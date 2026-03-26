"""Metadata Assistant API — task submission and proposal management."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.database import get_session, get_session_factory
from tune.core.models import MetadataProposal

router = APIRouter()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

_VALID_TASK_TYPES = {
    "infer-samples",
    "fill-samples",
    "fill-experiments",
    "link-files",
    "check-gaps",
}


class TaskRequest(BaseModel):
    project_id: str
    task_type: str
    instruction: Optional[str] = None


class ApplyRequest(BaseModel):
    accepted_keys: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _proposal_dict(p: MetadataProposal) -> dict:
    return {
        "id": p.id,
        "project_id": p.project_id,
        "task_type": p.task_type,
        "status": p.status,
        "instruction": p.instruction,
        "payload": p.payload,
        "created_at": p.created_at,
        "applied_at": p.applied_at,
    }


async def _run_task(proposal_id: str, task_type: str, project_id: str, instruction: str | None) -> None:
    """Background coroutine — runs the task and updates the proposal."""
    from tune.core.metadata.tasks import (
        check_gaps_task,
        fill_experiments_task,
        fill_samples_task,
        infer_samples_task,
        link_files_task,
    )

    task_fn = {
        "infer-samples": infer_samples_task,
        "fill-samples": fill_samples_task,
        "fill-experiments": fill_experiments_task,
        "link-files": link_files_task,
        "check-gaps": check_gaps_task,
    }[task_type]

    async with get_session_factory()() as session:
        try:
            payload = await task_fn(project_id, session, instruction)
            proposal = (
                await session.execute(
                    select(MetadataProposal).where(MetadataProposal.id == proposal_id)
                )
            ).scalar_one_or_none()
            if proposal:
                proposal.status = "pending"
                proposal.payload = payload
                await session.commit()
        except Exception:
            async with get_session_factory()() as err_session:
                proposal = (
                    await err_session.execute(
                        select(MetadataProposal).where(MetadataProposal.id == proposal_id)
                    )
                ).scalar_one_or_none()
                if proposal:
                    proposal.status = "failed"
                    await err_session.commit()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/tasks", status_code=202)
async def submit_task(body: TaskRequest, session: AsyncSession = Depends(get_session)):
    if body.task_type not in _VALID_TASK_TYPES:
        raise HTTPException(422, f"Unknown task_type. Valid: {sorted(_VALID_TASK_TYPES)}")

    proposal = MetadataProposal(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        task_type=body.task_type,
        status="running",
        instruction=body.instruction,
    )
    session.add(proposal)
    await session.commit()
    await session.refresh(proposal)

    proposal_id = proposal.id
    asyncio.create_task(_run_task(proposal_id, body.task_type, body.project_id, body.instruction))

    return {"proposal_id": proposal_id, "status": "running"}


@router.get("/proposals")
async def list_proposals(
    project_id: str,
    status: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    q = select(MetadataProposal).where(MetadataProposal.project_id == project_id)
    if status:
        q = q.where(MetadataProposal.status == status)
    q = q.order_by(MetadataProposal.created_at.desc())
    rows = (await session.execute(q)).scalars().all()
    return [_proposal_dict(p) for p in rows]


@router.get("/proposals/{proposal_id}")
async def get_proposal(proposal_id: str, session: AsyncSession = Depends(get_session)):
    p = (
        await session.execute(
            select(MetadataProposal).where(MetadataProposal.id == proposal_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Proposal not found")
    return _proposal_dict(p)


@router.post("/proposals/{proposal_id}/apply")
async def apply_proposal(
    proposal_id: str,
    body: ApplyRequest,
    session: AsyncSession = Depends(get_session),
):
    from tune.core.metadata.tasks import apply_proposal_payload

    p = (
        await session.execute(
            select(MetadataProposal).where(MetadataProposal.id == proposal_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Proposal not found")
    if p.status not in ("pending",):
        raise HTTPException(409, f"Proposal status is '{p.status}', expected 'pending'")

    counts = await apply_proposal_payload(
        payload=p.payload or {},
        accepted_keys=body.accepted_keys,
        project_id=p.project_id,
        session=session,
    )

    p.status = "applied"
    p.applied_at = datetime.now(timezone.utc)
    await session.commit()

    return {"applied": True, "counts": counts}


@router.post("/proposals/{proposal_id}/discard")
async def discard_proposal(proposal_id: str, session: AsyncSession = Depends(get_session)):
    p = (
        await session.execute(
            select(MetadataProposal).where(MetadataProposal.id == proposal_id)
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Proposal not found")
    p.status = "discarded"
    await session.commit()
    return {"discarded": True}


# ---------------------------------------------------------------------------
# Startup cleanup — called from app lifespan
# ---------------------------------------------------------------------------


async def cleanup_stale_proposals() -> None:
    """Mark proposals stuck in 'running' for >5 minutes as 'failed'."""
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with get_session_factory()() as session:
        stale = (
            await session.execute(
                select(MetadataProposal).where(
                    MetadataProposal.status == "running",
                    MetadataProposal.created_at < cutoff,
                )
            )
        ).scalars().all()
        for p in stale:
            p.status = "failed"
        if stale:
            await session.commit()
