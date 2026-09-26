import json
import os
from datetime import date
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine
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
    if "point" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE catalog ADD COLUMN point INTEGER NOT NULL DEFAULT 0"))
    wallet_columns = {c["name"] for c in inspect(engine).get_columns("wallet")}
    if "test_grant_applied" not in wallet_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE wallet ADD COLUMN test_grant_applied BOOLEAN NOT NULL DEFAULT FALSE"))


# catalog.json を正として図鑑テーブルを揃える。初回は全件投入し、既存DBでも
# 画像・クレジット・季節などの変更や、後から追加した天体が起動時に反映されるようにする。
# シードから消えた天体は、捕獲記録から参照されている可能性があるので削除しない。
def sync_catalog_from_seed():
    raw = json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))
    with Session(engine) as session:
        for item in raw:
            # 値の決定はカタログ担当。未設定は報酬0で互換性を保つ。
            point = item.get("point", 0)
            if type(point) is not int or point < 0:
                raise ValueError(f"Invalid point for catalog entry: {item['id']}")
            fields = {**item, "capture_date": date.fromisoformat(item["capture_date"])}
            fields["point"] = point
            fields.setdefault("seasons", None)
            fields.setdefault("license_note", None)
            entry = session.get(CatalogEntry, item["id"])
            if entry is None:
                session.add(CatalogEntry(**fields))
                continue
            for key, value in fields.items():
                if getattr(entry, key) != value:
                    setattr(entry, key, value)
        session.commit()
