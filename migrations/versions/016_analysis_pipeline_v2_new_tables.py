"""Create analysis pipeline v2 tables: step runs, auth requests, repair requests, user decisions.

Revision ID: 016
Revises: 015
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # AnalysisStepRun — one row per step in a job execution
    op.create_table(
        "analysis_step_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("analysis_jobs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("step_key", sa.String(128), nullable=False),
        sa.Column("step_type", sa.String(128), nullable=False),
        sa.Column("display_name", sa.String(256), nullable=True),
        # pending|ready|binding_missing|awaiting_authorization|running|
        # repairable_failed|waiting_for_human_repair|succeeded|failed|skipped
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("depends_on", JSONB, nullable=True),   # list of step_key strings
        sa.Column("params_json", JSONB, nullable=True),
        sa.Column("bindings_json", JSONB, nullable=True),
        sa.Column("outputs_json", JSONB, nullable=True),
        sa.Column("renderer_version", sa.Integer, nullable=True),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )

    # CommandAuthorizationRequest — replaces asyncio.Event for command authorization
    op.create_table(
        "command_authorization_requests",
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
            sa.ForeignKey("analysis_step_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("command_text", sa.Text, nullable=False),
        sa.Column("command_fingerprint", sa.String(64), nullable=True),
        sa.Column("command_template_type", sa.String(64), nullable=True),
        # pending|approved|rejected|bypassed
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )

    # RepairRequest — replaces asyncio.Event for human error recovery
    op.create_table(
        "repair_requests",
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
            sa.ForeignKey("analysis_step_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("failed_command", sa.Text, nullable=True),
        sa.Column("stderr_excerpt", sa.Text, nullable=True),
        sa.Column("repair_level", sa.Integer, nullable=False),  # 1, 2, or 3
        # pending|resolved|cancelled
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("suggestion_json", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
    )

    # UserDecision — audit log of every user-driven state change
    op.create_table(
        "user_decisions",
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
            sa.ForeignKey("analysis_step_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # plan_confirmed|plan_modified|authorization_approved|authorization_rejected|
        # repair_choice|job_cancelled
        sa.Column("decision_type", sa.String(64), nullable=False),
        sa.Column("payload_json", JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
    )

    # Now that analysis_step_runs exists, add FK constraint for current_step_id
    op.create_foreign_key(
        "fk_analysis_jobs_current_step_id",
        "analysis_jobs",
        "analysis_step_runs",
        ["current_step_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_analysis_jobs_current_step_id", "analysis_jobs", type_="foreignkey")
    op.drop_table("user_decisions")
    op.drop_table("repair_requests")
    op.drop_table("command_authorization_requests")
    op.drop_table("analysis_step_runs")
