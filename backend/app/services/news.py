"""Current-affairs retrieval from registered public RSS/Atom feeds.

Only metadata published in the feed is stored: headline, publisher, publication date,
original URL and the feed's own short summary (truncated). Full articles are never
scraped or copied. AI enrichment works only from that summary and is flagged as
AI-generated interpretation.
"""
from __future__ import annotations

import html
import logging
import re
from datetime import datetime, timezone

import feedparser
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ContentSource, CurrentAffairsItem, TopicCategory, UserSettings, utcnow
from .ai import AIError, complete_json
from .evaluator import _arr, _int, _obj, _str

log = logging.getLogger("celpip.news")
UA = "CELPIP-Mastery-12/1.0 (personal study app; RSS reader)"
SUMMARY_MAX = 600

CATEGORY_KEYWORDS = {
    "housing-affordability": ["housing", "rent", "tenant", "mortgage", "home price", "landlord"],
    "public-transit": ["transit", "bus", "subway", "train", "commut", "lrt", "transport"],
    "workplace-remote-work": ["remote work", "return to office", "workers", "employment", "jobs", "labour", "union", "wage"],
    "environment-energy": ["climate", "emission", "energy", "wildfire", "environment", "recycl", "flood"],
    "public-services": ["health", "hospital", "doctor", "school", "library", "service", "benefit"],
    "technology-privacy": ["technology", "ai ", "artificial intelligence", "privacy", "cyber", "data"],
    "community-safety": ["police", "safety", "crime", "road", "pedestrian"],
}


def _clean(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    return text[:SUMMARY_MAX] + ("…" if len(text) > SUMMARY_MAX else "")


def _date(entry) -> datetime | None:
    for k in ("published_parsed", "updated_parsed"):
        t = entry.get(k)
        if t:
            return datetime(*t[:6], tzinfo=timezone.utc).replace(tzinfo=None)
    return None


def categorize(db: Session, text: str) -> int | None:
    low = text.lower()
    for slug, words in CATEGORY_KEYWORDS.items():
        if any(w in low for w in words):
            cat = db.scalar(select(TopicCategory).where(TopicCategory.slug == slug))
            if cat:
                return cat.id
    return None


def fetch_source(db: Session, src: ContentSource, limit: int = 25) -> int:
    if not src.feed_url:
        return 0
    try:
        r = httpx.get(src.feed_url, headers={"User-Agent": UA}, timeout=20.0, follow_redirects=True)
        r.raise_for_status()
        parsed = feedparser.parse(r.content)
        if parsed.bozo and not parsed.entries:
            raise ValueError("feed could not be parsed")
    except Exception as e:  # network, HTTP, parse
        src.last_error = f"{type(e).__name__}: {str(e)[:200]}"
        src.last_checked_on = utcnow().date()
        db.commit()
        log.warning("feed failed source=%s err=%s", src.name, type(e).__name__)
        return 0
    added = 0
    for entry in parsed.entries[:limit]:
        link = entry.get("link")
        title = _clean(entry.get("title", ""))
        if not link or not title or not link.startswith("http"):
            continue
        existing = db.scalar(select(CurrentAffairsItem).where(CurrentAffairsItem.url == link))
        if existing:
            existing.last_verified_at = utcnow()
            continue
        summary = _clean(entry.get("summary", ""))
        db.add(
            CurrentAffairsItem(
                source_id=src.id,
                headline=title,
                publisher=src.name,
                published_at=_date(entry),
                url=link,
                feed_summary=summary,
                topic_category_id=categorize(db, f"{title} {summary}"),
                verification_status="retrieved",
                retrieved_at=utcnow(),
                last_verified_at=utcnow(),
            )
        )
        added += 1
    src.last_success_at = utcnow()
    src.last_checked_on = utcnow().date()
    src.last_error = None
    db.commit()
    return added


def refresh_all(db: Session) -> dict:
    out = {}
    for src in db.scalars(select(ContentSource).where(ContentSource.enabled.is_(True), ContentSource.feed_url.is_not(None))):
        out[src.name] = fetch_source(db, src)
    return out


ENRICH_SCHEMA = _obj(
    {
        "main_issue": _str,
        "important_facts": _arr(_str),
        "viewpoints": _arr(_obj({"holder": _str, "position": _str, "type": {"type": "string", "enum": ["reported", "possible_perspective"]}})),
        "vocabulary": _arr(_obj({"term": _str, "meaning": _str, "example": _str, "collocations": _arr(_str), "tone": _str})),
        "questions": _arr(_obj({"question": _str, "kind": {"type": "string", "enum": ["comprehension", "fact_or_opinion", "discussion", "summary"]}})),
        "difficulty": _int,
    }
)


def enrich(db: Session, item: CurrentAffairsItem, s: UserSettings) -> CurrentAffairsItem:
    if not item.feed_summary and not item.headline:
        raise AIError("nothing", "This item has no summary text to work from.")
    user = (
        f"Headline: {item.headline}\nPublisher: {item.publisher}\nPublished: {item.published_at}\n"
        f"Feed summary (the ONLY factual source you may use):\n{item.feed_summary or '(none — headline only)'}\n\n"
        "Produce English-learning support material:\n"
        "- main_issue: one neutral sentence.\n"
        "- important_facts: ONLY facts explicitly stated in the headline/summary (may be empty). No outside facts, "
        "no numbers that are not in the text.\n"
        "- viewpoints: type='reported' only if a view is attributed in the text; otherwise 'possible_perspective' "
        "describing reasonable stakeholder perspectives in neutral language.\n"
        "- vocabulary: 5-8 useful words/collocations from or about the topic.\n"
        "- questions: 4-6 questions (comprehension, fact_or_opinion, discussion, summary).\n"
        "- difficulty: 1-5 estimated reading difficulty."
    )
    res = complete_json(
        db,
        s,
        system="You create neutral, accurate English-learning material from news metadata. Never invent facts, "
        "quotations, statistics or dates. Use balanced framing on controversial topics.",
        user=user,
        schema=ENRICH_SCHEMA,
        purpose="news_enrich",
        max_tokens=4000,
    )
    d = res.data
    item.main_issue = d.get("main_issue", "")
    item.important_facts = d.get("important_facts", [])
    item.viewpoints = d.get("viewpoints", [])
    item.vocabulary = d.get("vocabulary", [])
    item.questions = d.get("questions", [])
    item.difficulty = max(1, min(5, int(d.get("difficulty") or 3)))
    item.ai_enriched = True
    db.commit()
    return item
