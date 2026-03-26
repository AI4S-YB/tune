"""DerivedResourceCache — persistent cache for derived bioinformatics resources.

Stores aligner index paths with provenance (derived_from_path) and staleness
tracking (derived_from_mtime).  Returns ResourceNode objects so callers don't
need to know the underlying DB schema.
"""
from __future__ import annotations

import glob
import os
import uuid
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.models import DerivedResource
from tune.core.resources.models import ResourceNode, ResourceStatus

# Extension globs used to verify that index files still exist on disk
_INDEX_GLOBS: dict[str, list[str]] = {
    "hisat2": ["*.ht2", "*.ht2l"],
    "star": ["SA"],          # presence of SA file inside genome dir
    "bwa": ["*.bwt", "*.sa"],
    "bowtie2": ["*.bt2", "*.bt2l"],
}


def _index_files_exist(path: str, aligner: Optional[str]) -> bool:
    """Return True if index files for the aligner are present at *path*."""
    if not aligner:
        return os.path.exists(path)
    patterns = _INDEX_GLOBS.get(aligner, [])
    if not patterns:
        return os.path.exists(path)
    if aligner == "star":
        # path is the genome dir; check for SA file inside it
        return os.path.isfile(os.path.join(path, "SA"))
    # For other aligners, path is the index prefix; glob with that prefix
    for pat in patterns:
        if glob.glob(f"{path}*.ht2") or glob.glob(f"{path}*.ht2l") or \
           glob.glob(f"{path}*.bt2") or glob.glob(f"{path}*.bt2l") or \
           glob.glob(f"{path}.bwt") or glob.glob(f"{path}.sa"):
            return True
    return False


def _check_index_exists(path: str, aligner: Optional[str]) -> bool:
    """Simplified existence check per aligner type."""
    if aligner == "hisat2":
        return bool(glob.glob(f"{path}*.1.ht2") or glob.glob(f"{path}.1.ht2"))
    if aligner == "star":
        return os.path.isfile(os.path.join(path, "SA"))
    if aligner == "bwa":
        return os.path.isfile(f"{path}.bwt")
    if aligner == "bowtie2":
        return bool(glob.glob(f"{path}*.1.bt2") or glob.glob(f"{path}.1.bt2"))
    return os.path.exists(path)


class DerivedResourceCache:
    """Query and update the derived_resources table."""

    async def get(
        self,
        project_id: str,
        kind: str,
        aligner: Optional[str],
        db: AsyncSession,
        organism: Optional[str] = None,
        genome_build: Optional[str] = None,
    ) -> Optional[ResourceNode]:
        """Return a ResourceNode for the cached resource, or None on cache miss.

        Status:
        - ``ready``  — record exists, mtime matches, index files present
        - ``stale``  — record exists but mtime mismatch or files missing
        """
        stmt = select(DerivedResource).where(
            DerivedResource.project_id == project_id,
            DerivedResource.kind == kind,
            DerivedResource.aligner == aligner,
        )
        record: Optional[DerivedResource] = (
            await db.execute(stmt)
        ).scalar_one_or_none()

        if record is None:
            return None

        path = record.path
        status: ResourceStatus = "ready"

        # Check staleness: mtime mismatch with source FASTA
        if record.derived_from_path and record.derived_from_mtime is not None:
            try:
                current_mtime = os.path.getmtime(record.derived_from_path)
                if abs(current_mtime - record.derived_from_mtime) > 1.0:
                    status = "stale"
            except OSError:
                status = "stale"

        # Check that index files still exist on disk
        if status == "ready" and not _check_index_exists(path, aligner):
            status = "stale"

        node_id = f"{kind}:{aligner or 'generic'}:{project_id[:8]}"
        return ResourceNode(
            id=node_id,
            kind="aligner_index",  # type: ignore[arg-type]
            status=status,
            label=f"{aligner or kind} index",
            resolved_path=path if status == "ready" else None,
            organism=record.organism,
            genome_build=record.genome_build,
            source_type="auto_derived",
            created_at=record.created_at,
        )

    async def put(
        self,
        project_id: str,
        node: ResourceNode,
        derived_from_path: str,
        aligner: Optional[str],
        db: AsyncSession,
    ) -> None:
        """Upsert a DerivedResource record after a successful build step."""
        derived_from_mtime: Optional[float] = None
        try:
            derived_from_mtime = os.path.getmtime(derived_from_path)
        except OSError:
            pass

        stmt = (
            insert(DerivedResource)
            .values(
                id=str(uuid.uuid4()),
                project_id=project_id,
                kind="aligner_index",
                aligner=aligner,
                organism=node.organism,
                genome_build=node.genome_build,
                path=node.resolved_path or "",
                derived_from_path=derived_from_path,
                derived_from_mtime=derived_from_mtime,
            )
            .on_conflict_do_update(
                constraint="uq_derived_resources",
                set_={
                    "path": node.resolved_path or "",
                    "derived_from_path": derived_from_path,
                    "derived_from_mtime": derived_from_mtime,
                    "organism": node.organism,
                    "genome_build": node.genome_build,
                },
            )
        )
        await db.execute(stmt)

    async def invalidate(
        self,
        project_id: str,
        aligner: Optional[str],
        db: AsyncSession,
    ) -> None:
        """Delete all cache entries for the given project+aligner combination."""
        stmt = delete(DerivedResource).where(
            DerivedResource.project_id == project_id,
            DerivedResource.aligner == aligner,
        )
        await db.execute(stmt)
