"""File type detector — extension + content inspection."""
from __future__ import annotations

import gzip
import struct
from pathlib import Path

# Maps detected type string to human label
FILE_TYPE_MAP = {
    "fastq": "FASTQ",
    "bam": "BAM",
    "sam": "SAM",
    "vcf": "VCF",
    "bcf": "BCF",
    "csv": "CSV",
    "tsv": "TSV",
    "excel": "Excel",
    "gtf": "GTF",
    "gff": "GFF",
    "png": "Image",
    "pdf": "PDF",
    "html": "HTML",
    "unknown": "Unknown",
}

_EXT_MAP = {
    ".fastq": "fastq", ".fq": "fastq", ".fastq.gz": "fastq", ".fq.gz": "fastq",
    ".bam": "bam",
    ".sam": "sam",
    ".vcf": "vcf", ".vcf.gz": "vcf",
    ".bcf": "bcf",
    ".csv": "csv",
    ".tsv": "tsv", ".txt": "tsv",
    ".xlsx": "excel", ".xls": "excel",
    ".gtf": "gtf", ".gtf.gz": "gtf",
    ".gff": "gff", ".gff3": "gff", ".gff.gz": "gff",
    ".png": "png", ".jpg": "png", ".jpeg": "png", ".svg": "png",
    ".pdf": "pdf",
    ".html": "html", ".htm": "html",
}


def detect_file_type(path: Path) -> str:
    """Detect file type by extension, falling back to magic bytes."""
    name = path.name.lower()

    # Handle double extensions like .fastq.gz
    for ext, ftype in _EXT_MAP.items():
        if name.endswith(ext):
            return ftype

    # Magic bytes fallback
    try:
        with open(path, "rb") as f:
            header = f.read(16)
        if header[:2] == b"\x1f\x8b":
            return _detect_gzipped(path)
        if header[:3] == b"BAM":
            return "bam"
        if header[:4] == b"%PDF":
            return "pdf"
    except OSError:
        pass

    return "unknown"


def _detect_gzipped(path: Path) -> str:
    """Try to identify gzipped file content."""
    try:
        with gzip.open(path, "rt", errors="ignore") as f:
            first_line = f.readline(200)
        if first_line.startswith("@"):
            return "fastq"
        if first_line.startswith("##"):
            if "fileformat=VCF" in first_line or "gff" in path.name.lower():
                return "vcf" if "vcf" in path.name.lower() else "gff"
    except Exception:
        pass
    return "unknown"
