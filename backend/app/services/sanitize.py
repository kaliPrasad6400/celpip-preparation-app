"""Server-side sanitization for rich text (TipTap HTML). The frontend also sanitizes
with DOMPurify before rendering."""
from __future__ import annotations

import html
import re

import bleach
from bleach.css_sanitizer import CSSSanitizer

ALLOWED_TAGS = [
    "p", "br", "h1", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "mark", "code", "pre",
    "blockquote", "ul", "ol", "li", "a", "hr", "table", "thead", "tbody", "tr", "th", "td",
    "label", "input", "div", "span",
]
ALLOWED_ATTRS = {
    "a": ["href", "title", "target", "rel", "data-link-type", "data-link-id"],
    "mark": ["data-color", "style"],
    "li": ["data-type", "data-checked"],
    "ul": ["data-type"],
    "input": ["type", "checked", "disabled"],
    "th": ["colspan", "rowspan", "colwidth"],
    "td": ["colspan", "rowspan", "colwidth"],
    "span": ["data-type", "data-id", "data-label", "class"],
    "div": ["data-type"],
    "label": ["contenteditable"],
}
_css = CSSSanitizer(allowed_css_properties=["background-color", "color"])


def clean_html(raw: str) -> str:
    return bleach.clean(
        raw or "",
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRS,
        protocols=["http", "https", "mailto", "app"],
        css_sanitizer=_css,
        strip=True,
    )


def html_to_text(raw: str) -> str:
    t = re.sub(r"<(br|/p|/h\d|/li|/tr)[^>]*>", "\n", raw or "")
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"[ \t]+", " ", html.unescape(t)).strip()
