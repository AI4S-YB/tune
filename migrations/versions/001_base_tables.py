"""Base tables: files, enhanced_metadata, projects, analysis_jobs, job_logs, skills,
skill_versions, conversations, messages, scan_state, llm_logs.

Revision ID: 001
Revises:
Create Date: 2025-01-01 00:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("path", sa.Text, unique=True, nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("file_type", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("md5", sa.String(32), nullable=True),
        sa.Column("mtime", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preview", sa.Text, nullable=True),
        sa.Column("duplicate_of", sa.String(36), sa.ForeignKey("files.id"), nullable=True),
        sa.Column(
            "discovered_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

    op.create_table(
        "enhanced_metadata",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id"), nullable=False),
        sa.Column("field_key", sa.String(128), nullable=False),
        sa.Column("field_value", sa.Text, nullable=True),
        sa.Column("source", sa.String(32), default="inferred"),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("file_id", "field_key"),
    )

    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(256), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("inferred", sa.Boolean, default=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column("name", sa.String(256), nullable=False),
        sa.Column("status", sa.String(32), default="queued"),
        sa.Column("goal", sa.Text, nullable=True),
        sa.Column("plan", postgresql.JSONB, nullable=True),
        sa.Column("output_dir", sa.Text, nullable=True),
        sa.Column("procrastinate_job_id", sa.Integer, nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("peak_cpu_pct", sa.Float, nullable=True),
        sa.Column("peak_mem_mb", sa.Float, nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
    )

    op.create_table(
        "job_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("analysis_jobs.id"), nullable=False),
        sa.Column("stream", sa.String(8), default="stdout"),
        sa.Column("line", sa.Text, nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_job_logs_job_id", "job_logs", ["job_id"])

    op.create_table(
        "skills",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(256), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("skill_type", sa.String(32), default="analysis"),
        sa.Column("current_version", sa.String(16), default="1.0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("source_job_id", sa.String(36), sa.ForeignKey("analysis_jobs.id"), nullable=True),
    )

    op.create_table(
        "skill_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("skill_id", sa.String(36), sa.ForeignKey("skills.id"), nullable=False),
        sa.Column("version", sa.String(16), nullable=False),
        sa.Column("input_params", postgresql.JSONB, nullable=False),
        sa.Column("steps", postgresql.JSONB, nullable=False),
        sa.Column("pixi_toml", sa.Text, nullable=True),
        sa.Column("pixi_lock", sa.Text, nullable=True),
        sa.Column("tags", postgresql.JSONB, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "conversation_id", sa.String(36), sa.ForeignKey("conversations.id"), nullable=False
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])

    op.create_table(
        "scan_state",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("total_discovered", sa.Integer, default=0),
        sa.Column("total_processed", sa.Integer, default=0),
        sa.Column("last_scanned_path", sa.Text, nullable=True),
        sa.Column("status", sa.String(32), default="idle"),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "llm_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("model", sa.String(128), nullable=False),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("success", sa.Boolean, default=True),
        sa.Column("error_type", sa.String(64), nullable=True),
        sa.Column("ts", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    for table in [
        "llm_logs", "scan_state", "messages", "conversations",
        "skill_versions", "skills", "job_logs", "analysis_jobs",
        "projects", "enhanced_metadata", "files",
    ]:
        op.drop_table(table)
