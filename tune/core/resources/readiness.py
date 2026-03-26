"""ReadinessChecker — evaluates a plan against a ResourceGraph.

Returns a ReadinessReport indicating whether execution can proceed,
with typed ReadinessIssue objects suitable for generating user dialogue.

Status mapping:
  ready     → ok, no issue
  derivable → ok (warning, prepare step should be injected)
  stale     → warning (treat as derivable if source is ready; inject rebuild)
  ambiguous → blocking issue, resolution_type=select_candidate
  missing   → blocking issue, resolution_type=provide_path or provide_metadata
"""
from __future__ import annotations

from tune.core.resources.models import (
    IssueKind,
    ReadinessIssue,
    ReadinessReport,
    ResourceGraph,
    ResourceKind,
    ResourceNode,
    ResourceStatus,
)

# Which resource kinds are needed for each step_type prefix
_STEP_TYPE_RESOURCE_NEEDS: dict[str, list[ResourceKind]] = {
    "align": ["reads", "reference_fasta", "aligner_index"],
    "quant": ["reads", "annotation_gtf"],
    "trim": ["reads"],
    "qc": ["reads"],
    "util": [],  # util steps (build/generate) are auto-injected; no user-facing requirements
}


def _step_prefix(step_type: str) -> str:
    """Return the first segment of a dotted step_type (e.g. 'align' from 'align.hisat2')."""
    return step_type.split(".")[0] if step_type else ""


class ReadinessChecker:
    """Checks a plan against a ResourceGraph and returns a ReadinessReport."""

    def check(
        self,
        plan: list[dict],
        resource_graph: ResourceGraph,
    ) -> ReadinessReport:
        """Evaluate plan resource requirements against the ResourceGraph.

        - ``derivable`` nodes are treated as ok (prepare steps should already be injected)
        - ``stale`` nodes are treated as derivable (warning only)
        - ``missing`` and ``ambiguous`` nodes produce blocking issues
        """
        issues: list[ReadinessIssue] = []
        warnings: list[ReadinessIssue] = []

        # Determine which resource kinds the plan actually needs
        needs_reads = False
        needs_reference = False
        needs_annotation = False
        needs_index = False
        step_keys_needing: dict[str, list[str]] = {}  # resource_kind → [step_key]

        for step in plan:
            step_type = step.get("step_type", "")
            step_key = step.get("step_key", step_type)
            prefix = _step_prefix(step_type)
            needed = _STEP_TYPE_RESOURCE_NEEDS.get(prefix, [])
            for kind in needed:
                step_keys_needing.setdefault(kind, []).append(step_key)
                if kind == "reads":
                    needs_reads = True
                elif kind == "reference_fasta":
                    needs_reference = True
                elif kind == "annotation_gtf":
                    needs_annotation = True
                elif kind == "aligner_index":
                    needs_index = True

        # Check reads
        if needs_reads:
            read_node_ids = resource_graph.by_kind.get("reads", [])
            if not read_node_ids:
                issues.append(_issue_missing_reads(step_keys_needing.get("reads", [])))
            else:
                unlinked = [
                    resource_graph.nodes[nid]
                    for nid in read_node_ids
                    if resource_graph.nodes[nid].status == "missing"
                ]
                if unlinked:
                    issues.extend(
                        _issue_unbound_read(node, step_keys_needing.get("reads", []))
                        for node in unlinked
                    )

        # Check reference FASTA
        if needs_reference:
            ref_ids = resource_graph.by_kind.get("reference_fasta", [])
            if not ref_ids:
                issues.append(_issue_for_missing_reference(step_keys_needing.get("reference_fasta", [])))
            else:
                ref_node = resource_graph.nodes[ref_ids[0]]
                issue_or_warn = self._issue_for_node(ref_node, step_keys_needing.get("reference_fasta", []))
                if issue_or_warn:
                    (issues if issue_or_warn.severity == "blocking" else warnings).append(issue_or_warn)

        # Check annotation GTF
        if needs_annotation:
            ann_ids = resource_graph.by_kind.get("annotation_gtf", [])
            if not ann_ids:
                issues.append(_issue_for_missing_annotation(step_keys_needing.get("annotation_gtf", [])))
            else:
                ann_node = resource_graph.nodes[ann_ids[0]]
                issue_or_warn = self._issue_for_node(ann_node, step_keys_needing.get("annotation_gtf", []))
                if issue_or_warn:
                    (issues if issue_or_warn.severity == "blocking" else warnings).append(issue_or_warn)
                elif ann_node.status == "ready" and ann_node.source_type == "project_file_scan":
                    # Soft warning: annotation was auto-discovered, not explicitly registered
                    warnings.append(ReadinessIssue(
                        kind="incomplete_metadata",
                        severity="warning",
                        title="Annotation not explicitly registered",
                        description=(
                            f"Using auto-discovered annotation: {ann_node.resolved_path}. "
                            "This path was not explicitly registered via a KnownPath."
                        ),
                        suggestion="Register it with 'add annotation' to avoid ambiguity in future runs.",
                        resolution_type="provide_path",
                        affected_step_keys=step_keys_needing.get("annotation_gtf", []),
                    ))

        # Check aligner index
        if needs_index:
            idx_ids = resource_graph.by_kind.get("aligner_index", [])
            if not idx_ids:
                issues.append(_issue_for_missing_index(step_keys_needing.get("aligner_index", [])))
            else:
                for nid in idx_ids:
                    idx_node = resource_graph.nodes[nid]
                    issue_or_warn = self._issue_for_node(
                        idx_node, step_keys_needing.get("aligner_index", [])
                    )
                    if issue_or_warn:
                        (issues if issue_or_warn.severity == "blocking" else warnings).append(issue_or_warn)

        ok = not any(i.severity == "blocking" for i in issues)
        return ReadinessReport(
            ok=ok,
            issues=issues,
            warnings=warnings,
            resource_graph=resource_graph,
        )

    def _issue_for_node(
        self,
        node: ResourceNode,
        affected_step_keys: list[str],
    ) -> ReadinessIssue | None:
        """Map (kind, status) → ReadinessIssue; returns None if status is ok."""
        kind = node.kind
        status = node.status

        if status == "ready":
            return None

        if status == "derivable":
            # Non-blocking: prepare step should already be in plan
            return ReadinessIssue(
                kind=_derivable_issue_kind(kind),
                severity="warning",
                title=f"{node.label} will be built automatically",
                description=f"{node.label} does not exist yet but will be derived as a prepare step.",
                suggestion=node.derive_command or "Build will proceed automatically.",
                affected_resource_ids=[node.id],
                affected_step_keys=affected_step_keys,
                resolution_type="confirm_auto_build",
                details=_node_details(node),
            )

        if status == "stale":
            # Treat as derivable: non-blocking rebuild
            return ReadinessIssue(
                kind="stale_index",
                severity="warning",
                title=f"{node.label} is stale (source changed)",
                description=(
                    f"{node.label} was built from a source file that has since changed. "
                    "It will be rebuilt automatically."
                ),
                suggestion="The index will be rebuilt before alignment.",
                affected_resource_ids=[node.id],
                affected_step_keys=affected_step_keys,
                resolution_type="confirm_auto_build",
                details=_node_details(node),
            )

        if status == "ambiguous":
            issue_kind: IssueKind = (
                "ambiguous_reference" if kind == "reference_fasta"
                else "ambiguous_annotation" if kind == "annotation_gtf"
                else "stale_index"
            )
            return ReadinessIssue(
                kind=issue_kind,
                severity="blocking",
                title=f"Multiple candidates for {node.label}",
                description=(
                    f"Found {len(node.candidates)} possible {node.label} files. "
                    "Please select the correct one."
                ),
                suggestion="Select the correct file from the candidate list.",
                affected_resource_ids=[node.id],
                affected_step_keys=affected_step_keys,
                resolution_type="select_candidate",
                candidates=node.candidates,
                details=_node_details(node),
            )

        if status == "missing":
            return _issue_for_missing_node(node, affected_step_keys)

        return None


# ---------------------------------------------------------------------------
# Issue constructors
# ---------------------------------------------------------------------------


def _node_details(node: ResourceNode, extra: dict | None = None) -> dict:
    details = dict(extra or {})
    if node.resource_entity_id:
        details["resource_entity_id"] = node.resource_entity_id
    return details


def _issue_missing_reads(step_keys: list[str]) -> ReadinessIssue:
    return ReadinessIssue(
        kind="missing_reads",
        severity="blocking",
        title="No FASTQ read files found",
        description="The plan requires FASTQ input files but none were found in this project.",
        suggestion="Add FASTQ files to the project and link them to experiments via the Samples tab.",
        affected_step_keys=step_keys,
        resolution_type="link_experiment",
    )


def _issue_unbound_read(node: ResourceNode, step_keys: list[str]) -> ReadinessIssue:
    return ReadinessIssue(
        kind="unbound_reads",
        severity="blocking",
        title="FASTQ file not linked to an experiment",
        description=(
            f"The FASTQ file '{node.label}' has no FileRun record linking it to a sample/experiment."
        ),
        suggestion="Select the correct experiment for this FASTQ file.",
        affected_resource_ids=[node.id],
        affected_step_keys=step_keys,
        resolution_type="link_experiment",
        details=_node_details(
            node,
            {
                "files": [
                    {
                        "resource_id": node.id,
                        "file_id": node.linked_file_ids[0] if node.linked_file_ids else None,
                        "filename": node.label,
                    }
                ]
            },
        ),
    )


def _issue_for_missing_reference(step_keys: list[str]) -> ReadinessIssue:
    return ReadinessIssue(
        kind="missing_reference",
        severity="blocking",
        title="Reference genome FASTA not found",
        description="No reference genome FASTA was found for this project.",
        suggestion="Register a reference FASTA via known paths, or upload the file to the project.",
        affected_step_keys=step_keys,
        resolution_type="provide_path",
    )


def _issue_for_missing_annotation(step_keys: list[str]) -> ReadinessIssue:
    return ReadinessIssue(
        kind="missing_annotation",
        severity="blocking",
        title="Annotation GTF/GFF not found",
        description="No genome annotation file (GTF/GFF) was found for this project.",
        suggestion="Register an annotation GTF via known paths, or upload it to the project.",
        affected_step_keys=step_keys,
        resolution_type="provide_path",
    )


def _issue_for_missing_index(step_keys: list[str]) -> ReadinessIssue:
    issue = ReadinessIssue(
        kind="missing_index",
        severity="blocking",
        title="Aligner index missing",
        description="No aligner index was found and the reference FASTA is not available to build one.",
        suggestion="Provide a reference FASTA so the index can be built automatically.",
        affected_step_keys=step_keys,
        resolution_type="provide_path",
    )
    setattr(issue, "binding_key", "reference_fasta")
    return issue


def _issue_for_missing_node(node: ResourceNode, step_keys: list[str]) -> ReadinessIssue:
    kind_to_issue: dict[str, IssueKind] = {
        "reference_fasta": "missing_reference",
        "annotation_gtf": "missing_annotation",
        "reads": "missing_reads",
        "aligner_index": "missing_index",
    }
    issue_kind: IssueKind = kind_to_issue.get(node.kind, "missing_reference")  # type: ignore
    issue = ReadinessIssue(
        kind=issue_kind,
        severity="blocking",
        title=f"{node.label} not found",
        description=f"The required resource '{node.label}' could not be located.",
        suggestion="Provide the path or register it via known paths.",
        affected_resource_ids=[node.id],
        affected_step_keys=step_keys,
        resolution_type="provide_path",
        details=_node_details(node),
    )
    if node.kind == "aligner_index":
        setattr(issue, "binding_key", "reference_fasta")
    return issue


def _derivable_issue_kind(kind: str) -> IssueKind:
    _map: dict[str, IssueKind] = {
        "aligner_index": "stale_index",
        "reference_fasta": "missing_reference",
        "annotation_gtf": "missing_annotation",
    }
    return _map.get(kind, "stale_index")
