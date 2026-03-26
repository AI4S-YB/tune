"""Project-scoped execution event memory."""
from __future__ import annotations

import logging
import uuid

log = logging.getLogger(__name__)


async def query_project_events(session, project_id: str, query_text: str, top_k: int = 3):
    """Return top-k ProjectExecutionEvent entries for the project, relevant to query_text."""
    from sqlalchemy import desc, select

    from tune.core.memory.global_memory import embed_text
    from tune.core.models import ProjectExecutionEvent

    query_embedding = await embed_text(query_text)
    if query_embedding is not None:
        results = (
            await session.execute(
                select(ProjectExecutionEvent)
                .where(
                    ProjectExecutionEvent.project_id == project_id,
                    ProjectExecutionEvent.embedding.isnot(None),
                )
                .order_by(
                    ProjectExecutionEvent.embedding.cosine_distance(query_embedding)
                )
                .limit(top_k)
            )
        ).scalars().all()
        if not results:
            results = (
                await session.execute(
                    select(ProjectExecutionEvent)
                    .where(ProjectExecutionEvent.project_id == project_id)
                    .order_by(desc(ProjectExecutionEvent.created_at))
                    .limit(top_k)
                )
            ).scalars().all()
    else:
        results = (
            await session.execute(
                select(ProjectExecutionEvent)
                .where(ProjectExecutionEvent.project_id == project_id)
                .order_by(desc(ProjectExecutionEvent.created_at))
                .limit(top_k)
            )
        ).scalars().all()

    return results


async def write_execution_event(
    session,
    project_id: str,
    event_type: str,
    description: str,
    resolution: str,
    user_contributed: bool,
):
    """Write a ProjectExecutionEvent with embedding."""
    from tune.core.memory.global_memory import embed_text
    from tune.core.models import ProjectExecutionEvent

    embedding = await embed_text(f"{description}\n{resolution}")
    event = ProjectExecutionEvent(
        id=str(uuid.uuid4()),
        project_id=project_id,
        event_type=event_type,
        description=description,
        resolution=resolution,
        user_contributed=user_contributed,
        embedding=embedding,
    )
    session.add(event)
    await session.commit()
    return event
