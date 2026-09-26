from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import engine
from app.economy import PRODUCTS, lure_rarities
from app.main import app
from app.models import User, Wallet
from app.routers import cast

ALL = {"common", "rare", "super_rare", "legendary"}


def test_lure_keeps_only_super_rare_and_above():
    assert lure_rarities(ALL) == {"super_rare", "legendary"}
    assert lure_rarities({"common", "legendary"}) == {"legendary"}
    # その季節にスーパーレア以上がいなければ絞らない（釣りそのものは続けられる）
    assert lure_rarities({"common", "rare"}) == {"common", "rare"}


def test_lure_ratio_between_super_rare_and_legendary(monkeypatch):
    observed = {}

    def choices(values, weights, k):
        observed.update(zip(values, weights))
        return [values[0]]

    monkeypatch.setattr(cast.random, "choices", choices)
    cast._draw_rarity(lure_rarities(ALL), [1, 1.5, 2, 3])
    # 通常の比 8:2 にルアーの倍率 ×2・×3 が掛かり、スーパーレア約73% / 伝説約27%
    assert observed == {"super_rare": 16, "legendary": 6}


def test_lure_price_makes_farming_unprofitable():
    # 既知の天体の報酬（SR 100pt / 伝説 300pt）の期待値を、ルアーの価格が上回る
    expected_reward = (16 * 100 + 6 * 300) / 22
    assert PRODUCTS["lure"]["price"] > expected_reward


@pytest.mark.parametrize("season", ["spring", "summer", "autumn", "winter"])
def test_every_lure_cast_hooks_super_rare_or_above(season):
    with TestClient(app) as client:
        headers = {"X-Device-Id": str(uuid4())}
        client.get("/api/economy", headers=headers)
        casts = 40
        with Session(engine) as session:
            user = session.exec(select(User).where(User.device_id == headers["X-Device-Id"])).one()
            wallet = session.get(Wallet, user.id) or Wallet(user_id=user.id)
            wallet.inventory = {"lure": casts}
            session.add(wallet)
            session.commit()
        for _ in range(casts):
            body = {"request_id": str(uuid4()), "season": season, "use_lure": True}
            res = client.post("/api/cast/start", headers=headers, json=body)
            assert res.status_code == 200
            assert res.json()["rarity"] in {"super_rare", "legendary"}
        assert client.get("/api/economy", headers=headers).json()["inventory"]["lure"] == 0
