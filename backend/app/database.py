import json
import os
from datetime import date
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from dotenv import load_dotenv

from .models import CatalogEntry

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
CATALOG_SEED_PATH = Path(__file__).parent / "data" / "catalog.json"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def get_session():
    with Session(engine) as session:
        yield session


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


# create_all は既存テーブルに列を足さないので、後から増えた列だけ追加する（マイグレーションツール導入までのつなぎ）
def _add_missing_columns():
    columns = {c["name"] for c in inspect(engine).get_columns("catalog")}
    if "seasons" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE catalog ADD COLUMN seasons JSON"))


def seed_catalog_if_empty():
    raw = json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))
    with Session(engine) as session:
        existing = session.exec(select(CatalogEntry)).first()
        if existing:
            _sync_seasons(session, raw)
            return
        for item in raw:
            item["capture_date"] = date.fromisoformat(item["capture_date"])
            session.add(CatalogEntry(**item))
        session.commit()


# 既存DBにもシードの季節設定を反映する（季節限定の天体を後から指定できるように）
def _sync_seasons(session: Session, raw: list[dict]):
    changed = False
    for item in raw:
        entry = session.get(CatalogEntry, item["id"])
        seasons = item.get("seasons")
        if entry and entry.seasons != seasons:
            entry.seasons = seasons
            session.add(entry)
            changed = True
    if changed:
        session.commit()
