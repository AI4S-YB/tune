"""Persist semantic artifact metadata and binding match explanations.

Revision ID: 027
Revises: 026
Create Date: 2026-03-21 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "artifact_records",
        sa.Column("step_type", sa.String(128), nullable=True),
    )
    op.add_column(
        "artifact_records",
        sa.Column("artifact_role", sa.String(128), nullable=True),
    )
    op.add_column(
        "artifact_records",
        sa.Column("artifact_scope", sa.String(32), nullable=True),
    )
    op.add_column(
        "input_bindings",
        sa.Column("match_metadata_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("input_bindings", "match_metadata_json")
    op.drop_column("artifact_records", "artifact_scope")
    op.drop_column("artifact_records", "artifact_role")
    op.drop_column("artifact_records", "step_type")
