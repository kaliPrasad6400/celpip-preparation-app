from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..db import get_db
from ..models import (
    ContentSource,
    CurrentAffairsItem,
    PracticeAttempt,
    PracticeQuestion,
    TopicCategory,
    TopicItem,
    utcnow,
)
from ..services import evaluator, generator, news
from ..services.ai import AIError
from .common import ai_http_error, get_or_404, get_settings, public_question, to_dict
from .knowledge import VocabIn, create_vocab

router = APIRouter(prefix="/api", tags=["context"])


# ------------------------------------------------------------------ topics
@router.get("/topic-categories")
def categories(db: Session = Depends(get_db)):
    out = []
    for c in db.scalars(select(TopicCategory).order_by(TopicCategory.group, TopicCategory.name)):
        d = to_dict(c)
        d["item_count"] = len(c.items)
        out.append(d)
    return out


@router.get("/topics")
def list_topics(
    category_id: int | None = None,
    group: str | None = None,
    skill: str | None = None,
    difficulty: int | None = None,
    kind: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(TopicItem).join(TopicCategory)
    if category_id:
        stmt = stmt.where(TopicItem.category_id == category_id)
    if group:
        stmt = stmt.where(TopicCategory.group == group)
    if difficulty:
        stmt = stmt.where(TopicItem.difficulty == difficulty)
    if kind:
        stmt = stmt.where(TopicItem.kind == kind)
    if q:
        stmt = stmt.where(TopicItem.title.ilike(f"%{q}%") | TopicItem.scenario.ilike(f"%{q}%"))
    rows = list(db.scalars(stmt.order_by(TopicCategory.group, TopicItem.title)))
    if skill:
        rows = [t for t in rows if skill in (t.skills or [])]
    qcount: dict[int, int] = {}
    for qid in db.scalars(select(PracticeQuestion.topic_item_id).where(PracticeQuestion.topic_item_id.is_not(None))):
        qcount[qid] = qcount.get(qid, 0) + 1
    out = []
    for t in rows:
        d = to_dict(t, exclude={"content_html"})
        d["category"] = t.category.name
        d["group"] = t.category.group
        d["question_count"] = qcount.get(t.id, 0)
        out.append(d)
    return out


@router.get("/topics/{tid}")
def get_topic(tid: int, db: Session = Depends(get_db)):
    t = get_or_404(db, TopicItem, tid)
    d = to_dict(t)
    d["category"] = to_dict(t.category)
    qs = list(db.scalars(select(PracticeQuestion).where(PracticeQuestion.topic_item_id == tid, PracticeQuestion.archived.is_(False))))
    d["questions"] = [
        {"id": q.id, "skill": q.skill, "task_type": q.task_type, "task_name": fmt.task_name(q.task_type), "title": q.title,
         "difficulty": q.difficulty, "source_type": q.source_type}
        for q in qs
    ]
    d["offline_tasks"] = list(generator.OFFLINE_TASKS)
    return d


class TopicVocabIn(BaseModel):
    index: int


@router.post("/topics/{tid}/save-vocab")
def save_topic_vocab(tid: int, body: TopicVocabIn, db: Session = Depends(get_db)):
    t = get_or_404(db, TopicItem, tid)
    try:
        v = t.key_vocabulary[body.index]
    except (IndexError, TypeError):
        raise HTTPException(404, "vocabulary entry not found")
    return create_vocab(
        VocabIn(
            term=v.get("term", "")[:200],
            meaning=v.get("meaning", ""),
            example=v.get("example", ""),
            collocations=v.get("collocations", []),
            formality=v.get("tone", "neutral") if v.get("tone") in ("formal", "neutral", "informal") else "neutral",
            usage_notes=v.get("usage", ""),
            context=t.title,
            regional_note=v.get("regional_note", ""),
            practice_exercise=v.get("exercise", ""),
            tags=["canadian-context", t.category.slug],
            source_type="topic",
            source_ref=f"Topic: {t.title}",
        ),
        db,
    )


class MultiGenIn(BaseModel):
    task_types: list[str] = Field(min_length=1, max_length=8)
    use_ai: bool = False
    difficulty: int = Field(3, ge=1, le=5)


@router.post("/topics/{tid}/generate")
def generate_for_topic(tid: int, body: MultiGenIn, db: Session = Depends(get_db)):
    """Generate exercises for several skills from one topic. Offline composer when possible."""
    t = get_or_404(db, TopicItem, tid)
    created, errors = [], []
    for tt in body.task_types:
        found = fmt.task_by_key(tt)
        if not found:
            errors.append({"task_type": tt, "error": "unknown task type"})
            continue
        try:
            if not body.use_ai and tt in generator.OFFLINE_TASKS:
                q = generator.compose_offline(db, t, tt)
                method = "offline"
            else:
                q = generator.generate_ai(db, get_settings(db), skill=found[0], task_type=tt, topic=t, difficulty=body.difficulty)
                method = "ai"
            created.append({"id": q.id, "task_type": tt, "title": q.title, "method": method})
        except ValueError as e:
            errors.append({"task_type": tt, "error": str(e)})
        except AIError as e:
            errors.append({"task_type": tt, "error": e.message})
    return {"created": created, "errors": errors}


# ------------------------------------------------------------------ sources
class SourceIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    url: str = Field(pattern=r"^https?://")
    source_type: str
    feed_url: str | None = Field(None, pattern=r"^https?://")
    description: str = ""
    enabled: bool = True


@router.get("/sources")
def list_sources(db: Session = Depends(get_db)):
    return [to_dict(s) for s in db.scalars(select(ContentSource).order_by(ContentSource.source_type, ContentSource.name))]


@router.post("/sources")
def add_source(body: SourceIn, db: Session = Depends(get_db)):
    s = ContentSource(**body.model_dump())
    db.add(s)
    db.commit()
    return to_dict(s)


@router.patch("/sources/{sid}")
def toggle_source(sid: int, enabled: bool, db: Session = Depends(get_db)):
    s = get_or_404(db, ContentSource, sid)
    s.enabled = enabled
    db.commit()
    return to_dict(s)


@router.delete("/sources/{sid}")
def delete_source(sid: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, ContentSource, sid))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ current affairs
@router.post("/current-affairs/refresh")
def refresh(db: Session = Depends(get_db)):
    return {"added": news.refresh_all(db), "sources": [to_dict(s) for s in db.scalars(select(ContentSource))]}


@router.get("/current-affairs")
def list_news(category_id: int | None = None, source_id: int | None = None, limit: int = 60, db: Session = Depends(get_db)):
    stmt = select(CurrentAffairsItem)
    if category_id:
        stmt = stmt.where(CurrentAffairsItem.topic_category_id == category_id)
    if source_id:
        stmt = stmt.where(CurrentAffairsItem.source_id == source_id)
    rows = db.scalars(stmt.order_by(CurrentAffairsItem.published_at.desc().nullslast()).limit(min(limit, 300)))
    now = utcnow()
    out = []
    for r in rows:
        d = to_dict(r)
        age_days = (now - r.published_at).days if r.published_at else None
        d["age_days"] = age_days
        d["freshness"] = "historical" if age_days is not None and age_days > 30 else r.verification_status
        out.append(d)
    return out


@router.get("/current-affairs/{nid}")
def get_news(nid: int, db: Session = Depends(get_db)):
    r = get_or_404(db, CurrentAffairsItem, nid)
    d = to_dict(r)
    d["questions_generated"] = [
        {"id": q.id, "title": q.title, "task_type": q.task_type, "task_name": fmt.task_name(q.task_type)}
        for q in db.scalars(select(PracticeQuestion).where(PracticeQuestion.current_affairs_id == nid))
    ]
    d["summary_attempts"] = [
        {"id": a.id, "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None, "status": a.status}
        for a in db.scalars(select(PracticeAttempt).where(PracticeAttempt.task_type == "NEWS", PracticeAttempt.answers["news_id"].as_integer() == nid))
    ]
    return d


@router.post("/current-affairs/{nid}/enrich")
def enrich_news(nid: int, db: Session = Depends(get_db)):
    r = get_or_404(db, CurrentAffairsItem, nid)
    try:
        news.enrich(db, r, get_settings(db))
    except AIError as e:
        raise ai_http_error(e)
    return to_dict(r)


class NewsExerciseIn(BaseModel):
    task_type: str


@router.post("/current-affairs/{nid}/exercise")
def news_exercise(nid: int, body: NewsExerciseIn, db: Session = Depends(get_db)):
    r = get_or_404(db, CurrentAffairsItem, nid)
    found = fmt.task_by_key(body.task_type)
    if not found:
        raise HTTPException(400, "unknown task type")
    ctx = f"Headline: {r.headline}\nPublisher: {r.publisher}\nDate: {r.published_at}\nSummary: {r.feed_summary}"
    try:
        q = generator.generate_ai(
            db, get_settings(db), skill=found[0], task_type=body.task_type, current_affairs_context=ctx, current_affairs_id=r.id
        )
    except AIError as e:
        raise ai_http_error(e)
    return public_question(q, False)


class NewsSummaryIn(BaseModel):
    text: str = Field(min_length=20, max_length=5000)
    evaluate: bool = True


@router.post("/current-affairs/{nid}/summary")
def news_summary(nid: int, body: NewsSummaryIn, db: Session = Depends(get_db)):
    """Learner summarizes the issue in their own words; optional AI feedback.
    This is a news-discussion exercise, not an official CELPIP task (task_type NEWS)."""
    r = get_or_404(db, CurrentAffairsItem, nid)
    r.user_summary = body.text
    q = db.scalar(select(PracticeQuestion).where(PracticeQuestion.task_type == "NEWS", PracticeQuestion.current_affairs_id == nid))
    if not q:
        q = PracticeQuestion(
            skill="writing",
            task_type="NEWS",
            title=f"Summary: {r.headline[:250]}",
            prompt=f"Summarize the central issue of this news item in your own words (60-120 words), separating "
            f"reported facts from opinions.\n\nHeadline: {r.headline}\nFeed summary: {r.feed_summary}",
            current_affairs_id=nid,
            source_type="original",
            word_min=60,
            word_max=120,
            archived=True,  # not part of the CELPIP question bank
        )
        db.add(q)
        db.flush()
    a = PracticeAttempt(
        question_id=q.id,
        skill="writing",
        task_type="NEWS",
        mode="news",
        response_text=body.text,
        answers={"news_id": nid},
        word_count=len(body.text.split()),
        submitted_at=utcnow(),
    )
    db.add(a)
    db.commit()
    result = {"attempt_id": a.id, "evaluated": False, "error": None}
    if body.evaluate:
        try:
            evaluator.evaluate_attempt(db, a, get_settings(db))
            result["evaluated"] = True
        except AIError as e:
            result["error"] = e.message
    return result
