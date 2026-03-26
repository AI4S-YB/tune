"""pgvector extension and embedding column on files table.

Revision ID: 003
Revises: 002
Create Date: 2025-01-01 00:02:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column("files", sa.Column("embedding", Vector(1536), nullable=True))
    op.create_index(
        "ix_files_embedding",
        "files",
        ["embedding"],
        postgresql_using="ivfflat",
        postgresql_with={"lists": 100},
        postgresql_ops={"embedding": "vector_cosine_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_files_embedding", "files")
    op.drop_column("files", "embedding")
