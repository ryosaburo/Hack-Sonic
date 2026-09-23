import json
import os
from datetime import date
from pathlib import Path

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


def seed_catalog_if_empty():
    with Session(engine) as session:
        existing = session.exec(select(CatalogEntry)).first()
        if existing:
            return
        raw = json.loads(CATALOG_SEED_PATH.read_text(encoding="utf-8"))
        for item in raw:
            item["capture_date"] = date.fromisoformat(item["capture_date"])
            session.add(CatalogEntry(**item))
        session.commit()
