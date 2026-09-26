from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..database import get_session
from ..deps import get_current_user
from ..economy import (
    AREA_INFO_PRICES, PRODUCTS, area_info_key, configured_test_points, economy_transaction,
    purchase_limit, revealed_areas, wallet_for, wallet_public,
)
from ..models import AreaRevealRequest, CatalogEntry, EquipmentRequest, Exchange, ExchangeRequest, User, Wallet

router = APIRouter(prefix="/api/economy", tags=["economy"])


@router.get("")
def get_economy(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    test_points = configured_test_points()
    if test_points:
        user_id = user.id
        with economy_transaction(session, user_id):
            wallet = wallet_for(session, user_id)
            if not wallet.test_grant_applied:
                wallet.balance += test_points
                wallet.test_grant_applied = True
            result = wallet_public(wallet)
        return result
    return wallet_public(session.get(Wallet, user.id))


@router.get("/products")
def products():
    # 未購入の釣り場の正確な座標は返さない。
    return list(PRODUCTS.values())


@router.post("/exchange")
def exchange(body: ExchangeRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    user_id = user.id
    exchange_id = f"{user_id}:{body.request_id}"
    with economy_transaction(session, user_id):
        wallet = wallet_for(session, user_id)
        existing = session.get(Exchange, exchange_id)
        if existing:
            if existing.product_id != body.product_id:
                raise HTTPException(409, "request_id already used for another product")
        else:
            product = PRODUCTS.get(body.product_id)
            if not product:
                raise HTTPException(404, "unknown product")
            limit = purchase_limit(product)
            if limit is not None and wallet.inventory.get(body.product_id, 0) >= limit:
                raise HTTPException(409, "already owned")
            if wallet.balance < product["price"]:
                raise HTTPException(409, "insufficient points")
            wallet.balance -= product["price"]
            wallet.inventory = {**wallet.inventory, body.product_id: wallet.inventory.get(body.product_id, 0) + 1}
            session.add(Exchange(id=exchange_id, user_id=user_id, product_id=body.product_id))
        result = wallet_public(wallet)
    return result


@router.put("/equipment")
def set_equipment(body: EquipmentRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    user_id = user.id
    with economy_transaction(session, user_id):
        wallet = wallet_for(session, user_id)
        if not wallet.inventory.get(body.product_id):
            raise HTTPException(409, "equipment not owned")
        wallet.equipped = {**wallet.equipped, body.product_id: body.equipped}
        result = wallet_public(wallet)
    return result


@router.get("/areas")
def areas(session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    return revealed_areas(session, session.get(Wallet, user.id))


@router.post("/reveal")
def reveal_area(body: AreaRevealRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    # 天体ごとの「釣れやすい場所」をポイントで開示する。再送は交換と同じくリクエストIDで一度だけ処理する
    user_id = user.id
    key = area_info_key(body.species_id)
    exchange_id = f"{user_id}:{body.request_id}"
    with economy_transaction(session, user_id):
        wallet = wallet_for(session, user_id)
        existing = session.get(Exchange, exchange_id)
        if existing:
            if existing.product_id != key:
                raise HTTPException(409, "request_id already used for another product")
        else:
            entry = session.get(CatalogEntry, body.species_id)
            price = AREA_INFO_PRICES.get(entry.rarity) if entry else None
            if price is None or not (entry.catch_bonus or {}).get("area"):
                raise HTTPException(404, "no area info for this species")
            if wallet.inventory.get(key, 0):
                raise HTTPException(409, "already owned")
            if wallet.balance < price:
                raise HTTPException(409, "insufficient points")
            wallet.balance -= price
            wallet.inventory = {**wallet.inventory, key: 1}
            session.add(Exchange(id=exchange_id, user_id=user_id, product_id=key))
        result = {"economy": wallet_public(wallet), "areas": revealed_areas(session, wallet)}
    return result
