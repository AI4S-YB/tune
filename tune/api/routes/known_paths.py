"""KnownPath API routes — per-project explicit resource registry.

Primary use:
- reference FASTA
- annotation files

Index keys remain accepted as legacy compatibility overrides, but runtime
resolution prefers DerivedResource / ResourceGraph for those resources.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.database import get_session
from tune.core.models import KnownPath, Project, ResourceEntity
from tune.core.resources.known_path_policy import known_path_policy_payload

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class KnownPathCreate(BaseModel):
    project_id: str
    key: str            # e.g. "reference_fasta", "hisat2_index", "annotation_gtf"
    path: str           # absolute filesystem path
    description: Optional[str] = None


class KnownPathUpdate(BaseModel):
    path: Optional[str] = None
    description: Optional[str] = None


class KnownPathUpsert(BaseModel):
    project_id: str
    key: str
    path: str
    description: Optional[str] = None


# ---------------------------------------------------------------------------
# Serializer
# ---------------------------------------------------------------------------

def _kp_dict(kp: KnownPath, language: str = "en") -> dict:
    return {
        "id": kp.id,
        "project_id": kp.project_id,
        "key": kp.key,
        "path": kp.path,
        "description": kp.description,
        "created_at": kp.created_at,
        "policy": known_path_policy_payload(kp.key, language=language),
    }


async def _clear_project_resource_entity_known_path_decisions(
    session: AsyncSession,
    *,
    project_id: str,
    known_path_key: str,
) -> None:
    """Drop stale recognized-resource keep_registered decisions for one key.

    An explicit registry edit supersedes any prior "keep current registration"
    decision for the same KnownPath key.
    """
    entities = (
        await session.execute(
            select(ResourceEntity).where(ResourceEntity.project_id == project_id)
        )
    ).scalars().all()

    for entity in entities:
        metadata = dict(entity.metadata_json or {})
        decisions = dict(metadata.get("known_path_decisions") or {})
        if known_path_key not in decisions:
            continue
        decisions.pop(known_path_key, None)
        if decisions:
            metadata["known_path_decisions"] = decisions
        else:
            metadata.pop("known_path_decisions", None)
        entity.metadata_json = metadata


# ---------------------------------------------------------------------------
# Endpoints
# NOTE: Literal route /upsert must be declared BEFORE parametric /{known_path_id}
# ---------------------------------------------------------------------------

@router.get("/")
async def list_known_paths(
    project_id: str,
    language: str = "en",
    session: AsyncSession = Depends(get_session),
):
    """List all known paths for a project."""
    rows = (
        await session.execute(
            select(KnownPath)
            .where(KnownPath.project_id == project_id)
            .order_by(KnownPath.key)
        )
    ).scalars().all()
    return [_kp_dict(r, language=language) for r in rows]


@router.post("/", status_code=201)
async def create_known_path(
    body: KnownPathCreate,
    session: AsyncSession = Depends(get_session),
):
    """Create a new known path. Returns 409 if (project_id, key) already exists."""
    proj = (
        await session.execute(select(Project).where(Project.id == body.project_id))
    ).scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")

    existing = (
        await session.execute(
            select(KnownPath).where(
                KnownPath.project_id == body.project_id,
                KnownPath.key == body.key,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(
            409,
            f"Key '{body.key}' already registered for this project. "
            f"Use PUT /upsert to update or PATCH /{existing.id} to modify.",
        )

    kp = KnownPath(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        key=body.key,
        path=body.path,
        description=body.description,
    )
    session.add(kp)
    await session.commit()
    await session.refresh(kp)
    return _kp_dict(kp)


@router.put("/upsert")
async def upsert_known_path(
    body: KnownPathUpsert,
    session: AsyncSession = Depends(get_session),
):
    """Insert or update a known path by (project_id, key). Idempotent — safe to call from chat."""
    proj = (
        await session.execute(select(Project).where(Project.id == body.project_id))
    ).scalar_one_or_none()
    if not proj:
        raise HTTPException(404, "Project not found")

    existing = (
        await session.execute(
            select(KnownPath).where(
                KnownPath.project_id == body.project_id,
                KnownPath.key == body.key,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.path = body.path
        if body.description is not None:
            existing.description = body.description
        await _clear_project_resource_entity_known_path_decisions(
            session,
            project_id=body.project_id,
            known_path_key=body.key,
        )
        await session.commit()
        await session.refresh(existing)
        return {"action": "updated", **_kp_dict(existing)}

    kp = KnownPath(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        key=body.key,
        path=body.path,
        description=body.description,
    )
    session.add(kp)
    await _clear_project_resource_entity_known_path_decisions(
        session,
        project_id=body.project_id,
        known_path_key=body.key,
    )
    await session.commit()
    await session.refresh(kp)
    return {"action": "created", **_kp_dict(kp)}


@router.get("/{known_path_id}")
async def get_known_path(
    known_path_id: str,
    language: str = "en",
    session: AsyncSession = Depends(get_session),
):
    kp = (
        await session.execute(select(KnownPath).where(KnownPath.id == known_path_id))
    ).scalar_one_or_none()
    if not kp:
        raise HTTPException(404, "KnownPath not found")
    return _kp_dict(kp, language=language)


@router.patch("/{known_path_id}")
async def update_known_path(
    known_path_id: str,
    body: KnownPathUpdate,
    language: str = "en",
    session: AsyncSession = Depends(get_session),
):
    kp = (
        await session.execute(select(KnownPath).where(KnownPath.id == known_path_id))
    ).scalar_one_or_none()
    if not kp:
        raise HTTPException(404, "KnownPath not found")
    if body.path is not None:
        kp.path = body.path
    if body.description is not None:
        kp.description = body.description
    await _clear_project_resource_entity_known_path_decisions(
        session,
        project_id=kp.project_id,
        known_path_key=kp.key,
    )
    await session.commit()
    await session.refresh(kp)
    return _kp_dict(kp, language=language)


@router.delete("/{known_path_id}")
async def delete_known_path(
    known_path_id: str,
    session: AsyncSession = Depends(get_session),
):
    kp = (
        await session.execute(select(KnownPath).where(KnownPath.id == known_path_id))
    ).scalar_one_or_none()
    if not kp:
        raise HTTPException(404, "KnownPath not found")
    await _clear_project_resource_entity_known_path_decisions(
        session,
        project_id=kp.project_id,
        known_path_key=kp.key,
    )
    await session.delete(kp)
    await session.commit()
    return {"ok": True}
