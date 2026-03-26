"""Policy helpers for project-level KnownPath keys.

KnownPath remains the explicit user override layer for project-scoped resources,
but not every key has the same product meaning:

- primary keys: long-lived user-confirmed resources such as reference FASTA
  and annotation files
- legacy index keys: compatibility overrides for derived indices; runtime
  resolution should prefer DerivedResource / ResourceGraph
"""
from __future__ import annotations

PRIMARY_RESOURCE_KEYS = {
    "reference_fasta",
    "annotation_gtf",
    "annotation_bed",
}

LEGACY_DERIVED_INDEX_KEYS = {
    "hisat2_index",
    "star_genome_dir",
    "bwa_index",
    "bowtie2_index",
}


def classify_known_path_key(key: str) -> str:
    if key in PRIMARY_RESOURCE_KEYS:
        return "primary_resource"
    if key in LEGACY_DERIVED_INDEX_KEYS:
        return "legacy_index_override"
    return "custom"


def known_path_policy_note(key: str, language: str = "en") -> str | None:
    classification = classify_known_path_key(key)
    if classification != "legacy_index_override":
        return None
    if language == "zh":
        return (
            "该资源键仍被接受，但仅作为兼容覆盖项；系统在运行时会优先使用 "
            "DerivedResource / ResourceGraph 管理的索引资源。"
        )
    return (
        "This key is still accepted, but only as a compatibility override; "
        "runtime resolution prefers indices managed by DerivedResource / ResourceGraph."
    )


def known_path_policy_payload(key: str, language: str = "en") -> dict[str, str]:
    classification = classify_known_path_key(key)
    note = known_path_policy_note(key, language=language)
    payload = {"classification": classification}
    if note:
        payload["note"] = note
    return payload
