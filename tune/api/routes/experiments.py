"""Experiments API routes — CRUD for SRA Experiment records."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Any, Optional

from tune.core.database import get_session
from tune.core.models import Experiment

router = APIRouter()


class ExperimentCreate(BaseModel):
    project_id: str
    sample_id: str
    library_strategy: Optional[str] = None
    library_source: Optional[str] = None
    library_selection: Optional[str] = None
    library_layout: Optional[str] = None
    platform: Optional[str] = None
    instrument_model: Optional[str] = None
    attrs: Optional[dict[str, Any]] = None


class ExperimentUpdate(BaseModel):
    sample_id: Optional[str] = None
    library_strategy: Optional[str] = None
    library_source: Optional[str] = None
    library_selection: Optional[str] = None
    library_layout: Optional[str] = None
    platform: Optional[str] = None
    instrument_model: Optional[str] = None
    attrs: Optional[dict[str, Any]] = None


def _exp_dict(e: Experiment) -> dict:
    return {
        "id": e.id,
        "project_id": e.project_id,
        "sample_id": e.sample_id,
        "library_strategy": e.library_strategy,
        "library_source": e.library_source,
        "library_selection": e.library_selection,
        "library_layout": e.library_layout,
        "platform": e.platform,
        "instrument_model": e.instrument_model,
        "attrs": e.attrs or {},
        "created_at": e.created_at,
    }


@router.get("/")
async def list_experiments(project_id: str, session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            select(Experiment)
            .where(Experiment.project_id == project_id)
            .order_by(Experiment.created_at)
        )
    ).scalars().all()
    return [_exp_dict(e) for e in rows]


@router.post("/", status_code=201)
async def create_experiment(body: ExperimentCreate, session: AsyncSession = Depends(get_session)):
    e = Experiment(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        sample_id=body.sample_id,
        library_strategy=body.library_strategy,
        library_source=body.library_source,
        library_selection=body.library_selection,
        library_layout=body.library_layout,
        platform=body.platform,
        instrument_model=body.instrument_model,
        attrs=body.attrs or {},
    )
    session.add(e)
    await session.commit()
    await session.refresh(e)
    return _exp_dict(e)


@router.patch("/{experiment_id}")
async def update_experiment(
    experiment_id: str,
    body: ExperimentUpdate,
    session: AsyncSession = Depends(get_session),
):
    e = (await session.execute(select(Experiment).where(Experiment.id == experiment_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Experiment not found")
    if body.sample_id is not None:
        e.sample_id = body.sample_id
    for field in ("library_strategy", "library_source", "library_selection",
                  "library_layout", "platform", "instrument_model"):
        val = getattr(body, field)
        if val is not None:
            setattr(e, field, val)
    if body.attrs is not None:
        current = dict(e.attrs or {})
        current.update(body.attrs)
        e.attrs = current
    await session.commit()
    await session.refresh(e)
    return _exp_dict(e)


@router.delete("/{experiment_id}", status_code=200)
async def delete_experiment(experiment_id: str, session: AsyncSession = Depends(get_session)):
    e = (await session.execute(select(Experiment).where(Experiment.id == experiment_id))).scalar_one_or_none()
    if not e:
        raise HTTPException(404, "Experiment not found")
    await session.delete(e)
    await session.commit()
    return {"ok": True}
