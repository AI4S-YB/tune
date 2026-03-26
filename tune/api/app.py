"""FastAPI application factory."""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from tune.api.routes import config as config_routes
from tune.api.routes import experiments as experiment_routes
from tune.api.routes import file_runs as file_run_routes
from tune.api.routes import files as file_routes
from tune.api.routes import fs as fs_routes
from tune.api.routes import health as health_routes
from tune.api.routes import jobs as job_routes
from tune.api.routes import llm as llm_routes
from tune.api.routes import metadata as metadata_routes
from tune.api.routes import metadata_assistant as metadata_assistant_routes
from tune.api.routes import profile as profile_routes
from tune.api.routes import known_paths as known_path_routes
from tune.api.routes import projects as project_routes
from tune.api.routes import samples as sample_routes
from tune.api.routes import skills as skill_routes
from tune.api.routes import threads as thread_routes
from tune.api.routes import llm_configs as llm_config_routes
from tune.api.ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    # Open Procrastinate app so tasks can be deferred.
    import psycopg_pool
    from tune.core.config import get_config
    from tune.workers.app import app as proc_app

    cfg = get_config()
    conninfo = cfg.database_url.replace("postgresql+psycopg://", "postgresql://")
    pool = psycopg_pool.AsyncConnectionPool(conninfo, open=False)
    await pool.open()
    async with proc_app.open_async(pool=pool):
        # W3: Mark any jobs that were 'running' when the server last died as 'interrupted'.
        try:
            from tune.core.database import get_session_factory
            from tune.core.models import AnalysisJob
            from sqlalchemy import update

            async with get_session_factory()() as session:
                await session.execute(
                    update(AnalysisJob)
                    .where(AnalysisJob.status.in_([
                        "running",
                        "waiting_for_authorization",
                        "waiting_for_repair",
                        "preparing_environment",
                    ]))
                    .values(status="interrupted")
                )
                await session.commit()
        except Exception:
            pass  # DB may not be available on a fresh install before migrations

        # Apply GlobalMemory seed entries (idempotent upsert)
        try:
            from tune.core.database import get_session_factory
            from tune.core.memory.seeds import apply_memory_seeds

            async with get_session_factory()() as session:
                await apply_memory_seeds(session)
        except Exception:
            pass  # Seeds are best-effort; don't block startup

        # Mark stale metadata proposals as failed
        try:
            from tune.api.routes.metadata_assistant import cleanup_stale_proposals
            await cleanup_stale_proposals()
        except Exception:
            pass

        # Start Procrastinate worker in the background (same event loop as FastAPI)
        worker_task = asyncio.create_task(
            proc_app.run_worker_async(
                queues=["scan", "analysis"],
                install_signal_handlers=False,
            )
        )

        # Start the resume-pending-jobs poller (pipeline-v2)
        resume_task = asyncio.create_task(_resume_pending_jobs_loop())

        # Start watchdog
        from tune.core.scanner.watchdog import start_watchdog
        from tune.core.runtime.watchdog import start_runtime_watchdog
        await start_watchdog()
        await start_runtime_watchdog()

        # Trigger initial full scan so pre-existing files are discovered
        from tune.workers.tasks import full_scan_task
        await full_scan_task.defer_async(data_dir=str(cfg.data_dir))

        yield

        from tune.core.scanner.watchdog import stop_watchdog
        from tune.core.runtime.watchdog import stop_runtime_watchdog
        await stop_watchdog()
        await stop_runtime_watchdog()
        resume_task.cancel()
        try:
            await resume_task
        except asyncio.CancelledError:
            pass
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
    await pool.close()


async def _resume_pending_jobs_loop() -> None:
    """Poll every 2 s for jobs whose blocking request has been resolved, then re-queue them.

    This is the DB-side recovery path (pipeline-v2). In the common case the
    asyncio.Event in ws.py fires immediately; this poller catches the cases
    where the event was missed (page refresh, process restart, timeout).
    """
    import asyncio
    from datetime import datetime, timezone

    from sqlalchemy import select

    from tune.core.database import get_session_factory
    from tune.core.models import AnalysisJob, CommandAuthorizationRequest, RepairRequest

    while True:
        await asyncio.sleep(2)
        try:
            async with get_session_factory()() as session:
                # Jobs waiting for authorization where the request has been resolved
                auth_jobs = (await session.execute(
                    select(AnalysisJob.id)
                    .join(
                        CommandAuthorizationRequest,
                        CommandAuthorizationRequest.id == AnalysisJob.pending_auth_request_id,
                    )
                    .where(
                        AnalysisJob.pending_auth_request_id.is_not(None),
                        AnalysisJob.status.in_(["waiting_for_authorization", "interrupted", "running"]),
                        CommandAuthorizationRequest.status.in_(["approved", "rejected"]),
                    )
                )).scalars().all()

                # Jobs waiting for repair where the request has been resolved
                repair_jobs = (await session.execute(
                    select(AnalysisJob.id)
                    .join(
                        RepairRequest,
                        RepairRequest.id == AnalysisJob.pending_repair_request_id,
                    )
                    .where(
                        AnalysisJob.pending_repair_request_id.is_not(None),
                        AnalysisJob.status.in_(["waiting_for_repair", "interrupted", "running"]),
                        RepairRequest.status == "resolved",
                    )
                )).scalars().all()

            for job_id in set(list(auth_jobs) + list(repair_jobs)):
                try:
                    from tune.workers.tasks import resume_job_task
                    await resume_job_task.defer_async(job_id=job_id)
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception(
                        "resume_pending_jobs: failed to defer resume for job %s", job_id
                    )
        except asyncio.CancelledError:
            break
        except Exception:
            import logging
            logging.getLogger(__name__).exception("resume_pending_jobs_loop error")


app = FastAPI(title="Tune", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(config_routes.router, prefix="/api/config", tags=["config"])
app.include_router(fs_routes.router, prefix="/api/fs", tags=["fs"])
app.include_router(llm_routes.router, prefix="/api/llm", tags=["llm"])
app.include_router(file_routes.router, prefix="/api/files", tags=["files"])
app.include_router(metadata_routes.router, prefix="/api/metadata", tags=["metadata"])
app.include_router(project_routes.router, prefix="/api/projects", tags=["projects"])
app.include_router(sample_routes.router, prefix="/api/samples", tags=["samples"])
app.include_router(experiment_routes.router, prefix="/api/experiments", tags=["experiments"])
app.include_router(file_run_routes.router, prefix="/api/file-runs", tags=["file-runs"])
app.include_router(known_path_routes.router, prefix="/api/known-paths", tags=["known-paths"])
app.include_router(job_routes.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(skill_routes.router, prefix="/api/skills", tags=["skills"])
app.include_router(thread_routes.router, prefix="/api/threads", tags=["threads"])
app.include_router(llm_config_routes.router, prefix="/api/llm-configs", tags=["llm-configs"])
app.include_router(health_routes.router, prefix="/api/system/health", tags=["health"])
app.include_router(profile_routes.router, prefix="/api/profile", tags=["profile"])
app.include_router(metadata_assistant_routes.router, prefix="/api/metadata-assistant", tags=["metadata-assistant"])
app.include_router(ws_router)

# W2: Correct path — built React bundle lives at tune/frontend/ inside the package.
# Path(__file__) = tune/api/app.py  →  parent.parent = tune/  →  tune/frontend/
_frontend_dir = Path(__file__).parent.parent / "frontend"
if _frontend_dir.exists() and any(_frontend_dir.iterdir()):
    app.mount("/", StaticFiles(directory=str(_frontend_dir), html=True), name="frontend")
