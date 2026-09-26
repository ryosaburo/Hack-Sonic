from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from ..database import get_session
from ..deps import get_current_user
from ..economy import PRODUCTS, configured_test_points, economy_transaction, wallet_for, wallet_public
from ..models import Exchange, ExchangeRequest, User, Wallet

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
            if product["kind"] != "consumable" and wallet.inventory.get(body.product_id, 0):
                raise HTTPException(409, "already owned")
            if wallet.balance < product["price"]:
                raise HTTPException(409, "insufficient points")
            wallet.balance -= product["price"]
            wallet.inventory = {**wallet.inventory, body.product_id: wallet.inventory.get(body.product_id, 0) + 1}
            session.add(Exchange(id=exchange_id, user_id=user_id, product_id=body.product_id))
        result = wallet_public(wallet)
    return result
