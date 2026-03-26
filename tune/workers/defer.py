"""Helpers for deferring Procrastinate tasks in service and script contexts."""
from __future__ import annotations

import asyncio
import inspect
import logging
import os
from typing import Any

import procrastinate
import psycopg_pool

from tune.core.config import get_config
from tune.workers.app import app as proc_app

log = logging.getLogger(__name__)


async def defer_async_with_fallback(task: Any, **task_kwargs: Any) -> Any:
    """Defer a Procrastinate task, opening the app temporarily if needed.

    FastAPI startup normally opens the shared Procrastinate app. Direct handler
    calls in scripts/tests may skip that lifecycle, so task.defer_async() would
    fail with AppNotOpen. This fallback keeps those paths functional without
    changing the normal service flow.
    """
    if os.getenv("TUNE_INLINE_TASKS", "").strip().lower() in {"1", "true", "yes", "on"}:
        log.info(
            "defer_async_with_fallback: running %s inline because TUNE_INLINE_TASKS is enabled",
            getattr(task, "__name__", getattr(task, "name", repr(task))),
        )
        result = task(**task_kwargs)
        if inspect.isawaitable(result):
            return asyncio.create_task(result)
        return result

    try:
        return await task.defer_async(**task_kwargs)
    except (
        procrastinate.exceptions.AppNotOpen,
        procrastinate.exceptions.ConnectorException,
    ):
        log.info("Procrastinate app unavailable; opening temporary app context to defer task")

    cfg = get_config()
    conninfo = cfg.database_url.replace("postgresql+psycopg://", "postgresql://")
    pool = psycopg_pool.AsyncConnectionPool(conninfo, open=False)
    await pool.open()
    try:
        async with proc_app.open_async(pool=pool):
            return await task.defer_async(**task_kwargs)
    finally:
        await pool.close()
