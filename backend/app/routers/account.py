import math

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator
from sqlmodel import Session

from ..database import get_session
from ..deps import get_current_user
from ..models import Season, User

router = APIRouter(prefix="/api/me", tags=["account"])


class ResumeState(BaseModel):
    pan_x: float
    pan_y: float
    season: Season

    @field_validator("pan_x", "pan_y")
    @classmethod
    def finite(cls, value: float) -> float:
        if not math.isfinite(value):
            raise ValueError("must be finite")
        return value


class Me(BaseModel):
    logged_in: bool
    resume: ResumeState | None


def _resume_of(user: User) -> ResumeState | None:
    if user.resume_pan_x is None or user.resume_pan_y is None or user.resume_season is None:
        return None
    return ResumeState(pan_x=user.resume_pan_x, pan_y=user.resume_pan_y, season=user.resume_season)


@router.get("", response_model=Me)
def get_me(user: User = Depends(get_current_user)):
    return Me(logged_in=user.auth_user_id is not None, resume=_resume_of(user))


@router.put("/resume", response_model=ResumeState)
def save_resume(
    body: ResumeState,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    user.resume_pan_x = body.pan_x
    user.resume_pan_y = body.pan_y
    user.resume_season = body.season
    session.add(user)
    session.commit()
    return body
