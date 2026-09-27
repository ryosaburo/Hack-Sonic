import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.main import app

SECRET = "test-secret-for-hs256-signing-32bytes!"
SUPABASE_URL = "https://example.supabase.co"


@pytest.fixture(autouse=True)
def supabase_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", SECRET)


def token_for(sub: str, **overrides) -> str:
    secret = overrides.pop("secret", SECRET)
    claims = {"sub": sub, "aud": "authenticated", "iss": f"{SUPABASE_URL}/auth/v1", "exp": int(time.time()) + 3600}
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm="HS256")


def catch_one(client: TestClient, headers: dict) -> None:
    start = client.post("/api/cast/start", headers=headers).json()
    client.post("/api/cast/resolve", headers=headers, json={"attempt_id": start["attempt_id"], "success": True})
    client.post("/api/cast/decision", headers=headers, json={"attempt_id": start["attempt_id"], "decision": "keep"})


def test_first_login_takes_over_guest_progress():
    guest = {"X-Device-Id": "login-device-1"}
    with TestClient(app) as client:
        catch_one(client, guest)
        assert len(client.get("/api/collection", headers=guest).json()) == 1

        account = {**guest, "Authorization": f"Bearer {token_for('user-1')}"}
        assert len(client.get("/api/collection", headers=account).json()) == 1
        assert client.get("/api/me", headers=account).json()["logged_in"] is True

        # 別の端末で同じアカウントにログインしても、同じ進行データが見える
        other_device = {"X-Device-Id": "login-device-2", "Authorization": f"Bearer {token_for('user-1')}"}
        assert len(client.get("/api/collection", headers=other_device).json()) == 1


def test_guest_on_linked_device_needs_login_again():
    guest = {"X-Device-Id": "login-device-3"}
    with TestClient(app) as client:
        client.get("/api/collection", headers=guest)
        client.get("/api/me", headers={**guest, "Authorization": f"Bearer {token_for('user-2')}"})

        assert client.get("/api/collection", headers=guest).status_code == 401


def test_new_account_on_used_device_starts_fresh():
    device = {"X-Device-Id": "login-device-4"}
    with TestClient(app) as client:
        catch_one(client, device)
        client.get("/api/me", headers={**device, "Authorization": f"Bearer {token_for('user-3')}"})

        # この端末の進行データは user-3 に引き継ぎ済みなので、別アカウントは空から始まる
        another = {**device, "Authorization": f"Bearer {token_for('user-4')}"}
        assert client.get("/api/collection", headers=another).json() == []


@pytest.mark.parametrize("bad", [
    "not-a-jwt",
    token_for("user-5", exp=int(time.time()) - 10),
    token_for("user-5", aud="anon"),
    token_for("user-5", secret="wrong-secret-wrong-secret-wrong!!"),
])
def test_invalid_tokens_are_rejected(bad):
    with TestClient(app) as client:
        res = client.get("/api/me", headers={"X-Device-Id": "login-device-5", "Authorization": f"Bearer {bad}"})
        assert res.status_code == 401


def test_resume_is_saved_per_account():
    with TestClient(app) as client:
        first = {"X-Device-Id": "login-device-6", "Authorization": f"Bearer {token_for('user-6')}"}
        assert client.get("/api/me", headers=first).json()["resume"] is None

        body = {"pan_x": 1493.25, "pan_y": 461.29, "season": "winter"}
        assert client.put("/api/me/resume", headers=first, json=body).status_code == 200

        second = {"X-Device-Id": "login-device-7", "Authorization": f"Bearer {token_for('user-6')}"}
        assert client.get("/api/me", headers=second).json()["resume"] == body


def test_resume_rejects_unknown_season():
    with TestClient(app) as client:
        res = client.put(
            "/api/me/resume",
            headers={"X-Device-Id": "login-device-8"},
            json={"pan_x": 0, "pan_y": 0, "season": "rainy"},
        )
        assert res.status_code == 422
