import json
import os
from datetime import date
from pathlib import Path

from sqlalchemy import inspect, text
from sqlmodel import SQLModel, Session, create_engine, select
from dotenv import load_dotenv

from .models import CatalogEntry, Collection

load_dotenv()



def normalize_database_url(url: str) -> str:
    """Supabase などが発行する postgres(ql):// の接続文字列を、同梱の psycopg 3 ドライバで使う形に揃える。"""
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url.removeprefix(prefix)
    return url


DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./dev.db"))
CATALOG_SEED_PATH = Path(__file__).parent / "data" / "catalog.json"
# カタログから外した天体のID。既存DBからも、その天体の収集記録ごと削除する
RETIRED_CATALOG_IDS = ["slim_landing"]  # slim_touchdown に改名

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, echo=False, connect_args={"check_same_thread": False})
else:
    # Supabase の接続プール（Supavisor）のトランザクションモードは prepared statement を使えないので無効にする。
    # 使い回す接続が切れていても落ちないよう、取り出すたびに生存確認する。
    engine = create_engine(
        DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        connect_args={"prepare_threshold": None},
    )


def get_session():
    with Session(engine) as session:
        yield session


def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()
    _enable_row_level_security()


# Supabase は public スキーマのテーブルを anon キーの REST API（PostgREST）にも公開する。
# ポリシーなしで RLS を有効にしてそこからの読み書きを塞ぐ。バックエンドはテーブルの所有者として
# 接続するので RLS の影響を受けない。
def _enable_row_level_security():
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            conn.execute(text(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY'))


# create_all は既存テーブルに列を足さないので、後から増えた列だけ追加する（マイグレーションツール導入までのつなぎ）
def _add_missing_columns():
    columns = {c["name"] for c in inspect(engine).get_columns("catalog")}
    if "seasons" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE catalog ADD COLUMN seasons JSON"))
    if "point" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE catalog ADD COLUMN point INTEGER NOT NULL DEFAULT 0"))
    if "catch_bonus" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE catalog ADD COLUMN catch_bonus JSON"))
    wallet_columns = {c["name"] for c in inspect(engine).get_columns("wallet")}
    if "test_grant_applied" not in wallet_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE wallet ADD COLUMN test_grant_applied BOOLEAN NOT NULL DEFAULT FALSE"))
    if "equipped" not in wallet_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE wallet ADD COLUMN equipped JSON NOT NULL DEFAULT '{}'"))


# catalog.json を正として図鑑テーブルを揃える。初回は全件投入し、既存DBでも
# 画像・クレジット・季節などの変更や、後から追加した天体が起動時に反映されるようにする。
# シードから消えた天体は、捕獲記録から参照されている可能性があるので削除しない
# （RETIRED_CATALOG_IDS に載せた天体だけは収集記録ごと削除する）。
def sync_catalog_from_seed():
    raw = json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))
    with Session(engine) as session:
        _remove_retired_entries(session)
        for item in raw:
            # 値の決定はカタログ担当。未設定は報酬0で互換性を保つ。
            point = item.get("point", 0)
            if type(point) is not int or point < 0:
                raise ValueError(f"Invalid point for catalog entry: {item['id']}")
            # テーブルに列がない項目は同期しない
            fields = {key: item.get(key) for key in CatalogEntry.model_fields}
            fields["capture_date"] = date.fromisoformat(item["capture_date"])
            fields["point"] = point
            entry = session.get(CatalogEntry, item["id"])
            if entry is None:
                session.add(CatalogEntry(**fields))
                continue
            for key, value in fields.items():
                if getattr(entry, key) != value:
                    setattr(entry, key, value)
        session.commit()


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
