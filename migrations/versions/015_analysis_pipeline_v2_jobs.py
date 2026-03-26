"""Extend analysis_jobs for pipeline-v2: new status values and phase columns.

Revision ID: 015
Revises: 014
Create Date: 2026-03-17 00:00:00

New status values added (column remains String(32)):
  draft, awaiting_plan_confirmation, binding_required,
  preparing_environment, waiting_for_authorization,
  waiting_for_repair
All new columns are nullable so existing rows are unaffected.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # current_step_id — FK added after analysis_step_runs table is created in 016
    op.add_column(
        "analysis_jobs",
        sa.Column("current_step_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("plan_draft_json", JSONB, nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("resolved_plan_json", JSONB, nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column(
            "binding_status",
            sa.String(32),
            nullable=True,
            server_default="not_started",
        ),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column(
            "env_status",
            sa.String(32),
            nullable=True,
            server_default="not_started",
        ),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("env_spec_hash", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_jobs", "env_spec_hash")
    op.drop_column("analysis_jobs", "env_status")
    op.drop_column("analysis_jobs", "binding_status")
    op.drop_column("analysis_jobs", "resolved_plan_json")
    op.drop_column("analysis_jobs", "plan_draft_json")
    op.drop_column("analysis_jobs", "current_step_id")
