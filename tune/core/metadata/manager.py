"""Metadata manager — CRUD, completeness scoring, project grouping, embeddings."""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.models import EnhancedMetadata, Experiment, File, FileRun, Project, Sample

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Completeness scoring
# ---------------------------------------------------------------------------


def score_completeness(file: File, required_keys: list[str]) -> str:
    """Return 'complete' | 'partial' | 'missing'."""
    present = {m.field_key for m in file.enhanced_metadata if m.field_value is not None}
    if not required_keys:
        return "complete"
    filled = sum(1 for k in required_keys if k in present)
    if filled == 0:
        return "missing"
    if filled < len(required_keys):
        return "partial"
    return "complete"


_SAMPLE_REQUIRED = ["sample_name", "organism"]
_EXPERIMENT_REQUIRED = [
    "library_strategy", "library_source", "library_selection",
    "library_layout", "platform", "instrument_model",
]


def score_sample_completeness(sample: Sample) -> str:
    """Return 'complete' | 'partial' | 'missing' for a Sample record."""
    filled = 0
    total = len(_SAMPLE_REQUIRED)
    if sample.sample_name:
        filled += 1
    if sample.organism:
        filled += 1
    if filled == 0:
        return "missing"
    if filled < total:
        return "partial"
    return "complete"


def score_experiment_completeness(exp: Experiment) -> str:
    """Return 'complete' | 'partial' | 'missing' for an Experiment record."""
    values = [
        exp.library_strategy, exp.library_source, exp.library_selection,
        exp.library_layout, exp.platform, exp.instrument_model,
    ]
    filled = sum(1 for v in values if v)
    total = len(values)
    if filled == 0:
        return "missing"
    if filled < total:
        return "partial"
    return "complete"


async def score_project_metadata_health(project_id: str, session: AsyncSession) -> dict:
    """Return three-tier completeness summary for a project."""
    from sqlalchemy.orm import selectinload

    samples = (
        await session.execute(select(Sample).where(Sample.project_id == project_id))
    ).scalars().all()

    sample_scores = [score_sample_completeness(s) for s in samples]
    sample_complete = sample_scores.count("complete")
    sample_partial = sample_scores.count("partial")
    sample_missing_count = sample_scores.count("missing")

    exp_ids: list[str] = []
    experiments = []
    if samples:
        sample_ids = [s.id for s in samples]
        experiments = (
            await session.execute(
                select(Experiment).where(Experiment.sample_id.in_(sample_ids))
            )
        ).scalars().all()
    exp_scores = [score_experiment_completeness(e) for e in experiments]
    exp_complete = exp_scores.count("complete")
    exp_partial = exp_scores.count("partial")

    exp_ids = [e.id for e in experiments]
    linked_files = 0
    if exp_ids:
        linked_files = len(
            (await session.execute(select(FileRun.file_id).where(FileRun.experiment_id.in_(exp_ids)))).all()
        )

    total_fastq = (
        await session.execute(
            select(File).where(File.project_id == project_id, File.file_type.in_(["fastq", "fq"]))
        )
    ).scalars().all()
    total_fastq_count = len(total_fastq)

    return {
        "sample_count": len(samples),
        "sample_complete": sample_complete,
        "sample_partial": sample_partial,
        "sample_missing": sample_missing_count,
        "experiment_count": len(experiments),
        "experiment_complete": exp_complete,
        "experiment_partial": exp_partial,
        "files_linked": linked_files,
        "files_total_fastq": total_fastq_count,
        "files_unlinked": max(0, total_fastq_count - linked_files),
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def upsert_enhanced_field(
    session: AsyncSession,
    file_id: str,
    key: str,
    value: Optional[str],
    source: str = "user",
    confidence: Optional[float] = None,
) -> EnhancedMetadata:
    existing = (
        await session.execute(
            select(EnhancedMetadata).where(
                EnhancedMetadata.file_id == file_id,
                EnhancedMetadata.field_key == key,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.field_value = value
        existing.source = source
        existing.confidence = confidence
        return existing
    else:
        rec = EnhancedMetadata(
            id=str(uuid.uuid4()),
            file_id=file_id,
            field_key=key,
            field_value=value,
            source=source,
            confidence=confidence,
        )
        session.add(rec)
        return rec


async def get_file_with_metadata(session: AsyncSession, file_id: str) -> Optional[File]:
    from sqlalchemy.orm import selectinload
    return (
        await session.execute(
            select(File).where(File.id == file_id).options(selectinload(File.enhanced_metadata))
        )
    ).scalar_one_or_none()


async def get_or_create_project(session: AsyncSession, name: str, inferred: bool = True) -> Project:
    proj = (
        await session.execute(select(Project).where(Project.name == name))
    ).scalar_one_or_none()
    if not proj:
        proj = Project(id=str(uuid.uuid4()), name=name, inferred=inferred)
        session.add(proj)
        await session.flush()
    return proj


# ---------------------------------------------------------------------------
# AI project grouping
# ---------------------------------------------------------------------------


async def infer_project_groupings(session: AsyncSession) -> None:
    """Ask LLM to group files into projects based on directory structure."""
    from tune.core.llm.gateway import LLMMessage, get_gateway
    from tune.core.metadata.schemas import all_required_fields

    files = (await session.execute(select(File).limit(500))).scalars().all()
    if not files:
        return

    # Build a compact directory tree representation
    paths = [f.path for f in files]
    tree_sample = "\n".join(paths[:200])

    gw = get_gateway()
    schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "project_name": {"type": "string"},
                "file_paths": {"type": "array", "items": {"type": "string"}},
            },
        },
    }

    try:
        result = await gw.structured_output(
            messages=[
                LLMMessage(
                    "user",
                    f"Analyze these file paths and group them into projects based on "
                    f"directory structure and naming conventions. Return JSON:\n\n{tree_sample}",
                )
            ],
            schema=schema,
            system="You are a bioinformatics data manager. Group files into logical projects.",
        )
        for group in result:
            proj_name = group.get("project_name", "unknown")
            proj = await get_or_create_project(session, proj_name, inferred=True)
            for fp in group.get("file_paths", []):
                f = (await session.execute(select(File).where(File.path == fp))).scalar_one_or_none()
                if f:
                    await upsert_enhanced_field(
                        session, f.id, "project", proj_name, source="inferred", confidence=0.7
                    )
        await session.commit()
    except Exception as e:
        log.warning("Project grouping inference failed: %s", e)


# ---------------------------------------------------------------------------
# Semantic embedding
# ---------------------------------------------------------------------------


async def generate_embedding(file: File) -> Optional[list[float]]:
    """Generate pgvector embedding from concatenated metadata text."""
    from tune.core.llm.gateway import get_gateway
    text_parts = [
        f"filename: {file.filename}",
        f"type: {file.file_type}",
        f"path: {file.path}",
    ]
    for m in file.enhanced_metadata:
        if m.field_value:
            text_parts.append(f"{m.field_key}: {m.field_value}")
    text = " | ".join(text_parts)

    # Use OpenAI embeddings if available, else skip
    try:
        from tune.core.config import get_config
        cfg = get_config()
        active = cfg.active_llm
        if active and active.api_style in ("openai", "openai_compatible"):
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=active.api_key, base_url=active.base_url)
            resp = await client.embeddings.create(model="text-embedding-3-small", input=text)
            return resp.data[0].embedding
    except Exception as e:
        log.warning("Embedding generation failed: %s", e)
    return None
