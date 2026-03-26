"""ProjectGraphLoader — loads the Project/Sample/Experiment/FileRun graph
with minimal queries (no N+1).

Strategy:
  Query 1: Project + selectinload(samples → experiments → file_runs)
  Query 2: File + selectinload(enhanced_metadata) WHERE project_id = ...
           (or WHERE id IN [...] for file_set mode)
  Query 3: KnownPath records for the project
  Query 4 (file_set mode only): FileRun + selectinload(experiment → sample)

This gives at most 4 queries for a full project load, independent of
the number of samples or files.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.models import (
    Experiment,
    File,
    FileRun,
    KnownPath,
    Project,
    ResourceEntity,
    ResourceFile,
    Sample,
)


class ProjectGraphLoader:
    """Loads the relational graph needed to build PlannerContext."""

    # ------------------------------------------------------------------
    # Project-scope loaders
    # ------------------------------------------------------------------

    async def load(
        self, project_id: str, session: AsyncSession
    ) -> Project | None:
        """Return the Project ORM object with samples → experiments → file_runs
        eagerly loaded.  Files are loaded separately via load_files_for_project().
        """
        stmt = (
            select(Project)
            .where(Project.id == project_id)
            .options(
                selectinload(Project.samples)
                .selectinload(Sample.experiments)
                .selectinload(Experiment.file_runs)
            )
        )
        return (await session.execute(stmt)).scalar_one_or_none()

    async def load_files_for_project(
        self, project_id: str, session: AsyncSession
    ) -> dict[str, File]:
        """Return {file_id: File} for all files in the project (≤ 200),
        with EnhancedMetadata eagerly loaded.
        """
        stmt = (
            select(File)
            .where(File.project_id == project_id)
            .options(selectinload(File.enhanced_metadata))
            .limit(200)
        )
        files = (await session.execute(stmt)).scalars().all()
        return {f.id: f for f in files}

    async def load_known_paths(
        self, project_id: str, session: AsyncSession
    ) -> list[KnownPath]:
        """Return all KnownPath records for the project."""
        stmt = (
            select(KnownPath)
            .where(KnownPath.project_id == project_id)
            .order_by(KnownPath.key)
        )
        return list((await session.execute(stmt)).scalars().all())

    async def load_resource_entities(
        self, project_id: str, session: AsyncSession
    ) -> list[ResourceEntity]:
        """Return logical resource entities and their linked component files."""
        stmt = (
            select(ResourceEntity)
            .where(ResourceEntity.project_id == project_id)
            .options(
                selectinload(ResourceEntity.resource_files).selectinload(ResourceFile.file)
            )
            .order_by(ResourceEntity.display_name, ResourceEntity.id)
        )
        return list((await session.execute(stmt)).scalars().all())

    # ------------------------------------------------------------------
    # File-set-scope loaders
    # ------------------------------------------------------------------

    async def load_files(
        self, file_ids: list[str], session: AsyncSession
    ) -> dict[str, File]:
        """Return {file_id: File} for a specific set of file IDs,
        with EnhancedMetadata eagerly loaded.
        """
        if not file_ids:
            return {}
        stmt = (
            select(File)
            .where(File.id.in_(file_ids))
            .options(selectinload(File.enhanced_metadata))
        )
        files = (await session.execute(stmt)).scalars().all()
        return {f.id: f for f in files}

    async def load_file_runs_for_files(
        self, file_ids: list[str], session: AsyncSession
    ) -> list[FileRun]:
        """For file_set mode: find FileRuns for a set of File IDs, with
        experiment → sample eagerly loaded (one query).
        """
        if not file_ids:
            return []
        stmt = (
            select(FileRun)
            .where(FileRun.file_id.in_(file_ids))
            .options(
                selectinload(FileRun.experiment).selectinload(Experiment.sample)
            )
        )
        return list((await session.execute(stmt)).scalars().all())
