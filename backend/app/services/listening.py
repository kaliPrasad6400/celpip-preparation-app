"""Listening audio: section plan + natural-voice generation (Gemini TTS) with caching.

Section plan
  Scripts may contain Narrator marker turns such as "[Section 1]". Each section is played,
  then only its questions are shown (CELPIP Listening Part 1 works this way). Items carry an
  explicit `section`; if missing (e.g. AI-generated sets), they are assigned by word overlap
  with each section's script, kept in non-decreasing order. Scripts without markers are one
  section with all questions.

Audio
  Each speaker turn is synthesized separately (short requests are the most faithful — a
  multi-turn request was observed to silently drop lines), checked for plausible duration
  (retried, then the fallback model), and the turns are joined with short pauses into one WAV
  per section, cached under data/tts/. The cache key includes the text, voices and model, so
  edited scripts are regenerated automatically.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import re
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from sqlalchemy.orm import Session

from .. import config
from ..models import ApiUsage, PracticeQuestion, UserSettings
from .ai import AIError, _gemini_error, _gemini_post, check_limits

log = logging.getLogger("celpip.tts")

TTS_MODEL = "gemini-3.1-flash-tts-preview"
TTS_FALLBACK = "gemini-2.5-flash-preview-tts"
RATE = 24000  # Gemini TTS returns 16-bit mono PCM at 24 kHz
GAP_SEC = 0.45
TTS_PRICE = (0.50, 10.0)  # USD per 1M input/output tokens — approximate

FEMALE_VOICES = ["Kore", "Aoede", "Leda", "Despina", "Callirrhoe", "Zephyr"]
MALE_VOICES = ["Puck", "Orus", "Iapetus", "Algieba", "Fenrir", "Umbriel"]
NARRATOR_VOICE = "Charon"
_MARK = re.compile(r"^\[?\s*(section|part)\s*\d+\s*\]?\.?$", re.I)
_STOP = set(
    "the a an and or to of in on for is are was were be it that this he she they you i we his her their with at by "
    "as from not do does did will would can could should has have had so but if about what which who why how when".split()
)


def tts_dir() -> Path:
    d = config.DATA_DIR / "tts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def tts_available() -> bool:
    return bool(config.get_secret("GEMINI_API_KEY"))


# ------------------------------------------------------------------ sections
def _is_marker(seg: dict) -> bool:
    return seg.get("speaker", "").lower().startswith("narrator") and bool(_MARK.match(seg.get("text", "").strip()))


def split_sections(script: list[dict]) -> list[dict]:
    """[{label, segments:[...]}] — marker turns become section boundaries and are not spoken."""
    sections: list[dict] = []
    current = {"label": None, "segments": []}
    for seg in script:
        if _is_marker(seg):
            if current["segments"]:
                sections.append(current)
            current = {"label": seg["text"].strip("[] ."), "segments": []}
        else:
            current["segments"].append(seg)
    if current["segments"]:
        sections.append(current)
    return sections or [{"label": None, "segments": []}]


def _toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9']+", s.lower()) if w not in _STOP and len(w) > 2}


def section_plan(q: PracticeQuestion) -> list[dict]:
    script = (q.content or {}).get("script", [])
    secs = split_sections(script)
    items = q.items or []
    if len(secs) == 1:
        assign = [1] * len(items)
    else:
        sec_toks = [_toks(" ".join(s["text"] for s in sec["segments"])) for sec in secs]
        assign, prev = [], 1
        for it in items:
            if isinstance(it.get("section"), int) and 1 <= it["section"] <= len(secs):
                sec = it["section"]
            else:
                t = _toks(f"{it['stem']} {it['options'][it['answer']]} {it.get('explanation', '')}")
                scores = [len(t & st) / (len(t) or 1) for st in sec_toks]
                sec = max(range(prev - 1, len(secs)), key=lambda k: (scores[k], -k)) + 1
            sec = max(sec, prev)  # questions never refer back to an earlier section
            assign.append(sec)
            prev = sec
    plan = []
    for k, sec in enumerate(secs, start=1):
        plan.append(
            {
                "index": k,
                "label": sec["label"] or (f"Section {k}" if len(secs) > 1 else None),
                "item_ids": [str(it["id"]) for it, a in zip(items, assign) if a == k],
                "turns": len(sec["segments"]),
            }
        )
    return plan


# ------------------------------------------------------------------ voices & cache
def voice_map(q: PracticeQuestion) -> dict[str, str]:
    content = q.content or {}
    genders = content.get("voices", {})
    out, fi, mi = {}, 0, 0
    for seg in content.get("script", []):
        sp = seg.get("speaker", "")
        if sp in out or _is_marker(seg):
            continue
        g = genders.get(sp)
        if sp.lower().startswith(("narrator", "announcer", "newsreader", "host")) and not g:
            out[sp] = NARRATOR_VOICE
        elif g == "female":
            out[sp] = FEMALE_VOICES[fi % len(FEMALE_VOICES)]
            fi += 1
        elif g == "male":
            out[sp] = MALE_VOICES[mi % len(MALE_VOICES)]
            mi += 1
        else:  # unknown gender: alternate so speakers stay distinguishable
            if (fi + mi) % 2 == 0:
                out[sp] = FEMALE_VOICES[fi % len(FEMALE_VOICES)]
                fi += 1
            else:
                out[sp] = MALE_VOICES[mi % len(MALE_VOICES)]
                mi += 1
    return out


def _cache_path(q: PracticeQuestion, section: int, segments: list[dict], voices: dict) -> Path:
    h = hashlib.sha256(
        (TTS_MODEL + repr([(s["speaker"], s["text"]) for s in segments]) + repr(sorted(voices.items()))).encode()
    ).hexdigest()[:16]
    return tts_dir() / f"q{q.id}-s{section}-{h}.wav"


def cached_audio(q: PracticeQuestion, section: int) -> Path | None:
    secs = split_sections((q.content or {}).get("script", []))
    if not 1 <= section <= len(secs):
        return None
    p = _cache_path(q, section, secs[section - 1]["segments"], voice_map(q))
    return p if p.exists() else None


# ------------------------------------------------------------------ synthesis
def _expected_seconds(text: str) -> float:
    return len(text.split()) / 2.7  # ~160 words per minute


def _speak(key: str, text: str, voice: str, model: str) -> tuple[bytes, int, int]:
    body = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
        },
    }
    r = _gemini_post(key, model, body, 120.0)
    if r.status_code != 200:
        raise _gemini_error(r)
    d = r.json()
    try:
        data = d["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]
    except (KeyError, IndexError):
        raise AIError("invalid_output", "Speech generation returned no audio.", True)
    u = d.get("usageMetadata", {})
    return base64.b64decode(data), int(u.get("promptTokenCount") or 0), int(u.get("candidatesTokenCount") or 0)


def _speak_checked(key: str, text: str, voice: str) -> tuple[bytes, int, int]:
    """Synthesize one turn; retry (then fallback model) if the audio is implausibly short."""
    expected = _expected_seconds(text)
    tin = tout = 0
    last = b""
    models = (TTS_MODEL, TTS_MODEL, TTS_MODEL, TTS_FALLBACK, TTS_FALLBACK)
    for attempt, model in enumerate(models):
        try:
            pcm, i, o = _speak(key, text, voice, model)
        except AIError as e:
            if not e.retryable or attempt == len(models) - 1:
                raise
            log.warning("tts turn failed (%s) model=%s — retrying", e.code, model)
            time.sleep(5 * 2**attempt)  # 5, 10, 20, 40 s: TTS quotas are per minute
            continue
        tin, tout = tin + i, tout + o
        secs = len(pcm) / (RATE * 2)
        if secs >= 0.55 * expected or expected < 1.5:
            return pcm, tin, tout
        log.warning("tts turn too short (%.1fs vs ~%.1fs expected) model=%s — retrying", secs, expected, model)
        last = pcm
    return last, tin, tout


def _speak_dialogue(key: str, segments: list[dict], voices: dict) -> tuple[bytes, int, int] | None:
    """One multi-speaker request for a two-voice section (≈5x fewer requests than per turn).
    Returns None if the audio looks incomplete, so the caller falls back to per-turn synthesis."""
    names = {sp: f"Speaker{i + 1}" for i, sp in enumerate(dict.fromkeys(seg["speaker"] for seg in segments))}
    lines = "\n".join(f"{names[seg['speaker']]}: {seg['text']}" for seg in segments)
    body = {
        "contents": [{"parts": [{"text": f"Read this conversation aloud exactly as written, at a natural pace:\n{lines}"}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
                {"speaker": n, "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voices.get(sp, NARRATOR_VOICE)}}}
                for sp, n in names.items()
            ]}},
        },
    }
    r = _gemini_post(key, TTS_MODEL, body, 180.0)
    if r.status_code != 200:
        raise _gemini_error(r)
    d = r.json()
    try:
        pcm = base64.b64decode(d["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
    except (KeyError, IndexError):
        return None
    expected = sum(_expected_seconds(seg["text"]) for seg in segments)
    if len(pcm) / (RATE * 2) < 0.8 * expected:  # a dropped line shows up as missing duration
        log.warning("dialogue audio too short (%.1fs vs ~%.1fs) — falling back to per-turn", len(pcm) / (RATE * 2), expected)
        return None
    u = d.get("usageMetadata", {})
    return pcm, int(u.get("promptTokenCount") or 0), int(u.get("candidatesTokenCount") or 0)


def generate_section(db: Session, s: UserSettings, q: PracticeQuestion, section: int) -> Path:
    if q.skill != "listening":
        raise AIError("bad_request", "Not a listening question.")
    key = config.get_secret("GEMINI_API_KEY")
    if not key:
        raise AIError("no_key", "Natural-voice audio needs a Gemini API key (Settings → AI).")
    secs = split_sections((q.content or {}).get("script", []))
    if not 1 <= section <= len(secs):
        raise AIError("bad_request", "Section not found.")
    segments = secs[section - 1]["segments"]
    voices = voice_map(q)
    out = _cache_path(q, section, segments, voices)
    if out.exists():
        return out
    check_limits(db, s)
    t0 = time.monotonic()
    gap = b"\x00\x00" * int(RATE * GAP_SEC)
    try:
        dialogue = None
        if 1 < len({seg["speaker"] for seg in segments}) <= 2:
            dialogue = _speak_dialogue(key, segments, voices)
        if dialogue:
            parts = [dialogue]
        else:
            with ThreadPoolExecutor(max_workers=2) as ex:  # TTS rate limits are tight
                parts = list(ex.map(lambda seg: _speak_checked(key, seg["text"], voices.get(seg["speaker"], NARRATOR_VOICE)), segments))
    except AIError as e:
        log.warning("tts section failed q=%s section=%s code=%s", q.id, section, e.code)
        db.add(ApiUsage(provider="gemini", model=TTS_MODEL, purpose="tts", success=False, error_type=e.code))
        db.commit()
        raise
    pcm = gap.join(p for p, _, _ in parts)
    tin = sum(i for _, i, _ in parts)
    tout = sum(o for _, _, o in parts)
    tmp = out.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    tmp.rename(out)
    for old in tts_dir().glob(f"q{q.id}-s{section}-*.wav"):  # drop stale versions
        if old != out:
            old.unlink(missing_ok=True)
    db.add(
        ApiUsage(
            provider="gemini",
            model=TTS_MODEL,
            purpose="tts",
            success=True,
            input_tokens=tin,
            output_tokens=tout,
            cost_estimate_usd=round(tin / 1e6 * TTS_PRICE[0] + tout / 1e6 * TTS_PRICE[1], 5),
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
    )
    db.commit()
    log.info("tts generated q=%s section=%s turns=%s seconds=%.1f", q.id, section, len(segments), len(pcm) / (RATE * 2))
    return out


def audio_seconds(p: Path) -> float:
    with wave.open(str(p), "rb") as w:
        return w.getnframes() / w.getframerate()
