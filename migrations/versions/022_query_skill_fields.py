"""Add query Skill fields to skills table.

Adds params_schema, dataset_template, query_steps, required_capabilities
columns to support parameterized query-based Skills (skill_type='query').

Revision ID: 022
Revises: 021
Create Date: 2026-03-19 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("skills", sa.Column("params_schema", JSONB, nullable=True))
    op.add_column("skills", sa.Column("dataset_template", JSONB, nullable=True))
    op.add_column("skills", sa.Column("query_steps", JSONB, nullable=True))
    op.add_column("skills", sa.Column("required_capabilities", JSONB, nullable=True))
    # Update skill_type check to allow 'query' in addition to 'analysis' and 'metadata'
    # (No CHECK constraint exists in existing migrations, so this is a no-op schema change)


def downgrade() -> None:
    op.drop_column("skills", "required_capabilities")
    op.drop_column("skills", "query_steps")
    op.drop_column("skills", "dataset_template")
    op.drop_column("skills", "params_schema")
