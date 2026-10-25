"""Deterministic scoring of listening/reading attempts against the stored answer key."""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Evaluation, PracticeAttempt, PracticeQuestion


def score_objective(db: Session, attempt: PracticeAttempt, q: PracticeQuestion) -> Evaluation:
    items = q.items or []
    if not items:
        raise ValueError("This question has no answer key.")
    correct = 0
    per_item = []
    for it in items:
        chosen = attempt.answers.get(str(it["id"]))
        ok = isinstance(chosen, int) and chosen == it["answer"]
        correct += ok
        per_item.append(
            {
                "item_id": str(it["id"]),
                "qtype": it.get("qtype", "detail"),
                "chosen": chosen,
                "answer": it["answer"],
                "correct": ok,
                "explanation": it.get("explanation", ""),
            }
        )
    attempt.score_correct = correct
    attempt.score_total = len(items)
    attempt.accuracy = round(correct / len(items), 4)
    attempt.status = "evaluated"
    ev = Evaluation(
        attempt_id=attempt.id,
        kind="objective",
        summary=f"{correct} of {len(items)} correct ({attempt.accuracy:.0%}). Objective practice accuracy, not a CELPIP score.",
        explanations=per_item,
        limitations="Calculated against this app's answer key. Raw practice accuracy is not an official CELPIP level.",
    )
    db.add(ev)
    return ev


def accuracy_by_qtype(attempts: list[PracticeAttempt], questions: dict[int, PracticeQuestion]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for a in attempts:
        q = questions.get(a.question_id) if a.question_id else None
        if not q:
            continue
        for it in q.items or []:
            key = it.get("qtype", "detail")
            d = out.setdefault(key, {"correct": 0, "total": 0})
            d["total"] += 1
            if a.answers.get(str(it["id"])) == it["answer"]:
                d["correct"] += 1
    for d in out.values():
        d["accuracy"] = round(d["correct"] / d["total"], 3) if d["total"] else None
    return out
