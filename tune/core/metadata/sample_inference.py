"""Sample inference from FASTQ filenames — detects R1/R2 pairs, extracts sample names."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from tune.core.models import File


# Patterns that indicate paired-end read number in filename
_PAIR_PATTERNS = [
    (re.compile(r'[._\-]R([12])[._\-]', re.IGNORECASE), 1),   # _R1_ _R2_
    (re.compile(r'[._\-]([12])\.f(ast)?q', re.IGNORECASE), 1), # _1.fastq _2.fastq
    (re.compile(r'[._\-]read([12])[._\-]', re.IGNORECASE), 1), # _read1_ _read2_
    (re.compile(r'[._\-]r([12])\.f(ast)?q', re.IGNORECASE), 1),# _r1.fastq
]

# Patterns to strip the pair suffix to get the sample base name
_STRIP_PAIR = [
    re.compile(r'[._\-]R[12][._\-]', re.IGNORECASE),
    re.compile(r'[._\-]R[12]$', re.IGNORECASE),
    re.compile(r'[._\-]read[12][._\-]', re.IGNORECASE),
    re.compile(r'[._\-]read[12]$', re.IGNORECASE),
    re.compile(r'[._\-][12]\.f(ast)?q(\.gz)?$', re.IGNORECASE),
    re.compile(r'[._\-]r[12]\.f(ast)?q(\.gz)?$', re.IGNORECASE),
]

# Strip common FASTQ extensions
_EXT_PATTERN = re.compile(r'\.(fastq|fq)(\.gz)?$', re.IGNORECASE)


@dataclass
class SampleCandidate:
    sample_name: str
    file_ids: list[str] = field(default_factory=list)
    filenames: list[str] = field(default_factory=list)
    read_numbers: list[Optional[int]] = field(default_factory=list)
    is_paired: bool = False


@dataclass
class SampleInferenceResult:
    candidates: list[SampleCandidate]
    library_layout: str  # "PAIRED" | "SINGLE" | "MIXED"
    # filename → sample_name mapping
    file_to_sample: dict[str, str] = field(default_factory=dict)
    # LLM grouping analysis (populated by infer_samples_from_filenames)
    grouping_hint: Optional[str] = None


def _detect_read_number(filename: str) -> Optional[int]:
    """Return 1 or 2 if filename contains a pair suffix, else None."""
    for pat, group in _PAIR_PATTERNS:
        m = pat.search(filename)
        if m:
            return int(m.group(group))
    return None


def _strip_pair_suffix(filename: str) -> str:
    """Remove pair suffix and extension to get the sample base name."""
    name = _EXT_PATTERN.sub('', filename)
    for pat in _STRIP_PAIR:
        name = pat.sub('', name)
    return name.strip('._-')


async def infer_samples_from_filenames(files: list[File]) -> SampleInferenceResult:
    """
    Analyse FASTQ filenames to infer candidate sample list.

    Returns SampleInferenceResult with candidates grouped by base name,
    paired/single-end detection, and a file→sample mapping.
    Also calls LLM to annotate grouping patterns (prefixes, replicate numbering).
    """
    # Only operate on FASTQ files
    fastq_files = [f for f in files if f.file_type in ("fastq", "fq")]
    if not fastq_files:
        return SampleInferenceResult(candidates=[], library_layout="UNKNOWN")

    # Group files by base name
    groups: dict[str, list[tuple[str, str, Optional[int]]]] = {}  # base → [(id, filename, read_num)]
    for f in fastq_files:
        read_num = _detect_read_number(f.filename)
        base = _strip_pair_suffix(f.filename)
        if not base:
            base = f.filename  # fallback: use full filename
        groups.setdefault(base, []).append((f.id, f.filename, read_num))

    # Determine library layout
    has_paired = any(
        any(rn is not None for _, _, rn in items) for items in groups.values()
    )
    has_single = any(
        all(rn is None for _, _, rn in items) for items in groups.values()
    )
    if has_paired and has_single:
        layout = "MIXED"
    elif has_paired:
        layout = "PAIRED"
    else:
        layout = "SINGLE"

    # Build candidates
    candidates: list[SampleCandidate] = []
    file_to_sample: dict[str, str] = {}
    for base, items in sorted(groups.items()):
        c = SampleCandidate(
            sample_name=base,
            is_paired=any(rn is not None for _, _, rn in items),
        )
        for fid, fname, rn in items:
            c.file_ids.append(fid)
            c.filenames.append(fname)
            c.read_numbers.append(rn)
            file_to_sample[fname] = base
        candidates.append(c)

    # Ask LLM to analyse grouping patterns
    grouping_hint = await _llm_analyse_groupings([c.sample_name for c in candidates])

    return SampleInferenceResult(
        candidates=candidates,
        library_layout=layout,
        file_to_sample=file_to_sample,
        grouping_hint=grouping_hint,
    )


async def _llm_analyse_groupings(sample_names: list[str]) -> Optional[str]:
    """Ask LLM to identify grouping patterns and replicate numbering in sample names."""
    if not sample_names:
        return None
    try:
        from tune.core.llm.gateway import LLMMessage, get_gateway
        gw = get_gateway()
        names_str = ", ".join(sample_names[:50])
        result = await gw.structured_output(
            messages=[LLMMessage("user", f"Sample names: {names_str}")],
            schema={
                "type": "object",
                "properties": {
                    "grouping_description": {
                        "type": "string",
                        "description": "Brief English description of the naming pattern, groups detected, and replicate numbering if any."
                    }
                },
            },
            system=(
                "Analyse these biological sample names and identify: "
                "1) How many distinct experimental groups exist and what prefixes/tokens distinguish them. "
                "2) Whether numbers indicate biological replicates. "
                "Return a concise one-sentence description. "
                "Example: 'H group (heat treatment) and C group (control), each with 3 replicates (1/2/3).'"
            ),
        )
        return result.get("grouping_description")
    except Exception:
        return None
