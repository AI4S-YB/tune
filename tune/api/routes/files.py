"""Files API routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.database import get_session
from tune.core.metadata.schemas import all_required_fields
from tune.core.metadata.manager import score_completeness
from tune.core.models import File, ScanState

router = APIRouter()

_UNSET = object()


@router.get("/")
async def list_files(
    project_id: str | None = None,
    project_id_is_null: bool = False,
    file_type: str | None = None,
    metadata_status: str | None = None,
    filename_contains: str | None = None,
    limit: int | None = None,
    session: AsyncSession = Depends(get_session),
):
    q = select(File).options(selectinload(File.enhanced_metadata))
    if limit is not None:
        q = q.limit(limit)

    if project_id_is_null:
        q = q.where(File.project_id.is_(None))
    elif project_id is not None:
        q = q.where(File.project_id == project_id)

    if file_type:
        q = q.where(File.file_type == file_type)
    if filename_contains:
        q = q.where(File.filename.ilike(f"%{filename_contains}%"))

    files = (await session.execute(q)).scalars().all()

    result = []
    for f in files:
        required = all_required_fields(f.file_type)
        status = score_completeness(f, required)
        if metadata_status and status != metadata_status:
            continue
        meta_dict = {m.field_key: m.field_value for m in f.enhanced_metadata}
        result.append({
            "id": f.id,
            "path": f.path,
            "filename": f.filename,
            "file_type": f.file_type,
            "size_bytes": f.size_bytes,
            "metadata_status": status,
            "project_id": f.project_id,
            "sample_id": meta_dict.get("sample_id"),
        })
    return result


@router.get("/{file_id}")
async def get_file(file_id: str, session: AsyncSession = Depends(get_session)):
    from tune.core.metadata.manager import get_file_with_metadata
    f = await get_file_with_metadata(session, file_id)
    if not f:
        raise HTTPException(404, "File not found")
    required = all_required_fields(f.file_type)
    status = score_completeness(f, required)
    return {
        "id": f.id,
        "path": f.path,
        "filename": f.filename,
        "file_type": f.file_type,
        "size_bytes": f.size_bytes,
        "md5": f.md5,
        "mtime": f.mtime,
        "preview": f.preview,
        "discovered_at": f.discovered_at,
        "metadata_status": status,
        "enhanced_metadata": [
            {"key": m.field_key, "value": m.field_value, "source": m.source}
            for m in f.enhanced_metadata
        ],
    }


@router.get("/scan/status")
async def scan_status(session: AsyncSession = Depends(get_session)):
    state = (await session.execute(select(ScanState))).scalar_one_or_none()
    if not state:
        return {
            "status": "not_started",
            "total_discovered": 0,
            "total_processed": 0,
            "resource_sync_status": None,
            "resource_sync_summary": None,
        }
    return {
        "status": state.status,
        "total_discovered": state.total_discovered,
        "total_processed": state.total_processed,
        "resource_sync_status": state.resource_sync_status,
        "resource_sync_summary": state.resource_sync_summary_json,
        "started_at": state.started_at,
        "completed_at": state.completed_at,
    }


@router.post("/scan/start")
async def start_scan(session: AsyncSession = Depends(get_session)):
    from tune.core.config import get_config
    from tune.workers.tasks import full_scan_task
    cfg = get_config()
    await full_scan_task.defer_async(data_dir=str(cfg.data_dir))
    return {"ok": True, "message": "Full scan queued"}
