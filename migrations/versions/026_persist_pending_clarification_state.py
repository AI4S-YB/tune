"""Persist pending clarification interaction state on analysis jobs.

Revision ID: 026
Revises: 025
Create Date: 2026-03-20 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_jobs",
        sa.Column("pending_interaction_type", sa.String(64), nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("pending_interaction_payload_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_jobs", "pending_interaction_payload_json")
    op.drop_column("analysis_jobs", "pending_interaction_type")
