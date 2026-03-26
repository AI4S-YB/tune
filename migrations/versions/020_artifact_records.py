"""Add artifact_records table for tracking step outputs.

Phase 4: downstream steps query ArtifactRecord (Tier 1a) before falling back
to BFS directory scanning (Tier 1b).  This gives deterministic, typed binding
for all outputs that passed through render_step().

Revision ID: 020
Revises: 019
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "artifact_records",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_key", sa.String(128), nullable=False),
        sa.Column(
            "step_run_id",
            sa.String(36),
            sa.ForeignKey("analysis_step_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Output slot name from StepTypeDefinition (e.g. "sam", "sorted_bam")
        sa.Column("slot_name", sa.String(128), nullable=False),
        # File extension / type category (e.g. "sam", "bam", "txt")
        sa.Column("artifact_type", sa.String(64), nullable=False),
        sa.Column("file_path", sa.Text, nullable=False),
        sa.Column("sample_name", sa.String(256), nullable=True),
        sa.Column("size_bytes", sa.Integer, nullable=True),
        sa.Column("metadata_json", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_artifact_records_job_step",
        "artifact_records",
        ["job_id", "step_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_artifact_records_job_step", table_name="artifact_records")
    op.drop_table("artifact_records")
