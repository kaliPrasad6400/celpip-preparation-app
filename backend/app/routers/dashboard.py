from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..db import get_db
from ..models import SKILLS
from ..services import analytics, planner
from .common import get_settings, to_dict
from .planner import plan_payload, session_payload

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    s = get_settings(db)
    today = date.today()
    plan = planner.generate_plan(db, s, today)
    skills = {sk: analytics.skill_summary(db, sk, s) for sk in SKILLS}
    for v in skills.values():
        v.pop("trend", None)
    last7 = analytics.study_days(db, 7)
    week = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        week.append({"date": d.isoformat(), "studied": d in last7, "planned": d.weekday() in (s.study_days or range(7))})
    evs = []
    for ev in analytics.recent_evaluations(db, 6):
        a = ev.attempt
        evs.append(
            {
                "id": ev.id,
                "attempt_id": a.id,
                "kind": ev.kind,
                "skill": a.skill,
                "task_name": fmt.task_name(a.task_type),
                "estimated_level": ev.estimated_level,
                "accuracy": a.accuracy,
                "summary": ev.summary[:240],
                "created_at": ev.created_at.isoformat(),
            }
        )
    return {
        "today": today.isoformat(),
        "exam_date": s.exam_date.isoformat(),
        "days_remaining": (s.exam_date - today).days,
        "target_levels": s.target_levels,
        "plan": plan_payload(db, plan),
        "carry_over": [session_payload(db, x) for x in planner.carry_over(db, today)],
        "skills": skills,
        "recent_evaluations": evs,
        "top_mistakes": [to_dict(m) for m in analytics.top_mistakes(db, 5)],
        "vocab": analytics.vocab_stats(db),
        "week": week,
        "readiness": analytics.readiness(db, s),
        "readiness_trend": analytics.readiness_history(db, 8),
        "next": planner.recommend_next(db, s, today),
        "scoring_note": fmt.SCORING_NOTE,
    }


@router.get("/analytics")
def analytics_overview(db: Session = Depends(get_db)):
    s = get_settings(db)
    from ..models import PracticeAttempt, PracticeQuestion, StudySession
    from sqlalchemy import select
    from ..services.scoring import accuracy_by_qtype

    skills = {}
    for sk in SKILLS:
        summ = analytics.skill_summary(db, sk, s)
        if sk in ("listening", "reading"):
            attempts = [a for a in analytics.skill_attempts(db, sk) if a.accuracy is not None]
            qs = {q.id: q for q in db.scalars(select(PracticeQuestion).where(PracticeQuestion.skill == sk))}
            summ["accuracy_by_qtype"] = accuracy_by_qtype(attempts, qs)
        by_task = {}
        for a in analytics.skill_attempts(db, sk):
            v = analytics.perf_value(a)
            t = by_task.setdefault(a.task_type, {"task_name": fmt.task_name(a.task_type), "attempts": 0, "values": []})
            t["attempts"] += 1
            if v is not None:
                t["values"].append(v)
        for t in by_task.values():
            vals = t.pop("values")
            t["avg_index"] = round(sum(vals) / len(vals), 1) if vals else None
        summ["by_task"] = by_task
        sessions = list(db.scalars(select(StudySession).where(StudySession.skill == sk)))
        summ["modules_planned"] = len(sessions)
        summ["modules_completed"] = sum(1 for x in sessions if x.status == "completed")
        summ["completion_rate"] = round(summ["modules_completed"] / len(sessions), 3) if sessions else None
        skills[sk] = summ
    cal = analytics.consistency_calendar(db, 120)
    # weekly/monthly consistency
    days = {c["date"] for c in cal if c["attempts"] or c["modules_completed"]}
    today = date.today()
    weekly = []
    for w in range(11, -1, -1):
        start = today - timedelta(days=today.weekday() + 7 * w)
        n = sum(1 for i in range(7) if (start + timedelta(days=i)).isoformat() in days)
        weekly.append({"week": start.isoformat(), "days_studied": n})
    monthly: dict[str, int] = {}
    for d in days:
        monthly[d[:7]] = monthly.get(d[:7], 0) + 1
    from ..models import OfficialScore

    return {
        "skills": skills,
        "readiness": analytics.readiness(db, s),
        "readiness_trend": analytics.readiness_history(db, 16),
        "calendar": cal,
        "weekly_consistency": weekly,
        "monthly_consistency": [{"month": k, "days_studied": v} for k, v in sorted(monthly.items())],
        "mistake_categories": analytics.mistake_category_counts(db),
        "template_mastery": analytics.template_mastery(db),
        "vocab": analytics.vocab_stats(db),
        "mock_results": analytics.mock_results(db),
        "official_scores": [to_dict(o) for o in db.scalars(select(OfficialScore).order_by(OfficialScore.test_date))],
        "targets": s.target_levels,
        "notes": {
            "objective": "Listening/reading accuracy is calculated from this app's answer keys (practice accuracy, not a CELPIP level).",
            "ai": "Writing/speaking levels are unofficial AI estimates.",
            "official": "Official results appear only if you enter them.",
        },
    }
