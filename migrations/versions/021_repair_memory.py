"""Add repair_memories table for long-term human repair knowledge.

Phase 6: when a user manually fixes a failed step, the fix is persisted here
so future jobs encountering the same error class can apply it automatically
(Tier 0, before Level-1 rules in the repair engine).

Revision ID: 021
Revises: 020
Create Date: 2026-03-17 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "repair_memories",
        sa.Column("id", sa.String(36), primary_key=True),
        # Which step type this fix applies to (e.g. "align.hisat2")
        sa.Column("step_type", sa.String(128), nullable=False),
        # First token of the original failing command (e.g. "hisat2")
        sa.Column("tool_name", sa.String(128), nullable=False, server_default=""),
        # SHA-256[:16] hash of (step_type, stderr keywords) — matches same error class
        sa.Column("error_signature", sa.String(16), nullable=False),
        # command_fingerprint from RenderedCommand (may be empty for LLM-fallback commands)
        sa.Column("context_fingerprint", sa.String(16), nullable=False, server_default=""),
        # {repair_command, original_command, action, note}
        sa.Column("human_solution_json", JSONB, nullable=True),
        # Short strategy label: reduce_threads|reduce_memory|fix_path|add_flag|custom
        sa.Column("normalized_strategy", sa.String(32), nullable=False, server_default="custom"),
        # "global" applies to all projects; "project" is project-specific
        sa.Column("scope_type", sa.String(16), nullable=False, server_default="global"),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("success_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("failure_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Fast lookup by (step_type, error_signature) — the primary Tier-0 query
    op.create_index(
        "ix_repair_memories_step_sig",
        "repair_memories",
        ["step_type", "error_signature"],
    )


def downgrade() -> None:
    op.drop_index("ix_repair_memories_step_sig", table_name="repair_memories")
    op.drop_table("repair_memories")
