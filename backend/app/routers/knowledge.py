from __future__ import annotations

import random
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..db import get_db
from ..models import (
    EntityLink,
    Evaluation,
    Mistake,
    MistakeOccurrence,
    Note,
    NoteFolder,
    PracticeAttempt,
    PracticeQuestion,
    Template,
    TemplatePracticeHistory,
    TopicItem,
    VocabularyItem,
    utcnow,
)
from ..services import search as search_svc
from ..services import srs
from ..services.evaluator import recommend_template
from ..services.sanitize import clean_html, html_to_text
from .common import get_or_404, get_settings, to_dict

router = APIRouter(prefix="/api", tags=["knowledge"])

LINK_TYPES = {"note", "template", "vocabulary", "attempt", "mistake", "topic", "question"}


# ================================================================== templates
class TemplateIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    skill: str
    task_type: str
    intended_use: str = ""
    structure: list[dict] = []
    opening_phrases: list[str] = []
    transition_phrases: list[str] = []
    useful_expressions: list[str] = []
    example_prompt: str = ""
    example_response: str = ""
    why_it_works: str = ""
    common_mistakes: list[str] = []
    adaptation_guidance: str = ""
    vocabulary: list[str] = []
    time_plan: str = ""
    personal_version: str = ""


class TemplatePatch(BaseModel):
    personal_version: str | None = None
    confidence: int | None = Field(None, ge=1, le=5)
    status: str | None = None
    name: str | None = None
    intended_use: str | None = None
    structure: list[dict] | None = None
    opening_phrases: list[str] | None = None
    transition_phrases: list[str] | None = None
    useful_expressions: list[str] | None = None
    example_response: str | None = None
    common_mistakes: list[str] | None = None
    adaptation_guidance: str | None = None
    vocabulary: list[str] | None = None


@router.get("/templates")
def list_templates(skill: str | None = None, task_type: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Template)
    if skill:
        stmt = stmt.where(Template.skill == skill)
    if task_type:
        stmt = stmt.where(Template.task_type == task_type)
    out = []
    for t in db.scalars(stmt.order_by(Template.skill, Template.task_type, Template.id)):
        d = to_dict(t)
        d["task_name"] = fmt.task_name(t.task_type)
        out.append(d)
    return out


@router.get("/templates/recommend")
def recommend(skill: str, task_type: str, db: Session = Depends(get_db)):
    t = recommend_template(db, skill, task_type)
    return to_dict(t) if t else None


@router.get("/templates/{tid}")
def get_template(tid: int, db: Session = Depends(get_db)):
    t = get_or_404(db, Template, tid)
    d = to_dict(t)
    d["task_name"] = fmt.task_name(t.task_type)
    d["history"] = [to_dict(h) for h in t.history]
    d["backlinks"] = backlinks_for(db, "template", tid)
    return d


@router.post("/templates")
def create_template(body: TemplateIn, db: Session = Depends(get_db)):
    found = fmt.task_by_key(body.task_type)
    if not found or found[0] != body.skill:
        raise HTTPException(400, "Unknown task type for this skill")
    t = Template(**body.model_dump(), is_user_created=True, source_type="user")
    db.add(t)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(t)


@router.patch("/templates/{tid}")
def patch_template(tid: int, body: TemplatePatch, db: Session = Depends(get_db)):
    t = get_or_404(db, Template, tid)
    data = body.model_dump(exclude_none=True)
    if "status" in data and data["status"] not in ("learning", "practicing", "mastered", "needs_revision"):
        raise HTTPException(400, "invalid status")
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(t)


class RecallIn(BaseModel):
    success: bool
    notes: str = ""


@router.post("/templates/{tid}/recall")
def recall_check(tid: int, body: RecallIn, db: Session = Depends(get_db)):
    """Record a closed-book recall check (could the learner reproduce the structure without looking?)."""
    t = get_or_404(db, Template, tid)
    t.history.append(TemplatePracticeHistory(used_without_looking=body.success, notes=body.notes or "recall check"))
    if body.success:
        t.times_without_looking += 1
        t.confidence = min(5, t.confidence + 1)
    else:
        t.confidence = max(1, t.confidence - 1)
        if t.status == "mastered":
            t.status = "needs_revision"
    db.commit()
    return to_dict(t)


@router.delete("/templates/{tid}")
def delete_template(tid: int, db: Session = Depends(get_db)):
    t = get_or_404(db, Template, tid)
    if not t.is_user_created:
        raise HTTPException(400, "Starter templates cannot be deleted; edit your personal version instead.")
    db.delete(t)
    db.commit()
    search_svc.mark_dirty()
    return {"ok": True}


# ================================================================== notes
class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None
    icon: str | None = None


@router.get("/note-folders")
def list_folders(db: Session = Depends(get_db)):
    return [to_dict(f) for f in db.scalars(select(NoteFolder).order_by(NoteFolder.order, NoteFolder.name))]


@router.post("/note-folders")
def create_folder(body: FolderIn, db: Session = Depends(get_db)):
    f = NoteFolder(**body.model_dump())
    db.add(f)
    db.commit()
    return to_dict(f)


@router.patch("/note-folders/{fid}")
def rename_folder(fid: int, body: FolderIn, db: Session = Depends(get_db)):
    f = get_or_404(db, NoteFolder, fid)
    f.name = body.name
    f.icon = body.icon
    if body.parent_id != fid:
        f.parent_id = body.parent_id
    db.commit()
    return to_dict(f)


@router.delete("/note-folders/{fid}")
def delete_folder(fid: int, db: Session = Depends(get_db)):
    f = get_or_404(db, NoteFolder, fid)
    # notes are kept (moved to no folder) via ON DELETE SET NULL
    for n in db.scalars(select(Note).where(Note.folder_id == fid)):
        n.folder_id = None
    db.delete(f)
    db.commit()
    return {"ok": True}


class NoteIn(BaseModel):
    title: str = Field("Untitled", max_length=300)
    content_html: str = Field("", max_length=2_000_000)
    folder_id: int | None = None
    tags: list[str] = []
    category: str | None = None
    favorite: bool = False
    icon: str | None = None


class NotePatch(BaseModel):
    title: str | None = Field(None, max_length=300)
    content_html: str | None = Field(None, max_length=2_000_000)
    folder_id: int | None = None
    move_to_root: bool = False
    tags: list[str] | None = None
    category: str | None = None
    favorite: bool | None = None
    icon: str | None = None


def _note_summary(n: Note) -> dict:
    d = to_dict(n, exclude={"content_html", "content_text"})
    d["excerpt"] = (n.content_text or "")[:160]
    return d


_LINK_RE = re.compile(r'data-link-type="(\w+)"\s+data-link-id="(\d+)"')


def _sync_links(db: Session, note: Note) -> None:
    """Re-derive outgoing links from internal links embedded in the note HTML."""
    found = {(t, int(i)) for t, i in _LINK_RE.findall(note.content_html or "") if t in LINK_TYPES}
    existing = list(db.scalars(select(EntityLink).where(EntityLink.source_type == "note", EntityLink.source_id == note.id)))
    for l in existing:
        if (l.target_type, l.target_id) not in found:
            db.delete(l)
    have = {(l.target_type, l.target_id) for l in existing}
    for t, i in found - have:
        db.add(EntityLink(source_type="note", source_id=note.id, target_type=t, target_id=i))


@router.get("/notes")
def list_notes(q: str | None = None, tag: str | None = None, favorite: bool | None = None, folder_id: int | None = None, db: Session = Depends(get_db)):
    stmt = select(Note)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Note.title.ilike(like), Note.content_text.ilike(like)))
    if favorite:
        stmt = stmt.where(Note.favorite.is_(True))
    if folder_id is not None:
        stmt = stmt.where(Note.folder_id == folder_id)
    rows = [n for n in db.scalars(stmt.order_by(Note.order, Note.updated_at.desc()))]
    if tag:
        rows = [n for n in rows if tag in (n.tags or [])]
    return [_note_summary(n) for n in rows]


@router.get("/notes/{nid}")
def get_note(nid: int, db: Session = Depends(get_db)):
    n = get_or_404(db, Note, nid)
    d = to_dict(n)
    d["backlinks"] = backlinks_for(db, "note", nid)
    d["outgoing"] = [
        resolve_link(db, l.target_type, l.target_id)
        for l in db.scalars(select(EntityLink).where(EntityLink.source_type == "note", EntityLink.source_id == nid))
    ]
    return d


@router.post("/notes")
def create_note(body: NoteIn, db: Session = Depends(get_db)):
    html = clean_html(body.content_html)
    n = Note(**{**body.model_dump(), "content_html": html}, content_text=html_to_text(html))
    db.add(n)
    db.flush()
    _sync_links(db, n)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(n)


@router.patch("/notes/{nid}")
def patch_note(nid: int, body: NotePatch, db: Session = Depends(get_db)):
    n = get_or_404(db, Note, nid)
    data = body.model_dump(exclude_none=True)
    move_root = data.pop("move_to_root", False)
    if "content_html" in data:
        data["content_html"] = clean_html(data["content_html"])
        n.content_text = html_to_text(data["content_html"])
    for k, v in data.items():
        setattr(n, k, v)
    if move_root:
        n.folder_id = None
    _sync_links(db, n)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(n)


@router.delete("/notes/{nid}")
def delete_note(nid: int, db: Session = Depends(get_db)):
    n = get_or_404(db, Note, nid)
    db.delete(n)
    for l in db.scalars(select(EntityLink).where(or_(
        (EntityLink.source_type == "note") & (EntityLink.source_id == nid),
        (EntityLink.target_type == "note") & (EntityLink.target_id == nid),
    ))):
        db.delete(l)
    db.commit()
    search_svc.mark_dirty()
    return {"ok": True}


# ================================================================== links
def resolve_link(db: Session, kind: str, id_: int) -> dict:
    model = {
        "note": Note, "template": Template, "vocabulary": VocabularyItem, "attempt": PracticeAttempt,
        "mistake": Mistake, "topic": TopicItem, "question": PracticeQuestion,
    }.get(kind)
    obj = db.get(model, id_) if model else None
    if not obj:
        return {"kind": kind, "id": id_, "title": "(deleted)", "missing": True}
    title = (
        getattr(obj, "title", None) or getattr(obj, "name", None) or getattr(obj, "term", None)
        or getattr(obj, "pattern", None) or f"{fmt.task_name(getattr(obj, 'task_type', ''))} attempt #{id_}"
    )
    return {"kind": kind, "id": id_, "title": title}


def backlinks_for(db: Session, kind: str, id_: int) -> list[dict]:
    rows = db.scalars(select(EntityLink).where(EntityLink.target_type == kind, EntityLink.target_id == id_))
    out = [resolve_link(db, l.source_type, l.source_id) for l in rows]
    # Notes that mention a vocabulary term in plain text also count as references.
    if kind == "vocabulary":
        v = db.get(VocabularyItem, id_)
        if v and len(v.term) >= 3:
            seen = {(o["kind"], o["id"]) for o in out}
            for n in db.scalars(select(Note).where(Note.content_text.ilike(f"%{v.term}%"))):
                if ("note", n.id) not in seen:
                    out.append({"kind": "note", "id": n.id, "title": n.title, "mention": True})
    return out


class LinkIn(BaseModel):
    source_type: str
    source_id: int
    target_type: str
    target_id: int


@router.post("/links")
def create_link(body: LinkIn, db: Session = Depends(get_db)):
    if body.source_type not in LINK_TYPES or body.target_type not in LINK_TYPES:
        raise HTTPException(400, "invalid link type")
    exists = db.scalar(select(EntityLink).where(
        EntityLink.source_type == body.source_type, EntityLink.source_id == body.source_id,
        EntityLink.target_type == body.target_type, EntityLink.target_id == body.target_id,
    ))
    if not exists:
        db.add(EntityLink(**body.model_dump()))
        db.commit()
    return {"ok": True}


@router.get("/links/lookup")
def link_lookup(q: str = "", db: Session = Depends(get_db)):
    """Autocomplete for inserting internal links into notes."""
    like = f"%{q}%"
    out = []
    for n in db.scalars(select(Note).where(Note.title.ilike(like)).limit(6)):
        out.append({"kind": "note", "id": n.id, "title": n.title})
    for t in db.scalars(select(Template).where(Template.name.ilike(like)).limit(6)):
        out.append({"kind": "template", "id": t.id, "title": t.name})
    for v in db.scalars(select(VocabularyItem).where(VocabularyItem.term.ilike(like)).limit(6)):
        out.append({"kind": "vocabulary", "id": v.id, "title": v.term})
    for m in db.scalars(select(Mistake).where(Mistake.pattern.ilike(like)).limit(4)):
        out.append({"kind": "mistake", "id": m.id, "title": m.pattern})
    for t in db.scalars(select(TopicItem).where(TopicItem.title.ilike(like)).limit(4)):
        out.append({"kind": "topic", "id": t.id, "title": t.title})
    return out


# ================================================================== vocabulary
class VocabIn(BaseModel):
    term: str = Field(min_length=1, max_length=200)
    meaning: str = ""
    part_of_speech: str = ""
    example: str = ""
    collocations: list[str] = []
    synonyms: list[str] = []
    usage_notes: str = ""
    formality: str = "neutral"
    skills: list[str] = []
    task_types: list[str] = []
    tags: list[str] = []
    context: str = ""
    regional_note: str = ""
    practice_exercise: str = ""
    source_type: str = "user"
    source_attempt_id: int | None = None
    source_ref: str | None = None
    personal_example: str = ""


class VocabPatch(BaseModel):
    term: str | None = None
    meaning: str | None = None
    part_of_speech: str | None = None
    example: str | None = None
    collocations: list[str] | None = None
    synonyms: list[str] | None = None
    usage_notes: str | None = None
    formality: str | None = None
    skills: list[str] | None = None
    tags: list[str] | None = None
    personal_example: str | None = None
    confidence: int | None = Field(None, ge=1, le=5)
    status: str | None = None


@router.get("/vocabulary")
def list_vocab(q: str | None = None, status: str | None = None, tag: str | None = None, skill: str | None = None, db: Session = Depends(get_db)):
    stmt = select(VocabularyItem)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(VocabularyItem.term.ilike(like), VocabularyItem.meaning.ilike(like)))
    if status:
        stmt = stmt.where(VocabularyItem.status == status)
    rows = list(db.scalars(stmt.order_by(VocabularyItem.created_at.desc())))
    if tag:
        rows = [v for v in rows if tag in (v.tags or [])]
    if skill:
        rows = [v for v in rows if skill in (v.skills or [])]
    return [to_dict(v) for v in rows]


@router.get("/vocabulary/queue")
def review_queue(db: Session = Depends(get_db)):
    """Daily review queue: due items first, then up to N new items."""
    s = get_settings(db)
    today = date.today()
    due = list(db.scalars(select(VocabularyItem).where(VocabularyItem.review_count > 0, VocabularyItem.due_date <= today).order_by(VocabularyItem.due_date)))
    new = list(db.scalars(select(VocabularyItem).where(VocabularyItem.review_count == 0).order_by(VocabularyItem.created_at).limit(s.vocab_daily_new_limit)))
    return {"due": [to_dict(v) for v in due], "new": [to_dict(v) for v in new], "intervals": s.srs_intervals}


@router.get("/vocabulary/quiz")
def vocab_quiz(kind: str = "meaning", n: int = 10, db: Session = Depends(get_db)):
    """Deterministic quizzes built from saved items (no AI): meaning MCQ or fill-in-the-blank."""
    items = [v for v in db.scalars(select(VocabularyItem)) if v.meaning]
    if len(items) < 4:
        raise HTTPException(409, "Save at least 4 vocabulary items with meanings to start a quiz.")
    today = date.today()
    items.sort(key=lambda v: (v.due_date or today) > today)  # due items first
    pool = items[: max(n * 2, 10)]
    random.shuffle(pool)
    out = []
    for v in pool:
        if len(out) >= n:
            break
        distractors = random.sample([x for x in items if x.id != v.id], 3)
        if kind == "fill":
            sentence = v.example or v.personal_example
            if not sentence or not re.search(re.escape(v.term), sentence, re.I):
                continue
            blank = re.sub(re.escape(v.term), "_____", sentence, count=1, flags=re.I)
            options = [v.term] + [d.term for d in distractors]
            random.shuffle(options)
            out.append({"item_id": v.id, "kind": "fill", "prompt": blank, "options": options, "answer": options.index(v.term)})
        else:
            options = [v.meaning] + [d.meaning for d in distractors]
            random.shuffle(options)
            out.append({"item_id": v.id, "kind": "meaning", "prompt": v.term, "options": options, "answer": options.index(v.meaning)})
    if not out:
        raise HTTPException(409, "Not enough items with example sentences for fill-in-the-blank yet.")
    return out


@router.get("/vocabulary/{vid}")
def get_vocab(vid: int, db: Session = Depends(get_db)):
    v = get_or_404(db, VocabularyItem, vid)
    d = to_dict(v)
    d["reviews"] = [to_dict(r) for r in v.reviews]
    d["backlinks"] = backlinks_for(db, "vocabulary", vid)
    if v.source_attempt_id:
        d["backlinks"].append(resolve_link(db, "attempt", v.source_attempt_id))
    return d


@router.post("/vocabulary")
def create_vocab(body: VocabIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(VocabularyItem).where(VocabularyItem.term.ilike(body.term.strip())))
    if existing:
        return {**to_dict(existing), "duplicate": True}
    v = VocabularyItem(**{**body.model_dump(), "term": body.term.strip()}, due_date=date.today())
    db.add(v)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(v)


@router.patch("/vocabulary/{vid}")
def patch_vocab(vid: int, body: VocabPatch, db: Session = Depends(get_db)):
    v = get_or_404(db, VocabularyItem, vid)
    data = body.model_dump(exclude_none=True)
    if "status" in data and data["status"] not in ("new", "learning", "familiar", "mastered"):
        raise HTTPException(400, "invalid status")
    for k, val in data.items():
        setattr(v, k, val)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(v)


@router.delete("/vocabulary/{vid}")
def delete_vocab(vid: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, VocabularyItem, vid))
    db.commit()
    search_svc.mark_dirty()
    return {"ok": True}


class ReviewIn(BaseModel):
    result: str
    mode: str = "card"


@router.post("/vocabulary/{vid}/review")
def review_vocab(vid: int, body: ReviewIn, db: Session = Depends(get_db)):
    v = get_or_404(db, VocabularyItem, vid)
    try:
        srs.review(v, body.result, body.mode, get_settings(db).srs_intervals)
    except ValueError as e:
        raise HTTPException(400, str(e))
    db.commit()
    return to_dict(v)


class UsageIn(BaseModel):
    used_correctly: bool


@router.post("/vocabulary/{vid}/usage")
def record_usage(vid: int, body: UsageIn, db: Session = Depends(get_db)):
    """Self-reported active use in the learner's own writing/speaking."""
    v = get_or_404(db, VocabularyItem, vid)
    if body.used_correctly:
        v.used_correctly_count += 1
        v.last_used_at = utcnow()
    db.add_all([])
    db.commit()
    return to_dict(v)


# ================================================================== mistakes
@router.get("/mistakes")
def list_mistakes(skill: str | None = None, category: str | None = None, status: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Mistake)
    if skill:
        stmt = stmt.where(Mistake.skill == skill)
    if category:
        stmt = stmt.where(Mistake.category == category)
    if status:
        stmt = stmt.where(Mistake.status == status)
    rows = db.scalars(stmt.order_by((Mistake.occurrence_count * Mistake.severity).desc(), Mistake.last_seen_at.desc()))
    return [to_dict(m) for m in rows]


@router.get("/mistakes/{mid}")
def get_mistake(mid: int, db: Session = Depends(get_db)):
    m = get_or_404(db, Mistake, mid)
    d = to_dict(m)
    d["occurrences"] = []
    for o in m.occurrences:
        od = to_dict(o)
        if o.attempt_id:
            a = db.get(PracticeAttempt, o.attempt_id)
            od["attempt"] = {"id": a.id, "task_name": fmt.task_name(a.task_type), "submitted_at": a.submitted_at.isoformat() if a and a.submitted_at else None} if a else None
        d["occurrences"].append(od)
    d["backlinks"] = backlinks_for(db, "mistake", mid)
    return d


class MistakeIn(BaseModel):
    category: str
    skill: str
    pattern: str = Field(min_length=3, max_length=300)
    original_example: str = ""
    corrected_example: str = ""
    explanation: str = ""
    recommended_exercise: str = ""
    severity: int = Field(2, ge=1, le=3)


@router.post("/mistakes")
def create_mistake(body: MistakeIn, db: Session = Depends(get_db)):
    if body.category not in fmt.MISTAKE_CATEGORIES:
        raise HTTPException(400, "invalid category")
    m = Mistake(**body.model_dump(), occurrence_count=1)
    db.add(m)
    db.commit()
    search_svc.mark_dirty()
    return to_dict(m)


class MistakePatch(BaseModel):
    status: str | None = None
    recommended_exercise: str | None = None
    explanation: str | None = None
    severity: int | None = Field(None, ge=1, le=3)


@router.patch("/mistakes/{mid}")
def patch_mistake(mid: int, body: MistakePatch, db: Session = Depends(get_db)):
    m = get_or_404(db, Mistake, mid)
    data = body.model_dump(exclude_none=True)
    if "status" in data and data["status"] not in ("open", "improving", "resolved"):
        raise HTTPException(400, "invalid status")
    for k, v in data.items():
        setattr(m, k, v)
    db.commit()
    return to_dict(m)


@router.delete("/mistakes/{mid}")
def delete_mistake(mid: int, db: Session = Depends(get_db)):
    db.delete(get_or_404(db, Mistake, mid))
    db.commit()
    search_svc.mark_dirty()
    return {"ok": True}


# ================================================================== search
@router.get("/search")
def search(q: str, db: Session = Depends(get_db)):
    return search_svc.search(db, q)


# ================================================================== save-from helpers
class SaveFromEvaluationIn(BaseModel):
    evaluation_id: int
    index: int


@router.post("/vocabulary/from-evaluation")
def vocab_from_evaluation(body: SaveFromEvaluationIn, db: Session = Depends(get_db)):
    ev = get_or_404(db, Evaluation, body.evaluation_id)
    try:
        s = ev.vocabulary_suggestions[body.index]
    except (IndexError, TypeError):
        raise HTTPException(404, "suggestion not found")
    term = (s.get("suggestion") or "").strip()
    if not term:
        raise HTTPException(400, "empty suggestion")
    a = ev.attempt
    return create_vocab(
        VocabIn(
            term=term[:200],
            meaning=s.get("meaning", ""),
            example=s.get("example", ""),
            collocations=s.get("collocations", []),
            formality=s.get("formality", "neutral"),
            usage_notes=f"Instead of: “{s.get('original', '')}”" if s.get("original") else "",
            skills=[a.skill],
            task_types=[a.task_type],
            source_type="evaluation",
            source_attempt_id=a.id,
            source_ref=f"Evaluation #{ev.id}",
        ),
        db,
    )
