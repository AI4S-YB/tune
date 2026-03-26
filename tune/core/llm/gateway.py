"""LLM Gateway — abstract interface, provider adapters, active-config routing."""
from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any, Optional

from tune.core.config import ApiConfig


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class GatewayNotConfiguredError(RuntimeError):
    """Raised when get_gateway() is called but no active LLM config is set."""


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------


class LLMMessage:
    def __init__(self, role: str, content: str):
        self.role = role
        self.content = content


class LLMResponse:
    def __init__(
        self,
        content: str,
        input_tokens: Optional[int] = None,
        output_tokens: Optional[int] = None,
    ):
        self.content = content
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class LLMGateway(ABC):
    """Abstract interface for all LLM providers."""

    @abstractmethod
    async def chat(self, messages: list[LLMMessage], system: str = "") -> LLMResponse:
        """Single-turn or multi-turn chat completion."""

    @abstractmethod
    async def stream(
        self, messages: list[LLMMessage], system: str = ""
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion — yields token strings."""

    @abstractmethod
    async def structured_output(
        self, messages: list[LLMMessage], schema: dict[str, Any], system: str = ""
    ) -> dict[str, Any]:
        """Return structured JSON output matching the given JSON schema."""

    @property
    @abstractmethod
    def provider_name(self) -> str: ...

    @property
    @abstractmethod
    def model_name(self) -> str: ...


# ---------------------------------------------------------------------------
# Anthropic adapter
# ---------------------------------------------------------------------------


class AnthropicGateway(LLMGateway):
    def __init__(self, cfg: ApiConfig):
        import anthropic
        self._client = anthropic.AsyncAnthropic(api_key=cfg.api_key)
        self._model = cfg.model_name
        self._timeout = cfg.timeout
        self._cfg = cfg

    @property
    def provider_name(self) -> str:
        return "anthropic"

    @property
    def model_name(self) -> str:
        return self._model

    async def chat(self, messages: list[LLMMessage], system: str = "") -> LLMResponse:
        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=4096,
            system=system or "You are a helpful bioinformatics assistant.",
            messages=[{"role": m.role, "content": m.content} for m in messages],
        )
        await self._log(True, None)
        return LLMResponse(
            content=resp.content[0].text,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )

    async def stream(
        self, messages: list[LLMMessage], system: str = ""
    ) -> AsyncGenerator[str, None]:
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=4096,
            system=system or "You are a helpful bioinformatics assistant.",
            messages=[{"role": m.role, "content": m.content} for m in messages],
        ) as stream:
            async for text in stream.text_stream:
                yield text

    async def structured_output(
        self, messages: list[LLMMessage], schema: dict[str, Any], system: str = ""
    ) -> dict[str, Any]:
        for attempt in range(3):
            try:
                schema_str = json.dumps(schema, indent=2)
                sys_prompt = (
                    f"{system}\n\nRespond ONLY with valid JSON matching this schema:\n{schema_str}"
                )
                resp = await self.chat(messages, system=sys_prompt)
                return json.loads(resp.content)
            except json.JSONDecodeError:
                if attempt == 2:
                    raise
                messages = messages + [
                    LLMMessage("assistant", ""),
                    LLMMessage("user", "Your response was not valid JSON. Please respond with valid JSON only."),
                ]
        raise RuntimeError("Failed to get valid structured output after 3 attempts")

    async def _log(self, success: bool, err: Optional[str], latency: Optional[float] = None):
        try:
            from tune.core.database import get_session_factory
            from tune.core.models import LLMLog
            async with get_session_factory()() as session:
                log = LLMLog(
                    provider=self.provider_name,
                    model=self.model_name,
                    latency_ms=int(latency * 1000) if latency else None,
                    success=success,
                    error_type=err,
                )
                session.add(log)
                await session.commit()
        except Exception:
            pass  # Logging must never crash the main flow


# ---------------------------------------------------------------------------
# OpenAI-compatible adapter
# ---------------------------------------------------------------------------


class OpenAIGateway(LLMGateway):
    def __init__(self, cfg: ApiConfig):
        from openai import AsyncOpenAI
        # Inject extra_headers via httpx default_headers
        default_headers = dict(cfg.extra_headers) if cfg.extra_headers else {}
        self._client = AsyncOpenAI(
            api_key=cfg.api_key,
            base_url=cfg.base_url,
            timeout=cfg.timeout,
            default_headers=default_headers or None,
        )
        self._model = cfg.model_name
        self._extra_params = dict(cfg.extra_params) if cfg.extra_params else {}
        self._cfg = cfg

    @property
    def provider_name(self) -> str:
        return self._cfg.provider

    @property
    def model_name(self) -> str:
        return self._model

    async def chat(self, messages: list[LLMMessage], system: str = "") -> LLMResponse:
        all_msgs = []
        if system:
            all_msgs.append({"role": "system", "content": system})
        all_msgs += [{"role": m.role, "content": m.content} for m in messages]
        resp = await self._client.chat.completions.create(
            model=self._model, messages=all_msgs, **self._extra_params
        )
        usage = resp.usage
        return LLMResponse(
            content=resp.choices[0].message.content or "",
            input_tokens=usage.prompt_tokens if usage else None,
            output_tokens=usage.completion_tokens if usage else None,
        )

    async def stream(
        self, messages: list[LLMMessage], system: str = ""
    ) -> AsyncGenerator[str, None]:
        all_msgs = []
        if system:
            all_msgs.append({"role": "system", "content": system})
        all_msgs += [{"role": m.role, "content": m.content} for m in messages]
        async with await self._client.chat.completions.create(
            model=self._model, messages=all_msgs, stream=True, **self._extra_params
        ) as stream:
            async for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta

    async def structured_output(
        self, messages: list[LLMMessage], schema: dict[str, Any], system: str = ""
    ) -> dict[str, Any]:
        for attempt in range(3):
            try:
                schema_str = json.dumps(schema, indent=2)
                sys_prompt = (
                    f"{system}\n\nRespond ONLY with valid JSON matching this schema:\n{schema_str}"
                )
                resp = await self.chat(messages, system=sys_prompt)
                return json.loads(resp.content)
            except json.JSONDecodeError:
                if attempt == 2:
                    raise
                messages = messages + [
                    LLMMessage("assistant", ""),
                    LLMMessage("user", "Your response was not valid JSON. Please respond with valid JSON only."),
                ]
        raise RuntimeError("Failed to get valid structured output after 3 attempts")


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_gateway(cfg: ApiConfig) -> LLMGateway:
    """Build an LLMGateway from a single ApiConfig."""
    if cfg.api_style == "anthropic":
        return AnthropicGateway(cfg)
    elif cfg.api_style in ("openai", "openai_compatible"):
        return OpenAIGateway(cfg)
    else:
        # Fallback: treat unknown styles as openai_compatible
        return OpenAIGateway(cfg)


# Keep old name as alias for any code still calling make_gateway(LLMProviderConfig-like)
def make_gateway(cfg) -> LLMGateway:
    """Backwards-compatible alias for build_gateway."""
    return build_gateway(cfg)


# ---------------------------------------------------------------------------
# Singleton accessor
# ---------------------------------------------------------------------------

_gateway: Optional[LLMGateway] = None


def get_gateway() -> LLMGateway:
    global _gateway
    if _gateway is None:
        from tune.core.config import get_config
        cfg = get_config()
        active = cfg.active_llm
        if active is None:
            raise GatewayNotConfiguredError(
                "No active LLM configuration. Add a config and set it as active in Settings."
            )
        _gateway = build_gateway(active)
    return _gateway


def reset_gateway() -> None:
    """Reset the gateway singleton so next call to get_gateway() uses updated config."""
    global _gateway
    _gateway = None
