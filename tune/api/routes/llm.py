"""LLM status API route."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/status")
async def llm_status():
    from tune.core.config import get_config
    cfg = get_config()
    active = cfg.active_llm

    if not active:
        return {"active": None, "status": "not_configured"}

    async def probe(api_cfg):
        from tune.core.llm.gateway import LLMMessage, build_gateway
        try:
            g = build_gateway(api_cfg)
            await g.chat([LLMMessage("user", "ping")])
            return "reachable"
        except Exception as e:
            return f"unreachable: {e}"

    status = await probe(active)

    return {
        "active": {
            "id": active.id,
            "name": active.name,
            "provider": active.provider,
            "model_name": active.model_name,
            "status": status,
        },
    }
