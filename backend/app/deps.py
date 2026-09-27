from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from .auth import bearer_token, verify_access_token
from .database import get_session
from .models import User


def get_current_user(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    authorization: str | None = Header(default=None),
    session: Session = Depends(get_session),
) -> User:
    token = bearer_token(authorization)
    if token:
        return _account_user(session, verify_access_token(token), x_device_id)

    if not x_device_id:
        raise HTTPException(status_code=400, detail="X-Device-Id header is required")

    user = session.exec(select(User).where(User.device_id == x_device_id)).first()
    if user:
        # アカウントに引き継いだ端末の進行データは、ログアウト後に端末IDだけでは触らせない
        if user.auth_user_id:
            raise HTTPException(status_code=401, detail="Login required")
        return user

    user = User(device_id=x_device_id)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        # 初回のカタログ・残高・図鑑取得が並行しても同じ匿名ユーザーを使う。
        session.rollback()
        return session.exec(select(User).where(User.device_id == x_device_id)).one()
    session.refresh(user)
    return user


def _account_user(session: Session, auth_user_id: str, device_id: str | None) -> User:
    user = session.exec(select(User).where(User.auth_user_id == auth_user_id)).first()
    if user:
        return user

    # 初めてログインしたときは、その端末でログインせずに遊んでいた進行データをアカウントに引き継ぐ
    device_user = session.exec(select(User).where(User.device_id == device_id)).first() if device_id else None
    if device_user and not device_user.auth_user_id:
        device_user.auth_user_id = auth_user_id
        user = device_user
    else:
        user = User(device_id=f"account:{auth_user_id}", auth_user_id=auth_user_id)
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        # ログイン直後の並行リクエストが先に紐づけていれば、そちらを使う
        session.rollback()
        return session.exec(select(User).where(User.auth_user_id == auth_user_id)).one()
    session.refresh(user)
    return user
