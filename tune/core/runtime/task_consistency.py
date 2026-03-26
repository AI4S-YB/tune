from __future__ import annotations

from collections import Counter
from typing import Any, Mapping, Sequence


ACTIVE_JOB_STATUSES = {
    "queued",
    "running",
    "binding_required",
    "resource_clarification_required",
    "awaiting_plan_confirmation",
    "waiting_for_authorization",
    "waiting_for_repair",
}


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def validate_task_consistency(
    overview: Mapping[str, Any] | None,
    incident_payload: Mapping[str, Any] | None,
    jobs: Sequence[Mapping[str, Any]] | None,
    *,
    total_count: int | None = None,
    has_more: bool | None = None,
    page_limit: int | None = None,
) -> dict[str, Any]:
    overview = overview or {}
    incident_payload = incident_payload or {}
    jobs = list(jobs or [])
    summary = incident_payload.get("summary") if isinstance(incident_payload.get("summary"), Mapping) else {}
    incidents = incident_payload.get("incidents") if isinstance(incident_payload.get("incidents"), Sequence) else []
    incidents = [item for item in incidents if isinstance(item, Mapping)]

    errors: list[str] = []
    warnings: list[str] = []

    by_status = overview.get("by_status") if isinstance(overview.get("by_status"), Mapping) else {}
    by_status_counter = Counter({str(k): _as_int(v) for k, v in by_status.items()})
    incident_type_counter = Counter(str(item.get("incident_type") or "unknown") for item in incidents)
    severity_counter = Counter(str(item.get("severity") or "unknown") for item in incidents)

    overview_total = _as_int(overview.get("total"))
    overview_active = _as_int(overview.get("active"))
    derived_active = sum(count for status, count in by_status_counter.items() if status in ACTIVE_JOB_STATUSES)

    if overview_total < 0 or overview_active < 0:
        errors.append("overview totals must be non-negative")
    if overview_active > overview_total:
        errors.append("overview active count exceeds total")
    if overview_active != derived_active:
        errors.append(
            f"overview active mismatch: active={overview_active} derived_active={derived_active}"
        )

    incident_total = _as_int(summary.get("total_open"))
    if incident_total != len(incidents):
        errors.append(
            f"incident total mismatch: summary.total_open={incident_total} actual={len(incidents)}"
        )
    if _as_int(summary.get("critical")) != severity_counter.get("critical", 0):
        errors.append("incident critical count mismatch")
    if _as_int(summary.get("warning")) != severity_counter.get("warning", 0):
        errors.append("incident warning count mismatch")
    if _as_int(summary.get("info")) != severity_counter.get("info", 0):
        errors.append("incident info count mismatch")

    summary_by_type = summary.get("by_type") if isinstance(summary.get("by_type"), Mapping) else {}
    for incident_type, count in incident_type_counter.items():
        if _as_int(summary_by_type.get(incident_type)) != count:
            errors.append(f"incident by_type mismatch for {incident_type}")

    waiting_auth = by_status_counter.get("waiting_for_authorization", 0)
    waiting_repair = by_status_counter.get("waiting_for_repair", 0)
    if incident_type_counter.get("authorization", 0) > waiting_auth:
        errors.append("authorization incidents exceed waiting_for_authorization status count")
    if incident_type_counter.get("repair", 0) > waiting_repair:
        errors.append("repair incidents exceed waiting_for_repair status count")

    effective_total_count = _as_int(total_count, default=overview_total)
    if effective_total_count < len(jobs):
        errors.append(
            f"jobs page length exceeds total count: page_len={len(jobs)} total={effective_total_count}"
        )
    if effective_total_count == 0 and jobs:
        errors.append("jobs page is non-empty while total count is zero")
    if page_limit is not None and len(jobs) > page_limit:
        errors.append(f"jobs page length exceeds requested limit={page_limit}")

    if has_more is False and effective_total_count > len(jobs) and effective_total_count <= (page_limit or effective_total_count):
        warnings.append("jobs page headers report has_more=false while total count suggests more rows may exist")

    recent_status_counter = Counter(str(item.get("status") or "unknown") for item in jobs)
    if recent_status_counter.get("running", 0) > by_status_counter.get("running", 0):
        errors.append("recent jobs page reports more running jobs than overview")
    if recent_status_counter.get("waiting_for_authorization", 0) > waiting_auth:
        errors.append("recent jobs page reports more waiting_for_authorization jobs than overview")
    if recent_status_counter.get("waiting_for_repair", 0) > waiting_repair:
        errors.append("recent jobs page reports more waiting_for_repair jobs than overview")

    return {
        "ok": not errors,
        "errors": errors,
        "warnings": warnings,
        "derived": {
            "overview_total": overview_total,
            "overview_active": overview_active,
            "derived_active": derived_active,
            "incident_total": incident_total,
            "recent_page_count": len(jobs),
            "recent_status_counts": dict(recent_status_counter),
            "incident_type_counts": dict(incident_type_counter),
        },
    }
