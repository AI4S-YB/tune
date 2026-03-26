"""Filesystem API — native directory picker dialog for local use."""
from __future__ import annotations

import asyncio
import subprocess
import sys

from fastapi import APIRouter

router = APIRouter()

# Inline script run in a subprocess so tkinter gets its own main thread
# (macOS requires GUI calls on the main thread; a subprocess satisfies this)
_PICKER_SCRIPT = """
import sys
import tkinter as tk
from tkinter import filedialog

initial_dir = sys.argv[1] if len(sys.argv) > 1 else "/"
root = tk.Tk()
root.withdraw()
root.wm_attributes("-topmost", True)
folder = filedialog.askdirectory(
    parent=root,
    initialdir=initial_dir,
    title="选择目录 / Select Directory",
)
root.destroy()
print(folder, end="")
"""


def _pick_directory_sync(initial_dir: str) -> str | None:
    """Spawn a subprocess to show the native OS folder dialog on its main thread."""
    result = subprocess.run(
        [sys.executable, "-c", _PICKER_SCRIPT, initial_dir or "/"],
        capture_output=True,
        text=True,
        timeout=300,  # 5 minutes for user to navigate
    )
    path = result.stdout.strip()
    return path if path else None


@router.post("/pick-directory")
async def pick_directory(initial_dir: str = ""):
    """Open the native OS folder picker dialog on the server machine.

    Returns:
        path:      selected absolute path, or null if cancelled
        cancelled: true if user dismissed the dialog
    """
    loop = asyncio.get_event_loop()
    path = await loop.run_in_executor(None, _pick_directory_sync, initial_dir)
    if path is None:
        return {"path": None, "cancelled": True}
    return {"path": path, "cancelled": False}
