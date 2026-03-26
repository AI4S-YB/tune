"""MetadataNormalizer — derives AnalysisSummary from relational model data."""
from __future__ import annotations

from tune.core.context.models import (
    AnalysisSummary,
    ExperimentPlannerInfo,
    FilePlannerInfo,
    SamplePlannerInfo,
)
from tune.core.models import KnownPath

# Canonical mapping from (normalised) library_strategy → suggested analysis type
_STRATEGY_TO_TYPE: dict[str, str] = {
    "rna-seq": "rna_seq",
    "rna_seq": "rna_seq",
    "chip-seq": "chip_seq",
    "chip_seq": "chip_seq",
    "atac-seq": "atac_seq",
    "atac_seq": "atac_seq",
    "wgs": "wgs",
    "wes": "wes",
    "amplicon": "amplicon",
    "mirna-seq": "mirna_seq",
    "mirna_seq": "mirna_seq",
}

# KnownPath keys that indicate a reference genome / index is registered
_REFERENCE_KEYS: frozenset[str] = frozenset(
    {
        "reference_fasta",
        "hisat2_index",
        "star_genome_dir",
        "bwa_index",
        "bowtie2_index",
        "bowtie_index",
    }
)


def build_summary(
    samples: list[SamplePlannerInfo],
    experiments: list[ExperimentPlannerInfo],
    files: list[FilePlannerInfo],
    known_paths: list[KnownPath],
) -> AnalysisSummary:
    """Derive AnalysisSummary from assembled relational data."""

    # ── Files by type ──────────────────────────────────────────────────
    files_by_type: dict[str, int] = {}
    for f in files:
        files_by_type[f.file_type] = files_by_type.get(f.file_type, 0) + 1

    # ── Organisms (deduplicated, sorted) ───────────────────────────────
    organisms = sorted({s.organism for s in samples if s.organism})

    # ── Library strategies (deduplicated, sorted) ──────────────────────
    strategies = sorted({e.library_strategy for e in experiments if e.library_strategy})

    # ── Library layout → paired-end flag ──────────────────────────────
    layouts = {e.library_layout for e in experiments if e.library_layout}
    if not layouts:
        is_paired_end: bool | None = None
    elif layouts == {"PAIRED"}:
        is_paired_end = True
    elif layouts == {"SINGLE"}:
        is_paired_end = False
    else:
        is_paired_end = None  # mixed or unknown

    # ── Reference genome availability ─────────────────────────────────
    kp_keys = {kp.key for kp in known_paths}
    has_reference_genome = bool(kp_keys & _REFERENCE_KEYS)

    # ── Files without sample linkage ───────────────────────────────────
    files_without_samples = sum(1 for f in files if f.linked_sample_id is None)

    # ── Metadata completeness ─────────────────────────────────────────
    if not samples:
        completeness: str = "missing"
    elif files_without_samples > 0:
        completeness = "partial"
    else:
        completeness = "complete"

    # ── Suggested analysis type ────────────────────────────────────────
    suggested: str | None = None
    if len(strategies) == 1:
        norm = strategies[0].lower().replace("-", "_")
        suggested = _STRATEGY_TO_TYPE.get(norm)

    # ── Potential issues ───────────────────────────────────────────────
    issues: list[str] = []

    if not samples:
        issues.append(
            "No samples registered — biological context is unavailable; "
            "consider completing metadata before analysis"
        )
    elif files_without_samples > 0:
        issues.append(
            f"{files_without_samples} file(s) not linked to any sample — "
            "R1/R2 assignment may be incomplete"
        )

    if not has_reference_genome:
        issues.append(
            "No reference genome registered "
            "(use 'add reference genome' to register one)"
        )

    if len(strategies) > 1:
        issues.append(
            f"Mixed library strategies detected: {', '.join(strategies)} — "
            "verify this is intentional"
        )

    if is_paired_end is None and experiments and "PAIRED" in layouts and "SINGLE" in layouts:
        issues.append("Mixed PAIRED and SINGLE library layouts detected")

    return AnalysisSummary(
        total_files=len(files),
        files_by_type=files_by_type,
        sample_count=len(samples),
        experiment_count=len(experiments),
        library_strategies=strategies,
        organisms=organisms,
        is_paired_end=is_paired_end,
        has_reference_genome=has_reference_genome,
        files_without_samples=files_without_samples,
        metadata_completeness=completeness,  # type: ignore[arg-type]
        suggested_analysis_type=suggested,
        potential_issues=issues,
    )
