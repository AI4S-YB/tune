"""Add project narrative and user_profiles table.

Revision ID: 007
Revises: 006
Create Date: 2026-03-06
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add narrative column to projects
    op.add_column("projects", sa.Column("narrative", sa.Text(), nullable=True))

    # Create user_profiles table (single global row)
    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("research_domain", sa.Text(), nullable=True),
        sa.Column("experience_level", sa.String(32), nullable=True),  # novice|intermediate|expert
        sa.Column("language_preference", sa.String(8), nullable=True),  # en|zh
        sa.Column("communication_style", sa.String(32), nullable=True),  # brief|detailed
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("user_profiles")
    op.drop_column("projects", "narrative")
