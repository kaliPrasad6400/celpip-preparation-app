"""Local full-text search across notes, vocabulary, templates, mistakes and topics.

Uses a SQLite FTS5 index (search_index) rebuilt lazily when content changes
(cheap at personal-data scale). Falls back to LIKE if FTS5 is unavailable.
"""
from __future__ import annotations

import re

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..models import Mistake, Note, Template, TopicItem, VocabularyItem

_dirty = True


def mark_dirty() -> None:
    global _dirty
    _dirty = True


def _docs(db: Session):
    for n in db.scalars(select(Note)):
        yield "note", n.id, n.title, f"{n.content_text} {' '.join(n.tags or [])}"
    for v in db.scalars(select(VocabularyItem)):
        yield "vocabulary", v.id, v.term, f"{v.meaning} {v.example} {' '.join(v.collocations or [])} {v.usage_notes} {v.personal_example}"
    for t in db.scalars(select(Template)):
        yield "template", t.id, t.name, f"{t.intended_use} {t.example_response} {' '.join(t.useful_expressions or [])} {t.personal_version}"
    for m in db.scalars(select(Mistake)):
        yield "mistake", m.id, m.pattern, f"{m.original_example} {m.corrected_example} {m.explanation}"
    for ti in db.scalars(select(TopicItem)):
        yield "topic", ti.id, ti.title, f"{ti.scenario} {ti.background} {re.sub('<[^>]+>', ' ', ti.content_html or '')}"


def rebuild(db: Session) -> bool:
    global _dirty
    conn = db.connection()
    try:
        conn.execute(text("CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(kind UNINDEXED, ref UNINDEXED, title, body, tokenize='porter unicode61')"))
        conn.execute(text("DELETE FROM search_index"))
        for kind, ref, title, body in _docs(db):
            conn.execute(text("INSERT INTO search_index(kind, ref, title, body) VALUES (:k,:r,:t,:b)"), {"k": kind, "r": ref, "t": title, "b": body})
        db.commit()
        _dirty = False
        return True
    except Exception:
        db.rollback()
        return False


def search(db: Session, q: str, limit: int = 40) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    if _dirty:
        ok = rebuild(db)
    else:
        ok = True
    if ok:
        terms = [re.sub(r'[^\w\'-]', '', t) for t in q.split()]
        terms = [t for t in terms if t]
        if not terms:
            return []
        match = " ".join(f'"{t}"*' for t in terms)
        try:
            rows = db.execute(
                text(
                    "SELECT kind, ref, title, snippet(search_index, 3, '[', ']', '…', 12) AS snip "
                    "FROM search_index WHERE search_index MATCH :m ORDER BY bm25(search_index, 0, 0, 5.0, 1.0) LIMIT :l"
                ),
                {"m": match, "l": limit},
            ).all()
            return [{"kind": r[0], "id": int(r[1]), "title": r[2], "snippet": r[3]} for r in rows]
        except Exception:
            pass
    # LIKE fallback
    like = q.lower()
    out = []
    for kind, ref, title, body in _docs(db):
        hay = f"{title} {body}".lower()
        if like in hay:
            i = hay.find(like)
            out.append({"kind": kind, "id": ref, "title": title, "snippet": hay[max(0, i - 50): i + 80]})
        if len(out) >= limit:
            break
    return out
