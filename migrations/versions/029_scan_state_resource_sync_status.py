"""Persist resource-sync status on scan_state.

Revision ID: 029
Revises: 028
Create Date: 2026-03-22 00:30:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scan_state",
        sa.Column("resource_sync_status", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "scan_state",
        sa.Column("resource_sync_summary_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scan_state", "resource_sync_summary_json")
    op.drop_column("scan_state", "resource_sync_status")
