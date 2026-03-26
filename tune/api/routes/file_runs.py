"""FileRuns API routes — link experiments to FASTQ files (SRA Run)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from tune.core.database import get_session
from tune.core.models import FileRun

router = APIRouter()


class FileRunCreate(BaseModel):
    experiment_id: str
    file_id: str
    read_number: Optional[int] = None  # 1, 2, or null for single-end
    filename: Optional[str] = None
    attrs: Optional[dict] = None


class FileRunBatchCreate(BaseModel):
    runs: list[FileRunCreate]


def _run_dict(r: FileRun) -> dict:
    return {
        "id": r.id,
        "experiment_id": r.experiment_id,
        "file_id": r.file_id,
        "read_number": r.read_number,
        "filename": r.filename,
        "attrs": r.attrs or {},
    }


@router.get("/")
async def list_file_runs(experiment_id: str, session: AsyncSession = Depends(get_session)):
    rows = (
        await session.execute(
            select(FileRun).where(FileRun.experiment_id == experiment_id)
        )
    ).scalars().all()
    return [_run_dict(r) for r in rows]


@router.post("/", status_code=201)
async def create_file_runs(body: FileRunBatchCreate, session: AsyncSession = Depends(get_session)):
    created = []
    for run in body.runs:
        r = FileRun(
            id=str(uuid.uuid4()),
            experiment_id=run.experiment_id,
            file_id=run.file_id,
            read_number=run.read_number,
            filename=run.filename,
            attrs=run.attrs or {},
        )
        session.add(r)
        created.append(r)
    await session.commit()
    return [_run_dict(r) for r in created]


@router.delete("/{file_run_id}", status_code=200)
async def delete_file_run(file_run_id: str, session: AsyncSession = Depends(get_session)):
    r = (await session.execute(select(FileRun).where(FileRun.id == file_run_id))).scalar_one_or_none()
    if not r:
        raise HTTPException(404, "FileRun not found")
    await session.delete(r)
    await session.commit()
    return {"ok": True}
