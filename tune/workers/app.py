"""Procrastinate app configuration."""
from __future__ import annotations

import procrastinate

from tune.core.config import get_config

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(),
    import_paths=["tune.workers.tasks"],
)
