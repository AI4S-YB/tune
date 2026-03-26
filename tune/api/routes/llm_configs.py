"""CRUD API for LLM API configurations."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any, Optional

from tune.core.config import ApiConfig, get_config, save_config, set_config
from tune.core.llm.gateway import GatewayNotConfiguredError, LLMMessage, build_gateway, reset_gateway

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------


class ApiConfigCreate(BaseModel):
    name: str
    provider: str
    api_style: str
    base_url: Optional[str] = None
    model_name: str
    api_key: str
    enabled: bool = True
    timeout: int = 120
    max_retries: int = 2
    endpoint_path: Optional[str] = None
    extra_headers: dict[str, str] = {}
    extra_params: dict[str, Any] = {}
    remark: Optional[str] = None


class ApiConfigUpdate(BaseModel):
    name: Optional[str] = None
    provider: Optional[str] = None
    api_style: Optional[str] = None
    base_url: Optional[str] = None
    model_name: Optional[str] = None
    api_key: Optional[str] = None       # only applied when non-empty
    enabled: Optional[bool] = None
    timeout: Optional[int] = None
    max_retries: Optional[int] = None
    endpoint_path: Optional[str] = None
    extra_headers: Optional[dict[str, str]] = None
    extra_params: Optional[dict[str, Any]] = None
    remark: Optional[str] = None


class SetActiveRequest(BaseModel):
    config_id: str


class TestConfigRequest(BaseModel):
    name: str = ""
    provider: str
    api_style: str
    base_url: Optional[str] = None
    model_name: str
    api_key: str
    timeout: int = 30
    extra_headers: dict[str, str] = {}
    extra_params: dict[str, Any] = {}


def _mask(cfg: ApiConfig) -> dict:
    d = cfg.model_dump()
    d["api_key"] = "***" if cfg.api_key else ""
    return d


# ---------------------------------------------------------------------------
# Routes — literal paths MUST be declared before parametric /{config_id}
# ---------------------------------------------------------------------------


@router.get("/")
async def list_configs():
    cfg = get_config()
    return {
        "configs": [_mask(c) for c in cfg.llm_configs],
        "active_llm_config_id": cfg.active_llm_config_id,
    }


@router.post("/")
async def create_config(body: ApiConfigCreate):
    cfg = get_config()
    new_entry = ApiConfig.new(
        name=body.name,
        provider=body.provider,
        api_style=body.api_style,
        model_name=body.model_name,
        api_key=body.api_key,
        base_url=body.base_url,
        enabled=body.enabled,
        timeout=body.timeout,
        max_retries=body.max_retries,
        endpoint_path=body.endpoint_path,
        extra_headers=body.extra_headers,
        extra_params=body.extra_params,
        remark=body.remark,
    )
    cfg.llm_configs.append(new_entry)
    save_config(cfg)
    set_config(cfg)
    return {"ok": True, "config": _mask(new_entry)}


@router.post("/test")
async def test_unsaved_config(body: TestConfigRequest):
    """Test an unsaved config (form values only, nothing persisted)."""
    temp = ApiConfig(
        id="_test",
        name=body.name or "test",
        provider=body.provider,
        api_style=body.api_style,
        base_url=body.base_url,
        model_name=body.model_name,
        api_key=body.api_key,
        timeout=body.timeout,
        extra_headers=body.extra_headers,
        extra_params=body.extra_params,
    )
    try:
        gw = build_gateway(temp)
        resp = await gw.chat([LLMMessage("user", "Respond with the single word: ready")])
        return {"ok": True, "response": resp.content[:100]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.put("/active")
async def set_active_config(body: SetActiveRequest):
    cfg = get_config()
    ids = {c.id for c in cfg.llm_configs}
    if body.config_id not in ids:
        raise HTTPException(404, f"Config '{body.config_id}' not found")
    cfg.active_llm_config_id = body.config_id
    save_config(cfg)
    set_config(cfg)
    reset_gateway()
    return {"ok": True, "active_llm_config_id": body.config_id}


@router.get("/{config_id}")
async def get_config_entry(config_id: str):
    cfg = get_config()
    entry = next((c for c in cfg.llm_configs if c.id == config_id), None)
    if not entry:
        raise HTTPException(404, f"Config '{config_id}' not found")
    return _mask(entry)


@router.put("/{config_id}")
async def update_config_entry(config_id: str, body: ApiConfigUpdate):
    cfg = get_config()
    entry = next((c for c in cfg.llm_configs if c.id == config_id), None)
    if not entry:
        raise HTTPException(404, f"Config '{config_id}' not found")

    now = datetime.now(timezone.utc).isoformat()
    updates = body.model_dump(exclude_unset=True)

    # Never overwrite api_key with empty string
    if "api_key" in updates and not updates["api_key"]:
        del updates["api_key"]

    for k, v in updates.items():
        setattr(entry, k, v)
    entry.updated_at = now

    save_config(cfg)
    set_config(cfg)

    # Reset gateway only if this is the active config
    if cfg.active_llm_config_id == config_id:
        reset_gateway()

    return {"ok": True, "config": _mask(entry)}


@router.delete("/{config_id}")
async def delete_config_entry(config_id: str):
    cfg = get_config()
    before = len(cfg.llm_configs)
    cfg.llm_configs = [c for c in cfg.llm_configs if c.id != config_id]
    if len(cfg.llm_configs) == before:
        raise HTTPException(404, f"Config '{config_id}' not found")

    if cfg.active_llm_config_id == config_id:
        cfg.active_llm_config_id = None
        reset_gateway()

    save_config(cfg)
    set_config(cfg)
    return {"ok": True}


@router.post("/{config_id}/test")
async def test_saved_config(config_id: str):
    """Test a saved config by ID."""
    cfg = get_config()
    entry = next((c for c in cfg.llm_configs if c.id == config_id), None)
    if not entry:
        raise HTTPException(404, f"Config '{config_id}' not found")
    try:
        gw = build_gateway(entry)
        resp = await gw.chat([LLMMessage("user", "Respond with the single word: ready")])
        return {"ok": True, "response": resp.content[:100]}
    except Exception as e:
        return {"ok": False, "error": str(e)}
