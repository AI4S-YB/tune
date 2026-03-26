"""Add resource entity layer tables.

Revision ID: 028
Revises: 027
Create Date: 2026-03-22 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "resource_entities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("resource_role", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=False),
        sa.Column("organism", sa.String(256), nullable=True),
        sa.Column("genome_build", sa.String(128), nullable=True),
        sa.Column("version_label", sa.String(128), nullable=True),
        sa.Column("source_type", sa.String(64), nullable=True),
        sa.Column("source_uri", sa.Text, nullable=True),
        sa.Column("status", sa.String(32), nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_resource_entities_project_id", "resource_entities", ["project_id"])
    op.create_index("ix_resource_entities_project_role", "resource_entities", ["project_id", "resource_role"])

    op.create_table(
        "resource_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "resource_entity_id",
            sa.String(36),
            sa.ForeignKey("resource_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "file_id",
            sa.String(36),
            sa.ForeignKey("files.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("file_role", sa.String(64), nullable=False),
        sa.Column("is_primary", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.UniqueConstraint("resource_entity_id", "file_id", "file_role", name="uq_resource_files_entity_file_role"),
    )
    op.create_index("ix_resource_files_entity_id", "resource_files", ["resource_entity_id"])
    op.create_index("ix_resource_files_file_id", "resource_files", ["file_id"])
    op.create_index("ix_resource_files_entity_role", "resource_files", ["resource_entity_id", "file_role"])

    op.create_table(
        "resource_derivations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "parent_resource_id",
            sa.String(36),
            sa.ForeignKey("resource_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "child_resource_id",
            sa.String(36),
            sa.ForeignKey("resource_entities.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("derivation_type", sa.String(128), nullable=False),
        sa.Column("tool_name", sa.String(128), nullable=True),
        sa.Column("tool_version", sa.String(64), nullable=True),
        sa.Column("params_json", JSONB, nullable=True),
        sa.Column(
            "created_by_job_id",
            sa.String(36),
            sa.ForeignKey("analysis_jobs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint(
            "parent_resource_id",
            "child_resource_id",
            "derivation_type",
            name="uq_resource_derivations_parent_child_type",
        ),
    )
    op.create_index("ix_resource_derivations_parent_id", "resource_derivations", ["parent_resource_id"])
    op.create_index("ix_resource_derivations_child_id", "resource_derivations", ["child_resource_id"])


def downgrade() -> None:
    op.drop_table("resource_derivations")
    op.drop_table("resource_files")
    op.drop_table("resource_entities")
