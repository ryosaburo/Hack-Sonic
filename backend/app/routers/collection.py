from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..database import get_session
from ..deps import get_current_user
from ..models import Collection, CollectionPublic, User

router = APIRouter(prefix="/api/collection", tags=["collection"])


@router.get("", response_model=list[CollectionPublic])
def get_collection(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    return session.exec(select(Collection).where(Collection.user_id == user.id)).all()
