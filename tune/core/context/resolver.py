"""FileContextResolver — builds FilePlannerInfo list from loaded ORM objects.

Two entry points:
  resolve_files_from_project()   — project-scope: uses Project ORM tree
  resolve_files_from_file_runs() — file_set-scope: uses FileRun back-references
"""
from __future__ import annotations

from tune.core.context.models import INTRINSIC_META_KEYS, FilePlannerInfo
from tune.core.models import File, FileRun, Project


def resolve_files_from_project(
    project: Project,
    file_map: dict[str, File],
) -> tuple[list[FilePlannerInfo], dict[str, str], dict[str, str]]:
    """Build FilePlannerInfo list + lookup dicts from a loaded Project tree.

    Returns:
        (file_infos, file_to_sample, file_to_experiment)
    """
    file_to_experiment: dict[str, str] = {}
    file_to_sample: dict[str, str] = {}
    read_number_map: dict[str, int | None] = {}

    for sample in project.samples or []:
        for exp in sample.experiments or []:
            for fr in exp.file_runs or []:
                file_to_experiment[fr.file_id] = exp.id
                file_to_sample[fr.file_id] = sample.id
                read_number_map[fr.file_id] = fr.read_number

    file_infos: list[FilePlannerInfo] = []
    for f in file_map.values():
        intrinsic = {
            m.field_key: (m.field_value or "")
            for m in f.enhanced_metadata
            if m.field_key in INTRINSIC_META_KEYS
        }
        file_infos.append(
            FilePlannerInfo(
                id=f.id,
                path=f.path,
                filename=f.filename,
                file_type=f.file_type,
                read_number=read_number_map.get(f.id),
                linked_sample_id=file_to_sample.get(f.id),
                linked_experiment_id=file_to_experiment.get(f.id),
                intrinsic=intrinsic,
            )
        )

    return file_infos, file_to_sample, file_to_experiment


def resolve_files_from_file_runs(
    file_runs: list[FileRun],
    file_map: dict[str, File],
) -> tuple[list[FilePlannerInfo], dict[str, str], dict[str, str]]:
    """Build FilePlannerInfo list from FileRun records that have
    experiment and experiment.sample eagerly loaded.

    Returns:
        (file_infos, file_to_sample, file_to_experiment)
    """
    file_to_experiment: dict[str, str] = {}
    file_to_sample: dict[str, str] = {}
    read_number_map: dict[str, int | None] = {}

    for fr in file_runs:
        file_to_experiment[fr.file_id] = fr.experiment.id
        file_to_sample[fr.file_id] = fr.experiment.sample.id
        read_number_map[fr.file_id] = fr.read_number

    file_infos: list[FilePlannerInfo] = []
    for f in file_map.values():
        intrinsic = {
            m.field_key: (m.field_value or "")
            for m in f.enhanced_metadata
            if m.field_key in INTRINSIC_META_KEYS
        }
        file_infos.append(
            FilePlannerInfo(
                id=f.id,
                path=f.path,
                filename=f.filename,
                file_type=f.file_type,
                read_number=read_number_map.get(f.id),
                linked_sample_id=file_to_sample.get(f.id),
                linked_experiment_id=file_to_experiment.get(f.id),
                intrinsic=intrinsic,
            )
        )

    return file_infos, file_to_sample, file_to_experiment
