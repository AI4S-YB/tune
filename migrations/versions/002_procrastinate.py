"""Procrastinate job tables via Procrastinate's built-in schema.

Revision ID: 002
Revises: 001
Create Date: 2025-01-01 00:01:00
"""
from typing import Sequence, Union

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Procrastinate manages its own schema via its CLI or connector.
    # At runtime, `procrastinate schema apply` creates the required tables.
    # This migration records the dependency so Alembic ordering is correct.
    # The actual tables (procrastinate_jobs, procrastinate_events, etc.)
    # are created by running: procrastinate --app tune.workers.app:app schema apply
    pass


def downgrade() -> None:
    pass
