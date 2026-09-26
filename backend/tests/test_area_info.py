import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import CATALOG_SEED_PATH, engine
from app.economy import AREA_INFO_PRICES
from app.main import app
from app.models import User, Wallet

SEED = json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))


def _first(rarity):
    return next(e for e in SEED if e["rarity"] == rarity and "area" in e.get("catch_bonus", {}))


@pytest.fixture
def player():
    with TestClient(app) as client:
        headers = {"X-Device-Id": str(uuid4())}
        client.get("/api/economy", headers=headers)
        with Session(engine) as session:
            user_id = session.exec(select(User).where(User.device_id == headers["X-Device-Id"])).one().id
        yield client, headers, user_id


def fund(user_id, amount):
    with Session(engine) as session:
        wallet = session.get(Wallet, user_id) or Wallet(user_id=user_id)
        wallet.balance = amount
        session.add(wallet)
        session.commit()


def reveal(client, headers, species_id, request_id=None):
    body = {"request_id": request_id or str(uuid4()), "species_id": species_id}
    return client.post("/api/economy/reveal", headers=headers, json=body)


def test_area_is_hidden_until_revealed(player):
    client, headers, user_id = player
    rare = _first("rare")
    fund(user_id, 1000)
    assert client.get("/api/economy/areas", headers=headers).json() == {}
    assert "catch_bonus" not in client.get("/api/catalog").text

    res = reveal(client, headers, rare["id"])
    assert res.status_code == 200
    body = res.json()
    assert body["economy"]["balance"] == 1000 - AREA_INFO_PRICES["rare"]
    assert body["areas"] == {rare["id"]: rare["catch_bonus"]["area"]}
    assert client.get("/api/economy/areas", headers=headers).json() == {rare["id"]: rare["catch_bonus"]["area"]}


@pytest.mark.parametrize("rarity", ["rare", "super_rare", "legendary"])
def test_price_depends_on_rarity(player, rarity):
    client, headers, user_id = player
    fund(user_id, 1000)
    res = reveal(client, headers, _first(rarity)["id"])
    assert res.json()["economy"]["balance"] == 1000 - AREA_INFO_PRICES[rarity]


def test_replay_charges_once_and_second_purchase_is_rejected(player):
    client, headers, user_id = player
    rare = _first("rare")
    fund(user_id, 1000)
    request_id = str(uuid4())
    first = reveal(client, headers, rare["id"], request_id).json()
    assert reveal(client, headers, rare["id"], request_id).json() == first
    assert reveal(client, headers, rare["id"]).status_code == 409
    # 同じリクエストIDを別の天体に使い回すことはできない
    assert reveal(client, headers, _first("legendary")["id"], request_id).status_code == 409
    assert client.get("/api/economy", headers=headers).json()["balance"] == 1000 - AREA_INFO_PRICES["rare"]


def test_insufficient_points_keeps_area_hidden(player):
    client, headers, user_id = player
    fund(user_id, AREA_INFO_PRICES["legendary"] - 1)
    assert reveal(client, headers, _first("legendary")["id"]).status_code == 409
    assert client.get("/api/economy", headers=headers).json()["balance"] == AREA_INFO_PRICES["legendary"] - 1
    assert client.get("/api/economy/areas", headers=headers).json() == {}


def test_common_and_unknown_species_cannot_be_revealed(player):
    client, headers, user_id = player
    fund(user_id, 1000)
    common = next(e for e in SEED if e["rarity"] == "common")
    assert reveal(client, headers, common["id"]).status_code == 404
    assert reveal(client, headers, "no_such_body").status_code == 404
    assert client.get("/api/economy", headers=headers).json()["balance"] == 1000
