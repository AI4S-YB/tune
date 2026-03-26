"""Global memory: embed, query, write."""
from __future__ import annotations

import logging
import uuid
from typing import Optional

log = logging.getLogger(__name__)


async def embed_text(text: str) -> Optional[list[float]]:
    """Generate a 1536-dim embedding using the OpenAI embeddings API.

    Returns None if unavailable — callers must handle the None case gracefully.
    """
    try:
        from tune.core.config import get_config

        cfg = get_config()
        llm_cfg = cfg.active_llm
        if not llm_cfg:
            return None

        # Use the configured provider's API key/base_url for embeddings
        from openai import AsyncOpenAI

        base_url = llm_cfg.base_url if llm_cfg.api_style == "openai_compatible" else None
        client = AsyncOpenAI(api_key=llm_cfg.api_key, base_url=base_url)
        resp = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text[:8000],
        )
        return resp.data[0].embedding
    except Exception:
        log.debug("embed_text failed (non-fatal)", exc_info=True)
        return None


async def query_global_memories(session, query_text: str, top_k: int = 3):
    """Return top-k GlobalMemory entries most relevant to query_text.

    Uses cosine similarity when embeddings are available; falls back to
    most-used system memories when embedding generation is unavailable.
    """
    from sqlalchemy import desc, select

    from tune.core.models import GlobalMemory

    query_embedding = await embed_text(query_text)
    if query_embedding is not None:
        results = (
            await session.execute(
                select(GlobalMemory)
                .where(GlobalMemory.embedding.isnot(None))
                .order_by(GlobalMemory.embedding.cosine_distance(query_embedding))
                .limit(top_k)
            )
        ).scalars().all()
        # Fallback if no entries have embeddings yet
        if not results:
            results = (
                await session.execute(
                    select(GlobalMemory)
                    .order_by(desc(GlobalMemory.success_count), GlobalMemory.created_at)
                    .limit(top_k)
                )
            ).scalars().all()
    else:
        results = (
            await session.execute(
                select(GlobalMemory)
                .order_by(desc(GlobalMemory.success_count), GlobalMemory.created_at)
                .limit(top_k)
            )
        ).scalars().all()

    return results


async def write_user_memory(session, trigger: str, approach: str):
    """Write a user-taught GlobalMemory entry."""
    from tune.core.models import GlobalMemory

    embedding = await embed_text(f"{trigger}\n{approach}")
    mem = GlobalMemory(
        id=str(uuid.uuid4()),
        trigger_condition=trigger,
        approach=approach,
        source="user",
        embedding=embedding,
        success_count=1,
    )
    session.add(mem)
    await session.commit()
    return mem
