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


def test_point_migration_sync_and_new_species_preserve_progress(tmp_path, monkeypatch):
    from sqlalchemy import text
    from sqlmodel import SQLModel, create_engine, select
    from app import database
    from app.models import Collection, User, Wallet

    isolated = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    SQLModel.metadata.create_all(isolated)
    # 実データには触れず、point列がない既存DBを再現する。
    with isolated.begin() as conn:
        conn.execute(text('ALTER TABLE catalog DROP COLUMN point'))
        conn.execute(text('ALTER TABLE wallet DROP COLUMN test_grant_applied'))
        conn.execute(text("INSERT INTO users (device_id, created_at) VALUES ('legacy-user', '2026-01-01T00:00:00')"))
        conn.execute(text("INSERT INTO wallet (user_id, balance, inventory) VALUES (1, 42, '{}')"))
    monkeypatch.setattr(database, 'engine', isolated)
    database.create_db_and_tables()
    with Session(isolated) as session:
        assert session.get(Wallet, 1).balance == 42
        assert session.get(Wallet, 1).test_grant_applied is False
    seed = json.loads(CATALOG_SEED_PATH.read_text())
    seed[0]['point'] = 23
    seed.append({**seed[0], 'id': 'new_constellation', 'point': 47})
    path = tmp_path / 'catalog.json'
    path.write_text(json.dumps(seed))
    monkeypatch.setattr(database, 'CATALOG_SEED_PATH', path)
    database.sync_catalog_from_seed()
    with Session(isolated) as session:
        user = User(device_id='migration-test')
        session.add(user)
        session.flush()
        user_id = user.id
        session.add(Collection(user_id=user.id, species_id=seed[0]['id'], catch_count=9))
        session.add(Wallet(user_id=user.id, balance=81, inventory={'time_extension': 1}))
        session.commit()
    seed[0]['point'] = 31
    path.write_text(json.dumps(seed))
    database.sync_catalog_from_seed()
    database.create_db_and_tables()
    with Session(isolated) as session:
        assert session.get(CatalogEntry, seed[0]['id']).point == 31
        assert session.get(CatalogEntry, 'new_constellation').point == 47
        assert session.exec(select(Collection)).one().catch_count == 9
        assert session.get(Wallet, user_id).balance == 81


def test_invalid_point_fails_without_partial_sync(tmp_path, monkeypatch):
    import pytest
    from app import database
    seed = json.loads(CATALOG_SEED_PATH.read_text())
    path = tmp_path / 'catalog.json'
    monkeypatch.setattr(database, 'CATALOG_SEED_PATH', path)
    for invalid in [-1, 2.5, True, '20']:
        seed[0]['point'] = invalid
        path.write_text(json.dumps(seed))
        with pytest.raises(ValueError, match='Invalid point'):
            database.sync_catalog_from_seed()
