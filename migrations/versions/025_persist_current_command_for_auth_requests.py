"""Persist current command state for authorization requests.

Revision ID: 025
Revises: 024
Create Date: 2026-03-20 00:00:00
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "025"
down_revision: Union[str, None] = "024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "command_authorization_requests",
        sa.Column("current_command_text", sa.Text(), nullable=True),
    )
    op.add_column(
        "command_authorization_requests",
        sa.Column("revision_history_json", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("command_authorization_requests", "revision_history_json")
    op.drop_column("command_authorization_requests", "current_command_text")
