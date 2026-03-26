"""Add language column to analysis_jobs table.

Revision ID: 010
Revises: 009
Create Date: 2026-03-13 00:00:01
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "95d786b7e269"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_jobs",
        sa.Column("language", sa.String(8), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_jobs", "language")
