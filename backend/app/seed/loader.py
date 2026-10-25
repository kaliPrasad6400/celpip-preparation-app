"""Loads the starter content library from app/seed/data/*.json.

Each file is applied once (recorded in imported_resources as kind='seed'), and rows are
de-duplicated by natural key, so adding new files later only adds new content and
never overwrites the user's edits. See CONTENT_SOURCES.md for provenance.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..models import (
    ContentSource,
    ImportedResource,
    Note,
    NoteFolder,
    PracticeQuestion,
    Template,
    TopicCategory,
    TopicItem,
    UserSettings,
    VocabularyItem,
)
from ..services.sanitize import clean_html, html_to_text

log = logging.getLogger("celpip.seed")
DATA = Path(__file__).parent / "data"

# order matters: sources/topics before questions
ORDER = ["sources", "topics", "templates", "vocabulary", "notes", "questions"]


def _done(db: Session, key: str) -> bool:
    return db.scalar(select(ImportedResource).where(ImportedResource.kind == "seed", ImportedResource.title == key)) is not None


def _mark(db: Session, key: str) -> None:
    db.add(ImportedResource(title=key, kind="seed", source_type="original", content=""))


def _files():
    files = sorted(DATA.glob("*.json"))
    def rank(p: Path):
        for i, pre in enumerate(ORDER):
            if p.stem.startswith(pre):
                return (i, p.stem)
        return (99, p.stem)
    return sorted(files, key=rank)


def seed_all(db: Session) -> dict:
    if db.scalar(select(UserSettings).limit(1)) is None:
        db.add(UserSettings(id=1, exam_date=date(2026, 12, 3)))
        db.commit()
    counts = {}
    for f in _files():
        key = f"seed:{f.name}"
        if _done(db, key):
            continue
        data = json.loads(f.read_text(encoding="utf-8"))
        kind = next((p for p in ORDER if f.stem.startswith(p)), None)
        handler = HANDLERS.get(kind)
        if not handler:
            continue
        try:
            n = handler(db, data)
            _mark(db, key)
            db.commit()
            counts[f.name] = n
        except Exception:
            db.rollback()
            log.exception("seed file failed: %s", f.name)
            raise
    if counts:
        log.info("seeded %s", counts)
    return counts


def seed_sources(db: Session, data: list) -> int:
    n = 0
    for s in data:
        if db.scalar(select(ContentSource).where(ContentSource.url == s["url"])):
            continue
        checked = s.pop("checked_on", None)
        src = ContentSource(**s)
        if checked:
            src.last_checked_on = date.fromisoformat(checked)
        db.add(src)
        n += 1
    return n


def seed_topics(db: Session, data: dict) -> int:
    n = 0
    cats = {}
    for c in data.get("categories", []):
        cat = db.scalar(select(TopicCategory).where(TopicCategory.slug == c["slug"]))
        if not cat:
            cat = TopicCategory(**c)
            db.add(cat)
            db.flush()
        cats[c["slug"]] = cat
    for c in db.scalars(select(TopicCategory)):
        cats.setdefault(c.slug, c)
    for it in data.get("items", []):
        cat = cats.get(it["category"])
        if not cat:
            raise ValueError(f"unknown topic category {it['category']}")
        if db.scalar(select(TopicItem).where(TopicItem.title == it["title"], TopicItem.category_id == cat.id)):
            continue
        fields = {k: v for k, v in it.items() if k != "category"}
        if "content_html" in fields:
            fields["content_html"] = clean_html(fields["content_html"])
        db.add(TopicItem(category_id=cat.id, **fields))
        n += 1
    return n


def seed_templates(db: Session, data: list) -> int:
    n = 0
    for t in data:
        found = fmt.task_by_key(t["task_type"])
        if not found or found[0] != t["skill"]:
            raise ValueError(f"template {t['name']}: bad task type {t['task_type']}")
        if db.scalar(select(Template).where(Template.name == t["name"])):
            continue
        db.add(Template(**{k: v for k, v in t.items() if k != "source_type"}, source_type="original"))
        n += 1
    return n


def seed_vocabulary(db: Session, data: list) -> int:
    n = 0
    for v in data:
        if db.scalar(select(VocabularyItem).where(VocabularyItem.term == v["term"])):
            continue
        fields = {k: val for k, val in v.items() if k != "source_type"}
        db.add(VocabularyItem(**fields, source_type=v.get("source_type", "seed"), due_date=date.today()))
        n += 1
    return n


def seed_notes(db: Session, data: dict) -> int:
    n = 0
    folders = {}
    for i, f in enumerate(data.get("folders", [])):
        fo = db.scalar(select(NoteFolder).where(NoteFolder.name == f["name"]))
        if not fo:
            fo = NoteFolder(name=f["name"], icon=f.get("icon"), order=i)
            db.add(fo)
            db.flush()
        folders[f["name"]] = fo
    for i, nt in enumerate(data.get("notes", [])):
        if db.scalar(select(Note).where(Note.title == nt["title"])):
            continue
        html = clean_html(nt.get("content_html", ""))
        db.add(
            Note(
                title=nt["title"],
                folder_id=folders[nt["folder"]].id if nt.get("folder") in folders else None,
                content_html=html,
                content_text=html_to_text(html),
                tags=nt.get("tags", []),
                category=nt.get("category"),
                favorite=nt.get("favorite", False),
                icon=nt.get("icon"),
                order=i,
                source_type=nt.get("source_type", "original"),
            )
        )
        n += 1
    return n


def _validate_question(q: dict) -> None:
    found = fmt.task_by_key(q["task_type"])
    if not found or found[0] != q["skill"]:
        raise ValueError(f"question {q.get('title')}: bad task type")
    if q["skill"] in ("listening", "reading"):
        items = q.get("items") or []
        if not items:
            raise ValueError(f"question {q['title']}: objective question needs items")
        ids = set()
        for it in items:
            if not (0 <= it["answer"] < len(it["options"])):
                raise ValueError(f"question {q['title']} item {it['id']}: answer out of range")
            if it["id"] in ids:
                raise ValueError(f"question {q['title']}: duplicate item id {it['id']}")
            ids.add(it["id"])
        body = (q.get("content") or {}).get("script" if q["skill"] == "listening" else "passage")
        if not body:
            raise ValueError(f"question {q['title']}: missing script/passage")


def seed_questions(db: Session, data: list) -> int:
    n = 0
    topics = {t.title: t.id for t in db.scalars(select(TopicItem))}
    for q in data:
        _validate_question(q)
        if db.scalar(select(PracticeQuestion).where(PracticeQuestion.title == q["title"], PracticeQuestion.task_type == q["task_type"])):
            continue
        fields = {k: v for k, v in q.items() if k not in ("topic", "source_type")}
        found = fmt.task_by_key(q["task_type"])[1]
        if q["skill"] == "speaking":
            fields.setdefault("prep_time_sec", found["prep"])
            fields.setdefault("time_limit_sec", found["response"])
        elif q["skill"] == "writing":
            fields.setdefault("word_min", 150)
            fields.setdefault("word_max", 200)
            fields.setdefault("time_limit_sec", found["minutes"] * 60)
        db.add(PracticeQuestion(**fields, topic_item_id=topics.get(q.get("topic")), source_type=q.get("source_type", "original")))
        n += 1
    return n


HANDLERS = {
    "sources": seed_sources,
    "topics": seed_topics,
    "templates": seed_templates,
    "vocabulary": seed_vocabulary,
    "notes": seed_notes,
    "questions": seed_questions,
}
