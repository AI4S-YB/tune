"""Workflow state machine — transition helpers for AnalysisJob and AnalysisStepRun.

All state transitions are written to the DB before any side effects.
Callers must commit the session themselves after calling transition_*.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Allowed transitions
# ---------------------------------------------------------------------------

# Maps current_status -> set of valid next statuses
JOB_TRANSITIONS: dict[str, set[str]] = {
    "draft":                       {"awaiting_plan_confirmation", "cancelled"},
    "awaiting_plan_confirmation":  {"resource_clarification_required", "queued", "cancelled"},
    "resource_clarification_required": {"queued", "cancelled"},
    "queued":                      {"preparing_environment", "running", "cancelled"},
    "preparing_environment":       {"running", "failed"},
    "running":                     {"waiting_for_authorization", "waiting_for_repair",
                                    "completed", "failed", "cancelled"},
    "waiting_for_authorization":   {"running", "failed", "cancelled"},
    "waiting_for_repair":          {"running", "failed", "cancelled"},
    # Terminal states — no forward transitions
    "completed":                   set(),
    "failed":                      set(),
    "cancelled":                   set(),
    "interrupted":                 {"queued"},  # can be re-queued after restart
}

STEP_TRANSITIONS: dict[str, set[str]] = {
    "pending":                  {"ready", "binding_missing", "skipped"},
    "ready":                    {"awaiting_authorization", "running", "skipped"},
    "binding_missing":          {"ready"},
    "awaiting_authorization":   {"running", "failed"},
    "running":                  {"repairable_failed", "waiting_for_human_repair",
                                  "succeeded", "failed"},
    "repairable_failed":        {"running", "waiting_for_human_repair", "failed"},
    "waiting_for_human_repair": {"running", "skipped", "failed"},
    # Terminal states
    "succeeded":                set(),
    "failed":                   set(),
    "skipped":                  set(),
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


async def transition_job(
    job_id: str,
    new_status: str,
    db: "AsyncSession",
    *,
    error_message: str | None = None,
) -> bool:
    """Transition an AnalysisJob to new_status.

    Returns True on success, False if the transition is not allowed.
    Caller must commit the session.
    """
    from tune.core.models import AnalysisJob

    result = await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        log.error("transition_job: job %s not found", job_id)
        return False

    allowed = JOB_TRANSITIONS.get(job.status, set())
    if new_status not in allowed:
        log.warning(
            "transition_job: invalid transition %s -> %s for job %s",
            job.status, new_status, job_id,
        )
        return False

    now = datetime.now(timezone.utc)
    job.status = new_status
    job.last_progress_at = now
    if new_status == "running" and job.started_at is None:
        job.started_at = now
    if new_status in ("completed", "failed", "cancelled"):
        job.ended_at = now
    if error_message is not None:
        job.error_message = error_message
    return True


async def touch_job_progress(
    db: "AsyncSession",
    *,
    job_id: str | None = None,
    job=None,
    at: datetime | None = None,
) -> bool:
    """Refresh the job heartbeat/progress timestamp without changing status."""
    from tune.core.models import AnalysisJob

    target = job
    if target is None:
        if not job_id:
            return False
        result = await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))
        target = result.scalar_one_or_none()
    if target is None:
        return False

    target.last_progress_at = at or datetime.now(timezone.utc)
    return True


async def transition_step(
    step_id: str,
    new_status: str,
    db: "AsyncSession",
) -> bool:
    """Transition an AnalysisStepRun to new_status.

    Returns True on success, False if the transition is not allowed.
    Caller must commit the session.
    """
    from tune.core.models import AnalysisStepRun

    result = await db.execute(select(AnalysisStepRun).where(AnalysisStepRun.id == step_id))
    step = result.scalar_one_or_none()
    if step is None:
        log.error("transition_step: step %s not found", step_id)
        return False

    allowed = STEP_TRANSITIONS.get(step.status, set())
    if new_status not in allowed:
        log.warning(
            "transition_step: invalid transition %s -> %s for step %s",
            step.status, new_status, step_id,
        )
        return False

    step.status = new_status
    if new_status == "running" and step.started_at is None:
        step.started_at = datetime.now(timezone.utc)
    if new_status in ("succeeded", "failed", "skipped"):
        step.finished_at = datetime.now(timezone.utc)
    return True
