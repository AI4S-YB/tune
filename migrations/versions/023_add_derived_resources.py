"""Add derived_resources table and resource_graph_json to analysis_jobs.

Adds the derived_resources table for caching aligner indices with provenance
and staleness tracking.  Also adds resource_graph_json (nullable Text) column
to analysis_jobs for persisting the built ResourceGraph per job.

Includes a one-shot data migration that moves existing KnownPath entries
for hisat2_index, star_genome_dir, bwa_index, bowtie2_index → derived_resources.

Revision ID: 023
Revises: 022
Create Date: 2026-03-19 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "023"
down_revision: Union[str, None] = "022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Keys in known_paths that represent derived resources (not user-registered primaries)
_DERIVED_KEYS = {"hisat2_index", "star_genome_dir", "bwa_index", "bowtie2_index"}

# Map from known_path key → aligner string for derived_resources.aligner column
_KEY_TO_ALIGNER = {
    "hisat2_index": "hisat2",
    "star_genome_dir": "star",
    "bwa_index": "bwa",
    "bowtie2_index": "bowtie2",
}

# Map from known_path key → kind string for derived_resources.kind column
_KEY_TO_KIND = {
    "hisat2_index": "aligner_index",
    "star_genome_dir": "aligner_index",
    "bwa_index": "aligner_index",
    "bowtie2_index": "aligner_index",
}


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. Create derived_resources table
    # ------------------------------------------------------------------
    op.create_table(
        "derived_resources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(64), nullable=False),          # aligner_index | derived_index
        sa.Column("aligner", sa.String(32), nullable=True),        # hisat2 | star | bwa | bowtie2
        sa.Column("organism", sa.String(256), nullable=True),
        sa.Column("genome_build", sa.String(128), nullable=True),
        sa.Column("path", sa.Text, nullable=False),                # index prefix or genome dir
        sa.Column("derived_from_path", sa.Text, nullable=True),    # source FASTA path
        sa.Column("derived_from_mtime", sa.Float, nullable=True),  # mtime at build time
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "kind", "aligner", name="uq_derived_resources"),
    )

    # ------------------------------------------------------------------
    # 2. Add resource_graph_json to analysis_jobs
    # ------------------------------------------------------------------
    op.add_column(
        "analysis_jobs",
        sa.Column("resource_graph_json", sa.Text, nullable=True),
    )

    # ------------------------------------------------------------------
    # 3. Data migration: move derived-resource KnownPath entries
    # ------------------------------------------------------------------
    conn = op.get_bind()
    import uuid

    rows = conn.execute(
        sa.text(
            "SELECT id, project_id, key, path FROM known_paths"
            " WHERE key IN ('hisat2_index', 'star_genome_dir', 'bwa_index', 'bowtie2_index')"
        )
    ).fetchall()

    for row in rows:
        kp_id, project_id, key, path = row
        aligner = _KEY_TO_ALIGNER.get(key)
        kind = _KEY_TO_KIND.get(key, "aligner_index")
        new_id = str(uuid.uuid4())
        conn.execute(
            sa.text(
                """INSERT INTO derived_resources
                   (id, project_id, kind, aligner, path, created_at)
                   VALUES (:id, :project_id, :kind, :aligner, :path, NOW())
                   ON CONFLICT (project_id, kind, aligner) DO NOTHING"""
            ),
            {
                "id": new_id,
                "project_id": project_id,
                "kind": kind,
                "aligner": aligner,
                "path": path,
            },
        )
        # Delete migrated KnownPath record
        conn.execute(
            sa.text("DELETE FROM known_paths WHERE id = :id"),
            {"id": kp_id},
        )


def downgrade() -> None:
    op.drop_column("analysis_jobs", "resource_graph_json")
    op.drop_table("derived_resources")
