from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from .. import config
from ..db import get_db
from ..models import (
    Evaluation,
    PracticeAttempt,
    PracticeQuestion,
    StudySession,
    TopicItem,
    utcnow,
)
from ..services import evaluator, generator, listening, scoring
from ..services.ai import AIError, transcribe_audio
from .common import ai_http_error, get_or_404, get_settings, public_question, to_dict

router = APIRouter(prefix="/api", tags=["practice"])

MAX_AUDIO_BYTES = 25 * 1024 * 1024
AUDIO_EXT = {"audio/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a", "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav"}


# ------------------------------------------------------------------ questions
@router.get("/questions")
def list_questions(
    skill: str | None = None,
    task_type: str | None = None,
    topic_item_id: int | None = None,
    difficulty: int | None = None,
    include_mock: bool = False,
    db: Session = Depends(get_db),
):
    stmt = select(PracticeQuestion).where(PracticeQuestion.archived.is_(False))
    if skill:
        stmt = stmt.where(PracticeQuestion.skill == skill)
    if task_type:
        stmt = stmt.where(PracticeQuestion.task_type == task_type)
    if topic_item_id:
        stmt = stmt.where(PracticeQuestion.topic_item_id == topic_item_id)
    if difficulty:
        stmt = stmt.where(PracticeQuestion.difficulty == difficulty)
    if not include_mock:
        stmt = stmt.where(PracticeQuestion.is_mock.is_(False))
    qs = list(db.scalars(stmt.order_by(PracticeQuestion.task_type, PracticeQuestion.difficulty, PracticeQuestion.id)))
    attempts: dict[int, list[PracticeAttempt]] = {}
    for a in db.scalars(select(PracticeAttempt).where(PracticeAttempt.question_id.in_([q.id for q in qs]))):
        attempts.setdefault(a.question_id, []).append(a)
    topics = {t.id: t.title for t in db.scalars(select(TopicItem))}
    out = []
    for q in qs:
        at = attempts.get(q.id, [])
        last = max(at, key=lambda a: a.id) if at else None
        out.append(
            {
                "id": q.id,
                "skill": q.skill,
                "task_type": q.task_type,
                "task_name": fmt.task_name(q.task_type),
                "title": q.title,
                "difficulty": q.difficulty,
                "topic_item_id": q.topic_item_id,
                "topic_title": topics.get(q.topic_item_id),
                "source_type": q.source_type,
                "attempt_count": len(at),
                "last_accuracy": last.accuracy if last else None,
                "last_level": next((e.estimated_level for e in reversed(last.evaluations) if e.kind == "ai_rubric"), None) if last else None,
            }
        )
    return out


@router.get("/questions/{qid}")
def get_question(qid: int, reveal: bool = False, db: Session = Depends(get_db)):
    q = get_or_404(db, PracticeQuestion, qid)
    s = get_settings(db)
    # Answer keys are never sent before submission. Study mode (explicit setting) only
    # reveals the listening transcript, for text-based / replay study.
    d = public_question(q, False)
    allow = bool(reveal and q.skill == "listening" and s.listening_study_mode)
    if allow:
        d["content"] = dict(q.content or {})
    if q.topic_item_id:
        t = db.get(TopicItem, q.topic_item_id)
        d["topic_title"] = t.title if t else None
    d["task_name"] = fmt.task_name(q.task_type)
    d["template"] = None
    tpl = evaluator.recommend_template(db, q.skill, q.task_type)
    if tpl:
        d["template"] = {"id": tpl.id, "name": tpl.name, "status": tpl.status}
    d["study_mode"] = allow
    return d


@router.get("/questions/{qid}/audio-script")
def audio_script(qid: int, db: Session = Depends(get_db)):
    """Script text for local speech synthesis of listening audio. The UI plays it as audio and
    does not display it before submission (unless study mode is on)."""
    q = get_or_404(db, PracticeQuestion, qid)
    if q.skill != "listening":
        raise HTTPException(400, "Not a listening question")
    return {"script": (q.content or {}).get("script", []), "voices": (q.content or {}).get("voices", {})}


@router.get("/questions/{qid}/audio-plan")
def audio_plan(qid: int, db: Session = Depends(get_db)):
    """Sections to play in order, which questions follow each, and whether natural-voice audio is cached."""
    q = get_or_404(db, PracticeQuestion, qid)
    if q.skill != "listening":
        raise HTTPException(400, "Not a listening question")
    plan = listening.section_plan(q)
    for sec in plan:
        p = listening.cached_audio(q, sec["index"])
        sec["ready"] = p is not None
        sec["seconds"] = round(listening.audio_seconds(p), 1) if p else None
    return {"sections": plan, "tts_available": listening.tts_available()}


@router.post("/questions/{qid}/audio/{section}/prepare")
def prepare_audio(qid: int, section: int, db: Session = Depends(get_db)):
    q = get_or_404(db, PracticeQuestion, qid)
    try:
        p = listening.generate_section(db, get_settings(db), q, section)
    except AIError as e:
        raise ai_http_error(e)
    return {"ready": True, "seconds": round(listening.audio_seconds(p), 1)}


@router.get("/questions/{qid}/audio/{section}.wav")
def section_audio(qid: int, section: int, db: Session = Depends(get_db)):
    q = get_or_404(db, PracticeQuestion, qid)
    p = listening.cached_audio(q, section)
    if not p:
        raise HTTPException(404, "Audio not generated yet")
    return FileResponse(p, media_type="audio/wav", headers={"Cache-Control": "no-store"})


_prepare_all_state: dict = {"running": False, "done": 0, "total": 0, "errors": []}


@router.post("/listening/prepare-all")
def prepare_all_listening():
    """Generate natural-voice audio for every listening question in the background."""
    import threading

    from .. import db as dbmod

    if _prepare_all_state["running"]:
        return _prepare_all_state
    with dbmod.SessionLocal() as s:
        todo = [
            (q.id, sec["index"])
            for q in s.scalars(select(PracticeQuestion).where(PracticeQuestion.skill == "listening", PracticeQuestion.archived.is_(False)))
            for sec in listening.section_plan(q)
            if not listening.cached_audio(q, sec["index"])
        ]
    _prepare_all_state.update(running=True, done=0, total=len(todo), errors=[])

    def work():
        with dbmod.SessionLocal() as s:
            settings = get_settings(s)
            for qid, sec in todo:
                try:
                    listening.generate_section(s, settings, s.get(PracticeQuestion, qid), sec)
                except AIError as e:
                    _prepare_all_state["errors"].append(f"Question {qid} section {sec}: {e.message}")
                    if e.code in ("no_key", "auth", "limit_spend", "limit_requests", "quota_daily"):
                        break
                _prepare_all_state["done"] += 1
        _prepare_all_state["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return _prepare_all_state


@router.get("/listening/prepare-all")
def prepare_all_status(db: Session = Depends(get_db)):
    total = ready = 0
    for q in db.scalars(select(PracticeQuestion).where(PracticeQuestion.skill == "listening", PracticeQuestion.archived.is_(False))):
        for sec in listening.section_plan(q):
            total += 1
            ready += listening.cached_audio(q, sec["index"]) is not None
    return {**_prepare_all_state, "sections_total": total, "sections_ready": ready, "tts_available": listening.tts_available()}


class QuestionIn(BaseModel):
    skill: str
    task_type: str
    title: str = Field(min_length=2, max_length=300)
    prompt: str = Field(min_length=5)
    audience: str = ""
    purpose: str = ""
    background: str = ""
    difficulty: int = Field(3, ge=1, le=5)
    topic_item_id: int | None = None
    content: dict = {}


@router.post("/questions")
def create_question(body: QuestionIn, db: Session = Depends(get_db)):
    found = fmt.task_by_key(body.task_type)
    if not found or found[0] != body.skill or body.skill not in ("writing", "speaking"):
        raise HTTPException(400, "Custom questions are supported for writing and speaking task types.")
    task = found[1]
    q = PracticeQuestion(**body.model_dump(), source_type="user")
    if body.skill == "writing":
        q.word_min, q.word_max, q.time_limit_sec = 150, 200, task["minutes"] * 60
    else:
        q.prep_time_sec, q.time_limit_sec = task["prep"], task["response"]
    db.add(q)
    db.commit()
    return to_dict(q)


@router.delete("/questions/{qid}")
def archive_question(qid: int, db: Session = Depends(get_db)):
    q = get_or_404(db, PracticeQuestion, qid)
    q.archived = True  # keep for attempt history
    db.commit()
    return {"ok": True}


class GenerateIn(BaseModel):
    skill: str
    task_type: str
    topic_item_id: int | None = None
    difficulty: int = Field(3, ge=1, le=5)
    mode: str = "auto"  # auto|offline|ai
    variation_hint: str = Field("", max_length=500)


@router.post("/questions/generate")
def generate_question(body: GenerateIn, db: Session = Depends(get_db)):
    topic = db.get(TopicItem, body.topic_item_id) if body.topic_item_id else None
    use_offline = body.mode == "offline" or (
        body.mode == "auto" and topic is not None and body.task_type in generator.OFFLINE_TASKS and not body.variation_hint
    )
    if use_offline:
        if not topic:
            raise HTTPException(400, "Offline generation needs a topic.")
        try:
            q = generator.compose_offline(db, topic, body.task_type)
        except ValueError as e:
            if body.mode == "offline":
                raise HTTPException(409, str(e))
            use_offline = False
        else:
            return {"question": public_question(q, False), "method": "offline"}
    try:
        q = generator.generate_ai(
            db,
            get_settings(db),
            skill=body.skill,
            task_type=body.task_type,
            topic=topic,
            difficulty=body.difficulty,
            variation_hint=body.variation_hint,
        )
    except AIError as e:
        raise ai_http_error(e)
    return {"question": public_question(q, False), "method": "ai"}


# ------------------------------------------------------------------ attempts
class AttemptIn(BaseModel):
    question_id: int
    mode: str = "practice"
    response_text: str = Field("", max_length=20000)
    answers: dict[str, int | None] = {}
    transcript: str | None = Field(None, max_length=20000)
    transcript_source: str | None = None
    duration_sec: int | None = Field(None, ge=0, le=7200)
    template_id: int | None = None
    used_template_without_looking: bool = False
    study_session_id: int | None = None
    parent_attempt_id: int | None = None
    mock_exam_id: int | None = None
    started_at: datetime | None = None
    audio_token: str | None = None


def _attempt_payload(db: Session, a: PracticeAttempt) -> dict:
    d = to_dict(a)
    d["task_name"] = fmt.task_name(a.task_type)
    d["evaluations"] = []
    for ev in a.evaluations:
        e = to_dict(ev, exclude={"raw"})
        e["criteria"] = [to_dict(c) for c in ev.criteria]
        d["evaluations"].append(e)
    d["has_audio"] = bool(a.audio_path) and (config.AUDIO_DIR / (a.audio_path or "")).exists()
    if a.question_id:
        q = db.get(PracticeQuestion, a.question_id)
        if q:
            d["question"] = public_question(q, True)  # submitted → reveal key, transcript, sample
            d["question"]["task_name"] = fmt.task_name(q.task_type)
    return d


@router.post("/attempts")
def submit_attempt(body: AttemptIn, db: Session = Depends(get_db)):
    q = get_or_404(db, PracticeQuestion, body.question_id)
    text = body.response_text or ""
    a = PracticeAttempt(
        question_id=q.id,
        skill=q.skill,
        task_type=q.task_type,
        mode=body.mode,
        response_text=text,
        answers={k: v for k, v in body.answers.items()},
        transcript=body.transcript,
        transcript_source=body.transcript_source if body.transcript else None,
        duration_sec=body.duration_sec,
        word_count=len(text.split()) if text else 0,
        template_id=body.template_id,
        used_template_without_looking=body.used_template_without_looking,
        study_session_id=body.study_session_id,
        parent_attempt_id=body.parent_attempt_id,
        mock_exam_id=body.mock_exam_id,
        started_at=body.started_at.replace(tzinfo=None) if body.started_at else None,
        submitted_at=utcnow(),
        status="submitted",
    )
    if body.audio_token:
        f = _audio_file(body.audio_token)
        if f:
            a.audio_path = f.name
    if q.skill in ("listening", "reading"):
        db.add(a)
        db.flush()
        scoring.score_objective(db, a, q)
    else:
        if q.skill == "speaking" and not (text or body.transcript):
            raise HTTPException(422, "Add a transcript or typed response before submitting.")
        if q.skill == "speaking" and not text and body.transcript:
            a.response_text = body.transcript
        db.add(a)
    if q.topic_item_id:
        t = db.get(TopicItem, q.topic_item_id)
        if t:
            t.practice_count += 1
            t.last_practiced_at = utcnow()
    if body.study_session_id:
        sess = db.get(StudySession, body.study_session_id)
        if sess and sess.status == "pending":
            sess.status = "in_progress"
            sess.started_at = sess.started_at or utcnow()
    db.commit()
    db.refresh(a)
    return _attempt_payload(db, a)


@router.get("/attempts")
def list_attempts(skill: str | None = None, task_type: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    stmt = select(PracticeAttempt).where(PracticeAttempt.submitted_at.is_not(None))
    if skill:
        stmt = stmt.where(PracticeAttempt.skill == skill)
    if task_type:
        stmt = stmt.where(PracticeAttempt.task_type == task_type)
    rows = db.scalars(stmt.order_by(PracticeAttempt.submitted_at.desc()).limit(min(limit, 500)))
    out = []
    for a in rows:
        q = db.get(PracticeQuestion, a.question_id) if a.question_id else None
        ev = next((e for e in reversed(a.evaluations) if e.kind == "ai_rubric"), None)
        out.append(
            {
                "id": a.id,
                "skill": a.skill,
                "task_type": a.task_type,
                "task_name": fmt.task_name(a.task_type),
                "title": q.title if q else "(deleted question)",
                "mode": a.mode,
                "status": a.status,
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
                "accuracy": a.accuracy,
                "score_correct": a.score_correct,
                "score_total": a.score_total,
                "estimated_level": ev.estimated_level if ev else None,
                "word_count": a.word_count,
            }
        )
    return out


@router.get("/attempts/{aid}")
def get_attempt(aid: int, db: Session = Depends(get_db)):
    return _attempt_payload(db, get_or_404(db, PracticeAttempt, aid))


@router.delete("/attempts/{aid}")
def delete_attempt(aid: int, db: Session = Depends(get_db)):
    a = get_or_404(db, PracticeAttempt, aid)
    if a.audio_path:
        p = config.AUDIO_DIR / a.audio_path
        if p.exists():
            p.unlink()
    db.delete(a)
    db.commit()
    return {"ok": True}


@router.post("/attempts/{aid}/evaluate")
def evaluate(aid: int, db: Session = Depends(get_db)):
    a = get_or_404(db, PracticeAttempt, aid)
    if a.skill not in ("writing", "speaking"):
        raise HTTPException(400, "Listening and reading are scored against the answer key. Use /explain for AI explanations.")
    try:
        evaluator.evaluate_attempt(db, a, get_settings(db))
    except AIError as e:
        db.rollback()
        a = db.get(PracticeAttempt, aid)
        if a and a.status != "evaluated":
            a.status = "eval_failed"
            db.commit()
        raise ai_http_error(e)
    db.refresh(a)
    return _attempt_payload(db, a)


@router.post("/attempts/{aid}/explain")
def explain(aid: int, db: Session = Depends(get_db)):
    a = get_or_404(db, PracticeAttempt, aid)
    if a.skill not in ("listening", "reading"):
        raise HTTPException(400, "Explanations are for listening/reading attempts.")
    try:
        evaluator.explain_objective(db, a, get_settings(db))
    except AIError as e:
        db.rollback()
        raise ai_http_error(e)
    db.refresh(a)
    return _attempt_payload(db, a)


@router.get("/evaluations")
def list_evaluations(limit: int = 30, db: Session = Depends(get_db)):
    rows = db.scalars(select(Evaluation).where(Evaluation.kind == "ai_rubric").order_by(Evaluation.created_at.desc()).limit(limit))
    out = []
    for ev in rows:
        a = ev.attempt
        out.append(
            {
                "id": ev.id,
                "attempt_id": a.id,
                "skill": a.skill,
                "task_type": a.task_type,
                "task_name": fmt.task_name(a.task_type),
                "estimated_level": ev.estimated_level,
                "confidence": ev.confidence,
                "summary": ev.summary,
                "created_at": ev.created_at.isoformat(),
                "model": ev.model,
            }
        )
    return out


# ------------------------------------------------------------------ audio
def _audio_file(token: str):
    safe = "".join(c for c in token if c.isalnum() or c in "-.")
    for p in config.AUDIO_DIR.glob(f"{safe}*"):
        return p
    return None


@router.post("/audio")
async def upload_audio(file: UploadFile = File(...), transcribe: bool = Form(False), db: Session = Depends(get_db)):
    s = get_settings(db)
    ctype = (file.content_type or "").split(";")[0]
    ext = AUDIO_EXT.get(ctype)
    if not ext:
        raise HTTPException(415, f"Unsupported audio type {ctype}")
    data = await file.read()
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "Recording too large (max 25 MB).")
    config.ensure_dirs()
    token = uuid.uuid4().hex
    path = config.AUDIO_DIR / f"{token}{ext}"
    path.write_bytes(data)
    out = {"token": token, "stored": True, "transcript": None, "transcript_source": None, "transcription_error": None}
    if transcribe:
        try:
            out["transcript"], out["transcript_source"] = transcribe_audio(str(path))
        except AIError as e:
            out["transcription_error"] = e.message
    if not s.audio_retention:
        # retention disabled: keep the file only long enough to transcribe
        path.unlink(missing_ok=True)
        out["stored"] = False
        out["token"] = None
    return out


@router.get("/attempts/{aid}/audio")
def get_audio(aid: int, db: Session = Depends(get_db)):
    a = get_or_404(db, PracticeAttempt, aid)
    if not a.audio_path:
        raise HTTPException(404, "No recording")
    p = config.AUDIO_DIR / a.audio_path
    if not p.exists():
        raise HTTPException(404, "Recording file missing")
    return FileResponse(p)


@router.delete("/attempts/{aid}/audio")
def delete_audio(aid: int, db: Session = Depends(get_db)):
    a = get_or_404(db, PracticeAttempt, aid)
    if a.audio_path:
        (config.AUDIO_DIR / a.audio_path).unlink(missing_ok=True)
        a.audio_path = None
        db.commit()
    return {"ok": True}


@router.delete("/audio")
def delete_all_audio(db: Session = Depends(get_db)):
    n = 0
    if config.AUDIO_DIR.exists():
        for p in config.AUDIO_DIR.iterdir():
            p.unlink()
            n += 1
    for a in db.scalars(select(PracticeAttempt).where(PracticeAttempt.audio_path.is_not(None))):
        a.audio_path = None
    db.commit()
    return {"deleted_files": n}
