import json

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.database import CATALOG_SEED_PATH, RETIRED_CATALOG_IDS, engine, sync_catalog_from_seed
from app.main import app
from app.models import CatalogEntry, Collection, User

RARITIES = {"common", "rare", "super_rare", "legendary"}
SEED_IDS = [item["id"] for item in json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))]


def test_root_ok():
    with TestClient(app) as client:
        res = client.get("/")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}


def test_catalog_lists_all_seeded_entries():
    with TestClient(app) as client:
        res = client.get("/api/catalog")
        assert res.status_code == 200
        data = res.json()
        assert len(data) == len(SEED_IDS)
        assert {"id", "body_name", "mission_name", "rarity", "flavor_text"} <= set(data[0].keys())


def test_seed_adds_new_entries_to_existing_db():
    with TestClient(app) as client:
        # シードに後から足された天体を、既存DBから消して再現する
        added_later = SEED_IDS[-1]
        with Session(engine) as session:
            session.delete(session.get(CatalogEntry, added_later))
            session.commit()

        sync_catalog_from_seed()

        ids = {e["id"] for e in client.get("/api/catalog").json()}
        assert ids == set(SEED_IDS)


def test_seed_removes_retired_entries_and_their_records():
    with TestClient(app) as client:
        headers = {"X-Device-Id": "retired-entry-device"}
        client.get("/api/collection", headers=headers)  # ユーザーを作る
        # 改名前のIDで釣った記録が残っている既存DBを再現する
        with Session(engine) as session:
            base = session.get(CatalogEntry, SEED_IDS[0])
            session.add(CatalogEntry(**{**base.model_dump(), "id": RETIRED_CATALOG_IDS[0]}))
            user = session.exec(select(User).where(User.device_id == headers["X-Device-Id"])).one()
            session.add(Collection(user_id=user.id, species_id=RETIRED_CATALOG_IDS[0]))
            session.commit()

        sync_catalog_from_seed()

        ids = {e["id"] for e in client.get("/api/catalog").json()}
        assert RETIRED_CATALOG_IDS[0] not in ids
        assert client.get("/api/collection", headers=headers).json() == []


def test_cast_start_returns_valid_rarity_and_time_limit():
    with TestClient(app) as client:
        res = client.post("/api/cast/start", headers={"X-Device-Id": "ci-device-1"})
        assert res.status_code == 200
        body = res.json()
        assert body["rarity"] in RARITIES
        assert body["time_limit"] > 0
        assert body["attempt_id"]


def test_cast_resolve_success_registers_collection():
    headers = {"X-Device-Id": "ci-device-2"}
    with TestClient(app) as client:
        start = client.post("/api/cast/start", headers=headers).json()

        resolve = client.post(
            "/api/cast/resolve",
            headers=headers,
            json={"attempt_id": start["attempt_id"], "success": True},
        )
        assert resolve.status_code == 200
        result = resolve.json()
        assert result["success"] is True
        assert result["is_new_species"] is True
        assert result["catch_count"] == 1
        assert result["entry"]["rarity"] == start["rarity"]

        collection = client.get("/api/collection", headers=headers)
        assert collection.status_code == 200
        assert len(collection.json()) == 1


def test_cast_resolve_failure_reports_no_entry():
    headers = {"X-Device-Id": "ci-device-3"}
    with TestClient(app) as client:
        start = client.post("/api/cast/start", headers=headers).json()
        resolve = client.post(
            "/api/cast/resolve",
            headers=headers,
            json={"attempt_id": start["attempt_id"], "success": False},
        )
        assert resolve.status_code == 200
        result = resolve.json()
        assert result["success"] is False
        assert result["entry"] is None


def test_cast_resolve_rejects_unknown_attempt():
    with TestClient(app) as client:
        res = client.post(
            "/api/cast/resolve",
            headers={"X-Device-Id": "ci-device-4"},
            json={"attempt_id": "does-not-exist", "success": True},
        )
        assert res.status_code == 404


def test_collection_requires_device_id_header():
    with TestClient(app) as client:
        res = client.get("/api/collection")
        assert res.status_code == 400
