"""User profile CRUD endpoints."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

router = APIRouter()


class ProfileOut(BaseModel):
    research_domain: Optional[str] = None
    experience_level: Optional[str] = None
    language_preference: Optional[str] = None
    communication_style: Optional[str] = None
    notes: Optional[str] = None


class ProfilePatch(BaseModel):
    research_domain: Optional[str] = None
    experience_level: Optional[str] = None
    language_preference: Optional[str] = None
    communication_style: Optional[str] = None
    notes: Optional[str] = None


@router.get("", response_model=ProfileOut)
async def get_profile():
    from tune.core.database import get_session_factory
    from tune.core.analysis.engine import _get_or_create_user_profile

    async with get_session_factory()() as session:
        profile = await _get_or_create_user_profile(session)
        await session.commit()
        return ProfileOut(
            research_domain=profile.research_domain,
            experience_level=profile.experience_level,
            language_preference=profile.language_preference,
            communication_style=profile.communication_style,
            notes=profile.notes,
        )


@router.patch("", response_model=ProfileOut)
async def update_profile(patch: ProfilePatch):
    from tune.core.database import get_session_factory
    from tune.core.analysis.engine import _get_or_create_user_profile

    async with get_session_factory()() as session:
        profile = await _get_or_create_user_profile(session)
        for field, value in patch.model_dump(exclude_unset=True).items():
            setattr(profile, field, value)
        await session.commit()
        return ProfileOut(
            research_domain=profile.research_domain,
            experience_level=profile.experience_level,
            language_preference=profile.language_preference,
            communication_style=profile.communication_style,
            notes=profile.notes,
        )
