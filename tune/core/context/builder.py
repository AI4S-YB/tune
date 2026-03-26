"""PlannerContextBuilder — assembles PlannerContext from the relational model.

Usage:
    async with get_session_factory()() as session:
        ctx = await PlannerContextBuilder(session).build(
            ContextScope(project_id="...")
        )
"""
from __future__ import annotations

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.context.graph_loader import ProjectGraphLoader
from tune.core.context.models import (
    AnalysisSummary,
    ContextScope,
    ExperimentPlannerInfo,
    PlannerContext,
    ProjectPlannerInfo,
    SamplePlannerInfo,
)
from tune.core.context.normalizer import build_summary
from tune.core.context.resolver import (
    resolve_files_from_file_runs,
    resolve_files_from_project,
)
from tune.core.models import File, KnownPath, ResourceEntity
from tune.core.resources.entities import sync_project_resource_entities
from tune.core.resources.graph_builder import ResourceGraphBuilder

log = logging.getLogger(__name__)


class PlannerContextBuilder:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._loader = ProjectGraphLoader()

    async def build(self, scope: ContextScope) -> PlannerContext:
        """Assemble PlannerContext from the given scope."""
        if scope.file_ids is not None:
            return await self._build_file_set(scope)
        if scope.project_id:
            return await self._build_project(scope)
        return self._empty_context()

    async def _load_project_resource_entities(
        self,
        project_id: str,
        file_map: dict[str, File],
        known_paths: list[KnownPath],
    ) -> list[ResourceEntity]:
        try:
            await sync_project_resource_entities(
                self._session,
                project_id,
                file_map,
                known_paths,
            )
        except Exception:
            log.exception(
                "PlannerContextBuilder: resource entity sync failed for project %s; continuing without sync",
                project_id,
            )
        try:
            return await self._loader.load_resource_entities(project_id, self._session)
        except Exception:
            log.exception(
                "PlannerContextBuilder: resource entity load failed for project %s; continuing without entities",
                project_id,
            )
            return []

    @staticmethod
    def _serialize_resource_entities(resource_entities: list[ResourceEntity]) -> list[dict]:
        return [
            {
                "id": entity.id,
                "resource_role": entity.resource_role,
                "display_name": entity.display_name,
                "organism": entity.organism,
                "genome_build": entity.genome_build,
                "status": entity.status,
                "source_type": entity.source_type,
                "components": [
                    {
                        "file_id": rf.file_id,
                        "path": rf.file.path if rf.file is not None else None,
                        "file_role": rf.file_role,
                        "is_primary": rf.is_primary,
                    }
                    for rf in (entity.resource_files or [])
                ],
            }
            for entity in resource_entities
        ]

    # ------------------------------------------------------------------
    # Project-scope build
    # ------------------------------------------------------------------

    async def _build_project(self, scope: ContextScope) -> PlannerContext:
        project = await self._loader.load(scope.project_id, self._session)
        if not project:
            return self._empty_context()

        file_map = await self._loader.load_files_for_project(
            scope.project_id, self._session
        )
        known_paths = await self._loader.load_known_paths(
            scope.project_id, self._session
        )
        resource_entities = await self._load_project_resource_entities(
            scope.project_id,
            file_map,
            known_paths,
        )

        samples = [
            SamplePlannerInfo(
                id=s.id,
                sample_name=s.sample_name,
                organism=s.organism,
                attrs=s.attrs or {},
            )
            for s in (project.samples or [])
        ]

        experiments: list[ExperimentPlannerInfo] = []
        for s in project.samples or []:
            for e in s.experiments or []:
                experiments.append(
                    ExperimentPlannerInfo(
                        id=e.id,
                        sample_id=s.id,
                        library_strategy=e.library_strategy,
                        library_layout=e.library_layout,
                        platform=e.platform,
                        instrument_model=e.instrument_model,
                        file_ids=[fr.file_id for fr in (e.file_runs or [])],
                    )
                )

        file_infos, file_to_sample, file_to_experiment = resolve_files_from_project(
            project, file_map
        )

        project_info = ProjectPlannerInfo(
            id=project.id,
            name=project.name,
            project_dir=project.project_dir,
            project_goal=project.project_goal,
            project_info=project.project_info or {},
            known_paths=[
                {"key": kp.key, "path": kp.path, "description": kp.description}
                for kp in known_paths
            ],
            resource_entities=self._serialize_resource_entities(resource_entities),
        )

        summary = build_summary(samples, experiments, file_infos, known_paths)

        ctx = PlannerContext(
            context_mode="project",
            project=project_info,
            samples=samples,
            experiments=experiments,
            files=file_infos,
            file_to_sample=file_to_sample,
            file_to_experiment=file_to_experiment,
            summary=summary,
        )

        # Build ResourceGraph and attach summary to context
        try:
            graph = await ResourceGraphBuilder().build(ctx, self._session)
            ctx.resource_graph = graph
            ctx.resource_summary = ResourceGraphBuilder.to_summary(graph)
        except Exception:
            log.exception(
                "PlannerContextBuilder: ResourceGraph build failed; continuing without it"
            )

        return ctx

    # ------------------------------------------------------------------
    # File-set-scope build
    # ------------------------------------------------------------------

    async def _build_file_set(self, scope: ContextScope) -> PlannerContext:
        file_ids = scope.file_ids or []
        file_map = await self._loader.load_files(file_ids, self._session)
        file_runs = await self._loader.load_file_runs_for_files(
            file_ids, self._session
        )

        # Collect unique samples and experiments from the file_runs
        seen_samples: dict[str, SamplePlannerInfo] = {}
        seen_experiments: dict[str, ExperimentPlannerInfo] = {}
        for fr in file_runs:
            exp = fr.experiment
            smp = exp.sample
            if smp.id not in seen_samples:
                seen_samples[smp.id] = SamplePlannerInfo(
                    id=smp.id,
                    sample_name=smp.sample_name,
                    organism=smp.organism,
                    attrs=smp.attrs or {},
                )
            if exp.id not in seen_experiments:
                seen_experiments[exp.id] = ExperimentPlannerInfo(
                    id=exp.id,
                    sample_id=smp.id,
                    library_strategy=exp.library_strategy,
                    library_layout=exp.library_layout,
                    platform=exp.platform,
                    instrument_model=exp.instrument_model,
                    file_ids=[
                        fr2.file_id
                        for fr2 in (exp.file_runs or [])
                        if fr2.file_id in file_map
                    ],
                )

        # Try to load project info if all files share one project
        project_info: ProjectPlannerInfo | None = None
        known_paths: list[KnownPath] = []
        project_ids = {f.project_id for f in file_map.values() if f.project_id}
        if len(project_ids) == 1:
            pid = next(iter(project_ids))
            project = await self._loader.load(pid, self._session)
            known_paths = await self._loader.load_known_paths(pid, self._session)
            project_file_map = await self._loader.load_files_for_project(
                pid, self._session
            )
            resource_entities = await self._load_project_resource_entities(
                pid,
                project_file_map,
                known_paths,
            )
            if project:
                project_info = ProjectPlannerInfo(
                    id=project.id,
                    name=project.name,
                    project_dir=project.project_dir,
                    project_goal=project.project_goal,
                    project_info=project.project_info or {},
                    known_paths=[
                        {
                            "key": kp.key,
                            "path": kp.path,
                            "description": kp.description,
                        }
                        for kp in known_paths
                    ],
                    resource_entities=self._serialize_resource_entities(resource_entities),
                )

        samples = list(seen_samples.values())
        experiments = list(seen_experiments.values())
        file_infos, file_to_sample, file_to_experiment = resolve_files_from_file_runs(
            file_runs, file_map
        )
        summary = build_summary(samples, experiments, file_infos, known_paths)

        return PlannerContext(
            context_mode="file_set",
            project=project_info,
            samples=samples,
            experiments=experiments,
            files=file_infos,
            file_to_sample=file_to_sample,
            file_to_experiment=file_to_experiment,
            summary=summary,
        )

    # ------------------------------------------------------------------
    # Fallback
    # ------------------------------------------------------------------

    @staticmethod
    def _empty_context() -> PlannerContext:
        summary = AnalysisSummary(
            total_files=0,
            files_by_type={},
            sample_count=0,
            experiment_count=0,
            library_strategies=[],
            organisms=[],
            is_paired_end=None,
            has_reference_genome=False,
            files_without_samples=0,
            metadata_completeness="missing",
            suggested_analysis_type=None,
            potential_issues=["No project or files selected"],
        )
        return PlannerContext(
            context_mode="global",
            project=None,
            samples=[],
            experiments=[],
            files=[],
            file_to_sample={},
            file_to_experiment={},
            summary=summary,
        )
