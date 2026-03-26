from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from tune.core.runtime.task_consistency import validate_task_consistency


@dataclass
class HttpPayload:
    payload: Any
    headers: dict[str, str]


def _fetch_json(url: str) -> HttpPayload:
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
        headers = {k.lower(): v for k, v in response.headers.items()}
        return HttpPayload(payload=payload, headers=headers)


def _build_url(base_url: str, path: str, *, project: str | None = None, limit: int | None = None, offset: int | None = None) -> str:
    params: dict[str, Any] = {}
    if project:
        params["project"] = project
    if limit is not None:
        params["limit"] = limit
    if offset is not None:
        params["offset"] = offset
    query = urlencode(params)
    return f"{base_url.rstrip('/')}{path}{'?' + query if query else ''}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check task tray/task monitor API consistency for a Tune project.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Tune backend base URL")
    parser.add_argument("--project", default=None, help="Optional project id filter")
    parser.add_argument("--limit", type=int, default=20, help="Jobs page limit to inspect")
    parser.add_argument("--offset", type=int, default=0, help="Jobs page offset to inspect")
    parser.add_argument("--watch", action="store_true", help="Poll repeatedly instead of running once")
    parser.add_argument("--poll-seconds", type=float, default=5.0, help="Polling interval in watch mode")
    parser.add_argument("--max-polls", type=int, default=0, help="Maximum polls in watch mode; 0 means unlimited")
    parser.add_argument("--require-ok-streak", type=int, default=1, help="In watch mode, exit successfully after this many consecutive ok polls")
    parser.add_argument("--fail-fast", action="store_true", help="In watch mode, exit immediately on the first inconsistency")
    parser.add_argument("--json", action="store_true", help="Print the full validation report as JSON")
    args = parser.parse_args()

    def run_once() -> dict[str, Any]:
        overview = _fetch_json(_build_url(args.base_url, "/api/jobs/overview", project=args.project))
        incidents = _fetch_json(_build_url(args.base_url, "/api/jobs/incidents", project=args.project))
        jobs = _fetch_json(
            _build_url(
                args.base_url,
                "/api/jobs/",
                project=args.project,
                limit=args.limit,
                offset=args.offset,
            )
        )
        return validate_task_consistency(
            overview.payload if isinstance(overview.payload, dict) else {},
            incidents.payload if isinstance(incidents.payload, dict) else {},
            jobs.payload if isinstance(jobs.payload, list) else [],
            total_count=int(jobs.headers.get("x-total-count", "0") or 0),
            has_more=jobs.headers.get("x-has-more") == "1",
            page_limit=args.limit,
        )

    def print_report(report: dict[str, Any], *, poll_index: int | None = None) -> None:
        if args.json:
            print(json.dumps(report, indent=2, ensure_ascii=False))
            return
        prefix = f"[poll {poll_index}] " if poll_index is not None else ""
        print(
            f"{prefix}Task consistency report:"
            f" ok={report['ok']}"
            f" total={report['derived']['overview_total']}"
            f" active={report['derived']['overview_active']}"
            f" incidents={report['derived']['incident_total']}"
            f" page_count={report['derived']['recent_page_count']}"
        )
        if report["warnings"]:
            print("Warnings:")
            for item in report["warnings"]:
                print(f"- {item}")
        if report["errors"]:
            print("Errors:")
            for item in report["errors"]:
                print(f"- {item}")

    if not args.watch:
        try:
            report = run_once()
        except HTTPError as exc:
            print(f"HTTP error: {exc.code} {exc.reason}")
            return 2
        except URLError as exc:
            print(f"Connection error: {exc.reason}")
            return 2
        print_report(report)
        return 0 if report["ok"] else 1

    ok_streak = 0
    poll_index = 0
    while True:
        poll_index += 1
        try:
            report = run_once()
        except HTTPError as exc:
            print(f"[poll {poll_index}] HTTP error: {exc.code} {exc.reason}")
            return 2
        except URLError as exc:
            print(f"[poll {poll_index}] Connection error: {exc.reason}")
            return 2

        print_report(report, poll_index=poll_index)
        if report["ok"]:
            ok_streak += 1
            if ok_streak >= max(1, args.require_ok_streak):
                return 0
        else:
            ok_streak = 0
            if args.fail_fast:
                return 1

        if args.max_polls > 0 and poll_index >= args.max_polls:
            return 0 if report["ok"] else 1

        time.sleep(max(0.1, args.poll_seconds))


if __name__ == "__main__":
    raise SystemExit(main())
