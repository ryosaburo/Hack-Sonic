"""交換と報酬の永続化。SQLiteの書込トランザクションで再送・競合を直列化する。"""
import json
import os
from contextlib import contextmanager
from pathlib import Path

from sqlmodel import Session, select

from .models import CatalogEntry, User, Wallet

# TODO: catalog.json の point 確定後、shop.json の交換価格・効果量を再調整する。
SHOP = json.loads((Path(__file__).parent / "data/shop.json").read_text())
PRODUCTS = {p["id"]: p for p in SHOP["products"]}
# 天体ごとの「釣れやすい場所」の開示価格（レア度別）。交換所の商品一覧には出さない
AREA_INFO_PRICES: dict[str, int] = SHOP["area_info_prices"]
AREA_INFO_PREFIX = "area_info:"


def purchase_limit(product: dict) -> int | None:
    """同じ商品を持てる上限。消耗品は上限なし、それ以外は max_count（既定1）まで。"""
    if product["kind"] == "consumable":
        return None
    return product.get("max_count", 1)


def owned_spots(inventory: dict) -> list[dict]:
    """釣り場情報は1回の交換で1か所ずつ、shop.json に並べた順に開示する。"""
    spots = []
    for product_id in dict.fromkeys(s["product"] for s in SHOP["spots"]):
        count = inventory.get(product_id, 0)
        spots += [s for s in SHOP["spots"] if s["product"] == product_id][:count]
    return spots


def area_info_key(species_id: str) -> str:
    # 開示済みの印は所持品に「area_info:<天体ID>」として持つ
    return f"{AREA_INFO_PREFIX}{species_id}"


def revealed_areas(session: Session, wallet: Wallet | None) -> dict[str, dict]:
    """開示済みの天体の座標範囲だけを返す（未開示の座標は伏せたまま）。"""
    inventory = wallet.inventory if wallet else {}
    areas = {}
    for key, count in inventory.items():
        if not key.startswith(AREA_INFO_PREFIX) or count < 1:
            continue
        entry = session.get(CatalogEntry, key.removeprefix(AREA_INFO_PREFIX))
        area = (entry.catch_bonus or {}).get("area") if entry else None
        if area:
            areas[entry.id] = area
    return areas


@contextmanager
def economy_transaction(session: Session, user_id: int):
    # 認証の読取トランザクションを終了してからロックする。呼出元で変更はまだ行わない。
    session.rollback()
    try:
        if session.get_bind().dialect.name == "sqlite":
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        else:
            session.exec(select(User).where(User.id == user_id).with_for_update()).one()
        yield
        session.commit()
    except Exception:
        session.rollback()
        raise


def wallet_for(session: Session, user_id: int) -> Wallet:
    wallet = session.get(Wallet, user_id)
    if wallet is None:
        wallet = Wallet(user_id=user_id)
        session.add(wallet)
    return wallet


def wallet_public(wallet: Wallet | None) -> dict:
    inventory = wallet.inventory if wallet else {}
    return {
        "balance": wallet.balance if wallet else 0,
        "inventory": dict(inventory),
        "equipped": {
            product_id: bool(inventory.get(product_id) and wallet and (wallet.equipped or {}).get(product_id))
            for product_id in ("time_extension", "power_reel")
        },
        "spots": owned_spots(inventory),
    }


def configured_test_points() -> int:
    """ローカル検証用。未設定なら通常のポイント付与だけを使う。"""
    raw = os.getenv("SPACE_FISHING_TEST_POINTS", "0")
    if not raw.isascii() or not raw.isdecimal() or int(raw) > 1_000_000:
        raise ValueError("SPACE_FISHING_TEST_POINTS must be an integer from 0 to 1000000")
    return int(raw)


RARITY_ORDER = ["common", "rare", "super_rare", "legendary"]


def lure_rarities(available: set[str]) -> set[str]:
    """誘引ルアーを使った1投は、商品の min_rarity 以上だけを候補にする（その季節に該当がなければ絞らない）。"""
    lowest = RARITY_ORDER.index(PRODUCTS["lure"]["min_rarity"])
    return {r for r in available if RARITY_ORDER.index(r) >= lowest} or available


def rarity_multipliers(x: float, y: float, use_lure: bool) -> list[float]:
    # 釣り場は購入前から存在する。重複範囲では最大の補正を使う。
    multipliers = [1.0] * 4
    for spot in SHOP["spots"]:
        if spot["x_min"] <= x <= spot["x_max"] and spot["y_min"] <= y <= spot["y_max"]:
            multipliers = [max(a, b) for a, b in zip(multipliers, spot["rarity_multipliers"])]
    if use_lure:
        multipliers = [a * b for a, b in zip(multipliers, PRODUCTS["lure"]["rarity_multipliers"])]
    # TODO: pointと実際の成功率を見て併用上限を調整する。
    return [min(m, 6) for m in multipliers]
