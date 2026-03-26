"""Watchdog monitor — starts/stops with server lifecycle."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from watchdog.events import FileCreatedEvent, FileModifiedEvent, FileSystemEventHandler
from watchdog.observers import Observer

log = logging.getLogger(__name__)
_observer: Observer | None = None


class _TuneHandler(FileSystemEventHandler):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def _enqueue(self, path: str):
        from tune.workers.tasks import scan_file_task
        asyncio.run_coroutine_threadsafe(
            scan_file_task.defer_async(path=path), self._loop
        )

    def on_created(self, event):
        if not event.is_directory:
            self._enqueue(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._enqueue(event.src_path)


async def start_watchdog():
    global _observer
    try:
        from tune.core.config import get_config
        cfg = get_config()
        loop = asyncio.get_event_loop()
        _observer = Observer()
        _observer.schedule(_TuneHandler(loop), str(cfg.data_dir), recursive=True)
        _observer.start()
        log.info("Watchdog started on %s", cfg.data_dir)
    except Exception as e:
        log.warning("Watchdog failed to start: %s", e)


async def stop_watchdog():
    global _observer
    if _observer and _observer.is_alive():
        _observer.stop()
        _observer.join()
        log.info("Watchdog stopped")
