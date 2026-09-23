import random
import time
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..deps import get_current_user
from ..models import (
    CastResolveRequest,
    CastResolveResponse,
    CastStartResponse,
    CatalogEntry,
    Collection,
    User,
)

router = APIRouter(prefix="/api/cast", tags=["cast"])

# 仕様書4章: 抽選確率
RARITY_WEIGHTS = {
    "common": 70,
    "rare": 20,
    "super_rare": 8,
    "legendary": 2,
}

# 仕様書6章: レア度別の制限時間
RARITY_TIME_LIMIT = {
    "common": 20.0,
    "rare": 17.0,
    "super_rare": 14.0,
    "legendary": 12.0,
}

ATTEMPT_TTL_SECONDS = 5 * 60


@dataclass
class Attempt:
    user_id: int
    rarity: str
    created_at: float


# MVP: 単一プロセス内のメモリ上でミニゲームの試行を管理する（永続化テーブルは仕様上不要）。
_attempts: dict[str, Attempt] = {}


def _cleanup_expired_attempts():
    now = time.time()
    expired = [k for k, v in _attempts.items() if now - v.created_at > ATTEMPT_TTL_SECONDS]
    for k in expired:
        _attempts.pop(k, None)


def _draw_rarity() -> str:
    rarities = list(RARITY_WEIGHTS.keys())
    weights = list(RARITY_WEIGHTS.values())
    return random.choices(rarities, weights=weights, k=1)[0]


@router.post("/start", response_model=CastStartResponse)
def cast_start(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _cleanup_expired_attempts()
    rarity = _draw_rarity()
    attempt_id = str(uuid.uuid4())
    _attempts[attempt_id] = Attempt(user_id=user.id, rarity=rarity, created_at=time.time())
    return CastStartResponse(
        attempt_id=attempt_id,
        rarity=rarity,
        time_limit=RARITY_TIME_LIMIT[rarity],
    )


def _draw_entry_for_rarity(session: Session, rarity: str) -> CatalogEntry | None:
    candidates = session.exec(select(CatalogEntry).where(CatalogEntry.rarity == rarity)).all()
    if not candidates:
        return None
    weights = [c.weight for c in candidates]
    return random.choices(candidates, weights=weights, k=1)[0]


@router.post("/resolve", response_model=CastResolveResponse)
def cast_resolve(
    body: CastResolveRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    attempt = _attempts.pop(body.attempt_id, None)
    if not attempt or attempt.user_id != user.id:
        raise HTTPException(status_code=404, detail="attempt not found or expired")

    if not body.success:
        return CastResolveResponse(success=False)

    entry = _draw_entry_for_rarity(session, attempt.rarity)
    if entry is None:
        raise HTTPException(status_code=500, detail="no catalog entries for this rarity")

    existing = session.exec(
        select(Collection).where(
            Collection.user_id == user.id, Collection.species_id == entry.id
        )
    ).first()

    is_new_species = existing is None
    if existing:
        existing.catch_count += 1
        session.add(existing)
        catch_count = existing.catch_count
    else:
        record = Collection(user_id=user.id, species_id=entry.id, catch_count=1)
        session.add(record)
        catch_count = 1
    session.commit()

    return CastResolveResponse(
        success=True,
        entry=entry,
        is_new_species=is_new_species,
        catch_count=catch_count,
    )
