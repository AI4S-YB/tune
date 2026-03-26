"""System health check endpoint."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("")
async def system_health():
    """Return structured readiness flags for progressive onboarding."""
    from tune.core.database import get_session_factory
    from tune.core.models import File, Project, UserProfile
    from sqlalchemy import select, func as sqlfunc

    result = {
        "llm_reachable": False,
        "llm_error": None,
        "data_scanned": False,
        "projects_exist": False,
        "files_assigned": False,
        "user_profile_initialized": False,
    }

    # LLM reachability probe
    try:
        from tune.core.llm.gateway import GatewayNotConfiguredError, LLMMessage, get_gateway
        gw = get_gateway()
        resp = await gw.chat(
            messages=[LLMMessage("user", "ping")],
            system="Reply with exactly one word: pong",
        )
        result["llm_reachable"] = bool(resp.content)
    except GatewayNotConfiguredError as e:
        result["llm_error"] = str(e)
    except Exception as e:
        result["llm_error"] = str(e)

    # Database checks
    try:
        async with get_session_factory()() as session:
            file_count = (await session.execute(select(sqlfunc.count(File.id)))).scalar_one()
            project_count = (await session.execute(select(sqlfunc.count(Project.id)))).scalar_one()
            assigned_count = (
                await session.execute(
                    select(sqlfunc.count(File.id)).where(File.project_id.isnot(None))
                )
            ).scalar_one()
            profile_count = (await session.execute(select(sqlfunc.count(UserProfile.id)))).scalar_one()

        result["data_scanned"] = file_count > 0
        result["projects_exist"] = project_count > 0
        result["files_assigned"] = assigned_count > 0
        result["user_profile_initialized"] = profile_count > 0
    except Exception:
        pass  # DB not reachable — leave as False

    return result
