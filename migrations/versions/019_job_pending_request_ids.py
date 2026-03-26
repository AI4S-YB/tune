"""Add pending_auth_request_id, pending_repair_request_id, pending_step_key to analysis_jobs;
add human_resolution_json to repair_requests.

Phase 1 of persistent state machine: replaces asyncio.Event blocking with DB-poll + defer_async.

Workers now write pending_*_request_id + pending_step_key to the job before suspending.
WebSocket handlers write the user decision to DB then defer run_analysis_task to resume.
On resume, run_analysis_task reads the decision from DB, skips completed steps, and continues.

Revision ID: 019
Revises: 018
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # analysis_jobs: track which pending request to resume from and which step to restart
    op.add_column(
        "analysis_jobs",
        sa.Column("pending_auth_request_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("pending_repair_request_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("pending_step_key", sa.String(128), nullable=True),
    )

    # repair_requests: store the user's resolution payload so DB-poll resume can read it
    op.add_column(
        "repair_requests",
        sa.Column("human_resolution_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("repair_requests", "human_resolution_json")
    op.drop_column("analysis_jobs", "pending_step_key")
    op.drop_column("analysis_jobs", "pending_repair_request_id")
    op.drop_column("analysis_jobs", "pending_auth_request_id")
