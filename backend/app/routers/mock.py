from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..db import get_db
from ..models import (
    Mistake,
    MockExam,
    MockExamResult,
    MockExamSection,
    PracticeAttempt,
    PracticeQuestion,
    utcnow,
)
from ..services import evaluator
from ..services.ai import AIError
from .common import get_or_404, get_settings, public_question, to_dict

router = APIRouter(prefix="/api/mock-exams", tags=["mock"])

INSTRUCTIONS = {
    "listening": "You will hear each recording ONCE. Answer the questions for each part before moving on. "
    "You cannot return to a previous part. Recordings in this app use your browser's synthesized voice.",
    "reading": "Read each passage and answer the questions. The section timer covers all parts.",
    "writing": "Complete both tasks. Task 1 (email): 27 minutes. Task 2 (survey): 26 minutes. Aim for 150-200 words.",
    "speaking": "Each task has a preparation timer followed by a response timer. Speak until the timer ends.",
}


def _pick(db: Session, skill: str, task_type: str, used: set[int]) -> PracticeQuestion | None:
    qs = list(
        db.scalars(
            select(PracticeQuestion).where(
                PracticeQuestion.skill == skill, PracticeQuestion.task_type == task_type, PracticeQuestion.archived.is_(False)
            )
        )
    )
    qs = [q for q in qs if q.id not in used]
    if not qs:
        return None
    attempted = set(db.scalars(select(PracticeAttempt.question_id).where(PracticeAttempt.question_id.is_not(None))))
    qs.sort(key=lambda q: (q.id in attempted, not q.is_mock, -q.difficulty))
    return qs[0]


class MockIn(BaseModel):
    mode: str = "full"
    skills: list[str] = list(fmt.ORDER)


@router.post("")
def create_mock(body: MockIn, db: Session = Depends(get_db)):
    skills = [s for s in fmt.ORDER if s in body.skills] if body.mode == "section" else list(fmt.ORDER)
    if not skills:
        raise HTTPException(400, "Choose at least one section")
    exam = MockExam(
        title=("Full practice mock" if body.mode == "full" else "Section mock: " + ", ".join(s.title() for s in skills))
        + f" — {utcnow():%b %d}",
        mode=body.mode,
    )
    used: set[int] = set()
    missing = []
    for i, sk in enumerate(skills):
        qids = []
        for t in fmt.COMPONENTS[sk]["tasks"]:
            q = _pick(db, sk, t["key"], used)
            if q:
                used.add(q.id)
                qids.append(q.id)
            else:
                missing.append(t["key"])
        if not qids:
            raise HTTPException(409, f"No practice questions available for {sk}.")
        exam.sections.append(
            MockExamSection(order=i, skill=sk, question_ids=qids, time_limit_sec=fmt.COMPONENTS[sk]["mock_minutes"] * 60)
        )
    db.add(exam)
    db.commit()
    out = exam_payload(db, exam)
    out["missing_tasks"] = missing
    return out


def exam_payload(db: Session, exam: MockExam, include_questions: bool = False) -> dict:
    d = to_dict(exam)
    d["sections"] = []
    for sec in exam.sections:
        sd = to_dict(sec)
        sd["instructions"] = INSTRUCTIONS[sec.skill]
        sd["name"] = fmt.COMPONENTS[sec.skill]["name"]
        attempts = list(
            db.scalars(
                select(PracticeAttempt).where(PracticeAttempt.mock_exam_id == exam.id, PracticeAttempt.skill == sec.skill)
            )
        )
        sd["answered_question_ids"] = [a.question_id for a in attempts]
        if include_questions and sec.status == "in_progress":
            sd["questions"] = []
            for qid in sec.question_ids:
                q = db.get(PracticeQuestion, qid)
                if q:
                    qd = public_question(q, False)
                    qd["task_name"] = fmt.task_name(q.task_type)
                    sd["questions"].append(qd)
        if exam.status == "completed":
            sd["attempt_ids"] = [a.id for a in attempts]
        d["sections"].append(sd)
    d["results"] = [to_dict(r) for r in exam.results]
    d["label"] = "Practice mock built from original practice material — not official CELPIP questions."
    return d


@router.get("")
def list_mocks(db: Session = Depends(get_db)):
    return [
        {**to_dict(e), "sections": [s.skill for s in e.sections], "results": [to_dict(r) for r in e.results]}
        for e in db.scalars(select(MockExam).order_by(MockExam.created_at.desc()))
    ]


@router.get("/{eid}")
def get_mock(eid: int, db: Session = Depends(get_db)):
    return exam_payload(db, get_or_404(db, MockExam, eid), include_questions=True)


@router.post("/{eid}/sections/{order}/start")
def start_section(eid: int, order: int, db: Session = Depends(get_db)):
    exam = get_or_404(db, MockExam, eid)
    if exam.status == "completed":
        raise HTTPException(409, "This mock exam is finished.")
    sec = next((s for s in exam.sections if s.order == order), None)
    if not sec:
        raise HTTPException(404, "section not found")
    if order != exam.current_section:
        raise HTTPException(409, "Sections must be taken in order; previous sections cannot be reopened.")
    if sec.status == "not_started":
        sec.status = "in_progress"
        sec.started_at = utcnow()
        exam.status = "in_progress"
        exam.started_at = exam.started_at or utcnow()
        db.commit()
    return exam_payload(db, exam, include_questions=True)


@router.post("/{eid}/sections/{order}/complete")
def complete_section(eid: int, order: int, db: Session = Depends(get_db)):
    exam = get_or_404(db, MockExam, eid)
    sec = next((s for s in exam.sections if s.order == order), None)
    if not sec or sec.status != "in_progress":
        raise HTTPException(409, "Section is not in progress.")
    sec.status = "completed"
    sec.completed_at = utcnow()
    exam.current_section = order + 1
    db.commit()
    return exam_payload(db, exam, include_questions=True)


class FinishIn(BaseModel):
    evaluate: bool = True


@router.post("/{eid}/finish")
def finish(eid: int, body: FinishIn, db: Session = Depends(get_db)):
    exam = get_or_404(db, MockExam, eid)
    if any(s.status == "in_progress" for s in exam.sections):
        raise HTTPException(409, "Complete the current section first.")
    s = get_settings(db)
    for r in list(exam.results):
        db.delete(r)
    db.flush()
    errors = []
    for sec in exam.sections:
        attempts = list(
            db.scalars(select(PracticeAttempt).where(PracticeAttempt.mock_exam_id == exam.id, PracticeAttempt.skill == sec.skill))
        )
        res = MockExamResult(mock_exam_id=exam.id, skill=sec.skill)
        plan = []
        if sec.skill in ("listening", "reading"):
            total = 0
            correct = 0
            for qid in sec.question_ids:
                q = db.get(PracticeQuestion, qid)
                total += len(q.items) if q else 0
            for a in attempts:
                correct += a.score_correct or 0
            res.objective_correct, res.objective_total = correct, total
            weakest = sorted(attempts, key=lambda a: a.accuracy if a.accuracy is not None else 0)[:2]
            for a in weakest:
                if a.accuracy is not None and a.accuracy < 0.9:
                    plan.append(f"Repeat {fmt.task_name(a.task_type)} practice (scored {a.accuracy:.0%}) and review the missed items.")
            unanswered = len(sec.question_ids) - len(attempts)
            if unanswered:
                plan.append(f"{unanswered} part(s) were not submitted — practise pacing with the section timer.")
            res.summary = f"{correct}/{total} correct ({(correct / total if total else 0):.0%}) — objective practice accuracy."
        else:
            levels = []
            for a in attempts:
                ev = next((e for e in a.evaluations if e.kind == "ai_rubric"), None)
                if ev is None and body.evaluate and (a.response_text or a.transcript):
                    try:
                        ev = evaluator.evaluate_attempt(db, a, s)
                    except AIError as e:
                        errors.append(f"{fmt.task_name(a.task_type)}: {e.message}")
                if ev and ev.estimated_level is not None:
                    levels.append(ev.estimated_level)
                    if ev.next_steps:
                        plan.append(f"{fmt.task_name(a.task_type)}: {ev.next_steps[0]}")
            res.evaluated_count = len(levels)
            res.ai_estimated_level = round(sum(levels) / len(levels), 1) if levels else None
            res.summary = (
                f"Unofficial AI-estimated average level {res.ai_estimated_level} across {len(levels)} evaluated task(s)."
                if levels
                else "No AI evaluation available for this section (add an API key or evaluate attempts individually)."
            )
        top = db.scalars(
            select(Mistake).where(Mistake.skill == sec.skill, Mistake.status != "resolved")
            .order_by((Mistake.occurrence_count * Mistake.severity).desc()).limit(2)
        )
        for m in top:
            plan.append(f"Fix recurring issue: {m.pattern}. {m.recommended_exercise}".strip())
        res.improvement_plan = plan[:6]
        exam.results.append(res)
    exam.status = "completed"
    exam.completed_at = utcnow()
    db.commit()
    out = exam_payload(db, exam)
    out["errors"] = errors
    return out


@router.delete("/{eid}")
def delete_mock(eid: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, MockExam, eid))
    db.commit()
    return {"ok": True}
