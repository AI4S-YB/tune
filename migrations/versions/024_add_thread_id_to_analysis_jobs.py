"""Add thread_id mapping to analysis_jobs.

Makes the thread -> job association explicit so reconnect/rehydration logic can
target the exact conversation thread instead of inferring active jobs by project.

Revision ID: 024
Revises: 023
Create Date: 2026-03-20 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_jobs",
        sa.Column(
            "thread_id",
            sa.String(36),
            sa.ForeignKey("threads.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_analysis_jobs_thread_id", "analysis_jobs", ["thread_id"])


def downgrade() -> None:
    op.drop_index("ix_analysis_jobs_thread_id", table_name="analysis_jobs")
    op.drop_column("analysis_jobs", "thread_id")
