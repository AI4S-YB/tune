"""Add project_id FK to files table; backfill from enhanced_metadata.

Revision ID: 004
Revises: 003
Create Date: 2026-03-05 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable project_id column to files
    op.add_column(
        "files",
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
    )
    op.create_index("ix_files_project_id", "files", ["project_id"])

    # 2. Backfill: read enhanced_metadata where field_key='project', look up or create Project,
    #    then set files.project_id.
    conn = op.get_bind()

    # Fetch all (file_id, project_name) pairs from enhanced_metadata
    rows = conn.execute(
        sa.text(
            "SELECT em.file_id, em.field_value AS project_name "
            "FROM enhanced_metadata em "
            "WHERE em.field_key = 'project' AND em.field_value IS NOT NULL"
        )
    ).fetchall()

    for file_id, project_name in rows:
        project_name = project_name.strip()
        if not project_name:
            continue

        # Find existing project by name
        proj = conn.execute(
            sa.text("SELECT id FROM projects WHERE name = :name"),
            {"name": project_name},
        ).fetchone()

        if proj:
            project_id = proj[0]
        else:
            # Create missing project row (inferred=True)
            import uuid
            project_id = str(uuid.uuid4())
            conn.execute(
                sa.text(
                    "INSERT INTO projects (id, name, description, inferred, created_at) "
                    "VALUES (:id, :name, :desc, TRUE, now())"
                ),
                {"id": project_id, "name": project_name, "desc": project_name},
            )

        # Update files.project_id
        conn.execute(
            sa.text("UPDATE files SET project_id = :pid WHERE id = :fid"),
            {"pid": project_id, "fid": file_id},
        )


def downgrade() -> None:
    op.drop_index("ix_files_project_id", "files")
    op.drop_column("files", "project_id")
