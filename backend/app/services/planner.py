"""Daily study planner: two primary modules per day by default.

Skill priority (higher = more likely to be scheduled):
  weakness   : (100 - performance index); skills with no scored data get 100
  staleness  : +6 per day since the skill was last practised (max 42)
  mistakes   : +3 per open mistake in that skill (max 15)
  rotation   : -35 if the skill was planned yesterday
Within a skill, the least recently practised task type is chosen; within that, an
unattempted question whose topic was practised least recently and whose difficulty
fits current performance. Missed days are never deleted — unfinished sessions stay
available as carry-over.
"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..models import (
    SKILLS,
    Mistake,
    PracticeAttempt,
    PracticeQuestion,
    StudyPlan,
    StudySession,
    TopicItem,
    UserSettings,
    VocabularyItem,
)
from . import analytics
from .evaluator import recommend_template

SKILL_OBJECTIVES = {
    "listening": "Train precise listening for detail, inference and speaker attitude under one-play conditions.",
    "reading": "Read efficiently for gist, detail and viewpoint while managing the clock.",
    "writing": "Produce a well-organized, task-complete response with precise vocabulary and accurate grammar.",
    "speaking": "Deliver a structured, natural response that fills the time with developed ideas.",
}


def _last_practiced(db: Session) -> dict[str, date | None]:
    out: dict[str, date | None] = {}
    for sk in SKILLS:
        d = db.scalar(
            select(PracticeAttempt.submitted_at)
            .where(PracticeAttempt.skill == sk, PracticeAttempt.submitted_at.is_not(None))
            .order_by(PracticeAttempt.submitted_at.desc())
            .limit(1)
        )
        out[sk] = d.date() if d else None
    return out


def skill_priorities(db: Session, s: UserSettings, day: date) -> list[tuple[str, float, list[str]]]:
    ranking = dict(analytics.weakness_ranking(db, s))
    last = _last_practiced(db)
    yesterday = db.scalar(select(StudyPlan).where(StudyPlan.plan_date == day - timedelta(days=1)))
    y_skills = {x.skill for x in yesterday.sessions} if yesterday else set()
    out = []
    for sk in SKILLS:
        reasons = []
        idx = ranking[sk]
        weakness = 100 if idx < 0 else 100 - idx
        reasons.append("no scored practice yet" if idx < 0 else f"performance index {idx:.0f}")
        stale_days = (day - last[sk]).days if last[sk] else 7
        stale = min(42, 6 * max(0, stale_days))
        if stale_days >= 2:
            reasons.append(f"not practised for {stale_days} days" if last[sk] else "not practised yet")
        open_m = len(list(db.scalars(select(Mistake.id).where(Mistake.skill == sk, Mistake.status != "resolved"))))
        mistakes = min(15, 3 * open_m)
        if open_m:
            reasons.append(f"{open_m} open mistakes")
        rot = -35 if sk in y_skills else 0
        out.append((sk, weakness + stale + mistakes + rot, reasons))
    return sorted(out, key=lambda x: -x[1])


def _choose_task_type(db: Session, skill: str) -> str:
    keys = [t["key"] for t in fmt.COMPONENTS[skill]["tasks"]]
    last_by_type = {}
    for k in keys:
        d = db.scalar(
            select(PracticeAttempt.submitted_at)
            .where(PracticeAttempt.task_type == k, PracticeAttempt.submitted_at.is_not(None))
            .order_by(PracticeAttempt.submitted_at.desc())
            .limit(1)
        )
        planned = db.scalar(
            select(StudySession.created_at).where(StudySession.task_type == k).order_by(StudySession.created_at.desc()).limit(1)
        )
        stamps = [x for x in (d, planned) if x]
        last_by_type[k] = max(stamps) if stamps else None
    # never-practised first (catalog order), then least recent
    never = [k for k in keys if last_by_type[k] is None]
    if never:
        return never[0]
    return min(keys, key=lambda k: last_by_type[k])


def target_difficulty(db: Session, s: UserSettings, skill: str) -> int:
    idx = analytics.skill_summary(db, skill, s)["performance_index"]
    if idx is None:
        return 3
    return 2 if idx < 55 else 3 if idx < 75 else 4 if idx < 88 else 5


def choose_question(db: Session, s: UserSettings, skill: str, task_type: str, exclude: set[int] | None = None) -> PracticeQuestion | None:
    qs = list(
        db.scalars(
            select(PracticeQuestion).where(
                PracticeQuestion.skill == skill,
                PracticeQuestion.task_type == task_type,
                PracticeQuestion.archived.is_(False),
                PracticeQuestion.is_mock.is_(False),
            )
        )
    )
    qs = [q for q in qs if not exclude or q.id not in exclude]
    if not qs:
        return None
    attempted = {
        r for r in db.scalars(select(PracticeAttempt.question_id).where(PracticeAttempt.question_id.is_not(None)))
    }
    planned = {r for r in db.scalars(select(StudySession.question_id).where(StudySession.question_id.is_not(None)))}
    diff = target_difficulty(db, s, skill)
    topics = {t.id: t for t in db.scalars(select(TopicItem))}

    def key(q: PracticeQuestion):
        t = topics.get(q.topic_item_id)
        topic_recency = t.practice_count if t else 0
        return (
            q.id in attempted,
            q.id in planned,
            abs(q.difficulty - diff),
            topic_recency,
            q.id,
        )

    return sorted(qs, key=key)[0]


def _steps(skill: str, minutes: int, has_template: bool, mistake: Mistake | None, vocab_due: int) -> list[dict]:
    m = minutes
    steps = []
    if has_template:
        steps.append({"key": "learn", "label": "Review the recommended template / strategy", "minutes": round(m * 0.15)})
    steps.append({"key": "practice", "label": "Complete the practice task under timed conditions", "minutes": round(m * 0.35)})
    steps.append(
        {
            "key": "evaluate",
            "label": "Check answers against the key" if skill in ("listening", "reading") else "Submit for AI evaluation",
            "minutes": round(m * 0.1),
        }
    )
    steps.append(
        {
            "key": "review",
            "label": "Review mistakes" + (f" — focus: {mistake.pattern}" if mistake else ""),
            "minutes": round(m * 0.2),
        }
    )
    steps.append(
        {
            "key": "vocab",
            "label": f"Save useful vocabulary / notes" + (f" and review {vocab_due} due words" if vocab_due else ""),
            "minutes": round(m * 0.1),
        }
    )
    if skill in ("writing", "speaking"):
        steps.append({"key": "retry", "label": "Retry exercise from the feedback", "minutes": round(m * 0.1)})
    return steps


def generate_plan(db: Session, s: UserSettings, day: date, force: bool = False) -> StudyPlan:
    existing = db.scalar(select(StudyPlan).where(StudyPlan.plan_date == day))
    if existing and not force:
        return existing
    if existing and force:
        if any(x.status in ("completed", "in_progress") for x in existing.sessions):
            # keep history: only replace sessions that were never started
            for x in list(existing.sessions):
                if x.status == "pending":
                    existing.sessions.remove(x)
            plan = existing
        else:
            db.delete(existing)
            db.flush()
            plan = None
    else:
        plan = None

    n = max(1, min(4, s.daily_module_count or 2))
    minutes = max(20, s.daily_minutes or 90)
    if plan is None:
        plan = StudyPlan(plan_date=day, total_minutes=minutes)
        db.add(plan)
    kept = {x.skill for x in plan.sessions}
    priorities = [p for p in skill_priorities(db, s, day) if p[0] not in kept]
    chosen = priorities[: max(0, n - len(plan.sessions))]
    per = minutes // n
    vocab_due = len(
        list(
            db.scalars(
                select(VocabularyItem.id).where(VocabularyItem.due_date <= day, VocabularyItem.review_count > 0)
            )
        )
    )
    rationale = []
    used_q: set[int] = set()
    for i, (skill, score, reasons) in enumerate(chosen):
        tt = _choose_task_type(db, skill)
        q = choose_question(db, s, skill, tt, used_q)
        if q is None:
            # fall back to any task type in this skill that has questions
            for t in fmt.COMPONENTS[skill]["tasks"]:
                q = choose_question(db, s, skill, t["key"], used_q)
                if q:
                    tt = t["key"]
                    break
        if q:
            used_q.add(q.id)
        tpl = recommend_template(db, skill, tt)
        mistake = db.scalar(
            select(Mistake)
            .where(Mistake.skill == skill, Mistake.status != "resolved")
            .order_by((Mistake.occurrence_count * Mistake.severity).desc())
            .limit(1)
        )
        sess = StudySession(
            order=len(plan.sessions) + i,
            skill=skill,
            task_type=tt,
            title=f"{fmt.COMPONENTS[skill]['name']}: {fmt.task_name(tt)}",
            objective=SKILL_OBJECTIVES[skill],
            duration_min=per,
            steps=_steps(skill, per, tpl is not None, mistake, vocab_due),
            question_id=q.id if q else None,
            template_id=tpl.id if tpl else None,
            topic_item_id=q.topic_item_id if q else None,
            focus_mistake_id=mistake.id if mistake else None,
        )
        plan.sessions.append(sess)
        rationale.append(f"{fmt.COMPONENTS[skill]['name']} — " + ", ".join(reasons))
    plan.rationale = "Selected because: " + "; ".join(rationale) if rationale else plan.rationale
    db.commit()
    db.refresh(plan)
    return plan


def carry_over(db: Session, before: date, limit: int = 6) -> list[StudySession]:
    return list(
        db.scalars(
            select(StudySession)
            .join(StudyPlan)
            .where(StudyPlan.plan_date < before, StudySession.status.in_(["pending", "in_progress"]))
            .order_by(StudyPlan.plan_date.desc())
            .limit(limit)
        )
    )


def recommend_next(db: Session, s: UserSettings, today: date) -> dict:
    """Next best activity: today's unfinished module, else overdue vocab, else weakest skill / top mistake."""
    plan = db.scalar(select(StudyPlan).where(StudyPlan.plan_date == today))
    if plan:
        for x in plan.sessions:
            if x.status in ("pending", "in_progress"):
                return {
                    "type": "session",
                    "label": f"Continue today's module: {x.title}",
                    "reason": "Today's plan is not finished yet.",
                    "session_id": x.id,
                }
    due = len(list(db.scalars(select(VocabularyItem.id).where(VocabularyItem.due_date <= today, VocabularyItem.review_count > 0))))
    if due >= 5:
        return {"type": "vocab", "label": f"Review {due} vocabulary items due today", "reason": "Spaced-repetition reviews are overdue."}
    m = analytics.top_mistakes(db, 1)
    weakest = analytics.weakness_ranking(db, s)[0][0]
    if m and m[0].occurrence_count >= 3:
        return {
            "type": "mistake",
            "label": f"Targeted drill: {m[0].pattern}",
            "reason": f"This {m[0].category.replace('_', ' ')} issue has recurred {m[0].occurrence_count} times.",
            "mistake_id": m[0].id,
            "skill": m[0].skill,
        }
    return {
        "type": "skill",
        "label": f"Extra {fmt.COMPONENTS[weakest]['name']} practice",
        "reason": f"{fmt.COMPONENTS[weakest]['name']} is currently your weakest or least-measured skill.",
        "skill": weakest,
    }
