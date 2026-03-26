"""Skills API routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.database import get_session
from tune.core.models import Skill, SkillVersion

router = APIRouter()


@router.get("/")
async def list_skills(session: AsyncSession = Depends(get_session)):
    skills = (
        await session.execute(
            # Exclude legacy query-workbench skills from the active product surface.
            select(Skill)
            .where(Skill.skill_type != "query")
            .options(selectinload(Skill.versions))
            .order_by(Skill.created_at.desc())
        )
    ).scalars().all()
    return [
        {
            "id": s.id, "name": s.name, "description": s.description,
            "skill_type": s.skill_type, "current_version": s.current_version,
            "created_at": s.created_at,
            "versions": [v.version for v in s.versions],
        }
        for s in skills
    ]


@router.get("/{skill_id}")
async def get_skill(skill_id: str, session: AsyncSession = Depends(get_session)):
    s = (
        await session.execute(
            select(Skill).where(Skill.id == skill_id).options(selectinload(Skill.versions))
        )
    ).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Skill not found")
    return {
        "id": s.id, "name": s.name, "description": s.description,
        "skill_type": s.skill_type, "current_version": s.current_version,
        "created_at": s.created_at,
        "versions": [
            {
                "version": v.version, "input_params": v.input_params,
                "steps": v.steps, "tags": v.tags,
                "has_pixi": bool(v.pixi_toml), "created_at": v.created_at,
            }
            for v in s.versions
        ],
    }


class SkillUpdate(BaseModel):
    description: str | None = None
    input_params: list | None = None
    steps: list | None = None
    pixi_toml: str | None = None
    tags: list | None = None


class SkillFromJobRequest(BaseModel):
    name: str | None = None
    description: str | None = None


@router.post("/from-job/{job_id}")
async def create_skill_from_job_endpoint(
    job_id: str,
    body: SkillFromJobRequest,
    session: AsyncSession = Depends(get_session),
):
    """Create a Skill from a completed analysis job's plan and Pixi environment."""
    from tune.core.models import AnalysisJob
    from tune.core.skills.registry import create_skill_from_job

    job = (
        await session.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))
    ).scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "completed":
        raise HTTPException(400, f"Job is '{job.status}', not 'completed'")

    pixi_toml: str | None = None
    pixi_lock: str | None = None
    if job.output_dir:
        toml_path = Path(job.output_dir) / "pixi.toml"
        lock_path = Path(job.output_dir) / "pixi.lock"
        if toml_path.exists():
            pixi_toml = toml_path.read_text()
        if lock_path.exists():
            pixi_lock = lock_path.read_text()

    skill = await create_skill_from_job(
        session=session,
        job_id=job_id,
        name=body.name or job.name,
        description=body.description or f"Analysis workflow: {job.name}",
        plan=job.plan or [],
        pixi_toml=pixi_toml,
        pixi_lock=pixi_lock,
        input_files=[],
    )
    await session.commit()
    return {"id": skill.id, "name": skill.name, "version": skill.current_version}


@router.patch("/{skill_id}")
async def update_skill(
    skill_id: str, body: SkillUpdate, session: AsyncSession = Depends(get_session)
):
    from tune.core.skills.registry import create_new_version
    s = (await session.execute(select(Skill).where(Skill.id == skill_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Skill not found")

    if body.description is not None:
        s.description = body.description

    if body.steps is not None:
        await create_new_version(session, s, body)

    await session.commit()
    return {"ok": True, "current_version": s.current_version}


@router.delete("/{skill_id}")
async def delete_skill(skill_id: str, session: AsyncSession = Depends(get_session)):
    s = (await session.execute(select(Skill).where(Skill.id == skill_id))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Skill not found")
    await session.delete(s)
    await session.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Pipeline-v2: SkillTemplate browsing routes
# ---------------------------------------------------------------------------


@router.get("/templates/")
async def list_skill_templates(session: AsyncSession = Depends(get_session)):
    """Return all SkillTemplate records (pipeline-v2)."""
    from tune.core.models import SkillTemplate as SkillTemplateModel
    rows = (await session.execute(
        select(SkillTemplateModel).order_by(SkillTemplateModel.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "step_types": t.step_types,
            "env_spec": t.env_spec,
            "source_job_id": t.source_job_id,
            "created_at": t.created_at,
        }
        for t in rows
    ]


@router.get("/templates/{template_id}")
async def get_skill_template(template_id: str, session: AsyncSession = Depends(get_session)):
    """Return a SkillTemplate with its SkillVersions (pipeline-v2)."""
    from tune.core.models import SkillTemplate as SkillTemplateModel, SkillVersionSnapshot as SkillVersionModel
    t = (await session.execute(
        select(SkillTemplateModel).where(SkillTemplateModel.id == template_id)
    )).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "SkillTemplate not found")

    versions = (await session.execute(
        select(SkillVersionModel)
        .where(SkillVersionModel.template_id == template_id)
        .order_by(SkillVersionModel.version_number.asc())
    )).scalars().all()

    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "step_types": t.step_types,
        "plan_schema": t.plan_schema,
        "env_spec": t.env_spec,
        "source_job_id": t.source_job_id,
        "created_at": t.created_at,
        "versions": [
            {
                "id": v.id,
                "version_number": v.version_number,
                "renderer_versions": v.renderer_versions,
                "has_pixi_toml": bool(v.pixi_toml),
                "has_pixi_lock": bool(v.pixi_lock),
                "source_job_id": v.source_job_id,
                "created_at": v.created_at,
            }
            for v in versions
        ],
    }



