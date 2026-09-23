from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..database import get_session
from ..models import CatalogEntry, CatalogEntryPublic

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("", response_model=list[CatalogEntryPublic])
def list_catalog(session: Session = Depends(get_session)):
    return session.exec(select(CatalogEntry)).all()
