"""Metadata schema loader — built-in + user-defined YAML schemas."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

log = logging.getLogger(__name__)

_BUILTIN_DIR = Path(__file__).parent.parent.parent / "schemas"

# Cache: file_type -> schema dict
_schema_cache: dict[str, dict[str, Any]] = {}


def _load_yaml_schemas(directory: Path) -> dict[str, dict[str, Any]]:
    result = {}
    for yaml_file in directory.glob("*.yaml"):
        try:
            with open(yaml_file) as f:
                schema = yaml.safe_load(f)
            for ft in schema.get("file_types", []):
                result[ft] = schema
        except Exception as e:
            log.warning("Failed to load schema %s: %s", yaml_file, e)
    return result


def load_all_schemas() -> dict[str, dict[str, Any]]:
    """Load built-in schemas, then overlay user schemas (user wins on conflict)."""
    global _schema_cache
    schemas = _load_yaml_schemas(_BUILTIN_DIR)

    # User schemas
    try:
        from tune.core.config import get_config
        user_dir = get_config().analysis_dir / ".tune" / "schemas"
        if user_dir.exists():
            schemas.update(_load_yaml_schemas(user_dir))
    except RuntimeError:
        pass  # No config loaded yet

    _schema_cache = schemas
    return schemas


def get_schema(file_type: str) -> dict[str, Any] | None:
    if not _schema_cache:
        load_all_schemas()
    return _schema_cache.get(file_type)


def all_required_fields(file_type: str) -> list[str]:
    schema = get_schema(file_type)
    if not schema:
        return ["project", "sample_id", "experiment_type"]  # minimal default
    fields = schema.get("base_fields", []) + schema.get("type_fields", [])
    return [f["key"] for f in fields if f.get("required")]


def all_fields(file_type: str) -> list[dict]:
    schema = get_schema(file_type)
    if not schema:
        return []
    return schema.get("base_fields", []) + schema.get("type_fields", [])
