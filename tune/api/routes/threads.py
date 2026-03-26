"""Threads API routes — CRUD for conversation threads and their messages."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.database import get_session
from tune.core.models import Project, Thread, ThreadMessage

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class ThreadCreate(BaseModel):
    project_id: str | None = None
    title: str | None = None


class ThreadUpdate(BaseModel):
    title: str | None = None
    project_id: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/")
async def list_threads(
    project_id: str | None = None,
    session: AsyncSession = Depends(get_session),
):
    q = select(Thread).order_by(Thread.created_at.desc())
    if project_id is not None:
        q = q.where(Thread.project_id == project_id)
    threads = (await session.execute(q)).scalars().all()

    result = []
    for t in threads:
        project_name = None
        if t.project_id:
            proj = (
                await session.execute(select(Project).where(Project.id == t.project_id))
            ).scalar_one_or_none()
            if proj:
                project_name = proj.name
        result.append({
            "id": t.id,
            "title": t.title,
            "project_id": t.project_id,
            "project_name": project_name,
            "created_at": t.created_at,
            "updated_at": t.updated_at,
        })
    return result


@router.post("/", status_code=201)
async def create_thread(body: ThreadCreate, session: AsyncSession = Depends(get_session)):
    project_name = None
    if body.project_id:
        proj = (
            await session.execute(select(Project).where(Project.id == body.project_id))
        ).scalar_one_or_none()
        if not proj:
            raise HTTPException(404, f"Project '{body.project_id}' not found")
        project_name = proj.name

    thread = Thread(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        title=body.title,
    )
    session.add(thread)
    await session.commit()
    await session.refresh(thread)
    return {
        "id": thread.id,
        "title": thread.title,
        "project_id": thread.project_id,
        "project_name": project_name,
        "created_at": thread.created_at,
        "updated_at": thread.updated_at,
    }


@router.get("/{thread_id}/messages")
async def get_thread_messages(thread_id: str, session: AsyncSession = Depends(get_session)):
    thread = (
        await session.execute(
            select(Thread)
            .options(selectinload(Thread.messages))
            .where(Thread.id == thread_id)
        )
    ).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")

    # Return last 100 messages
    msgs = sorted(thread.messages, key=lambda m: m.created_at)[-100:]
    return [{"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at} for m in msgs]


@router.patch("/{thread_id}")
async def update_thread(
    thread_id: str,
    body: ThreadUpdate,
    session: AsyncSession = Depends(get_session),
):
    thread = (
        await session.execute(select(Thread).where(Thread.id == thread_id))
    ).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")

    project_name = None

    if "title" in body.model_fields_set:
        thread.title = body.title
    if "project_id" in body.model_fields_set:
        if body.project_id:
            proj = (
                await session.execute(select(Project).where(Project.id == body.project_id))
            ).scalar_one_or_none()
            if not proj:
                raise HTTPException(404, f"Project '{body.project_id}' not found")
            project_name = proj.name
        thread.project_id = body.project_id
    elif thread.project_id:
        proj = (
            await session.execute(select(Project).where(Project.id == thread.project_id))
        ).scalar_one_or_none()
        if proj:
            project_name = proj.name

    await session.commit()
    await session.refresh(thread)
    return {
        "id": thread.id,
        "title": thread.title,
        "project_id": thread.project_id,
        "project_name": project_name,
        "created_at": thread.created_at,
        "updated_at": thread.updated_at,
    }


@router.delete("/{thread_id}", status_code=204)
async def delete_thread(thread_id: str, session: AsyncSession = Depends(get_session)):
    thread = (
        await session.execute(select(Thread).where(Thread.id == thread_id))
    ).scalar_one_or_none()
    if not thread:
        raise HTTPException(404, "Thread not found")

    await session.delete(thread)
    await session.commit()
