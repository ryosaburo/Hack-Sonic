from fastapi import Depends, Header, HTTPException
from sqlmodel import Session, select
from sqlalchemy.exc import IntegrityError

from .database import get_session
from .models import User


def get_current_user(
    x_device_id: str | None = Header(default=None, alias="X-Device-Id"),
    session: Session = Depends(get_session),
) -> User:
    if not x_device_id:
        raise HTTPException(status_code=400, detail="X-Device-Id header is required")

    user = session.exec(select(User).where(User.device_id == x_device_id)).first()
    if user:
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
