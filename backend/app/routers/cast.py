import math
import random
import time

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlmodel import Session, select

from ..database import get_session
from ..deps import get_current_user
from ..economy import PRODUCTS, economy_transaction, lure_rarities, rarity_multipliers, wallet_for, wallet_public
from ..models import (
    CastAttempt, CastDecisionRequest, CastResolveRequest, CastResolveResponse,
    CastStartRequest, CastStartResponse, CatalogEntry, CatalogEntryPublic, Collection, User,
)

router = APIRouter(prefix="/api/cast", tags=["cast"])
RARITY_WEIGHTS = {"common": 70, "rare": 20, "super_rare": 8, "legendary": 2}
RARITY_TIME_LIMIT = {"common": 20.0, "rare": 17.0, "super_rare": 14.0, "legendary": 12.0}
ATTEMPT_TTL_SECONDS = 5 * 60


def _in_season_entries(session: Session, season: str | None) -> list[CatalogEntry]:
    entries = list(session.exec(select(CatalogEntry)).all())
    if season is None:
        return entries
    return [e for e in entries if e.seasons is None or season in e.seasons] or entries


def _draw_rarity(available: set[str], multipliers: list[float] | None = None) -> str:
    multipliers = multipliers or [1] * 4
    weights = {r: w * m for (r, w), m in zip(RARITY_WEIGHTS.items(), multipliers)}
    rarities = [r for r in weights if r in available] or list(weights)
    return random.choices(rarities, weights=[weights[r] for r in rarities], k=1)[0]


def _catch_weight(entry: CatalogEntry, season: str | None, x: float, y: float) -> float:
    # rare以上だけ、得意な季節・座標で同じレア度の中から選ばれやすくなる。commonはどこでも重みのまま
    bonus = entry.catch_bonus
    if not bonus or entry.rarity == "common":
        return entry.weight
    weight = entry.weight
    if season in bonus.get("seasons", []):
        weight *= bonus.get("season_multiplier", 1)
    area = bonus.get("area")
    # area は画面の「座標」表示の単位（ワールド座標の1/10、yは上向きが正）
    if area and math.hypot(x / 10 - area["x"], -y / 10 - area["y"]) <= area["radius"]:
        weight *= bonus.get("area_multiplier", 1)
    return weight


def _draw_entry(session: Session, rarity: str, season: str | None, x: float = 0, y: float = 0) -> CatalogEntry | None:
    candidates = [e for e in _in_season_entries(session, season) if e.rarity == rarity]
    if not candidates:
        return None
    return random.choices(candidates, weights=[_catch_weight(c, season, x, y) for c in candidates], k=1)[0]


@router.post("/start", response_model=CastStartResponse)
def cast_start(
    body: CastStartRequest | None = Body(default=None),
    session: Session = Depends(get_session), user: User = Depends(get_current_user),
):
    body = body or CastStartRequest()
    user_id = user.id
    attempt_id = f"{user_id}:{body.request_id}"
    with economy_transaction(session, user_id):
        wallet = wallet_for(session, user_id)
        existing = session.get(CastAttempt, attempt_id)
        if existing:
            if existing.request != body.model_dump():
                raise HTTPException(409, "request_id already used with different parameters")
            return existing.start_result
        if body.use_lure and wallet.inventory.get("lure", 0) < 1:
            raise HTTPException(409, "no lure available")
        candidates = _in_season_entries(session, body.season)
        if not candidates:
            raise HTTPException(409, "catalog is empty")
        available = {c.rarity for c in candidates}
        if body.use_lure:
            available = lure_rarities(available)
        rarity = _draw_rarity(available, rarity_multipliers(body.x, body.y, body.use_lure))
        entry = _draw_entry(session, rarity, body.season, body.x, body.y)
        if entry is None:
            raise HTTPException(409, "no catalog entry for rarity")
        if body.use_lure:
            wallet.inventory = {**wallet.inventory, "lure": wallet.inventory["lure"] - 1}
        seconds = PRODUCTS["time_extension"]["extra_seconds"] if wallet.inventory.get("time_extension") and wallet.equipped.get("time_extension") else 0
        damage = PRODUCTS["power_reel"]["damage_multiplier"] if wallet.inventory.get("power_reel") and wallet.equipped.get("power_reel") else 1
        result = CastStartResponse(
            attempt_id=attempt_id, rarity=rarity, time_limit=RARITY_TIME_LIMIT[rarity] + seconds,
            damage_multiplier=damage, economy=wallet_public(wallet),
        ).model_dump(mode="json")
        session.add(CastAttempt(
            id=attempt_id, user_id=user_id, created_at=time.time(), request=body.model_dump(),
            start_result=result, species_id=entry.id,
        ))
    return result


def _get_attempt(session: Session, attempt_id: str, user_id: int) -> CastAttempt:
    attempt = session.get(CastAttempt, attempt_id)
    if not attempt or attempt.user_id != user_id:
        raise HTTPException(404, "attempt not found")
    return attempt


def _collection(session: Session, user_id: int, species_id: str) -> Collection | None:
    return session.exec(select(Collection).where(
        Collection.user_id == user_id, Collection.species_id == species_id,
    )).first()


@router.post("/resolve", response_model=CastResolveResponse)
def cast_resolve(
    body: CastResolveRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user),
):
    user_id = user.id
    with economy_transaction(session, user_id):
        attempt = _get_attempt(session, body.attempt_id, user_id)
        wallet = wallet_for(session, user_id)
        if attempt.result is not None:
            if attempt.result["success"] != body.success:
                raise HTTPException(409, "attempt already resolved differently")
            return attempt.result
        if time.time() - attempt.created_at > ATTEMPT_TTL_SECONDS:
            raise HTTPException(410, "attempt expired")
        result = CastResolveResponse(success=body.success)
        if body.success:
            entry = session.get(CatalogEntry, attempt.species_id)
            if entry is None:
                raise HTTPException(409, "catalog entry unavailable")
            existing = _collection(session, user_id, entry.id)
            result.entry = CatalogEntryPublic.model_validate(entry)
            result.is_new_species = existing is None
            result.catch_count = (existing.catch_count if existing else 0) + 1
            if existing:
                existing.catch_count += 1
                wallet.balance += entry.point
                result.earned_points = entry.point
        result.economy = wallet_public(wallet)
        attempt.result = result.model_dump(mode="json")
    return result


@router.post("/decision")
def cast_decision(
    body: CastDecisionRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user),
):
    user_id = user.id
    with economy_transaction(session, user_id):
        attempt = _get_attempt(session, body.attempt_id, user_id)
        if not attempt.result or not attempt.result["success"] or not attempt.result["is_new_species"]:
            raise HTTPException(409, "no new catch awaiting decision")
        if attempt.decision and attempt.decision != body.decision:
            raise HTTPException(409, "decision already made")
        if not attempt.decision:
            if body.decision == "keep":
                existing = _collection(session, user_id, attempt.species_id)
                if existing:
                    existing.catch_count += 1
                else:
                    session.add(Collection(user_id=user_id, species_id=attempt.species_id))
            attempt.decision = body.decision
    return {"decision": body.decision}
