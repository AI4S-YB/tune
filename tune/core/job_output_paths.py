"""Helpers for stable analysis-job output directory paths."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path


def sanitize_analysis_name(analysis_name: str, max_len: int = 50) -> str:
    safe_name = re.sub(r"[^\w-]", "_", analysis_name)[:max_len]
    return safe_name or "analysis"


def build_output_dir_path(
    analysis_dir: Path,
    project_name: str,
    analysis_name: str,
    *,
    created_at: datetime | None = None,
) -> Path:
    ts = (created_at or datetime.now(tz=timezone.utc)).astimezone(timezone.utc)
    stamp = ts.strftime("%Y%m%d_%H%M%S")
    return analysis_dir / project_name / f"{stamp}_{sanitize_analysis_name(analysis_name)}"


def derive_run_dirs_from_artifact_paths(project_root: Path, artifact_paths: list[str]) -> list[Path]:
    run_dirs: list[Path] = []
    seen: set[Path] = set()
    resolved_root = project_root.resolve()
    for raw_path in artifact_paths:
        if not raw_path:
            continue
        artifact_path = Path(raw_path).resolve()
        try:
            relative = artifact_path.relative_to(resolved_root)
        except ValueError:
            continue
        if not relative.parts:
            continue
        run_dir = resolved_root / relative.parts[0]
        if run_dir in seen:
            continue
        seen.add(run_dir)
        run_dirs.append(run_dir)
    return run_dirs
