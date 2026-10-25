"""AI provider abstraction (Anthropic or OpenAI), called only from the backend.

`complete_json` sends a system + user prompt with a JSON schema and returns a
parsed dict. It enforces the user's daily request / spend limits, records usage
(without prompt content or secrets) and maps provider errors to `AIError`
with a user-readable message.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import config
from ..models import ApiUsage, UserSettings, utcnow

log = logging.getLogger("celpip.ai")

# USD per 1M tokens (input, output). Used only for local usage estimates.
PRICING = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-haiku-4-5": (1.0, 5.0),
    # Gemini "latest" aliases move over time; these are approximate published rates.
    "gemini-pro-latest": (1.25, 10.0),
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-flash-latest": (0.30, 2.50),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-flash-lite-latest": (0.10, 0.40),
}
DEFAULT_PRICE = (5.0, 25.0)

ANTHROPIC_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
OPENAI_MODELS = ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"]
GEMINI_MODELS = ["gemini-pro-latest", "gemini-flash-latest", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-flash-lite-latest"]
PROVIDERS = ("anthropic", "openai", "gemini")
DEFAULT_MODEL = {"anthropic": ANTHROPIC_MODELS[0], "openai": OPENAI_MODELS[0], "gemini": GEMINI_MODELS[0]}
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
# Models that accept the server-side refusal fallback parameter.
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


class AIError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass
class AIResult:
    data: dict
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def estimate_cost(model: str, inp: int, out: int) -> float:
    pi, po = PRICING.get(model, DEFAULT_PRICE)
    return round(inp / 1e6 * pi + out / 1e6 * po, 5)


def key_name(provider: str) -> str:
    return {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}.get(provider, "ANTHROPIC_API_KEY")


PROVIDER_LABEL = {"anthropic": "Anthropic", "openai": "OpenAI", "gemini": "Google Gemini"}


def route_target(s: UserSettings, route: str) -> tuple[str, str]:
    """`practice` → the main provider/model; `mock` → the mock-exam provider/model."""
    if route == "mock":
        return s.mock_ai_provider or s.ai_provider, s.mock_ai_model or s.ai_model
    return s.ai_provider, s.ai_model


def provider_key(provider: str) -> str | None:
    return config.get_secret(key_name(provider))


def usage_today(db: Session) -> tuple[int, float]:
    start = datetime.combine(utcnow().date(), datetime.min.time())
    row = db.execute(
        select(func.count(ApiUsage.id), func.coalesce(func.sum(ApiUsage.cost_estimate_usd), 0.0)).where(
            ApiUsage.created_at >= start
        )
    ).one()
    return int(row[0]), float(row[1])


def _record(db: Session, provider, model, purpose, success, error_type=None, inp=0, out=0, latency=None):
    db.add(
        ApiUsage(
            provider=provider,
            model=model,
            purpose=purpose,
            success=success,
            error_type=error_type,
            input_tokens=inp,
            output_tokens=out,
            cost_estimate_usd=estimate_cost(model, inp, out),
            latency_ms=latency,
        )
    )
    db.commit()


def check_limits(db: Session, s: UserSettings) -> None:
    count, spend = usage_today(db)
    if s.daily_request_limit and count >= s.daily_request_limit:
        raise AIError("limit_requests", f"Daily AI request limit reached ({s.daily_request_limit}). Change it in Settings.")
    if s.daily_spend_limit_usd and spend >= s.daily_spend_limit_usd:
        raise AIError(
            "limit_spend",
            f"Estimated daily AI spend limit reached (${s.daily_spend_limit_usd:.2f}). Change it in Settings.",
        )


def complete_json(
    db: Session,
    s: UserSettings,
    *,
    system: str,
    user: str,
    schema: dict,
    purpose: str,
    max_tokens: int | None = None,
    route: str = "practice",
) -> AIResult:
    provider, model = route_target(s, route)
    key = provider_key(provider)
    if not key:
        where = "the mock-exam provider" if route == "mock" else "practice"
        raise AIError(
            "no_key",
            f"No {PROVIDER_LABEL.get(provider, provider)} API key is configured (used for {where}). Add one in Settings → AI.",
        )
    check_limits(db, s)
    max_tokens = max_tokens or s.ai_max_output_tokens
    t0 = time.monotonic()
    try:
        if provider == "openai":
            text, inp, out = _openai_call(key, s, model, system, user, schema, max_tokens)
        elif provider == "gemini":
            text, inp, out = _gemini_call(key, s, model, system, user, schema, max_tokens)
        else:
            text, inp, out = _anthropic_call(key, s, model, system, user, schema, max_tokens)
    except AIError as e:
        _record(db, provider, model, purpose, False, e.code, latency=int((time.monotonic() - t0) * 1000))
        log.warning("AI call failed purpose=%s code=%s", purpose, e.code)
        raise
    latency = int((time.monotonic() - t0) * 1000)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        _record(db, provider, model, purpose, False, "invalid_json", inp, out, latency)
        raise AIError("invalid_output", "The AI returned output that was not valid JSON. Please try again.", True)
    _record(db, provider, model, purpose, True, None, inp, out, latency)
    log.info("AI call ok purpose=%s model=%s in=%s out=%s ms=%s", purpose, model, inp, out, latency)
    return AIResult(data, provider, model, inp, out, estimate_cost(model, inp, out))


def _anthropic_call(key, s, model, system, user, schema, max_tokens):
    import anthropic

    client = anthropic.Anthropic(api_key=key, timeout=float(s.ai_timeout_seconds), max_retries=2)
    params = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": schema}, "effort": s.ai_effort},
    )
    use_fallback = s.ai_refusal_fallback and model in FALLBACK_MODELS
    try:
        try:
            if use_fallback:
                resp = client.beta.messages.create(
                    **params, betas=["server-side-fallback-2026-07-01"], fallbacks="default"
                )
            else:
                resp = client.messages.create(**params)
        except anthropic.BadRequestError as e:
            # Retry once without the optional fallback parameter / effort if the model rejects them.
            msg = str(getattr(e, "message", e)).lower()
            if use_fallback and "fallback" in msg:
                resp = client.messages.create(**params)
            elif "effort" in msg:
                params["output_config"] = {"format": params["output_config"]["format"]}
                resp = client.messages.create(**params)
            else:
                raise
    except anthropic.AuthenticationError:
        raise AIError("auth", "The Anthropic API key was rejected. Check it in Settings → AI.")
    except anthropic.PermissionDeniedError:
        raise AIError("permission", "The API key does not have permission to use this model.")
    except anthropic.NotFoundError:
        raise AIError("model", f"Model '{model}' was not found. Choose another model in Settings → AI.")
    except anthropic.RateLimitError:
        raise AIError("rate_limit", "The AI provider is rate-limiting requests. Wait a minute and try again.", True)
    except anthropic.APITimeoutError:
        raise AIError("timeout", "The AI request timed out. Try again, or raise the timeout in Settings.", True)
    except anthropic.APIConnectionError:
        raise AIError("network", "Could not reach the AI provider. Check your internet connection.", True)
    except anthropic.BadRequestError as e:
        raise AIError("bad_request", f"The AI provider rejected the request: {getattr(e, 'message', e)}")
    except anthropic.APIStatusError as e:
        raise AIError("server", f"The AI provider returned an error ({e.status_code}). Try again later.", True)

    if resp.stop_reason == "refusal":
        raise AIError("refusal", "The AI declined to evaluate this content.")
    if resp.stop_reason == "max_tokens":
        raise AIError("truncated", "The AI response was cut off. Increase 'max output tokens' in Settings.", True)
    text = next((b.text for b in resp.content if getattr(b, "type", None) == "text"), None)
    usage = resp.usage
    return text, int(usage.input_tokens or 0), int(usage.output_tokens or 0)


def _openai_call(key, s, model, system, user, schema, max_tokens):
    import openai

    client = openai.OpenAI(api_key=key, timeout=float(s.ai_timeout_seconds), max_retries=2)
    try:
        resp = client.chat.completions.create(
            model=model,
            max_completion_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "result", "schema": schema, "strict": True},
            },
        )
    except openai.AuthenticationError:
        raise AIError("auth", "The OpenAI API key was rejected. Check it in Settings → AI.")
    except openai.NotFoundError:
        raise AIError("model", f"Model '{model}' was not found. Choose another model in Settings → AI.")
    except openai.RateLimitError:
        raise AIError("rate_limit", "The AI provider is rate-limiting requests (or quota is exhausted).", True)
    except openai.APITimeoutError:
        raise AIError("timeout", "The AI request timed out. Try again.", True)
    except openai.APIConnectionError:
        raise AIError("network", "Could not reach the AI provider. Check your internet connection.", True)
    except openai.BadRequestError as e:
        raise AIError("bad_request", f"The AI provider rejected the request: {e}")
    except openai.APIStatusError as e:
        raise AIError("server", f"The AI provider returned an error ({e.status_code}).", True)
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise AIError("truncated", "The AI response was cut off. Increase 'max output tokens' in Settings.", True)
    if getattr(choice.message, "refusal", None):
        raise AIError("refusal", "The AI declined to evaluate this content.")
    u = resp.usage
    return choice.message.content, int(u.prompt_tokens or 0), int(u.completion_tokens or 0)


def _gemini_error(r) -> AIError:
    try:
        msg = r.json().get("error", {}).get("message", "")[:200]
    except ValueError:
        msg = ""
    if r.status_code in (401, 403) or "API key" in msg:
        return AIError("auth", "The Gemini API key was rejected. Check it in Settings → AI.")
    if r.status_code == 404:
        return AIError("model", f"Gemini model not found ({msg}). Choose another model in Settings → AI.")
    if r.status_code == 429:
        try:
            details = r.json().get("error", {}).get("details", [])
        except ValueError:
            details = []
        per_day = any("PerDay" in v.get("quotaId", "") for d in details for v in d.get("violations", []))
        if per_day:
            delay = next((d.get("retryDelay") for d in details if d.get("retryDelay")), "")
            hours = round(int(delay.rstrip("s")) / 3600, 1) if delay.rstrip("s").isdigit() else None
            when = f" It resets in about {hours} hours." if hours else ""
            return AIError("quota_daily", f"The daily Gemini quota for this model is used up.{when} You can raise it in Google AI Studio.")
        return AIError("rate_limit", "Gemini is rate-limiting requests. Try again shortly.", True)
    if r.status_code == 400:
        return AIError("bad_request", f"Gemini rejected the request: {msg}")
    return AIError("server", f"Gemini returned an error ({r.status_code}). Try again later.", True)


def _gemini_post(key: str, model: str, body: dict, timeout: float):
    import httpx

    try:
        return httpx.post(GEMINI_URL.format(model=model), headers={"x-goog-api-key": key}, json=body, timeout=timeout)
    except httpx.TimeoutException:
        raise AIError("timeout", "The Gemini request timed out. Try again, or raise the timeout in Settings.", True)
    except httpx.HTTPError:
        raise AIError("network", "Could not reach Gemini. Check your internet connection.", True)


def _gemini_call(key, s, model, system, user, schema, max_tokens):
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
            "maxOutputTokens": max_tokens,
        },
    }
    r = _gemini_post(key, model, body, float(s.ai_timeout_seconds))
    if r.status_code != 200:
        raise _gemini_error(r)
    d = r.json()
    if d.get("promptFeedback", {}).get("blockReason"):
        raise AIError("refusal", "Gemini declined to process this content.")
    cands = d.get("candidates") or []
    if not cands:
        raise AIError("invalid_output", "Gemini returned no answer. Please try again.", True)
    c = cands[0]
    reason = c.get("finishReason")
    if reason == "MAX_TOKENS":
        raise AIError("truncated", "The AI response was cut off. Increase 'max output tokens' in Settings.", True)
    if reason in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "RECITATION"):
        raise AIError("refusal", "Gemini declined to evaluate this content.")
    text = "".join(p.get("text", "") for p in c.get("content", {}).get("parts", []) if not p.get("thought"))
    u = d.get("usageMetadata", {})
    out = int(u.get("candidatesTokenCount") or 0) + int(u.get("thoughtsTokenCount") or 0)  # thinking is billed as output
    return text, int(u.get("promptTokenCount") or 0), out


def test_connection(db: Session, s: UserSettings, route: str = "practice") -> dict:
    schema = {
        "type": "object",
        "properties": {"status": {"type": "string"}},
        "required": ["status"],
        "additionalProperties": False,
    }
    try:
        r = complete_json(
            db,
            s,
            system="You are a connectivity check.",
            user='Reply with {"status": "ok"}.',
            schema=schema,
            purpose="connection_test",
            max_tokens=2000,
            route=route,
        )
        return {"ok": True, "route": route, "provider": r.provider, "model": r.model, "message": "Connected successfully."}
    except AIError as e:
        provider, model = route_target(s, route)
        return {"ok": False, "route": route, "provider": provider, "model": model, "code": e.code, "message": e.message}


AUDIO_MIME = {".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav"}


def transcription_provider() -> str | None:
    if config.get_secret("OPENAI_API_KEY"):
        return "openai"
    if config.get_secret("GEMINI_API_KEY"):
        return "gemini"
    return None


def transcribe_audio(path: str) -> tuple[str, str]:
    """Speech-to-text. Uses OpenAI when its key is set, otherwise Gemini. Returns (text, source)."""
    provider = transcription_provider()
    if provider == "openai":
        import openai

        client = openai.OpenAI(api_key=config.get_secret("OPENAI_API_KEY"), timeout=120.0, max_retries=1)
        try:
            with open(path, "rb") as f:
                r = client.audio.transcriptions.create(model="gpt-4o-mini-transcribe", file=f)
            return r.text, "openai"
        except openai.AuthenticationError:
            raise AIError("auth", "The OpenAI API key was rejected.")
        except openai.APIConnectionError:
            raise AIError("network", "Could not reach the transcription service.", True)
        except openai.APIStatusError as e:
            raise AIError("server", f"Transcription failed ({e.status_code}).", True)
    if provider == "gemini":
        import base64
        from pathlib import Path

        p = Path(path)
        body = {
            "contents": [{"role": "user", "parts": [
                {"text": "Transcribe this English speech verbatim. Keep fillers (um, uh), repetitions and self-corrections "
                         "exactly as spoken. Do not correct grammar. Output only the transcript."},
                {"inlineData": {"mimeType": AUDIO_MIME.get(p.suffix, "audio/webm"), "data": base64.b64encode(p.read_bytes()).decode()}},
            ]}],
            "generationConfig": {"maxOutputTokens": 4000},
        }
        r = _gemini_post(config.get_secret("GEMINI_API_KEY"), "gemini-flash-latest", body, 120.0)
        if r.status_code != 200:
            raise _gemini_error(r)
        cands = r.json().get("candidates") or []
        text = "".join(x.get("text", "") for x in (cands[0].get("content", {}).get("parts", []) if cands else []) if not x.get("thought"))
        if not text.strip():
            raise AIError("invalid_output", "Gemini returned an empty transcript.", True)
        return text.strip(), "gemini"
    raise AIError("no_key", "Transcription needs a Gemini or OpenAI API key (Settings → AI).")


def since(days: int) -> datetime:
    return utcnow() - timedelta(days=days)
