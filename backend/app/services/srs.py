"""Simple, configurable spaced repetition.

Each item sits on a step of the interval ladder (default 1, 3, 7, 14, 30, 60 days).
  again -> back to step 0, due tomorrow (lapse)
  hard  -> stay on the current step
  good  -> advance one step
  easy  -> advance two steps
Status follows the step: new (never reviewed) → learning → familiar → mastered.
"""
from __future__ import annotations

from datetime import date, timedelta

from ..models import VocabularyItem, VocabularyReviewHistory

RESULTS = ("again", "hard", "good", "easy")


def status_for(step: int, ladder_len: int, reviews: int) -> str:
    if reviews == 0:
        return "new"
    if step >= ladder_len - 1:
        return "mastered"
    if step >= 3:
        return "familiar"
    return "learning"


def review(item: VocabularyItem, result: str, mode: str, ladder: list[int], today: date | None = None) -> VocabularyReviewHistory:
    if result not in RESULTS:
        raise ValueError("invalid result")
    today = today or date.today()
    ladder = ladder or [1, 3, 7, 14, 30, 60]
    step = item.srs_step or 0
    if item.review_count == 0 and result in ("good", "easy"):
        step = 0 if result == "good" else 1
    elif result == "again":
        step = 0
        item.lapses += 1
    elif result == "good":
        step += 1
    elif result == "easy":
        step += 2
    step = max(0, min(step, len(ladder) - 1))
    interval = ladder[step] if result != "again" else 1
    item.srs_step = step
    item.due_date = today + timedelta(days=interval)
    item.review_count += 1
    item.status = status_for(step, len(ladder), item.review_count)
    item.confidence = {"again": 1, "hard": 2, "good": 3, "easy": 4}[result] if item.confidence < 5 else item.confidence
    h = VocabularyReviewHistory(item_id=item.id, mode=mode, result=result, interval_days=interval)
    item.reviews.append(h)
    return h
