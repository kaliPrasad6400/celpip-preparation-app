"""Progress statistics computed from persisted data only.

Three data types are kept separate:
- objective practice accuracy (listening/reading, from answer keys)
- unofficial AI-estimated levels (writing/speaking evaluations)
- official CELPIP results (entered manually, table official_scores)

The "performance index" (0-100) is an internal heuristic used only to rank skills
for planning and to draw the readiness indicator: accuracy × 100 for L/R,
estimated level ÷ 12 × 100 for W/S. It is not a CELPIP score.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    SKILLS,
    Evaluation,
    Mistake,
    MockExamResult,
    PracticeAttempt,
    StudySession,
    Template,
    UserSettings,
    VocabularyItem,
    VocabularyReviewHistory,
    utcnow,
)

OBJECTIVE = ("listening", "reading")
RECENT_N = 5


def _ai_level(a: PracticeAttempt) -> int | None:
    for ev in reversed(a.evaluations):
        if ev.kind == "ai_rubric":
            return ev.estimated_level
    return None


def skill_attempts(db: Session, skill: str) -> list[PracticeAttempt]:
    return list(
        db.scalars(
            select(PracticeAttempt)
            .where(
                PracticeAttempt.skill == skill,
                PracticeAttempt.submitted_at.is_not(None),
                PracticeAttempt.task_type != "NEWS",  # news summaries are not CELPIP tasks
            )
            .order_by(PracticeAttempt.submitted_at)
        )
    )


def perf_value(a: PracticeAttempt) -> float | None:
    if a.skill in OBJECTIVE:
        return a.accuracy * 100 if a.accuracy is not None else None
    lvl = _ai_level(a)
    return lvl / 12 * 100 if lvl is not None else None


def skill_summary(db: Session, skill: str, s: UserSettings) -> dict:
    attempts = skill_attempts(db, skill)
    values = [(a, perf_value(a)) for a in attempts]
    scored = [(a, v) for a, v in values if v is not None]
    recent = [v for _, v in scored[-RECENT_N:]]
    first = [v for _, v in scored[:3]]
    out: dict = {
        "skill": skill,
        "attempts": len(attempts),
        "scored_attempts": len(scored),
        "performance_index": round(sum(recent) / len(recent), 1) if recent else None,
        "first_index": round(sum(first) / len(first), 1) if first else None,
        "target_level": (s.target_levels or {}).get(skill, 12),
    }
    out["improvement"] = (
        round(out["performance_index"] - out["first_index"], 1)
        if out["performance_index"] is not None and len(scored) > 3
        else None
    )
    if skill in OBJECTIVE:
        rec = [a.accuracy for a, _ in scored[-RECENT_N:]]
        out["recent_accuracy"] = round(sum(rec) / len(rec), 3) if rec else None
        out["measure"] = "objective_accuracy"
    else:
        rec = [_ai_level(a) for a, _ in scored[-RECENT_N:]]
        out["recent_ai_level"] = round(sum(rec) / len(rec), 1) if rec else None
        out["measure"] = "ai_estimated_level"
    out["trend"] = [
        {"date": a.submitted_at.date().isoformat(), "value": round(v, 1), "attempt_id": a.id, "task_type": a.task_type}
        for a, v in scored[-30:]
    ]
    return out


def study_days(db: Session, days: int) -> set[date]:
    start = utcnow() - timedelta(days=days)
    rows = db.scalars(select(PracticeAttempt.submitted_at).where(PracticeAttempt.submitted_at >= start))
    d = {r.date() for r in rows if r}
    rows2 = db.scalars(select(VocabularyReviewHistory.reviewed_at).where(VocabularyReviewHistory.reviewed_at >= start))
    d |= {r.date() for r in rows2 if r}
    return d


def readiness(db: Session, s: UserSettings) -> dict:
    """Transparent readiness indicator. Not a probability of any score."""
    days14 = study_days(db, 14)
    planned = max(1, sum(1 for i in range(14) if (date.today() - timedelta(days=i)).weekday() in (s.study_days or range(7))))
    consistency = min(1.0, len(days14) / planned)
    since30 = utcnow() - timedelta(days=30)
    skills = {}
    for sk in SKILLS:
        summ = skill_summary(db, sk, s)
        vol = db.scalar(
            select(func.count(PracticeAttempt.id)).where(PracticeAttempt.skill == sk, PracticeAttempt.submitted_at >= since30)
        )
        volume = min(1.0, (vol or 0) / 12)
        perf = (summ["performance_index"] or 0) / 100
        score = round(100 * (0.6 * perf + 0.2 * consistency + 0.2 * volume), 1)
        skills[sk] = {
            "readiness": score,
            "components": {
                "recent_performance": round(perf * 100, 1),
                "consistency": round(consistency * 100, 1),
                "practice_volume": round(volume * 100, 1),
            },
            "has_data": summ["scored_attempts"] > 0,
        }
    vals = [v["readiness"] for v in skills.values()]
    return {
        "overall": round(sum(vals) / 4, 1),
        "weakest": min(skills, key=lambda k: skills[k]["readiness"]),
        "skills": skills,
        "formula": "readiness = 60% recent performance index (last 5 scored attempts) + 20% study consistency "
        "(days studied in the last 14 vs planned study days) + 20% practice volume (attempts in last 30 days, "
        "capped at 12). A heuristic for planning, not a probability or a CELPIP score.",
    }


def weakness_ranking(db: Session, s: UserSettings) -> list[tuple[str, float]]:
    """Lower = weaker. Skills without scored data are treated as weakest so they get measured."""
    out = []
    for sk in SKILLS:
        summ = skill_summary(db, sk, s)
        idx = summ["performance_index"]
        out.append((sk, -1.0 if idx is None else idx))
    return sorted(out, key=lambda x: x[1])


def readiness_history(db: Session, weeks: int = 12) -> list[dict]:
    """Weekly average performance index per skill (for the readiness trend chart)."""
    start = utcnow() - timedelta(weeks=weeks)
    attempts = db.scalars(select(PracticeAttempt).where(PracticeAttempt.submitted_at >= start))
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for a in attempts:
        v = perf_value(a)
        if v is None:
            continue
        wk = a.submitted_at.date() - timedelta(days=a.submitted_at.weekday())
        buckets[wk.isoformat()][a.skill].append(v)
    rows = []
    for wk in sorted(buckets):
        row = {"week": wk}
        for sk in SKILLS:
            vals = buckets[wk].get(sk)
            row[sk] = round(sum(vals) / len(vals), 1) if vals else None
        rows.append(row)
    return rows


def consistency_calendar(db: Session, days: int = 120) -> list[dict]:
    start = utcnow() - timedelta(days=days)
    counts: Counter = Counter()
    for r in db.scalars(select(PracticeAttempt.submitted_at).where(PracticeAttempt.submitted_at >= start)):
        if r:
            counts[r.date().isoformat()] += 1
    for r in db.scalars(select(VocabularyReviewHistory.reviewed_at).where(VocabularyReviewHistory.reviewed_at >= start)):
        counts[r.date().isoformat()] += 0  # day counts as active; reviews tracked separately
    completed = Counter()
    for sess in db.scalars(select(StudySession).where(StudySession.completed_at >= start)):
        completed[sess.completed_at.date().isoformat()] += 1
    keys = sorted(set(counts) | set(completed))
    return [{"date": k, "attempts": counts.get(k, 0), "modules_completed": completed.get(k, 0)} for k in keys]


def top_mistakes(db: Session, limit: int = 5) -> list[Mistake]:
    return list(
        db.scalars(
            select(Mistake)
            .where(Mistake.status != "resolved")
            .order_by((Mistake.occurrence_count * Mistake.severity).desc(), Mistake.last_seen_at.desc())
            .limit(limit)
        )
    )


def mistake_category_counts(db: Session) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = defaultdict(dict)
    for m in db.scalars(select(Mistake)):
        out[m.skill][m.category] = out[m.skill].get(m.category, 0) + m.occurrence_count
    return out


def template_mastery(db: Session) -> dict:
    c = Counter(t.status for t in db.scalars(select(Template)))
    return {k: c.get(k, 0) for k in ("learning", "practicing", "mastered", "needs_revision")}


def vocab_stats(db: Session) -> dict:
    items = list(db.scalars(select(VocabularyItem)))
    st = Counter(i.status for i in items)
    today = date.today()
    return {
        "total": len(items),
        "by_status": {k: st.get(k, 0) for k in ("new", "learning", "familiar", "mastered")},
        "due": sum(1 for i in items if i.due_date and i.due_date <= today and i.review_count > 0),
        "new_unreviewed": sum(1 for i in items if i.review_count == 0),
        "used_in_own_work": sum(1 for i in items if i.used_correctly_count > 0),
        "retained": sum(1 for i in items if i.status in ("familiar", "mastered")),
    }


def mock_results(db: Session) -> list[dict]:
    rows = db.scalars(select(MockExamResult).order_by(MockExamResult.created_at))
    return [
        {
            "mock_exam_id": r.mock_exam_id,
            "skill": r.skill,
            "date": r.created_at.date().isoformat(),
            "objective_correct": r.objective_correct,
            "objective_total": r.objective_total,
            "ai_estimated_level": r.ai_estimated_level,
        }
        for r in rows
    ]


def recent_evaluations(db: Session, limit: int = 5) -> list[Evaluation]:
    return list(db.scalars(select(Evaluation).order_by(Evaluation.created_at.desc()).limit(limit)))
