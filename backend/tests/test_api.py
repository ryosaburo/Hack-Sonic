from fastapi.testclient import TestClient

from app.main import app

RARITIES = {"common", "rare", "super_rare", "legendary"}


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
        assert len(data) == 9
        assert {"id", "body_name", "mission_name", "rarity", "flavor_text"} <= set(data[0].keys())


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
