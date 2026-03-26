"""Skill registry — CRUD, versioning, parameterization, skill creation from runs."""
from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.models import Skill, SkillVersion


def _next_version(current: str) -> str:
    parts = current.split(".")
    try:
        minor = int(parts[-1]) + 1
        return ".".join(parts[:-1] + [str(minor)])
    except (ValueError, IndexError):
        return f"{current}.1"


async def create_skill_from_job(
    session: AsyncSession,
    job_id: str,
    name: str,
    description: str,
    plan: list[dict],
    pixi_toml: str | None,
    pixi_lock: str | None,
    input_files: list[dict],
) -> Skill:
    """Create a new Skill from a completed analysis run."""
    params = _extract_params(plan, input_files)

    skill = Skill(
        id=str(uuid.uuid4()),
        name=name,
        description=description,
        skill_type="analysis",
        current_version="1.0",
        source_job_id=job_id,
    )
    session.add(skill)
    await session.flush()

    version = SkillVersion(
        id=str(uuid.uuid4()),
        skill_id=skill.id,
        version="1.0",
        input_params=params,
        steps=plan,
        pixi_toml=pixi_toml,
        pixi_lock=pixi_lock,
        tags=_infer_tags(plan),
    )
    session.add(version)
    return skill


def _extract_params(plan: list[dict], input_files: list[dict]) -> list[dict]:
    """Identify parameterizable values in the plan."""
    params = []
    file_types = list({f["file_type"] for f in input_files})
    if file_types:
        params.append({
            "name": "input_files",
            "type": "list[file]",
            "description": f"Input files ({', '.join(file_types)})",
            "required": True,
        })
    params.append({
        "name": "output_name",
        "type": "string",
        "description": "Name for this analysis run",
        "required": False,
        "default": "analysis",
    })
    return params


def _infer_tags(plan: list[dict]) -> list[str]:
    tags = set()
    for step in plan:
        tool = (step.get("tool") or "").lower()
        if "fastqc" in tool or "multiqc" in tool:
            tags.add("qc")
        if "star" in tool or "bwa" in tool:
            tags.add("alignment")
        if "deseq" in tool:
            tags.add("differential-expression")
        if "featurecount" in tool:
            tags.add("quantification")
        if "cluster" in tool or "pathway" in tool:
            tags.add("pathway-analysis")
    return sorted(tags)


async def create_new_version(session: AsyncSession, skill: Skill, update) -> SkillVersion:
    """Increment version and save updated skill definition."""
    new_ver = _next_version(skill.current_version)

    # Get current version for defaults
    latest = (
        await session.execute(
            select(SkillVersion)
            .where(SkillVersion.skill_id == skill.id)
            .order_by(SkillVersion.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()

    version = SkillVersion(
        id=str(uuid.uuid4()),
        skill_id=skill.id,
        version=new_ver,
        input_params=update.input_params or (latest.input_params if latest else []),
        steps=update.steps or (latest.steps if latest else []),
        pixi_toml=update.pixi_toml or (latest.pixi_toml if latest else None),
        pixi_lock=latest.pixi_lock if latest else None,
        tags=update.tags or (latest.tags if latest else []),
    )
    session.add(version)
    skill.current_version = new_ver
    return version


async def get_current_skill_version(session: AsyncSession, skill_id: str) -> SkillVersion | None:
    skill = (
        await session.execute(
            select(Skill).where(Skill.id == skill_id).options(selectinload(Skill.versions))
        )
    ).scalar_one_or_none()
    if not skill:
        return None
    for v in sorted(skill.versions, key=lambda x: x.created_at, reverse=True):
        if v.version == skill.current_version:
            return v
    return skill.versions[-1] if skill.versions else None


async def evolve_skill_via_llm(
    session: AsyncSession,
    skill_id: str,
    user_request: str,
) -> Skill | None:
    """Use LLM to modify skill definition based on user's natural language request."""
    from tune.core.llm.gateway import LLMMessage, get_gateway
    from sqlalchemy.orm import selectinload

    skill = (
        await session.execute(
            select(Skill).where(Skill.id == skill_id).options(selectinload(Skill.versions))
        )
    ).scalar_one_or_none()
    if not skill:
        return None

    current = await get_current_skill_version(session, skill_id)
    if not current:
        return None

    gw = get_gateway()
    import json

    result = await gw.structured_output(
        messages=[
            LLMMessage(
                "user",
                f"Modify this bioinformatics skill based on the user's request.\n\n"
                f"User request: {user_request}\n\n"
                f"Current steps:\n{json.dumps(current.steps, indent=2)}\n\n"
                "Return the modified steps array as JSON.",
            )
        ],
        schema={"type": "array", "items": {"type": "object"}},
        system="You are a bioinformatics workflow expert. Modify analysis pipelines precisely.",
    )

    class _Update:
        steps = result
        input_params = None
        pixi_toml = None
        tags = None

    await create_new_version(session, skill, _Update())
    await session.commit()
    return skill
