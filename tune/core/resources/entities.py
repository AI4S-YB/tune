"""Resource entity synchronization helpers.

This module materializes obvious project-scoped resource entities from the
existing file inventory and links derived-resource cache outputs back into the
resource entity graph.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from tune.core.models import File, KnownPath, Project, ResourceDerivation, ResourceEntity, ResourceFile

_FASTA_EXTS = (".fa", ".fasta", ".fna", ".fa.gz", ".fasta.gz")
_GTF_EXTS = (".gtf", ".gff", ".gff3", ".gtf.gz", ".gff.gz", ".gff3.gz")


def _has_ext(filename: str, exts: tuple[str, ...]) -> bool:
    lower = filename.lower()
    return any(lower.endswith(ext) for ext in exts)


def _known_path_map(known_paths: list[KnownPath]) -> dict[str, str]:
    return {kp.key: kp.path for kp in known_paths}


def _reference_primary_path(entity: ResourceEntity, file_map: dict[str, File]) -> Optional[str]:
    for rf in entity.resource_files or []:
        if rf.file_role == "reference_fasta" and rf.is_primary:
            file_obj = file_map.get(rf.file_id)
            if file_obj is not None:
                return file_obj.path
    for rf in entity.resource_files or []:
        if rf.file_role == "reference_fasta":
            file_obj = file_map.get(rf.file_id)
            if file_obj is not None:
                return file_obj.path
    return None


def _entity_has_role(entity: ResourceEntity, file_role: str) -> bool:
    return any(rf.file_role == file_role for rf in (entity.resource_files or []))


def _match_reference_entity_for_annotation(
    annotation_file: File,
    reference_entities: list[ResourceEntity],
    file_map: dict[str, File],
) -> Optional[ResourceEntity]:
    annotation_dir = str(Path(annotation_file.path).parent)
    same_dir: list[ResourceEntity] = []
    for entity in reference_entities:
        ref_path = _reference_primary_path(entity, file_map)
        if ref_path and str(Path(ref_path).parent) == annotation_dir:
            same_dir.append(entity)
    if len(same_dir) == 1:
        return same_dir[0]
    if len(reference_entities) == 1:
        return reference_entities[0]
    return None


async def _load_entities(project_id: str, session: AsyncSession) -> list[ResourceEntity]:
    stmt = (
        select(ResourceEntity)
        .where(ResourceEntity.project_id == project_id)
        .options(
            selectinload(ResourceEntity.resource_files).selectinload(ResourceFile.file)
        )
        .order_by(ResourceEntity.display_name, ResourceEntity.id)
    )
    return list((await session.execute(stmt)).scalars().all())


async def sync_project_resource_entities(
    session: AsyncSession,
    project_id: str,
    file_map: dict[str, File],
    known_paths: list[KnownPath],
) -> int:
    """Materialize obvious reference / annotation resource entities.

    Scope of this first implementation:
    - create one `reference_bundle` entity per FASTA file not yet linked
    - attach one annotation component to a reference bundle when there is one
      obvious match (same directory or only one reference bundle)
    - otherwise create one standalone `annotation_bundle` per GTF/GFF file
    """
    existing_entities = await _load_entities(project_id, session)
    component_keys = {
        (rf.file_id, rf.file_role)
        for entity in existing_entities
        for rf in (entity.resource_files or [])
    }
    known = _known_path_map(known_paths)
    changes = 0

    reference_entities = [
        entity for entity in existing_entities
        if entity.resource_role in {"reference", "reference_bundle", "reference_fasta"}
    ]

    for file_obj in file_map.values():
        if not _has_ext(file_obj.filename, _FASTA_EXTS):
            continue
        key = (file_obj.id, "reference_fasta")
        if key in component_keys:
            continue

        entity = ResourceEntity(
            id=str(uuid.uuid4()),
            project_id=project_id,
            resource_role="reference_bundle",
            display_name=file_obj.filename,
            organism=None,
            genome_build=None,
            source_type="user_confirmed" if known.get("reference_fasta") == file_obj.path else "project_file_scan",
            source_uri=file_obj.path,
            status="ready",
            metadata_json={"managed_by": "resource_entity_sync", "primary_component": "reference_fasta"},
        )
        entity.resource_files = []
        session.add(entity)
        await session.flush()
        entity.resource_files.append(
            ResourceFile(
                id=str(uuid.uuid4()),
                resource_entity_id=entity.id,
                file_id=file_obj.id,
                file_role="reference_fasta",
                is_primary=True,
                metadata_json={},
            )
        )
        component_keys.add(key)
        reference_entities.append(entity)
        existing_entities.append(entity)
        changes += 1

    for file_obj in file_map.values():
        if not _has_ext(file_obj.filename, _GTF_EXTS):
            continue
        key = (file_obj.id, "annotation_gtf")
        if key in component_keys:
            continue

        target_entity = _match_reference_entity_for_annotation(file_obj, reference_entities, file_map)
        if target_entity is not None and not _entity_has_role(target_entity, "annotation_gtf"):
            session.add(
                ResourceFile(
                    id=str(uuid.uuid4()),
                    resource_entity_id=target_entity.id,
                    file_id=file_obj.id,
                    file_role="annotation_gtf",
                    is_primary=known.get("annotation_gtf") == file_obj.path,
                    metadata_json={"managed_by": "resource_entity_sync", "attached_by": "same_dir_or_single_reference"},
                )
            )
            component_keys.add(key)
            changes += 1
            continue

        entity = ResourceEntity(
            id=str(uuid.uuid4()),
            project_id=project_id,
            resource_role="annotation_bundle",
            display_name=file_obj.filename,
            organism=None,
            genome_build=None,
            source_type="user_confirmed" if known.get("annotation_gtf") == file_obj.path else "project_file_scan",
            source_uri=file_obj.path,
            status="ready",
            metadata_json={"managed_by": "resource_entity_sync", "primary_component": "annotation_gtf"},
        )
        entity.resource_files = []
        session.add(entity)
        await session.flush()
        entity.resource_files.append(
            ResourceFile(
                id=str(uuid.uuid4()),
                resource_entity_id=entity.id,
                file_id=file_obj.id,
                file_role="annotation_gtf",
                is_primary=True,
                metadata_json={},
            )
        )
        component_keys.add(key)
        existing_entities.append(entity)
        changes += 1

    if changes:
        await session.commit()
    return changes


async def sync_derived_resource_entity(
    session: AsyncSession,
    *,
    project_id: str,
    aligner: str,
    derived_path: str,
    derived_from_path: str | None,
) -> Optional[str]:
    """Ensure a derived aligner-index resource entity and derivation edge exist."""
    entities = await _load_entities(project_id, session)

    parent_entity: Optional[ResourceEntity] = None
    if derived_from_path:
        for entity in entities:
            for rf in entity.resource_files or []:
                if rf.file is not None and rf.file.path == derived_from_path and rf.file_role == "reference_fasta":
                    parent_entity = entity
                    break
            if parent_entity is not None:
                break

    child_entity = next(
        (
            entity for entity in entities
            if entity.resource_role == "aligner_index"
            and entity.source_uri == derived_path
            and (entity.metadata_json or {}).get("aligner") == aligner
        ),
        None,
    )

    changed = False
    if child_entity is None:
        child_entity = ResourceEntity(
            id=str(uuid.uuid4()),
            project_id=project_id,
            resource_role="aligner_index",
            display_name=f"{aligner.upper()} index",
            organism=parent_entity.organism if parent_entity is not None else None,
            genome_build=parent_entity.genome_build if parent_entity is not None else None,
            source_type="auto_derived",
            source_uri=derived_path,
            status="ready",
            metadata_json={"managed_by": "resource_entity_sync", "aligner": aligner},
        )
        session.add(child_entity)
        await session.flush()
        changed = True

    if parent_entity is not None:
        stmt = select(ResourceDerivation).where(
            ResourceDerivation.parent_resource_id == parent_entity.id,
            ResourceDerivation.child_resource_id == child_entity.id,
            ResourceDerivation.derivation_type == f"{aligner}_index_from_fasta",
        )
        existing = (await session.execute(stmt)).scalar_one_or_none()
        if existing is None:
            session.add(
                ResourceDerivation(
                    id=str(uuid.uuid4()),
                    parent_resource_id=parent_entity.id,
                    child_resource_id=child_entity.id,
                    derivation_type=f"{aligner}_index_from_fasta",
                    tool_name=aligner,
                    params_json={"derived_path": derived_path, "source_path": derived_from_path},
                )
            )
            changed = True

    if changed:
        await session.commit()
    return child_entity.id if child_entity is not None else None


async def load_project_resource_inputs(
    session: AsyncSession,
    project_id: str,
) -> tuple[Project | None, dict[str, File], list[KnownPath]]:
    """Load the minimum project-scoped inputs needed for resource sync."""
    project = (
        await session.execute(select(Project).where(Project.id == project_id))
    ).scalar_one_or_none()
    if project is None:
        return None, {}, []

    files = (
        await session.execute(
            select(File).where(File.project_id == project_id).order_by(File.path)
        )
    ).scalars().all()
    known_paths = (
        await session.execute(
            select(KnownPath)
            .where(KnownPath.project_id == project_id)
            .order_by(KnownPath.key)
        )
    ).scalars().all()

    known_path_targets = [kp.path for kp in known_paths if kp.path]
    extra_files: list[File] = []
    if known_path_targets:
        extra_files = list((
            await session.execute(
                select(File).where(
                    File.path.in_(known_path_targets),
                    or_(File.project_id == project_id, File.project_id.is_(None)),
                )
            )
        ).scalars().all())

    file_map = {file_obj.id: file_obj for file_obj in files}
    for file_obj in extra_files:
        file_map[file_obj.id] = file_obj
    return project, file_map, list(known_paths)


async def sync_project_resource_entities_by_id(
    session: AsyncSession,
    project_id: str,
) -> dict[str, int | str | None]:
    """Run explicit project-scoped resource-entity backfill / reconciliation."""
    project, file_map, known_paths = await load_project_resource_inputs(session, project_id)
    if project is None:
        raise ValueError(f"Project not found: {project_id}")

    changes = await sync_project_resource_entities(
        session,
        project_id,
        file_map,
        known_paths,
    )
    resource_entities = await _load_entities(project_id, session)
    return {
        "project_id": project.id,
        "project_name": project.name,
        "file_count": len(file_map),
        "known_path_count": len(known_paths),
        "changes": changes,
        "resource_entity_count": len(resource_entities),
    }


async def sync_all_projects_resource_entities(
    session: AsyncSession,
) -> list[dict[str, int | str | None]]:
    """Run explicit resource-entity backfill for all projects."""
    project_ids = list((
        await session.execute(select(Project.id).order_by(Project.name, Project.id))
    ).scalars().all())
    results: list[dict[str, int | str | None]] = []
    for project_id in project_ids:
        results.append(await sync_project_resource_entities_by_id(session, project_id))
    return results
