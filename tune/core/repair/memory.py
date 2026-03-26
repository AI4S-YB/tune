"""RepairMemory — long-term storage and retrieval of human repair patterns.

When a user manually fixes a failed step, the fix is written here so future
jobs hitting the same error class can apply it automatically (Tier 0 in the
repair engine, before Level-1 rules).

Error signature
---------------
A deterministic SHA-256[:16] hash of ``(step_type, stderr_keywords)`` that
identifies the *class* of error regardless of exact file paths, thread counts,
or job-specific numbers.

Matching flow (attempt_repair Tier 0)
--------------------------------------
1. Compute error_signature for the current failure.
2. Query repair_memories for (step_type, signature) — project-scoped first,
   then global.
3. If found, call _apply_memory_fix() to adapt the stored command to the
   current command's paths/params.
4. Validate via _is_safe_repair() from engine.py.
5. Return MEMORY_RECALLED if safe, else fall through to Level-1 rules.

Write flow (tasks.py after human repair succeeds)
--------------------------------------------------
    await write_repair_memory(
        step_type=step["step_type"],
        original_command=original_failed_command,
        repair_command=user_provided_command,
        stderr=original_stderr,
        project_id=job.project_id,
        context_fingerprint=rendered.command_fingerprint,
    )
"""
from __future__ import annotations

import hashlib
import logging
import re
import shlex
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Error signature — maps stderr → error class hash
# ---------------------------------------------------------------------------

def _error_signature(step_type: str, stderr: str) -> str:
    """Return a 16-char hash identifying the error class.

    Strips file paths, numbers, hex IDs, and punctuation; keeps meaningful
    English error keywords only.  Combined with step_type so errors for
    different tools don't collide even if stderr text is similar.
    """
    text = stderr.lower()
    text = re.sub(r"/[\w/.\-@:]+", " ", text)        # strip paths
    text = re.sub(r"\b[0-9a-f]{8,}\b", " ", text)    # strip hex IDs / UUIDs
    text = re.sub(r"\b\d+\b", " ", text)              # strip bare numbers
    text = re.sub(r"[^\w\s]", " ", text)              # strip punctuation
    words = [w for w in text.split() if len(w) > 3][:8]
    sig_input = f"{step_type}::{' '.join(words)}"
    return hashlib.sha256(sig_input.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Strategy inference — what kind of fix did the user apply?
# ---------------------------------------------------------------------------

def _flag_value(parts: list[str], flag: str) -> Optional[str]:
    for i, p in enumerate(parts):
        if p == flag and i + 1 < len(parts):
            return parts[i + 1]
    return None


def _infer_strategy(original: str, repair: str) -> str:
    """Return a short label for the repair strategy applied."""
    try:
        orig_parts = shlex.split(original)
        rep_parts = shlex.split(repair)
    except ValueError:
        return "custom"

    # Thread reduction
    for flag in ("-@", "-p", "--runThreadN", "-T", "-t", "-w"):
        ov = _flag_value(orig_parts, flag)
        rv = _flag_value(rep_parts, flag)
        if ov and rv:
            try:
                if int(rv) < int(ov):
                    return "reduce_threads"
            except ValueError:
                pass

    # Memory reduction
    for flag in ("-m", "--limitBAMsortRAM"):
        ov = _flag_value(orig_parts, flag)
        rv = _flag_value(rep_parts, flag)
        if ov and rv and ov != rv:
            return "reduce_memory"

    # Path change
    orig_paths = {a for a in orig_parts if a.startswith("/")}
    rep_paths = {a for a in rep_parts if a.startswith("/")}
    if orig_paths != rep_paths:
        return "fix_path"

    # Tool change (unusual but label it)
    if orig_parts and rep_parts:
        if Path(orig_parts[0]).name.lower() != Path(rep_parts[0]).name.lower():
            return "change_tool"

    return "custom"


# ---------------------------------------------------------------------------
# Apply a stored fix to the current command
# ---------------------------------------------------------------------------

def _apply_memory_fix(current_command: str, memory: dict) -> Optional[str]:
    """Adapt the stored repair to the current command.

    Strategy:
    - ``reduce_threads`` / ``reduce_memory``: compute the ratio from the
      stored (original → repair) pair and apply the same ratio to the
      current command's parameter value.
    - All other strategies: return the stored repair_command directly for
      the caller to validate via _is_safe_repair.

    Returns None if the adaptation fails or the fix is not applicable.
    """
    strategy = memory.get("normalized_strategy", "custom")
    sol = memory.get("human_solution_json") or {}
    stored_repair = sol.get("repair_command", "")
    stored_original = sol.get("original_command", "")

    if not stored_repair:
        return None

    if strategy in ("reduce_threads", "reduce_memory"):
        flags = (
            ["-@", "-p", "--runThreadN", "-T", "-t", "-w"]
            if strategy == "reduce_threads"
            else ["-m", "--limitBAMsortRAM"]
        )
        try:
            orig_parts = shlex.split(stored_original) if stored_original else []
            rep_parts = shlex.split(stored_repair)
            cur_parts = shlex.split(current_command)
            for flag in flags:
                ov = _flag_value(orig_parts, flag) if orig_parts else None
                rv = _flag_value(rep_parts, flag)
                cv = _flag_value(cur_parts, flag)
                if rv and cv:
                    if ov:
                        try:
                            ratio = float(rv.rstrip("MmGg")) / float(ov.rstrip("MmGg"))
                        except (ValueError, ZeroDivisionError):
                            ratio = None
                    else:
                        ratio = None
                    # Apply ratio or fall back to stored value directly
                    if ratio is not None:
                        new_num = max(1, int(float(cv.rstrip("MmGg")) * ratio))
                        suffix = cv[-1:] if cv[-1:].lower() in ("m", "g") else ""
                        new_val = f"{new_num}{suffix}"
                    else:
                        new_val = rv  # use stored value as-is
                    # Replace in current command
                    result_parts = list(cur_parts)
                    for i, p in enumerate(result_parts):
                        if p == flag and i + 1 < len(result_parts):
                            result_parts[i + 1] = new_val
                            break
                    return " ".join(shlex.quote(p) for p in result_parts)
        except Exception:
            log.debug("_apply_memory_fix: ratio adaptation failed, falling back to stored repair")

    # For all other strategies: return stored repair directly.
    # The caller must run _is_safe_repair() before using it.
    return stored_repair


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

async def query_repair_memory(
    step_type: str,
    stderr: str,
    project_id: str = "",
) -> Optional[dict]:
    """Look up a RepairMemory record matching this error.

    Searches project-scoped memories first (most specific), then global.
    Returns the record with the highest success_count, or None.
    """
    if not step_type:
        return None

    sig = _error_signature(step_type, stderr)
    log.debug("query_repair_memory: step_type=%s sig=%s", step_type, sig)

    try:
        from tune.core.models import RepairMemory
        from tune.core.database import get_session_factory
        from sqlalchemy import select, or_

        async with get_session_factory()() as session:
            stmt = (
                select(RepairMemory)
                .where(
                    RepairMemory.step_type == step_type,
                    RepairMemory.error_signature == sig,
                    or_(
                        RepairMemory.scope_type == "global",
                        RepairMemory.project_id == project_id,
                    ) if project_id else RepairMemory.scope_type == "global",
                )
                .order_by(
                    # project-scoped > global, then highest success rate
                    RepairMemory.success_count.desc(),
                    RepairMemory.updated_at.desc(),
                )
                .limit(1)
            )
            row = (await session.execute(stmt)).scalar_one_or_none()
            if row is None:
                return None
            return {
                "id": row.id,
                "step_type": row.step_type,
                "error_signature": row.error_signature,
                "tool_name": row.tool_name,
                "human_solution_json": row.human_solution_json or {},
                "normalized_strategy": row.normalized_strategy,
                "success_count": row.success_count,
                "failure_count": row.failure_count,
            }
    except Exception:
        log.exception("query_repair_memory: failed for step_type=%s sig=%s", step_type, sig)
        return None


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

async def write_repair_memory(
    step_type: str,
    original_command: str,
    repair_command: str,
    stderr: str,
    project_id: str = "",
    context_fingerprint: str = "",
    scope_type: str = "global",
) -> Optional[str]:
    """Record a successful human repair for future reuse.

    Upserts on (step_type, error_signature, scope_type[, project_id]):
    - If a matching record exists: update solution + increment success_count.
    - Otherwise: create a new record.

    Returns the RepairMemory.id, or None on failure.
    """
    if not step_type or not repair_command:
        return None

    sig = _error_signature(step_type, stderr)
    strategy = _infer_strategy(original_command, repair_command)

    tool_name = ""
    try:
        tool_name = Path(shlex.split(original_command)[0]).name
    except Exception:
        pass

    solution = {
        "repair_command": repair_command,
        "original_command": original_command,
        "action": "human_fix",
    }

    now = datetime.now(tz=timezone.utc)

    try:
        from tune.core.models import RepairMemory
        from tune.core.database import get_session_factory
        from sqlalchemy import select

        async with get_session_factory()() as session:
            stmt = select(RepairMemory).where(
                RepairMemory.step_type == step_type,
                RepairMemory.error_signature == sig,
                RepairMemory.scope_type == scope_type,
            )
            if scope_type == "project" and project_id:
                stmt = stmt.where(RepairMemory.project_id == project_id)

            existing = (await session.execute(stmt)).scalar_one_or_none()

            if existing:
                existing.human_solution_json = solution
                existing.normalized_strategy = strategy
                existing.success_count += 1
                existing.updated_at = now
                record_id = existing.id
                log.info(
                    "write_repair_memory: updated memory %s (step_type=%s, count=%d)",
                    record_id, step_type, existing.success_count,
                )
            else:
                record_id = str(uuid.uuid4())
                record = RepairMemory(
                    id=record_id,
                    step_type=step_type,
                    tool_name=tool_name,
                    error_signature=sig,
                    context_fingerprint=context_fingerprint,
                    human_solution_json=solution,
                    normalized_strategy=strategy,
                    scope_type=scope_type,
                    project_id=project_id or None,
                    success_count=1,
                    failure_count=0,
                    created_at=now,
                    updated_at=now,
                )
                session.add(record)
                log.info(
                    "write_repair_memory: created memory %s (step_type=%s, strategy=%s)",
                    record_id, step_type, strategy,
                )

            await session.commit()
            return record_id
    except Exception:
        log.exception("write_repair_memory: failed for step_type=%s", step_type)
        return None


# ---------------------------------------------------------------------------
# Feedback helpers
# ---------------------------------------------------------------------------

async def increment_memory_failure(memory_id: str) -> None:
    """Increment failure_count for a memory that was tried but didn't work.

    Called by the repair engine if a MEMORY_RECALLED fix still fails after
    execution.  After too many failures the record can be deprioritised.
    """
    try:
        from tune.core.models import RepairMemory
        from tune.core.database import get_session_factory
        from sqlalchemy import select

        async with get_session_factory()() as session:
            row = (await session.execute(
                select(RepairMemory).where(RepairMemory.id == memory_id)
            )).scalar_one_or_none()
            if row:
                row.failure_count += 1
                row.updated_at = datetime.now(tz=timezone.utc)
                await session.commit()
    except Exception:
        log.exception("increment_memory_failure: failed for memory %s", memory_id)
