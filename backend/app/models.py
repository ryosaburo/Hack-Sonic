from datetime import datetime, date, timezone
from typing import Literal, Optional
from uuid import uuid4

from sqlalchemy import JSON, Column
from sqlmodel import SQLModel, Field

Season = Literal["spring", "summer", "autumn", "winter"]


class CatalogEntry(SQLModel, table=True):
    __tablename__ = "catalog"

    id: str = Field(primary_key=True)
    body_name: str
    mission_name: str
    image_url: str
    credit_text: str
    rarity: str
    weight: int
    point: int = Field(default=0, ge=0)
    capture_date: date
    flavor_text: str
    license_note: Optional[str] = None
    # 釣れる季節。NULLなら四季を通して釣れる
    seasons: Optional[list[str]] = Field(default=None, sa_column=Column(JSON))
    # rare以上の天体が釣れやすくなる季節・座標。釣り場と同じく座標を伏せるため、公開APIには含めない
    catch_bonus: Optional[dict] = Field(default=None, sa_column=Column(JSON))


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
    point: int = 0
    capture_date: date
    flavor_text: str
    seasons: Optional[list[str]] = None


class CollectionPublic(SQLModel):
    species_id: str
    first_caught_at: datetime
    catch_count: int


class CastStartRequest(SQLModel):
    # 省略時は季節で絞り込まない
    season: Optional[Season] = None
    request_id: str = Field(default_factory=lambda: str(uuid4()), min_length=1, max_length=100)
    x: float = Field(default=0, ge=-1000000, le=1000000)
    y: float = Field(default=0, ge=-1000000, le=1000000)
    use_lure: bool = False


class CastStartResponse(SQLModel):
    attempt_id: str
    rarity: str
    time_limit: float
    damage_multiplier: float = 1
    economy: dict = Field(default_factory=dict)


class CastResolveRequest(SQLModel):
    attempt_id: str
    success: bool


class CastResolveResponse(SQLModel):
    success: bool
    entry: Optional[CatalogEntryPublic] = None
    is_new_species: bool = False
    catch_count: int = 0
    earned_points: int = 0
    economy: dict = Field(default_factory=dict)


class Wallet(SQLModel, table=True):
    user_id: int = Field(primary_key=True, foreign_key="users.id")
    balance: int = 0
    test_grant_applied: bool = False
    inventory: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    equipped: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))


class CastAttempt(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: int = Field(index=True, foreign_key="users.id")
    created_at: float
    request: dict = Field(sa_column=Column(JSON, nullable=False))
    start_result: dict = Field(sa_column=Column(JSON, nullable=False))
    species_id: str
    result: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    decision: Optional[str] = None


class Exchange(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="users.id")
    product_id: str


class ExchangeRequest(SQLModel):
    request_id: str = Field(min_length=1, max_length=100)
    product_id: str


class EquipmentRequest(SQLModel):
    product_id: Literal["time_extension", "power_reel"]
    equipped: bool


class AreaRevealRequest(SQLModel):
    request_id: str = Field(min_length=1, max_length=100)
    species_id: str


class CastDecisionRequest(SQLModel):
    attempt_id: str
    decision: Literal["keep", "release"]
