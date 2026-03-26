"""Add execution IR and expanded DAG fields to analysis jobs.

Revision ID: 030
Revises: 029
Create Date: 2026-03-23 13:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "030"
down_revision: Union[str, None] = "029"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "analysis_jobs",
        sa.Column("execution_ir_json", JSONB, nullable=True),
    )
    op.add_column(
        "analysis_jobs",
        sa.Column("expanded_dag_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("analysis_jobs", "expanded_dag_json")
    op.drop_column("analysis_jobs", "execution_ir_json")
