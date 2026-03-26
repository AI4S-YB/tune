"""Add samples, experiments, file_runs tables and schema_extensions to projects.

Revision ID: 008
Revises: 007
Create Date: 2026-03-10 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add schema_extensions to projects
    op.add_column(
        "projects",
        sa.Column("schema_extensions", JSONB, nullable=True),
    )

    # Create samples table
    op.create_table(
        "samples",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sample_name", sa.String(256), nullable=False),
        sa.Column("organism", sa.String(256), nullable=True),
        sa.Column("attrs", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_samples_project_id", "samples", ["project_id"])

    # Create experiments table
    op.create_table(
        "experiments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sample_id", sa.String(36), sa.ForeignKey("samples.id", ondelete="CASCADE"), nullable=False),
        sa.Column("library_strategy", sa.String(64), nullable=True),
        sa.Column("library_source", sa.String(64), nullable=True),
        sa.Column("library_selection", sa.String(64), nullable=True),
        sa.Column("library_layout", sa.String(16), nullable=True),
        sa.Column("platform", sa.String(64), nullable=True),
        sa.Column("instrument_model", sa.String(128), nullable=True),
        sa.Column("attrs", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_experiments_project_id", "experiments", ["project_id"])
    op.create_index("ix_experiments_sample_id", "experiments", ["sample_id"])

    # Create file_runs table
    op.create_table(
        "file_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("experiment_id", sa.String(36), sa.ForeignKey("experiments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("read_number", sa.Integer, nullable=True),
        sa.Column("filename", sa.String(512), nullable=True),
    )
    op.create_index("ix_file_runs_experiment_id", "file_runs", ["experiment_id"])
    op.create_index("ix_file_runs_file_id", "file_runs", ["file_id"])


def downgrade() -> None:
    op.drop_table("file_runs")
    op.drop_table("experiments")
    op.drop_table("samples")
    op.drop_column("projects", "schema_extensions")
