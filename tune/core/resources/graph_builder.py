"""ResourceGraphBuilder — builds ResourceGraph from PlannerContext + DB.

Calls ResourceResolver for each resource kind needed by the project's
experiments, then wires dependency edges between nodes.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from tune.core.context.models import PlannerContext
from tune.core.resources.models import (
    ReadGroup,
    ResourceEdge,
    ResourceGraph,
    ResourceNode,
    ResourceStatus,
    ResourceSummary,
)
from tune.core.resources.resolver import ResourceResolver

# Maps library_strategy (lower-case) → aligner type(s) needed
_STRATEGY_TO_ALIGNERS: dict[str, list[str]] = {
    "rna-seq": ["hisat2"],
    "rna_seq": ["hisat2"],
    "wgs": ["bwa"],
    "wes": ["bwa"],
    "chip-seq": ["bowtie2"],
    "chip_seq": ["bowtie2"],
    "atac-seq": ["bowtie2"],
    "atac_seq": ["bowtie2"],
}


def _infer_aligners(ctx: PlannerContext) -> list[str]:
    """Return list of aligner types needed based on experiment library_strategy."""
    aligners: set[str] = set()
    for exp in ctx.experiments:
        strat = (exp.library_strategy or "").lower().replace(" ", "_")
        for key, als in _STRATEGY_TO_ALIGNERS.items():
            if key in strat:
                aligners.update(als)
                break
    # Default to hisat2 if nothing detected (most common bioinformatics workflow)
    return sorted(aligners) if aligners else ["hisat2"]


class ResourceGraphBuilder:
    """Builds a ResourceGraph by calling ResourceResolver for each resource kind."""

    def __init__(self) -> None:
        self._resolver = ResourceResolver()

    async def build(
        self,
        ctx: PlannerContext,
        db: AsyncSession,
    ) -> ResourceGraph:
        """Build and return a fully-resolved ResourceGraph.

        Steps:
          1. Resolve reads (from FileRun.read_number)
          2. Resolve reference FASTA
          3. Resolve annotation GTF
          4. Resolve aligner index for each inferred aligner type
          5. Wire dependency edges
          6. Build by_kind index
        """
        graph = ResourceGraph()

        # ------------------------------------------------------------------
        # 1. Reads
        # ------------------------------------------------------------------
        read_nodes, read_groups = self._resolver.resolve_reads(ctx)
        for node in read_nodes:
            graph.nodes[node.id] = node
        graph.read_groups = read_groups
        self._update_by_kind(graph, read_nodes)

        # ------------------------------------------------------------------
        # 2. Reference FASTA
        # ------------------------------------------------------------------
        ref_node = self._resolver.resolve_reference(ctx)
        graph.nodes[ref_node.id] = ref_node
        self._update_by_kind(graph, [ref_node])

        # ------------------------------------------------------------------
        # 3. Annotation GTF
        # ------------------------------------------------------------------
        ann_node = self._resolver.resolve_annotation(ctx)
        graph.nodes[ann_node.id] = ann_node
        self._update_by_kind(graph, [ann_node])

        # ------------------------------------------------------------------
        # 4. Aligner index (one per inferred aligner type)
        # ------------------------------------------------------------------
        aligners = _infer_aligners(ctx)
        for aligner in aligners:
            idx_node = await self._resolver.resolve_aligner_index(
                ctx, aligner, db, reference_node=ref_node
            )
            graph.nodes[idx_node.id] = idx_node
            self._update_by_kind(graph, [idx_node])

            # 5. Wire dependency edges
            if ref_node:
                graph.edges.append(
                    ResourceEdge(
                        from_id=idx_node.id,
                        to_id=ref_node.id,
                        relation="derived_from",
                    )
                )
            # STAR genome also depends on annotation GTF
            if aligner == "star" and ann_node:
                graph.edges.append(
                    ResourceEdge(
                        from_id=idx_node.id,
                        to_id=ann_node.id,
                        relation="requires",
                    )
                )

        return graph

    @staticmethod
    def _update_by_kind(graph: ResourceGraph, nodes: list[ResourceNode]) -> None:
        for node in nodes:
            graph.by_kind.setdefault(node.kind, []).append(node.id)

    @staticmethod
    def to_summary(graph: ResourceGraph) -> ResourceSummary:
        """Compress ResourceGraph into a 5-field ResourceSummary for PlannerContext."""
        # reads_ready: all linked reads are ready
        read_nodes = [
            graph.nodes[nid]
            for nid in graph.by_kind.get("reads", [])
        ]
        reads_ready = bool(read_nodes) and all(
            n.status == "ready" for n in read_nodes
        )

        # reference_status: worst status across reference_fasta nodes
        ref_nodes = [
            graph.nodes[nid]
            for nid in graph.by_kind.get("reference_fasta", [])
        ]
        reference_status: ResourceStatus = _worst_status(ref_nodes, "missing")

        # annotation_status
        ann_nodes = [
            graph.nodes[nid]
            for nid in graph.by_kind.get("annotation_gtf", [])
        ]
        annotation_status: ResourceStatus = _worst_status(ann_nodes, "missing")

        # index_status
        idx_nodes = [
            graph.nodes[nid]
            for nid in graph.by_kind.get("aligner_index", [])
        ]
        index_status: ResourceStatus = _worst_status(idx_nodes, "missing")

        # prepare_steps_needed: derivable or stale index nodes
        prepare_steps: list[str] = []
        for node in idx_nodes:
            if node.status in ("derivable", "stale"):
                aligner = _aligner_from_node_id(node.id)
                step = _aligner_to_step(aligner)
                if step and step not in prepare_steps:
                    prepare_steps.append(step)

        return ResourceSummary(
            reads_ready=reads_ready,
            reference_status=reference_status,
            annotation_status=annotation_status,
            index_status=index_status,
            prepare_steps_needed=prepare_steps,
        )


def _worst_status(
    nodes: list[ResourceNode],
    default: ResourceStatus,
) -> ResourceStatus:
    """Return the 'worst' status across a list of nodes.

    Priority (worst → best): missing > ambiguous > stale > derivable > ready
    """
    if not nodes:
        return default
    order: list[ResourceStatus] = ["missing", "ambiguous", "stale", "derivable", "ready"]
    worst = "ready"
    for node in nodes:
        if order.index(node.status) < order.index(worst):
            worst = node.status
    return worst  # type: ignore[return-value]


def _aligner_from_node_id(node_id: str) -> str:
    """Extract aligner name from node_id like 'aligner_index:hisat2:abc12345'."""
    parts = node_id.split(":")
    return parts[1] if len(parts) >= 2 else "hisat2"


def _aligner_to_step(aligner: str) -> Optional[str]:
    _map = {
        "hisat2": "hisat2_build",
        "star": "star_genome_generate",
        "bwa": "bwa_index",
        "bowtie2": "bowtie2_build",
    }
    return _map.get(aligner)
