"""Add project_dir column and restructure schema_extensions.

Revision ID: 012
Revises: 011
Create Date: 2026-03-14 00:00:00
"""
from __future__ import annotations

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DIR_RE = re.compile(r"[^a-zA-Z0-9_-]")


def _sanitize(name: str) -> str:
    """Convert a project name to a valid project_dir value."""
    s = _DIR_RE.sub("-", name).strip("-")
    # Collapse consecutive dashes
    s = re.sub(r"-{2,}", "-", s)
    # Must start with alphanumeric
    s = re.sub(r"^[^a-zA-Z0-9]+", "", s)
    return s or "project"


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add nullable project_dir column first (unique added after fill)
    op.add_column("projects", sa.Column("project_dir", sa.String(256), nullable=True))

    # 2. Auto-fill project_dir from name for existing rows (deduplicate with suffix)
    rows = conn.execute(text("SELECT id, name FROM projects ORDER BY created_at")).fetchall()
    seen: set[str] = set()
    for row in rows:
        base = _sanitize(row.name)
        candidate = base
        i = 2
        while candidate in seen:
            candidate = f"{base}-{i}"
            i += 1
        seen.add(candidate)
        conn.execute(
            text("UPDATE projects SET project_dir = :pd WHERE id = :id"),
            {"pd": candidate, "id": row.id},
        )

    # 3. Now add NOT NULL + UNIQUE constraints
    op.alter_column("projects", "project_dir", nullable=False)
    op.create_unique_constraint("uq_projects_project_dir", "projects", ["project_dir"])

    # 4. Restructure schema_extensions: wrap existing flat dict into {sample_fields: <existing>, project_fields: {}, experiment_fields: {}}
    rows = conn.execute(
        text("SELECT id, schema_extensions FROM projects WHERE schema_extensions IS NOT NULL AND schema_extensions != 'null'::jsonb")
    ).fetchall()
    for row in rows:
        existing = row.schema_extensions or {}
        # Already restructured (idempotent check)
        if isinstance(existing, dict) and "sample_fields" in existing:
            continue
        nested = {"project_fields": {}, "sample_fields": existing, "experiment_fields": {}}
        conn.execute(
            text("UPDATE projects SET schema_extensions = CAST(:se AS jsonb) WHERE id = :id"),
            {"se": __import__("json").dumps(nested), "id": row.id},
        )

    # 5. For projects with null/empty schema_extensions, set empty nested structure
    conn.execute(
        text("""
            UPDATE projects
            SET schema_extensions = '{"project_fields": {}, "sample_fields": {}, "experiment_fields": {}}'::jsonb
            WHERE schema_extensions IS NULL OR schema_extensions = 'null'::jsonb OR schema_extensions = '{}'::jsonb
        """)
    )


def downgrade() -> None:
    op.drop_constraint("uq_projects_project_dir", "projects", type_="unique")
    op.drop_column("projects", "project_dir")
    # schema_extensions restructure is not easily reversed — leave as-is on downgrade
