import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import engine
from app.main import app
from app.models import CatalogEntry
from app.routers import cast


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def seasonal_legendaries(client):
    """既存の伝説を夏限定にし、冬限定の伝説を1体足す（春・秋に釣れる伝説は無くなる）。"""
    with Session(engine) as session:
        legendaries = session.exec(select(CatalogEntry).where(CatalogEntry.rarity == "legendary")).all()
        original = {e.id: e.seasons for e in legendaries}
        for e in legendaries:
            e.seasons = ["summer"]
            session.add(e)
        base = legendaries[0]
        session.add(
            CatalogEntry(
                id="test_winter_legend",
                body_name="冬限定の星",
                mission_name=base.mission_name,
                image_url=base.image_url,
                credit_text=base.credit_text,
                rarity="legendary",
                weight=1,
                capture_date=base.capture_date,
                flavor_text="テスト用",
                seasons=["winter"],
            )
        )
        session.commit()

    yield

    with Session(engine) as session:
        session.delete(session.get(CatalogEntry, "test_winter_legend"))
        for entry_id, seasons in original.items():
            entry = session.get(CatalogEntry, entry_id)
            entry.seasons = seasons
            session.add(entry)
        session.commit()


@pytest.fixture
def force_legendary(monkeypatch):
    monkeypatch.setattr(cast, "_draw_rarity", lambda available, multipliers=None: "legendary")


def _cast(client, device_id, season):
    headers = {"X-Device-Id": device_id}
    start = client.post("/api/cast/start", headers=headers, json={"season": season})
    assert start.status_code == 200
    resolve = client.post(
        "/api/cast/resolve",
        headers=headers,
        json={"attempt_id": start.json()["attempt_id"], "success": True},
    )
    assert resolve.status_code == 200
    return start.json()["rarity"], resolve.json()["entry"]


def test_catalog_exposes_seasons(client):
    data = client.get("/api/catalog").json()
    assert all("seasons" in e for e in data)


def test_cast_start_rejects_unknown_season(client):
    res = client.post("/api/cast/start", headers={"X-Device-Id": "season-1"}, json={"season": "rainy"})
    assert res.status_code == 422


def test_resolve_draws_only_entries_in_season(client, seasonal_legendaries, force_legendary):
    for _ in range(10):
        _, entry = _cast(client, "season-2", "winter")
        assert entry["id"] == "test_winter_legend"
    for _ in range(10):
        _, entry = _cast(client, "season-2", "summer")
        assert entry["id"] != "test_winter_legend"
        assert "summer" in entry["seasons"]


def test_rarity_without_in_season_entries_is_never_drawn(client, seasonal_legendaries):
    # 春に釣れる伝説は無いので、伝説は抽選されず resolve も必ず天体を返す
    for _ in range(100):
        rarity, entry = _cast(client, "season-3", "spring")
        assert rarity != "legendary"
        assert entry["rarity"] == rarity


def test_no_season_keeps_every_entry_as_candidate(seasonal_legendaries):
    # 季節を送らない旧クライアントでは、季節限定の天体も含めて全体から抽選する
    with Session(engine) as session:
        ids = {e.id for e in cast._in_season_entries(session, None)}
        total = len(session.exec(select(CatalogEntry)).all())
    assert "test_winter_legend" in ids
    assert len(ids) == total


def test_draw_rarity_skips_rarities_without_candidates():
    assert {cast._draw_rarity({"rare", "legendary"}) for _ in range(200)} <= {"rare", "legendary"}
    assert cast._draw_rarity(set()) in cast.RARITY_WEIGHTS
