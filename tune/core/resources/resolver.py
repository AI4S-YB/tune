"""ResourceResolver — resolves project resources into ResourceNode objects.

Resolution strategy per resource kind:

  reads:
    1. FileRun.read_number (authoritative — no filename heuristics)
    2. Unlinked FASTQs → status="missing"

  reference_fasta:
    1. Resource entities / reference bundles → confidence 0.95
    2. KnownPath(reference_fasta) → confidence 0.9
    3. EnhancedMetadata(genome_build) + organism filter → confidence 0.6
    4. FASTA file extension scan → confidence 0.3
    Single match → ready; multiple → ambiguous; none → missing

  annotation_gtf:
    1. Resource entities / annotation bundles → confidence 0.95
    2. KnownPath(annotation_gtf) → ready
    3. GTF/GFF project file scan (including .gz) → ready with warning
    4. None → missing

  aligner_index (hisat2 | star | bwa | bowtie2):
    1. DerivedResourceCache → ready or stale
    2. KnownPath fallback (if index files exist)
    3. derivable if reference ready
    4. missing otherwise
"""
from __future__ import annotations

import os
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.context.models import FilePlannerInfo, PlannerContext
from tune.core.resources.cache import DerivedResourceCache
from tune.core.resources.models import (
    ReadGroup,
    ResourceCandidate,
    ResourceNode,
    ResourceSourceType,
)

# FASTA extensions for reference genome detection
_FASTA_EXTS = (".fa", ".fasta", ".fna", ".fa.gz", ".fasta.gz")
# GTF/GFF extensions for annotation detection
_GTF_EXTS = (".gtf", ".gff", ".gff3", ".gtf.gz", ".gff.gz", ".gff3.gz")

# KnownPath key for derived aligner indices (kept for backwards-compat lookup)
_ALIGNER_KP_KEYS: dict[str, str] = {
    "hisat2": "hisat2_index",
    "star": "star_genome_dir",
    "bwa": "bwa_index",
    "bowtie2": "bowtie2_index",
}

_REFERENCE_ENTITY_ROLES = {"reference", "reference_bundle", "reference_fasta"}
_ANNOTATION_ENTITY_ROLES = {"annotation", "annotation_bundle", "annotation_gtf"}


def _has_ext(filename: str, exts: tuple[str, ...]) -> bool:
    lower = filename.lower()
    return any(lower.endswith(e) for e in exts)


def _primary_organism(ctx: PlannerContext) -> Optional[str]:
    """Return the most common organism string from samples, or None."""
    counts: dict[str, int] = {}
    for s in ctx.samples:
        if s.organism:
            counts[s.organism] = counts.get(s.organism, 0) + 1
    if not counts:
        return None
    return max(counts, key=lambda k: counts[k])


def _rank_candidates(
    candidates: list[ResourceCandidate],
    primary_organism: Optional[str],
) -> list[ResourceCandidate]:
    """Sort candidates by confidence descending; boost organism-matching ones."""
    if primary_organism:
        for c in candidates:
            if c.organism and c.organism.lower() == primary_organism.lower():
                c.confidence = min(1.0, c.confidence + 0.2)
    return sorted(candidates, key=lambda c: c.confidence, reverse=True)


def _kp_dict(ctx: PlannerContext) -> dict[str, str]:
    """Build {key: path} dict from PlannerContext.project.known_paths."""
    if ctx.project is None:
        return {}
    return {kp["key"]: kp["path"] for kp in (ctx.project.known_paths or [])}


def _iter_entity_candidates(
    ctx: PlannerContext,
    *,
    accepted_roles: set[str],
    file_role: str,
    default_label: str,
) -> list[ResourceCandidate]:
    """Build ranked candidates from preloaded project resource entities."""
    project = ctx.project
    if project is None:
        return []

    candidates: list[ResourceCandidate] = []
    for entity in project.resource_entities or []:
        resource_role = (entity.get("resource_role") or "").lower()
        if resource_role not in accepted_roles:
            continue

        components = entity.get("components") or []
        matching_components = [c for c in components if c.get("file_role") == file_role]
        if not matching_components:
            continue

        primary_component = next(
            (c for c in matching_components if c.get("is_primary")),
            matching_components[0],
        )
        path = primary_component.get("path")
        if not path:
            continue

        linked_file_ids = [
            c.get("file_id")
            for c in components
            if c.get("file_id")
        ]
        candidates.append(
            ResourceCandidate(
                path=path,
                resource_entity_id=entity.get("id"),
                file_id=primary_component.get("file_id"),
                linked_file_ids=linked_file_ids,
                organism=entity.get("organism"),
                genome_build=entity.get("genome_build"),
                source_type="resource_entity",
                confidence=0.95,
            )
        )

    return _rank_candidates(candidates, _primary_organism(ctx))


def _node_from_candidate(
    *,
    node_id: str,
    kind: str,
    label: str,
    candidate: ResourceCandidate,
    fallback_candidates: list[ResourceCandidate] | None = None,
) -> ResourceNode:
    return ResourceNode(
        id=node_id,
        kind=kind,  # type: ignore[arg-type]
        status="ready",
        label=label,
        resource_entity_id=candidate.resource_entity_id,
        resolved_path=candidate.path,
        candidates=fallback_candidates or [],
        organism=candidate.organism,
        genome_build=candidate.genome_build,
        linked_file_ids=candidate.linked_file_ids,
        source_type=candidate.source_type,
    )


class ResourceResolver:
    """Resolves project resources from PlannerContext + DB into ResourceNode objects."""

    def __init__(self) -> None:
        self._cache = DerivedResourceCache()

    def resolve_reads(
        self, ctx: PlannerContext
    ) -> tuple[list[ResourceNode], list[ReadGroup]]:
        """Build read ResourceNodes and ReadGroups from FileRun.read_number."""
        nodes: list[ResourceNode] = []
        read_groups: list[ReadGroup] = []

        fastq_files = [f for f in ctx.files if f.file_type in ("fastq", "fq")]

        exp_to_files: dict[str, list[FilePlannerInfo]] = {}
        unlinked: list[FilePlannerInfo] = []

        for f in fastq_files:
            exp_id = ctx.file_to_experiment.get(f.id)
            if exp_id:
                exp_to_files.setdefault(exp_id, []).append(f)
            else:
                unlinked.append(f)

        for exp_id, files in exp_to_files.items():
            exp_info = next((e for e in ctx.experiments if e.id == exp_id), None)
            sample_id = exp_info.sample_id if exp_info else ""
            sample_info = next((s for s in ctx.samples if s.id == sample_id), None)
            sample_name = sample_info.sample_name if sample_info else ""

            r1_id: Optional[str] = None
            r2_id: Optional[str] = None

            for f in files:
                node_id = f"reads:{f.id}"
                label_suffix = "R1" if f.read_number == 1 else "R2" if f.read_number == 2 else "read"
                node = ResourceNode(
                    id=node_id,
                    kind="reads",
                    status="ready",
                    label=f"{sample_name} {label_suffix}",
                    resolved_path=f.path,
                    source_type="filerun_db",
                    linked_file_ids=[f.id],
                    organism=sample_info.organism if sample_info else None,
                    size_bytes=None,
                )
                nodes.append(node)

                if f.read_number == 1:
                    r1_id = node_id
                elif f.read_number == 2:
                    r2_id = node_id

            rg = ReadGroup(
                sample_id=sample_id,
                sample_name=sample_name,
                experiment_id=exp_id,
                library_strategy=exp_info.library_strategy if exp_info else None,
                library_layout=exp_info.library_layout if exp_info else None,
                read1_resource_id=r1_id,
                read2_resource_id=r2_id,
            )
            read_groups.append(rg)

        for f in unlinked:
            node = ResourceNode(
                id=f"reads:{f.id}",
                kind="reads",
                status="missing",
                label=f.filename,
                resolved_path=None,
                source_type="project_file_scan",
                linked_file_ids=[f.id],
            )
            nodes.append(node)

        return nodes, read_groups

    def resolve_reference(self, ctx: PlannerContext) -> ResourceNode:
        """Resolve reference FASTA resource node."""
        kp = _kp_dict(ctx)
        primary_org = _primary_organism(ctx)
        project_id = ctx.project.id if ctx.project else "unknown"
        default_node_id = f"reference_fasta:{project_id[:8]}"

        entity_candidates = _iter_entity_candidates(
            ctx,
            accepted_roles=_REFERENCE_ENTITY_ROLES,
            file_role="reference_fasta",
            default_label="Reference genome FASTA",
        )
        if len(entity_candidates) == 1:
            candidate = entity_candidates[0]
            entity_id = candidate.resource_entity_id or project_id[:8]
            return _node_from_candidate(
                node_id=f"reference_fasta:{entity_id}",
                kind="reference_fasta",
                label="Reference genome FASTA",
                candidate=candidate,
            )

        kp_ref = kp.get("reference_fasta")
        if kp_ref and os.path.isfile(kp_ref):
            if entity_candidates:
                for candidate in entity_candidates:
                    if candidate.path == kp_ref:
                        candidate.confidence = 1.0
                        return _node_from_candidate(
                            node_id=f"reference_fasta:{candidate.resource_entity_id or project_id[:8]}",
                            kind="reference_fasta",
                            label="Reference genome FASTA",
                            candidate=candidate,
                            fallback_candidates=entity_candidates,
                        )
            return ResourceNode(
                id=default_node_id,
                kind="reference_fasta",
                status="ready",
                label="Reference genome FASTA",
                resolved_path=kp_ref,
                organism=primary_org,
                source_type="known_path",
                candidates=entity_candidates,
            )

        candidates = list(entity_candidates)

        for f in ctx.files:
            if not _has_ext(f.filename, _FASTA_EXTS):
                continue
            if kp_ref and f.path == kp_ref:
                continue
            if any(c.path == f.path for c in candidates):
                continue

            meta = f.intrinsic
            meta_org = meta.get("reference_genome") or meta.get("organism")
            meta_build = meta.get("genome_build")

            if meta_org or meta_build:
                conf = 0.6
                source: ResourceSourceType = "enhanced_metadata"
            else:
                conf = 0.3
                source = "project_file_scan"

            candidates.append(
                ResourceCandidate(
                    path=f.path,
                    file_id=f.id,
                    linked_file_ids=[f.id],
                    organism=meta_org or primary_org,
                    genome_build=meta_build,
                    source_type=source,
                    confidence=conf,
                )
            )

        candidates = _rank_candidates(candidates, primary_org)

        if not candidates:
            return ResourceNode(
                id=default_node_id,
                kind="reference_fasta",
                status="missing",
                label="Reference genome FASTA",
                source_type="project_file_scan",
            )

        if len(candidates) == 1:
            candidate = candidates[0]
            node_id = f"reference_fasta:{candidate.resource_entity_id or project_id[:8]}"
            return _node_from_candidate(
                node_id=node_id,
                kind="reference_fasta",
                label="Reference genome FASTA",
                candidate=candidate,
            )

        if primary_org:
            org_lower = primary_org.lower()
            org_matches = [
                c for c in candidates
                if c.organism and c.organism.lower() == org_lower
            ]
            if len(org_matches) == 1:
                candidate = org_matches[0]
                node_id = f"reference_fasta:{candidate.resource_entity_id or project_id[:8]}"
                return _node_from_candidate(
                    node_id=node_id,
                    kind="reference_fasta",
                    label="Reference genome FASTA",
                    candidate=candidate,
                    fallback_candidates=candidates,
                )

        return ResourceNode(
            id=default_node_id,
            kind="reference_fasta",
            status="ambiguous",
            label="Reference genome FASTA",
            resolved_path=None,
            candidates=candidates,
        )

    def resolve_annotation(self, ctx: PlannerContext) -> ResourceNode:
        """Resolve annotation GTF resource node."""
        kp = _kp_dict(ctx)
        project_id = ctx.project.id if ctx.project else "unknown"
        default_node_id = f"annotation_gtf:{project_id[:8]}"

        entity_candidates = _iter_entity_candidates(
            ctx,
            accepted_roles=_ANNOTATION_ENTITY_ROLES | _REFERENCE_ENTITY_ROLES,
            file_role="annotation_gtf",
            default_label="Annotation GTF",
        )
        if len(entity_candidates) == 1:
            candidate = entity_candidates[0]
            entity_id = candidate.resource_entity_id or project_id[:8]
            return _node_from_candidate(
                node_id=f"annotation_gtf:{entity_id}",
                kind="annotation_gtf",
                label="Annotation GTF",
                candidate=candidate,
            )

        kp_gtf = kp.get("annotation_gtf") or kp.get("annotation_bed")
        if kp_gtf and os.path.isfile(kp_gtf):
            if entity_candidates:
                for candidate in entity_candidates:
                    if candidate.path == kp_gtf:
                        candidate.confidence = 1.0
                        return _node_from_candidate(
                            node_id=f"annotation_gtf:{candidate.resource_entity_id or project_id[:8]}",
                            kind="annotation_gtf",
                            label="Annotation GTF",
                            candidate=candidate,
                            fallback_candidates=entity_candidates,
                        )
            return ResourceNode(
                id=default_node_id,
                kind="annotation_gtf",
                status="ready",
                label="Annotation GTF",
                resolved_path=kp_gtf,
                source_type="known_path",
                candidates=entity_candidates,
            )

        gtf_files = [f for f in ctx.files if _has_ext(f.filename, _GTF_EXTS)]
        if len(gtf_files) == 1 and not entity_candidates:
            f = gtf_files[0]
            return ResourceNode(
                id=default_node_id,
                kind="annotation_gtf",
                status="ready",
                label="Annotation GTF",
                resolved_path=f.path,
                source_type="project_file_scan",
                linked_file_ids=[f.id],
            )
        elif gtf_files:
            primary_org = _primary_organism(ctx)
            candidates = _rank_candidates(
                entity_candidates + [
                    ResourceCandidate(
                        path=f.path,
                        file_id=f.id,
                        linked_file_ids=[f.id],
                        source_type="project_file_scan",
                        confidence=0.3,
                    )
                    for f in gtf_files
                    if not any(c.path == f.path for c in entity_candidates)
                ],
                primary_org,
            )
            if len(candidates) == 1:
                candidate = candidates[0]
                node_id = f"annotation_gtf:{candidate.resource_entity_id or project_id[:8]}"
                return _node_from_candidate(
                    node_id=node_id,
                    kind="annotation_gtf",
                    label="Annotation GTF",
                    candidate=candidate,
                )
            return ResourceNode(
                id=default_node_id,
                kind="annotation_gtf",
                status="ambiguous",
                label="Annotation GTF",
                resolved_path=None,
                candidates=candidates,
            )

        if entity_candidates:
            return ResourceNode(
                id=default_node_id,
                kind="annotation_gtf",
                status="ambiguous",
                label="Annotation GTF",
                resolved_path=None,
                candidates=entity_candidates,
            )

        return ResourceNode(
            id=default_node_id,
            kind="annotation_gtf",
            status="missing",
            label="Annotation GTF",
            source_type="project_file_scan",
        )

    async def resolve_aligner_index(
        self,
        ctx: PlannerContext,
        aligner: str,
        db: AsyncSession,
        reference_node: Optional[ResourceNode] = None,
    ) -> ResourceNode:
        """Resolve aligner index resource node."""
        project_id = ctx.project.id if ctx.project else "unknown"
        primary_org = _primary_organism(ctx)
        node_id = f"aligner_index:{aligner}:{project_id[:8]}"

        cached = await self._cache.get(
            project_id=project_id,
            kind="aligner_index",
            aligner=aligner,
            db=db,
            organism=primary_org,
        )
        if cached is not None:
            cached.id = node_id
            return cached

        kp = _kp_dict(ctx)
        kp_key = _ALIGNER_KP_KEYS.get(aligner, f"{aligner}_index")
        kp_path = kp.get(kp_key)
        if kp_path:
            from tune.core.resources.cache import _check_index_exists
            if _check_index_exists(kp_path, aligner):
                return ResourceNode(
                    id=node_id,
                    kind="aligner_index",
                    status="ready",
                    label=f"{aligner} index",
                    resolved_path=kp_path,
                    source_type="known_path",
                )

        if reference_node and reference_node.status == "ready":
            ref_path = reference_node.resolved_path or ""
            derive_cmd = _derive_command(aligner, ref_path)
            return ResourceNode(
                id=node_id,
                kind="aligner_index",
                status="derivable",
                label=f"{aligner} index",
                resource_entity_id=reference_node.resource_entity_id,
                resolved_path=None,
                source_type="auto_derived",
                derived_from_ids=[reference_node.id],
                derive_command=derive_cmd,
            )

        return ResourceNode(
            id=node_id,
            kind="aligner_index",
            status="missing",
            label=f"{aligner} index",
            source_type="auto_derived",
        )


def _derive_command(aligner: str, fasta_path: str) -> str:
    """Human-readable description of how to build the aligner index."""
    if aligner == "hisat2":
        return f"hisat2-build {fasta_path} <index_prefix>"
    if aligner == "star":
        return f"STAR --runMode genomeGenerate --genomeFastaFiles {fasta_path} --genomeDir <genome_dir>"
    if aligner == "bwa":
        return f"bwa index {fasta_path}"
    if aligner == "bowtie2":
        return f"bowtie2-build {fasta_path} <index_prefix>"
    return f"build index for {aligner} from {fasta_path}"
