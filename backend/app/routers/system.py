from __future__ import annotations

import platform
import sqlite3
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from .. import config
from ..db import get_db
from ..models import ApiUsage, OfficialScore, PracticeAttempt
from ..services import ai
from .common import get_or_404, get_settings, to_dict

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health():
    return {"ok": True, "app": config.APP_NAME, "version": config.APP_VERSION}


@router.get("/format")
def celpip_format():
    return {
        "components": fmt.COMPONENTS,
        "order": fmt.ORDER,
        "scoring_note": fmt.SCORING_NOTE,
        "checked_on": fmt.CHECKED_ON,
        "writing_criteria": fmt.WRITING_CRITERIA,
        "speaking_criteria": fmt.SPEAKING_CRITERIA,
        "mistake_categories": fmt.MISTAKE_CATEGORIES,
    }


def _settings_payload(db: Session) -> dict:
    s = get_settings(db)
    d = to_dict(s)
    d["keys"] = {
        p: {"configured": bool(ai.provider_key(p)), "masked": config.mask_secret(ai.provider_key(p))}
        for p in ai.PROVIDERS
    }
    d["available_models"] = {"anthropic": ai.ANTHROPIC_MODELS, "openai": ai.OPENAI_MODELS, "gemini": ai.GEMINI_MODELS}
    d["transcription_provider"] = ai.transcription_provider()
    d["transcription_available"] = d["transcription_provider"] is not None
    return d


@router.get("/settings")
def read_settings(db: Session = Depends(get_db)):
    return _settings_payload(db)


class SettingsIn(BaseModel):
    exam_date: date | None = None
    target_levels: dict[str, int] | None = None
    daily_module_count: int | None = Field(None, ge=1, le=4)
    daily_minutes: int | None = Field(None, ge=20, le=480)
    study_days: list[int] | None = None
    ai_provider: str | None = None
    ai_model: str | None = Field(None, max_length=80)
    mock_ai_provider: str | None = None
    mock_ai_model: str | None = Field(None, max_length=80)
    mock_model_for_speaking: bool | None = None
    ai_effort: str | None = None
    ai_max_output_tokens: int | None = Field(None, ge=2000, le=64000)
    ai_timeout_seconds: int | None = Field(None, ge=20, le=600)
    ai_refusal_fallback: bool | None = None
    daily_request_limit: int | None = Field(None, ge=0, le=10000)
    daily_spend_limit_usd: float | None = Field(None, ge=0, le=1000)
    feedback_strictness: str | None = None
    feedback_language_level: str | None = None
    audio_retention: bool | None = None
    transcription_mode: str | None = None
    listening_study_mode: bool | None = None
    theme: str | None = None
    srs_intervals: list[int] | None = None
    vocab_daily_new_limit: int | None = Field(None, ge=0, le=100)
    onboarding_done: bool | None = None

    @field_validator("ai_provider", "mock_ai_provider")
    @classmethod
    def prov(cls, v):
        if v is not None and v not in ai.PROVIDERS:
            raise ValueError("provider must be anthropic, openai or gemini")
        return v

    @field_validator("ai_effort")
    @classmethod
    def eff(cls, v):
        if v is not None and v not in ("low", "medium", "high", "xhigh", "max"):
            raise ValueError("invalid effort")
        return v

    @field_validator("target_levels")
    @classmethod
    def tl(cls, v):
        if v is not None:
            for k, lvl in v.items():
                if k not in fmt.ORDER or not 1 <= lvl <= 12:
                    raise ValueError("target levels must be 1-12 for listening/reading/writing/speaking")
        return v

    @field_validator("study_days")
    @classmethod
    def sd(cls, v):
        if v is not None and (not v or any(d not in range(7) for d in v)):
            raise ValueError("study_days must be weekday numbers 0-6")
        return v

    @field_validator("srs_intervals")
    @classmethod
    def srs(cls, v):
        if v is not None and (len(v) < 2 or any(x < 1 for x in v) or v != sorted(v)):
            raise ValueError("SRS intervals must be increasing positive day counts")
        return v

    @field_validator("theme")
    @classmethod
    def th(cls, v):
        if v is not None and v not in ("light", "dark", "system"):
            raise ValueError("invalid theme")
        return v

    @field_validator("transcription_mode")
    @classmethod
    def tm(cls, v):
        if v is not None and v not in ("manual", "browser", "openai", "gemini"):
            raise ValueError("invalid transcription mode")
        return v


@router.put("/settings")
def update_settings(body: SettingsIn, db: Session = Depends(get_db)):
    s = get_settings(db)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    # switching provider without naming a model → that provider's default model
    def _fits(provider: str, model: str) -> bool:
        if provider == "anthropic":
            return model.startswith("claude")
        if provider == "gemini":
            return model.startswith("gemini")
        return not model.startswith(("claude", "gemini"))

    if body.ai_provider and not body.ai_model and not _fits(s.ai_provider, s.ai_model):
        s.ai_model = ai.DEFAULT_MODEL[s.ai_provider]
    if body.mock_ai_provider and not body.mock_ai_model and not _fits(s.mock_ai_provider, s.mock_ai_model):
        s.mock_ai_model = ai.DEFAULT_MODEL[s.mock_ai_provider]
    db.commit()
    return _settings_payload(db)


class KeyIn(BaseModel):
    provider: str
    api_key: str = Field(min_length=10, max_length=400)


@router.put("/settings/api-key")
def set_api_key(body: KeyIn, db: Session = Depends(get_db)):
    if body.provider not in ai.PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    key = body.api_key.strip()
    if any(c.isspace() for c in key):
        raise HTTPException(400, "API key must not contain spaces")
    config.set_secret(ai.key_name(body.provider), key)
    return _settings_payload(db)


@router.delete("/settings/api-key/{provider}")
def delete_api_key(provider: str, db: Session = Depends(get_db)):
    if provider not in ai.PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    config.set_secret(ai.key_name(provider), None)
    return _settings_payload(db)


@router.post("/settings/test-connection")
def test_connection(route: str = "practice", db: Session = Depends(get_db)):
    if route not in ("practice", "mock"):
        raise HTTPException(400, "route must be practice or mock")
    return ai.test_connection(db, get_settings(db), route)


@router.get("/usage")
def usage(db: Session = Depends(get_db)):
    count, spend = ai.usage_today(db)
    s = get_settings(db)
    recent = db.scalars(select(ApiUsage).order_by(ApiUsage.created_at.desc()).limit(50))
    totals = db.execute(
        select(
            func.count(ApiUsage.id),
            func.coalesce(func.sum(ApiUsage.input_tokens), 0),
            func.coalesce(func.sum(ApiUsage.output_tokens), 0),
            func.coalesce(func.sum(ApiUsage.cost_estimate_usd), 0.0),
        )
    ).one()
    return {
        "today": {"requests": count, "estimated_cost_usd": round(spend, 4)},
        "limits": {"requests": s.daily_request_limit, "spend_usd": s.daily_spend_limit_usd},
        "all_time": {
            "requests": totals[0],
            "input_tokens": totals[1],
            "output_tokens": totals[2],
            "estimated_cost_usd": round(totals[3], 4),
        },
        "recent": [to_dict(r) for r in recent],
        "note": "Costs are local estimates from published per-token prices; check your provider dashboard for billing.",
    }


@router.get("/diagnostics")
def diagnostics(db: Session = Depends(get_db)):
    db_size = config.DB_PATH.stat().st_size if config.DB_PATH.exists() else 0
    audio_files = list(config.AUDIO_DIR.glob("*")) if config.AUDIO_DIR.exists() else []
    from alembic.runtime.migration import MigrationContext

    rev = MigrationContext.configure(db.connection()).get_current_revision()
    return {
        "app_version": config.APP_VERSION,
        "python": platform.python_version(),
        "sqlite": sqlite3.sqlite_version,
        "platform": platform.platform(),
        "database_path": str(config.DB_PATH),
        "database_size_bytes": db_size,
        "migration_revision": rev,
        "data_dir": str(config.DATA_DIR),
        "audio_files": len(audio_files),
        "audio_bytes": sum(f.stat().st_size for f in audio_files),
        "attempts": db.scalar(select(func.count(PracticeAttempt.id))),
        "env_file": str(config.ENV_FILE),
        "env_file_exists": config.ENV_FILE.exists(),
    }


class OfficialScoreIn(BaseModel):
    test_date: date
    listening: int | None = Field(None, ge=0, le=12)
    reading: int | None = Field(None, ge=0, le=12)
    writing: int | None = Field(None, ge=0, le=12)
    speaking: int | None = Field(None, ge=0, le=12)
    notes: str = ""


@router.get("/official-scores")
def list_official(db: Session = Depends(get_db)):
    return [to_dict(o) for o in db.scalars(select(OfficialScore).order_by(OfficialScore.test_date))]


@router.post("/official-scores")
def add_official(body: OfficialScoreIn, db: Session = Depends(get_db)):
    o = OfficialScore(**body.model_dump())
    db.add(o)
    db.commit()
    return to_dict(o)


@router.delete("/official-scores/{oid}")
def del_official(oid: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, OfficialScore, oid))
    db.commit()
    return {"ok": True}
