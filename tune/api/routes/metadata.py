"""Metadata API routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.database import get_session
from tune.core.models import File

router = APIRouter()


class MetadataUpdate(BaseModel):
    fields: dict[str, str | None]


@router.patch("/files/{file_id}")
async def update_metadata(
    file_id: str,
    body: MetadataUpdate,
    session: AsyncSession = Depends(get_session),
):
    from tune.core.metadata.manager import get_file_with_metadata, upsert_enhanced_field
    f = await get_file_with_metadata(session, file_id)
    if not f:
        raise HTTPException(404, "File not found")

    for key, value in body.fields.items():
        await upsert_enhanced_field(session, file_id, key, value, source="user")
    await session.commit()
    return {"ok": True}


@router.get("/search")
async def search_metadata(
    project: str | None = None,
    sample_id: str | None = None,
    file_type: str | None = None,
    experiment_type: str | None = None,
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
):
    from tune.core.models import EnhancedMetadata
    q = select(File).options(selectinload(File.enhanced_metadata)).limit(limit)
    if file_type:
        q = q.where(File.file_type == file_type)
    files = (await session.execute(q)).scalars().all()

    filters = {k: v for k, v in {
        "project": project, "sample_id": sample_id, "experiment_type": experiment_type
    }.items() if v}

    result = []
    for f in files:
        meta = {m.field_key: m.field_value for m in f.enhanced_metadata}
        if all(meta.get(k) == v for k, v in filters.items()):
            result.append({"id": f.id, "path": f.path, "filename": f.filename,
                           "file_type": f.file_type, "metadata": meta})
    return result


@router.get("/semantic-search")
async def semantic_search(
    q: str,
    limit: int = 20,
    session: AsyncSession = Depends(get_session),
):
    """Semantic search using pgvector cosine similarity."""
    from tune.core.llm.gateway import get_gateway
    from tune.core.config import get_config
    cfg = get_config()
    active = cfg.active_llm
    if not active or active.api_style not in ("openai", "openai_compatible"):
        raise HTTPException(400, "Semantic search requires an OpenAI-compatible embedding model")

    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=active.api_key, base_url=active.base_url)
    resp = await client.embeddings.create(model="text-embedding-3-small", input=q)
    query_embedding = resp.data[0].embedding

    from sqlalchemy import text
    raw = await session.execute(
        text(
            "SELECT id, path, filename, file_type, "
            "1 - (embedding <=> :emb) AS similarity "
            "FROM files WHERE embedding IS NOT NULL "
            "ORDER BY embedding <=> :emb LIMIT :limit"
        ),
        {"emb": str(query_embedding), "limit": limit},
    )
    return [
        {"id": r.id, "path": r.path, "filename": r.filename,
         "file_type": r.file_type, "similarity": float(r.similarity)}
        for r in raw
    ]
