"""Samples API routes — CRUD for BioSample records."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Optional

from tune.core.database import get_session
from tune.core.models import Sample

router = APIRouter()


class SampleCreate(BaseModel):
    project_id: str
    sample_name: str
    organism: Optional[str] = None
    attrs: Optional[dict[str, Any]] = None


class SampleUpdate(BaseModel):
    sample_name: Optional[str] = None
    organism: Optional[str] = None
    attrs: Optional[dict[str, Any]] = None


def _sample_dict(s: Sample) -> dict:
    return {
        "id": s.id,
        "project_id": s.project_id,
        "sample_name": s.sample_name,
        "organism": s.organism,
        "attrs": s.attrs or {},
        "created_at": s.created_at,
    }


@router.get("/")
async def list_samples(project_id: str, session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            select(Sample).where(Sample.project_id == project_id).order_by(Sample.sample_name)
        )
    ).scalars().all()
    return [_sample_dict(s) for s in rows]


@router.post("/", status_code=201)
async def create_sample(body: SampleCreate, session: AsyncSession = Depends(get_session)):
    s = Sample(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        sample_name=body.sample_name,
        organism=body.organism,
        attrs=body.attrs or {},
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return _sample_dict(s)


@router.patch("/{sample_id}")
async def update_sample(
    sample_id: str,
    body: SampleUpdate,
    session: AsyncSession = Depends(get_session),
):
    s = (await session.execute(select(Sample).where(Sample.id == sample_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Sample not found")
    if body.sample_name is not None:
        s.sample_name = body.sample_name
    if body.organism is not None:
        s.organism = body.organism
    if body.attrs is not None:
        # Merge attrs (additive update) — always copy to force SQLAlchemy dirty detection
        current = dict(s.attrs or {})
        current.update(body.attrs)
        s.attrs = current
    await session.commit()
    await session.refresh(s)
    return _sample_dict(s)


@router.delete("/{sample_id}", status_code=200)
async def delete_sample(sample_id: str, session: AsyncSession = Depends(get_session)):
    s = (await session.execute(select(Sample).where(Sample.id == sample_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Sample not found")
    await session.delete(s)
    await session.commit()
    return {"ok": True}
