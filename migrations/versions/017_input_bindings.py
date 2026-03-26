"""Create input_bindings table for pipeline-v2 explicit slot binding.

Revision ID: 017
Revises: 016
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "input_bindings",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "step_id",
            sa.String(36),
            sa.ForeignKey("analysis_step_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slot_name", sa.String(128), nullable=False),
        # project_file | step_output | known_path | user_provided
        sa.Column("source_type", sa.String(32), nullable=True),
        sa.Column("source_ref", sa.Text, nullable=True),  # file_id, step_id, known_path_key
        sa.Column("resolved_path", sa.Text, nullable=True),
        # resolved | missing | invalid
        sa.Column("status", sa.String(16), nullable=False, server_default="missing"),
    )


def downgrade() -> None:
    op.drop_table("input_bindings")
