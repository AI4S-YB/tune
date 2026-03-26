"""Base metadata extraction per file type."""
from __future__ import annotations

import gzip
import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _md5(path: Path, chunk_size: int = 8192) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_preview(path: Path, file_type: str, n_lines: int = 10) -> Optional[str]:
    """Read first N lines; handle gzip transparently."""
    try:
        opener = gzip.open if path.suffix == ".gz" else open
        mode = "rt"
        with opener(path, mode, errors="replace") as f:  # type: ignore[call-overload]
            lines = []
            for _ in range(n_lines):
                line = f.readline()
                if not line:
                    break
                lines.append(line.rstrip())
        text = "\n".join(lines)
        # Strip NUL bytes — PostgreSQL text fields reject them
        return text.replace("\x00", "")
    except Exception:
        return None


def extract_base_metadata(path: Path, file_type: str) -> dict:
    stat = path.stat()
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    md5 = _md5(path)
    preview = _read_preview(path, file_type)

    return {
        "path": str(path),
        "filename": path.name,
        "file_type": file_type,
        "size_bytes": stat.st_size,
        "md5": md5,
        "mtime": mtime,
        "preview": preview,
    }
