"""Add project_goal to projects and attrs to file_runs.

Revision ID: 013
Revises: 012
Create Date: 2026-03-16 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("project_goal", sa.Text, nullable=True))
    op.add_column("file_runs", sa.Column("attrs", JSONB, nullable=True, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("projects", "project_goal")
    op.drop_column("file_runs", "attrs")
