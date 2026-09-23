from datetime import datetime, date, timezone
from typing import Optional

from sqlmodel import SQLModel, Field


class CatalogEntry(SQLModel, table=True):
    __tablename__ = "catalog"

    id: str = Field(primary_key=True)
    body_name: str
    mission_name: str
    image_url: str
    credit_text: str
    rarity: str
    weight: int
    capture_date: date
    flavor_text: str
    license_note: Optional[str] = None


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: Optional[int] = Field(default=None, primary_key=True)
    device_id: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Collection(SQLModel, table=True):
    __tablename__ = "collections"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    species_id: str = Field(foreign_key="catalog.id", index=True)
    first_caught_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    catch_count: int = Field(default=1)


# ---- APIレスポンス用スキーマ ----

class CatalogEntryPublic(SQLModel):
    id: str
    body_name: str
    mission_name: str
    image_url: str
    credit_text: str
    rarity: str
    weight: int
    capture_date: date
    flavor_text: str


class CollectionPublic(SQLModel):
    species_id: str
    first_caught_at: datetime
    catch_count: int


class CastStartResponse(SQLModel):
    attempt_id: str
    rarity: str
    time_limit: float


class CastResolveRequest(SQLModel):
    attempt_id: str
    success: bool


class CastResolveResponse(SQLModel):
    success: bool
    entry: Optional[CatalogEntryPublic] = None
    is_new_species: bool = False
    catch_count: int = 0
