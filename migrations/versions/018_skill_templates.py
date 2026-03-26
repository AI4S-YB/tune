"""Create skill_templates and skill_versions tables for pipeline-v2 skill extraction.

Revision ID: 018
Revises: 017
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # skill_templates: reusable parameterized pipeline templates
    op.create_table(
        "skill_templates",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("step_types", sa.JSON, nullable=False),   # list of step_type strings
        sa.Column("plan_schema", sa.JSON, nullable=True),   # abstract plan with slot refs
        sa.Column("env_spec", sa.JSON, nullable=True),      # {packages, hash}
        sa.Column("source_job_id", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    # skill_version_snapshots: snapshot of a specific run (uses unique name to avoid clash with legacy skill_versions)
    op.create_table(
        "skill_version_snapshots",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("template_id", sa.String,
                  sa.ForeignKey("skill_templates.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False, default=1),
        sa.Column("plan_json", sa.JSON, nullable=True),          # resolved plan steps
        sa.Column("pixi_toml", sa.Text, nullable=True),
        sa.Column("pixi_lock", sa.Text, nullable=True),
        sa.Column("renderer_versions", sa.JSON, nullable=True),  # {step_key: version}
        sa.Column("source_job_id", sa.String, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )

    op.create_index("ix_skill_version_snapshots_template_id", "skill_version_snapshots", ["template_id"])


def downgrade() -> None:
    op.drop_index("ix_skill_version_snapshots_template_id", table_name="skill_version_snapshots")
    op.drop_table("skill_version_snapshots")
    op.drop_table("skill_templates")
