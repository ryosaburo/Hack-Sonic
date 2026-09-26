import json

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.database import CATALOG_SEED_PATH, engine, sync_catalog_from_seed
from app.main import app
from app.models import CatalogEntry


def test_sync_restores_stale_entries_from_seed():
    seed = {e["id"]: e for e in json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))}
    with TestClient(app):
        # 画像差し替え前のDBを想定して、古い画像パスとクレジットに書き換える
        with Session(engine) as session:
            entry = session.get(CatalogEntry, "itokawa")
            entry.image_url = "/catalog-images/itokawa.svg"
            entry.credit_text = "古いクレジット"
            session.add(entry)
            session.commit()

        sync_catalog_from_seed()

        with Session(engine) as session:
            entry = session.get(CatalogEntry, "itokawa")
            assert entry.image_url == seed["itokawa"]["image_url"]
            assert entry.credit_text == seed["itokawa"]["credit_text"]


def test_catalog_api_serves_seed_images_and_credits():
    seed = {e["id"]: e for e in json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))}
    with TestClient(app) as client:
        for entry in client.get("/api/catalog").json():
            assert entry["image_url"] == seed[entry["id"]]["image_url"]
            assert entry["credit_text"] == seed[entry["id"]]["credit_text"]
