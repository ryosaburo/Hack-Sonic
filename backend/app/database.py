import json
import os
from datetime import date
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from dotenv import load_dotenv

from .models import CatalogEntry, Collection

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./dev.db")
CATALOG_SEED_PATH = Path(__file__).parent / "data" / "catalog.json"
# カタログから外した天体のID。既存DBからも、その天体の収集記録ごと削除する
RETIRED_CATALOG_IDS = ["slim_landing"]  # slim_touchdown に改名

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
            _remove_retired_entries(session)
            _sync_seasons(session, raw)
            _add_new_entries(session, raw)
            return
        for item in raw:
            session.add(_to_entry(item))
        session.commit()


def _to_entry(item: dict) -> CatalogEntry:
    return CatalogEntry(**{**item, "capture_date": date.fromisoformat(item["capture_date"])})


def _remove_retired_entries(session: Session):
    retired = session.exec(select(CatalogEntry).where(CatalogEntry.id.in_(RETIRED_CATALOG_IDS))).all()
    if not retired:
        return
    # 外部キーで参照している収集記録を先に消す（図鑑の収録数に数えられないように）
    records = session.exec(select(Collection).where(Collection.species_id.in_(RETIRED_CATALOG_IDS))).all()
    for record in records:
        session.delete(record)
    session.flush()
    for entry in retired:
        session.delete(entry)
    session.commit()


# シードに後から足された天体を既存DBにも追加する（既存の行は上書きしない）
def _add_new_entries(session: Session, raw: list[dict]):
    known = set(session.exec(select(CatalogEntry.id)).all())
    new_items = [item for item in raw if item["id"] not in known]
    for item in new_items:
        session.add(_to_entry(item))
    if new_items:
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
