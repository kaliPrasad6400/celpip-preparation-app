from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..db import get_db
from ..models import (
    Mistake,
    PracticeAttempt,
    PracticeQuestion,
    StudyPlan,
    StudySession,
    Template,
    TopicItem,
    utcnow,
)
from ..services import planner
from .common import get_or_404, get_settings, to_dict

router = APIRouter(prefix="/api", tags=["planner"])


def session_payload(db: Session, x: StudySession) -> dict:
    d = to_dict(x)
    d["task_name"] = fmt.task_name(x.task_type)
    d["plan_date"] = x.plan.plan_date.isoformat()
    q = db.get(PracticeQuestion, x.question_id) if x.question_id else None
    d["question"] = {"id": q.id, "title": q.title, "difficulty": q.difficulty} if q else None
    t = db.get(Template, x.template_id) if x.template_id else None
    d["template"] = {"id": t.id, "name": t.name, "status": t.status} if t else None
    tp = db.get(TopicItem, x.topic_item_id) if x.topic_item_id else None
    d["topic"] = {"id": tp.id, "title": tp.title} if tp else None
    m = db.get(Mistake, x.focus_mistake_id) if x.focus_mistake_id else None
    d["focus_mistake"] = {"id": m.id, "pattern": m.pattern, "category": m.category} if m else None
    attempts = list(db.scalars(select(PracticeAttempt).where(PracticeAttempt.study_session_id == x.id).order_by(PracticeAttempt.id)))
    d["attempts"] = [
        {
            "id": a.id,
            "status": a.status,
            "accuracy": a.accuracy,
            "estimated_level": next((e.estimated_level for e in reversed(a.evaluations) if e.kind == "ai_rubric"), None),
            "evaluated": any(e.kind in ("ai_rubric", "objective") for e in a.evaluations),
        }
        for a in attempts
    ]
    return d


def plan_payload(db: Session, p: StudyPlan) -> dict:
    d = to_dict(p)
    d["sessions"] = [session_payload(db, x) for x in p.sessions]
    done = sum(1 for x in p.sessions if x.status == "completed")
    d["completion"] = round(done / len(p.sessions), 2) if p.sessions else 0
    return d


@router.get("/plans/today")
def today_plan(db: Session = Depends(get_db)):
    s = get_settings(db)
    p = planner.generate_plan(db, s, date.today())
    out = plan_payload(db, p)
    out["carry_over"] = [session_payload(db, x) for x in planner.carry_over(db, date.today())]
    out["is_study_day"] = date.today().weekday() in (s.study_days or range(7))
    return out


@router.get("/plans/calendar")
def calendar(start: date, end: date, db: Session = Depends(get_db)):
    if (end - start).days > 120:
        raise HTTPException(400, "Range too large")
    plans = db.scalars(select(StudyPlan).where(StudyPlan.plan_date >= start, StudyPlan.plan_date <= end))
    return [
        {
            "date": p.plan_date.isoformat(),
            "sessions": [
                {"id": x.id, "skill": x.skill, "title": x.title, "status": x.status, "task_type": x.task_type}
                for x in p.sessions
            ],
        }
        for p in plans
    ]


@router.get("/plans/{day}")
def plan_for(day: date, db: Session = Depends(get_db)):
    p = db.scalar(select(StudyPlan).where(StudyPlan.plan_date == day))
    if not p:
        if day < date.today():
            raise HTTPException(404, "No plan existed for that day")
        p = planner.generate_plan(db, get_settings(db), day)
    return plan_payload(db, p)


@router.post("/plans/{day}/regenerate")
def regenerate(day: date, db: Session = Depends(get_db)):
    if day < date.today():
        raise HTTPException(400, "Past plans are kept as history and cannot be regenerated.")
    p = planner.generate_plan(db, get_settings(db), day, force=True)
    return plan_payload(db, p)


@router.get("/plans/week/{start}")
def week(start: date, db: Session = Depends(get_db)):
    """Weekly overview; future days are previewed (generated) only up to 7 days ahead."""
    s = get_settings(db)
    out = []
    for i in range(7):
        d = start + timedelta(days=i)
        p = db.scalar(select(StudyPlan).where(StudyPlan.plan_date == d))
        if p is None and date.today() <= d <= date.today() + timedelta(days=1):
            p = planner.generate_plan(db, s, d)
        out.append(
            {
                "date": d.isoformat(),
                "is_study_day": d.weekday() in (s.study_days or range(7)),
                "plan": plan_payload(db, p) if p else None,
            }
        )
    return out


@router.get("/sessions/{sid}")
def get_session(sid: int, db: Session = Depends(get_db)):
    return session_payload(db, get_or_404(db, StudySession, sid))


@router.post("/sessions/{sid}/start")
def start_session(sid: int, db: Session = Depends(get_db)):
    x = get_or_404(db, StudySession, sid)
    if x.status in ("pending", "skipped"):
        x.status = "in_progress"
        x.started_at = x.started_at or utcnow()
        db.commit()
    return session_payload(db, x)


class SessionPatch(BaseModel):
    review_done: bool | None = None
    vocab_saved: bool | None = None
    reflection: str | None = Field(None, max_length=5000)


@router.patch("/sessions/{sid}")
def patch_session(sid: int, body: SessionPatch, db: Session = Depends(get_db)):
    x = get_or_404(db, StudySession, sid)
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(x, k, v)
    db.commit()
    return session_payload(db, x)


@router.post("/sessions/{sid}/complete")
def complete_session(sid: int, db: Session = Depends(get_db)):
    """A module counts as complete only after a practice attempt was submitted for it
    and the mistake review step was confirmed. Opening a module never completes it."""
    x = get_or_404(db, StudySession, sid)
    attempts = list(db.scalars(select(PracticeAttempt).where(PracticeAttempt.study_session_id == x.id)))
    if not attempts:
        raise HTTPException(409, "Submit the practice task for this module before marking it complete.")
    if not x.review_done:
        raise HTTPException(409, "Confirm the mistake-review step before completing the module.")
    x.status = "completed"
    x.completed_at = utcnow()
    db.commit()
    return session_payload(db, x)


@router.post("/sessions/{sid}/skip")
def skip_session(sid: int, db: Session = Depends(get_db)):
    x = get_or_404(db, StudySession, sid)
    if x.status == "completed":
        raise HTTPException(409, "Completed modules cannot be skipped.")
    x.status = "skipped"
    db.commit()
    return session_payload(db, x)


@router.post("/sessions/{sid}/swap-question")
def swap_question(sid: int, db: Session = Depends(get_db)):
    x = get_or_404(db, StudySession, sid)
    if x.status == "completed":
        raise HTTPException(409, "Module already completed.")
    q = planner.choose_question(db, get_settings(db), x.skill, x.task_type, {x.question_id} if x.question_id else set())
    if not q:
        raise HTTPException(404, "No other question available for this task type. Generate one from a topic.")
    x.question_id = q.id
    x.topic_item_id = q.topic_item_id
    db.commit()
    return session_payload(db, x)
