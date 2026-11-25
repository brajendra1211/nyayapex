"""Single gateway to Claude. Every token-saving rule lives here:

1. Local answer cache   - same model+prompt => served from DB, 0 tokens.
2. Prompt caching       - stable system prompt is marked cache_control; repeat reads cost ~10%.
3. Model tiers          - BULK (Haiku) for per-chunk extraction, SMART (Opus) for reasoning/drafting.
4. Effort control       - low effort for simple jobs = fewer thinking tokens.
5. JSON schema output   - short, structured answers; no prose padding.
6. Batch API            - non-urgent bulk work at 50% price.
7. Usage log            - every call's tokens & cost recorded for the AI Usage panel.

Privacy: phone numbers, e-mails, Aadhaar and PAN are masked before a request leaves the server and restored in the
answer locally (services/pii.py; SC AI Regs 2026 Reg 10 / 48).
"""

import hashlib
import json
import threading
import time
from typing import Any

import anthropic
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..config import settings
from ..models import LlmCache, UsageLog
from . import pii, ratelimit

_client: anthropic.Anthropic | None = None
_last = threading.local()  # details of this thread's latest ask(), for the AI output register


def last_call() -> dict:
    """{model, cached, pii_masked} of the most recent ask() on this thread."""
    return getattr(_last, "info", {"model": "", "cached": False, "pii_masked": 0})

# Server-side refusal fallback is supported on Opus 5.5 / Sonnet 5.5 (not Haiku, not Batch).
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"

ETHICS_PREAMBLE = (
    "You assist Supreme Court of India advocates. You are a co-counsel, not a decision-maker. "
    "Rely only on the material provided in the request. Never invent a case name, citation, date, "
    "page number or statutory provision; if the material does not support an answer, say so plainly. "
    "Cite the page references given as [p.N] for every factual statement. Be concise."
)


def client() -> anthropic.Anthropic:
    global _client
    if not settings.ai_enabled:
        raise HTTPException(503, "AI is not configured: set ANTHROPIC_API_KEY in backend/.env")
    if _client is None:
        headers = {"anthropic-workspace-id": settings.anthropic_workspace_id} if settings.anthropic_workspace_id else None
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, max_retries=3, default_headers=headers)
    return _client


def strict_schema(schema: dict) -> dict:
    """Structured outputs need additionalProperties:false + required on every object."""
    if schema.get("type") == "object":
        schema.setdefault("additionalProperties", False)
        schema.setdefault("required", list(schema.get("properties", {})))
        for v in schema.get("properties", {}).values():
            strict_schema(v)
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        strict_schema(schema["items"])
    return schema


def _cost(model: str, u: Any, batch: bool = False) -> float:
    pin, pout = settings.prices.get(model, (4.0, 20.0))
    cost = (
        (u.input_tokens or 0) * pin
        + (getattr(u, "cache_creation_input_tokens", 0) or 0) * pin * 1.25
        + (getattr(u, "cache_read_input_tokens", 0) or 0) * pin * 0.10
        + (u.output_tokens or 0) * pout
    ) / 1_000_000
    return cost * (0.5 if batch else 1.0)


def _log(db: Session, feature: str, model: str, usage: Any = None, cached_locally: bool = False, batch: bool = False,
         workspace_id: int | None = None):
    db.add(
        UsageLog(
            workspace_id=workspace_id,
            feature=feature,
            model=model,
            input_tokens=getattr(usage, "input_tokens", 0) or 0,
            output_tokens=getattr(usage, "output_tokens", 0) or 0,
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
            cost_usd=_cost(model, usage, batch) if usage else 0.0,
            cached_locally=int(cached_locally),
        )
    )
    db.commit()


def build_params(*, model: str, system: str, user: str, max_tokens: int, effort: str, schema: dict | None,
                 think: bool = True) -> dict:
    params: dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens,
        # Stable prefix first, cached. Never put timestamps/IDs in here - it would break the cache.
        "system": [
            {"type": "text", "text": ETHICS_PREAMBLE + "\n\n" + system, "cache_control": {"type": "ephemeral"}}
        ],
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": effort},
    }
    if not think:  # speed-critical calls: no thinking, so the whole budget goes to the answer
        params["thinking"] = {"type": "disabled"}
    if schema:
        params["output_config"]["format"] = {"type": "json_schema", "schema": strict_schema(schema)}
    return params


def _text(message: Any) -> str:
    return "".join(b.text for b in message.content if b.type == "text")


def ask(
    db: Session,
    *,
    feature: str,
    system: str,
    user: str,
    smart: bool = False,
    effort: str = "low",
    max_tokens: int = 4000,
    schema: dict | None = None,
    use_cache: bool = True,
    workspace_id: int | None = None,
    model: str | None = None,
    think: bool = True,
) -> Any:
    """Call Claude once. Returns parsed JSON when `schema` is given, else text.

    `model` overrides the bulk/smart choice (e.g. a cheaper model for deep research)."""
    model = model or (settings.model_smart if smart else settings.model_bulk)
    mapping: dict[str, str] = {}
    if settings.ai_mask_pii:
        user, mapping = pii.mask(user)
    _last.info = {"model": model, "cached": False, "pii_masked": len(mapping)}
    params = build_params(model=model, system=system, user=user, max_tokens=max_tokens, effort=effort, schema=schema,
                          think=think)

    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    if use_cache and (hit := db.get(LlmCache, key)):
        _log(db, feature, model, cached_locally=True, workspace_id=workspace_id)
        _last.info["cached"] = True
        return pii.unmask(json.loads(hit.response) if schema else hit.response, mapping)

    if workspace_id is not None:  # cache hits above are free and not counted
        ratelimit.hit(f"ai-ws:{workspace_id}", settings.ai_calls_per_hour, 3600,
                      "This account has reached its hourly AI limit. Try again later, or ask the admin to raise AI_CALLS_PER_HOUR.")
    try:
        if model in FALLBACK_MODELS:
            message = client().beta.messages.create(betas=[FALLBACK_BETA], fallbacks="default", **params)
        else:
            message = client().messages.create(**params)
    except anthropic.RateLimitError:
        raise HTTPException(429, "Claude rate limit reached - retry in a minute.")
    except anthropic.AuthenticationError:
        raise HTTPException(503, "Invalid ANTHROPIC_API_KEY.")
    except anthropic.BadRequestError as e:
        if "workspace" in str(e.message).lower():
            raise HTTPException(503, "This API key is not scoped to a workspace: set ANTHROPIC_WORKSPACE_ID in backend/.env "
                                     "(Console -> Settings -> Workspaces), or create a key inside a workspace.")
        raise HTTPException(502, f"Claude API error: {e.message}")
    except anthropic.APIStatusError as e:
        raise HTTPException(502, f"Claude API error: {e.message}")
    except anthropic.APIConnectionError:
        raise HTTPException(502, "Could not reach Claude API.")

    _log(db, feature, model, message.usage, workspace_id=workspace_id)
    if message.stop_reason == "refusal":
        raise HTTPException(422, "The AI declined this request.")
    if message.stop_reason == "max_tokens":
        raise HTTPException(502, "AI answer was cut off (max_tokens). Try a narrower request.")

    text = _text(message)
    db.merge(LlmCache(key=key, response=text))  # cached masked; un-masked per request
    db.commit()
    return pii.unmask(json.loads(text) if schema else text, mapping)


def run_batch(db: Session, *, feature: str, items: list[tuple[str, dict]], poll_seconds: int = 30,
              workspace_id: int | None = None) -> dict[str, Any]:
    """Submit many BULK requests at 50% price; blocks (in a background worker) until done.

    items: [(custom_id, params_from_build_params), ...]. Returns {custom_id: parsed_json_or_text}.
    """
    maps: dict[str, dict[str, str]] = {}
    if settings.ai_mask_pii:
        for cid, p in items:
            p["messages"][0]["content"], maps[cid] = pii.mask(p["messages"][0]["content"])
    batch = client().messages.batches.create(requests=[{"custom_id": cid, "params": p} for cid, p in items])
    while (batch := client().messages.batches.retrieve(batch.id)).processing_status != "ended":
        time.sleep(poll_seconds)

    out: dict[str, Any] = {}
    for r in client().messages.batches.results(batch.id):
        if r.result.type != "succeeded":
            continue
        msg = r.result.message
        _log(db, feature, msg.model, msg.usage, batch=True, workspace_id=workspace_id)
        text = _text(msg)
        try:
            out[r.custom_id] = pii.unmask(json.loads(text), maps.get(r.custom_id, {}))
        except json.JSONDecodeError:
            out[r.custom_id] = pii.unmask(text, maps.get(r.custom_id, {}))
    return out
