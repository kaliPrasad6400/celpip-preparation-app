from __future__ import annotations

from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from ..models import PracticeQuestion, UserSettings
from ..services.ai import AIError


def to_dict(obj, exclude: set[str] | None = None) -> dict:
    out = {}
    for c in inspect(obj).mapper.column_attrs:
        if exclude and c.key in exclude:
            continue
        v = getattr(obj, c.key)
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        out[c.key] = v
    return out


def get_settings(db: Session) -> UserSettings:
    s = db.scalar(select(UserSettings).limit(1))
    if s is None:
        s = UserSettings(id=1)
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def get_or_404(db: Session, model, id_: int):
    obj = db.get(model, id_)
    if obj is None:
        raise HTTPException(404, f"{model.__name__} {id_} not found")
    return obj


def ai_http_error(e: AIError) -> HTTPException:
    status = {
        "no_key": 400,
        "auth": 401,
        "limit_requests": 429,
        "limit_spend": 429,
        "quota_daily": 429,
        "rate_limit": 429,
        "too_short": 422,
        "nothing": 422,
        "timeout": 504,
        "network": 503,
        "server": 502,
    }.get(e.code, 502)
    return HTTPException(status, {"code": e.code, "message": e.message, "retryable": e.retryable})


def public_question(q: PracticeQuestion, reveal: bool) -> dict:
    """Question payload. Answer keys, explanations, transcripts and sample responses are
    withheld until the attempt is submitted (or study mode reveals them)."""
    d = to_dict(q)
    d["topic_title"] = None
    if not reveal:
        d["items"] = [
            {k: v for k, v in it.items() if k not in ("answer", "explanation")} for it in (q.items or [])
        ]
        d["sample_response"] = ""
        if q.skill == "listening":
            content = dict(q.content or {})
            script = content.pop("script", [])
            content["segments"] = len(script)
            d["content"] = content
    d["has_answer_key"] = bool(q.items)
    return d
