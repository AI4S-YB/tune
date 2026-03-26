"""Skill template extractor.

Given a completed AnalysisJob, produces:
- SkillTemplate: abstract plan with slot references, step_types, and env_spec
- SkillVersion: snapshot of the exact plan_json, pixi.toml/lock, renderer_versions
"""
from __future__ import annotations

import re
import uuid
import logging
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Pattern to detect absolute paths that should become slot references
_ABS_PATH_RE = re.compile(r"(/[^\s\"'\\,;|&><]{3,})")


def _abstract_value(value: Any, slot_prefix: str = "") -> Any:
    """Replace absolute paths with {{slot_name}} template references.

    Recurses into dicts and lists. String values that look like absolute
    paths are replaced with ``{{<basename_without_ext>}}``.
    """
    if isinstance(value, str):
        if _ABS_PATH_RE.match(value):
            stem = Path(value).stem or Path(value).name
            safe = re.sub(r"[^a-z0-9_]", "_", stem.lower())[:32]
            label = f"{slot_prefix}{safe}" if slot_prefix else safe
            return f"{{{{{label}}}}}"
        return value
    if isinstance(value, dict):
        return {k: _abstract_value(v, slot_prefix=k + "_") for k, v in value.items()}
    if isinstance(value, list):
        return [_abstract_value(item, slot_prefix=slot_prefix) for item in value]
    return value


async def extract_skill_template(
    job_id: str,
    session,
) -> "SkillTemplate":
    """Create a SkillTemplate from a completed job.

    Steps:
    1. Load AnalysisJob and its AnalysisStepRun records.
    2. Build step_types list from the runs.
    3. Abstract the resolved_plan_json (replace absolute paths with {{slot_name}}).
    4. Capture env_spec from job.env_spec_hash.
    5. Persist and return the new SkillTemplate.
    """
    from sqlalchemy import select
    from tune.core.models import AnalysisJob, AnalysisStepRun, SkillTemplate

    job = (await session.execute(
        select(AnalysisJob).where(AnalysisJob.id == job_id)
    )).scalar_one_or_none()
    if not job:
        raise ValueError(f"Job {job_id!r} not found")
    if job.status != "completed":
        raise ValueError(f"Job {job_id!r} is not completed (status={job.status!r})")

    step_runs = (await session.execute(
        select(AnalysisStepRun)
        .where(AnalysisStepRun.job_id == job_id)
        .order_by(AnalysisStepRun.id)
    )).scalars().all()

    step_types = [sr.step_type for sr in step_runs if sr.step_type]

    # Build abstract plan from resolved_plan_json or plan
    source_plan = job.resolved_plan_json or job.plan or []
    abstract_plan: list[dict] = []
    for step in source_plan:
        abstract_step = dict(step)
        if "params" in abstract_step:
            abstract_step["params"] = _abstract_value(abstract_step["params"])
        if "bindings" in abstract_step:
            abstract_step["bindings"] = _abstract_value(abstract_step["bindings"])
        abstract_plan.append(abstract_step)

    # Derive env_spec
    env_spec = None
    if job.env_spec_hash:
        from tune.core.env_planner import build_env_spec
        computed = build_env_spec(source_plan)
        env_spec = {"packages": computed.packages, "hash": computed.hash}
    else:
        # Try to compute from step types
        from tune.core.env_planner import build_env_spec
        computed = build_env_spec(source_plan)
        env_spec = {"packages": computed.packages, "hash": computed.hash}

    template = SkillTemplate(
        id=str(uuid.uuid4()),
        name=job.name or f"Skill from job {job_id[:8]}",
        description=job.goal,
        step_types=step_types,
        plan_schema=abstract_plan,
        env_spec=env_spec,
        source_job_id=job_id,
    )
    session.add(template)
    await session.flush()  # get the ID without committing
    return template


async def create_skill_version(
    template_id: str,
    job_id: str,
    session,
) -> "SkillVersion":
    """Create a SkillVersion snapshot from a completed job.

    Captures:
    - plan_json: the resolved plan steps
    - pixi_toml / pixi_lock: the environment files (if available)
    - renderer_versions: {step_key: version_int} from AnalysisStepRun records
    """
    from sqlalchemy import select, func
    from tune.core.models import AnalysisJob, AnalysisStepRun, SkillVersionSnapshot, SkillTemplate
    from tune.core.config import get_config

    job = (await session.execute(
        select(AnalysisJob).where(AnalysisJob.id == job_id)
    )).scalar_one_or_none()
    if not job:
        raise ValueError(f"Job {job_id!r} not found")

    # Get current max version_number for this template
    max_ver = (await session.execute(
        select(func.max(SkillVersion.version_number))
        .where(SkillVersion.template_id == template_id)
    )).scalar_one_or_none() or 0

    step_runs = (await session.execute(
        select(AnalysisStepRun).where(AnalysisStepRun.job_id == job_id)
    )).scalars().all()
    renderer_versions = {
        sr.step_key: sr.renderer_version
        for sr in step_runs
        if sr.step_key and sr.renderer_version is not None
    }

    # Try to load pixi.toml and pixi.lock from the job's env dir
    pixi_toml: str | None = None
    pixi_lock: str | None = None
    if job.output_dir:
        env_dir = Path(job.output_dir).parent / ".pixi-env"
        toml_path = env_dir / "pixi.toml"
        lock_path = env_dir / "pixi.lock"
        if toml_path.exists():
            pixi_toml = toml_path.read_text()
        if lock_path.exists():
            pixi_lock = lock_path.read_text()

    version = SkillVersion(
        id=str(uuid.uuid4()),
        template_id=template_id,
        version_number=max_ver + 1,
        plan_json=job.resolved_plan_json or job.plan,
        pixi_toml=pixi_toml,
        pixi_lock=pixi_lock,
        renderer_versions=renderer_versions,
        source_job_id=job_id,
    )
    session.add(version)
    await session.flush()
    return version
