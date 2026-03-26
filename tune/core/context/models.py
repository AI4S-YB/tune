"""Data models for structured biological context assembly."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Literal, Optional

if TYPE_CHECKING:
    from tune.core.resources.models import ResourceSummary

# ---------------------------------------------------------------------------
# EnhancedMetadata keys that describe the FILE ITSELF (content-intrinsic).
# Only these keys are read from the EnhancedMetadata table when building
# FilePlannerInfo.intrinsic.  Relational attributes (organism, sample_id,
# experiment_type, paired_end) must NOT be stored here — they live in the
# Project / Sample / Experiment / FileRun relational model.
# ---------------------------------------------------------------------------
INTRINSIC_META_KEYS: frozenset[str] = frozenset(
    {
        "reference_genome",
        "genome_build",
        "schema",
        "queryable",
        "read_length",
        "quality_encoding",
        "notes",
    }
)


# ---------------------------------------------------------------------------
# Input scope — controls what the builder queries
# ---------------------------------------------------------------------------


@dataclass
class ContextScope:
    """Determines which data to include in the assembled PlannerContext."""

    project_id: Optional[str] = None
    file_ids: Optional[list[str]] = None
    mode: Literal["project", "file_set", "global"] = "project"


# ---------------------------------------------------------------------------
# Per-entity info dataclasses
# ---------------------------------------------------------------------------


@dataclass
class FilePlannerInfo:
    id: str
    path: str
    filename: str
    file_type: str
    read_number: Optional[int]              # 1, 2, or None (single-end / unlinked)
    linked_sample_id: Optional[str]         # None if not linked to any Sample
    linked_experiment_id: Optional[str]     # None if not linked to any Experiment
    intrinsic: dict[str, str]               # From EnhancedMetadata (INTRINSIC_META_KEYS only)


@dataclass
class SamplePlannerInfo:
    id: str
    sample_name: str
    organism: Optional[str]
    attrs: dict                             # tissue, treatment, replicate, sex, genotype, …


@dataclass
class ExperimentPlannerInfo:
    id: str
    sample_id: str
    library_strategy: Optional[str]        # RNA-Seq | WGS | ChIP-Seq | ATAC-Seq …
    library_layout: Optional[str]          # PAIRED | SINGLE
    platform: Optional[str]                # ILLUMINA | PACBIO_SMRT …
    instrument_model: Optional[str]
    file_ids: list[str]                     # File IDs linked via FileRun


@dataclass
class ProjectPlannerInfo:
    id: str
    name: str
    project_dir: str
    project_goal: Optional[str]
    project_info: dict                      # PI, institution, organism, project_type, date
    known_paths: list[dict]                 # [{key, path, description}]
    resource_entities: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Derived summary — used directly in the planner prompt
# ---------------------------------------------------------------------------


@dataclass
class AnalysisSummary:
    total_files: int
    files_by_type: dict[str, int]           # {"fastq": 12, "gtf": 1, …}
    sample_count: int
    experiment_count: int
    library_strategies: list[str]           # deduplicated, sorted
    organisms: list[str]                    # deduplicated, sorted
    is_paired_end: Optional[bool]           # True | False | None (mixed/unknown)
    has_reference_genome: bool
    files_without_samples: int              # files with no FileRun linkage
    metadata_completeness: Literal["complete", "partial", "missing"]
    suggested_analysis_type: Optional[str]  # "rna_seq" | "chip_seq" | …
    potential_issues: list[str]             # human-readable notices for the planner


# ---------------------------------------------------------------------------
# Top-level context object passed to PlannerPromptAdapter and generate_coarse_plan
# ---------------------------------------------------------------------------


@dataclass
class PlannerContext:
    context_mode: Literal["project", "file_set", "global"]
    project: Optional[ProjectPlannerInfo]
    samples: list[SamplePlannerInfo]
    experiments: list[ExperimentPlannerInfo]
    files: list[FilePlannerInfo]
    file_to_sample: dict[str, str]          # file_id → sample_id
    file_to_experiment: dict[str, str]      # file_id → experiment_id
    summary: AnalysisSummary
    generated_at: datetime = field(default_factory=datetime.utcnow)
    # Resource readiness summary — None when ResourceGraph was not built
    resource_summary: Optional["ResourceSummary"] = None
    # Full ResourceGraph — stored for downstream use by ReadinessChecker
    resource_graph: Optional[object] = None  # ResourceGraph (avoids circular import)
