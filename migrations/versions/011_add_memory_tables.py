"""Add global_memories and project_execution_events tables.

Revision ID: 011
Revises: 010
Create Date: 2026-03-14 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "global_memories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("trigger_condition", sa.Text, nullable=False),
        sa.Column("approach", sa.Text, nullable=False),
        sa.Column("source", sa.String(8), nullable=False, server_default="system"),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("success_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_global_memories_source", "global_memories", ["source"])
    op.create_index(
        "ix_global_memories_embedding",
        "global_memories",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )

    op.create_table(
        "project_execution_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(32), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("resolution", sa.Text, nullable=False),
        sa.Column("user_contributed", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index(
        "ix_project_execution_events_project_id",
        "project_execution_events",
        ["project_id"],
    )
    op.create_index(
        "ix_project_execution_events_embedding",
        "project_execution_events",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_table("project_execution_events")
    op.drop_table("global_memories")
