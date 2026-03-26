"""ArtifactRecord write/query helpers.

Written after each step succeeds; queried by the binding resolver (Tier 1a)
to give downstream steps deterministic output paths without BFS dir scanning.

Usage:
    # After a step succeeds (in tasks.py):
    async with get_session_factory()() as sess:
        await write_artifact_records(job_id, step_key, step_type, outputs, sess)
        await sess.commit()

    # In binding resolver Tier 1a:
    artifacts = await load_artifacts_for_step(job_id, dep_key, db)
    for art in artifacts:
        if _file_matches_types(art["file_path"], slot.file_types):
            resolved_path = art["file_path"]
            break
"""
from __future__ import annotations

import logging
import os
import uuid
from copy import deepcopy
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)


def _semantic_descriptor_for_output(
    step_type: str,
    slot_name: str,
) -> dict[str, str] | None:
    from tune.core.registry import get_step_type

    defn = get_step_type(step_type)
    if not defn:
        return None
    out_slot = next((slot for slot in defn.output_slots if slot.name == slot_name), None)
    if not out_slot:
        return None
    return {
        "artifact_role": out_slot.artifact_role or "",
        "artifact_scope": out_slot.artifact_scope or "job_global",
    }


async def write_artifact_records(
    job_id: str,
    step_key: str,
    step_type: str,
    renderer_outputs: list[str],
    db: "AsyncSession",
    step_run_id: str | None = None,
    sample_name: str | None = None,
    metadata: dict | None = None,
) -> int:
    """Write ArtifactRecord rows for all existing output files after a step succeeds.

    Maps each output file to an output slot by matching the file extension to
    the step type's output_slots.file_types.  Falls back to using the file
    extension as the slot_name if no output slot matches.

    Only files that actually exist on disk are recorded — phantom expected_outputs
    that weren't created (e.g. optional outputs) are silently skipped.

    Returns number of records written.
    """
    from tune.core.models import ArtifactRecord
    from tune.core.registry import get_step_type

    defn = get_step_type(step_type)
    written = 0

    for output_path in renderer_outputs:
        if not os.path.exists(output_path):
            continue

        ext = Path(output_path).suffix.lstrip(".").lower()
        try:
            size = os.path.getsize(output_path)
        except OSError:
            size = None

        # Infer slot_name by matching file extension to output slot definitions.
        # Wildcard outputs like index prefixes still map to their semantic slot name.
        slot_name = ext  # default: use extension as slot_name
        if defn:
            for out_slot in defn.output_slots:
                if out_slot.file_types == ["*"] or ext in out_slot.file_types:
                    slot_name = out_slot.name
                    break

        stored_path = output_path
        if step_type == "util.hisat2_build" and slot_name == "index_prefix" and output_path.endswith(".1.ht2"):
            stored_path = output_path[: -len(".1.ht2")]
        if step_type == "util.star_genome_generate" and slot_name == "genome_dir" and output_path.endswith("/SA"):
            stored_path = str(Path(output_path).parent)

        record = ArtifactRecord(
            id=str(uuid.uuid4()),
            job_id=job_id,
            step_key=step_key,
            step_type=step_type,
            step_run_id=step_run_id,
            slot_name=slot_name,
            artifact_type=ext,
            artifact_role=None,
            artifact_scope=None,
            file_path=stored_path,
            sample_name=sample_name,
            size_bytes=size,
            metadata_json=deepcopy(metadata) if metadata else {},
        )
        semantic = _semantic_descriptor_for_output(step_type, slot_name)
        if semantic:
            record.artifact_role = semantic["artifact_role"] or None
            record.artifact_scope = semantic["artifact_scope"] or None
            if record.metadata_json is None:
                record.metadata_json = {}
            record.metadata_json["semantic_descriptor"] = {
                "artifact_role": record.artifact_role,
                "artifact_scope": record.artifact_scope,
                "step_type": step_type,
                "slot_name": slot_name,
            }
        db.add(record)
        written += 1
        log.debug(
            "write_artifact_records: job=%s step=%s slot=%s role=%s type=%s path=%s",
            job_id, step_key, slot_name, record.artifact_role, ext, output_path,
        )

    return written


async def load_artifacts_for_step(
    job_id: str,
    step_key: str,
    db: "AsyncSession",
) -> list[dict]:
    """Return all ArtifactRecord rows for a step as plain dicts.

    Used by the binding resolver Tier 1a to find upstream step outputs
    without scanning directories.

    Returns list of dicts with keys: file_path, slot_name, artifact_type,
    sample_name, artifact_role, artifact_scope, step_type, metadata_json.
    Ordered by created_at (earliest first).
    """
    try:
        from tune.core.models import ArtifactRecord
        from sqlalchemy import select

        rows = (await db.execute(
            select(ArtifactRecord).where(
                ArtifactRecord.job_id == job_id,
                ArtifactRecord.step_key == step_key,
            ).order_by(ArtifactRecord.created_at)
        )).scalars().all()

        return [
            {
                "file_path": r.file_path,
                "slot_name": r.slot_name,
                "artifact_type": r.artifact_type,
                "sample_name": r.sample_name,
                "artifact_role": r.artifact_role,
                "artifact_scope": r.artifact_scope,
                "step_type": r.step_type,
                "metadata_json": r.metadata_json or {},
                "sample_id": (r.metadata_json or {}).get("lineage", {}).get("sample_id"),
                "experiment_id": (r.metadata_json or {}).get("lineage", {}).get("experiment_id"),
                "read_number": (r.metadata_json or {}).get("lineage", {}).get("read_number"),
            }
            for r in rows
        ]
    except Exception:
        log.exception(
            "load_artifacts_for_step: failed for job=%s step=%s", job_id, step_key
        )
        return []
