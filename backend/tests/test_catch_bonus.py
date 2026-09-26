import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import CATALOG_SEED_PATH, engine
from app.main import app
from app.models import CatalogEntry
from app.routers import cast

BONUS = {
    "seasons": ["winter"],
    "season_multiplier": 2,
    "area": {"x": 420, "y": -13, "radius": 35},
    "area_multiplier": 3,
}
# 画面の座標 (420, -13) はワールド座標では (4200, 130)
IN_AREA = (4200, 130)
OUT_OF_AREA = (0, 0)


def _entry(rarity="rare", catch_bonus=BONUS):
    return CatalogEntry(
        id="bonus_test", body_name="", mission_name="", image_url="", credit_text="",
        rarity=rarity, weight=10, capture_date="2026-01-01", flavor_text="", catch_bonus=catch_bonus,
    )


@pytest.mark.parametrize(
    ("season", "position", "expected"),
    [
        ("summer", OUT_OF_AREA, 10),
        ("winter", OUT_OF_AREA, 20),
        ("summer", IN_AREA, 30),
        ("winter", IN_AREA, 60),
        (None, IN_AREA, 30),
    ],
)
def test_catch_weight_boosts_by_season_and_area(season, position, expected):
    assert cast._catch_weight(_entry(), season, *position) == expected


def test_area_boundary_is_inclusive():
    # 半径ちょうど（画面座標で x=455）は範囲内、それより外は範囲外
    assert cast._catch_weight(_entry(), None, 4550, 130) == 30
    assert cast._catch_weight(_entry(), None, 4560, 130) == 10


def test_common_and_entries_without_bonus_keep_their_weight():
    assert cast._catch_weight(_entry(rarity="common"), "winter", *IN_AREA) == 10
    assert cast._catch_weight(_entry(catch_bonus=None), "winter", *IN_AREA) == 10


def test_constellation_bonus_without_seasons_only_uses_area():
    bonus = {"area": BONUS["area"], "area_multiplier": 3}
    assert cast._catch_weight(_entry(rarity="legendary", catch_bonus=bonus), "winter", *OUT_OF_AREA) == 10
    assert cast._catch_weight(_entry(rarity="legendary", catch_bonus=bonus), "winter", *IN_AREA) == 30


def _seed():
    return {e["id"]: e for e in json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))}


def test_draw_entry_passes_season_and_position_to_weights(monkeypatch):
    observed = {}

    def choices(values, weights, k):
        observed.update({v.id: w for v, w in zip(values, weights)})
        return [values[0]]

    # 座標ボーナスを持つrare以上の天体の、範囲の中心へ投げる
    target = next(e for e in _seed().values() if e["rarity"] != "common" and "area" in e.get("catch_bonus", {}))
    area = target["catch_bonus"]["area"]
    season = (target.get("seasons") or ["winter"])[0]
    with TestClient(app):
        monkeypatch.setattr(cast.random, "choices", choices)
        with Session(engine) as session:
            cast._draw_entry(session, target["rarity"], season, area["x"] * 10, -area["y"] * 10)
            candidates = {e.id: e for e in session.exec(select(CatalogEntry)).all() if e.id in observed}
    assert observed == {
        entry_id: cast._catch_weight(entry, season, area["x"] * 10, -area["y"] * 10)
        for entry_id, entry in candidates.items()
    }
    assert observed[target["id"]] >= target["weight"] * target["catch_bonus"]["area_multiplier"]


def test_catch_bonus_is_synced_but_not_exposed():
    with TestClient(app) as client:
        with Session(engine) as session:
            for entry_id, item in _seed().items():
                assert session.get(CatalogEntry, entry_id).catch_bonus == item.get("catch_bonus")
        assert "catch_bonus" not in client.get("/api/catalog").text


def test_mock_catalog_bonus_matches_backend_seed():
    root = Path(__file__).resolve().parents[2]
    mock = json.loads((root / "frontend/src/data/catalog.mock.json").read_text(encoding="utf-8"))
    seed = json.loads((root / "backend/app/data/catalog.json").read_text(encoding="utf-8"))
    assert {e["id"]: e.get("catch_bonus") for e in mock} == {e["id"]: e.get("catch_bonus") for e in seed}
