"""SQLAlchemy ORM models.

Conventions
- Integer surrogate primary keys, `created_at`/`updated_at` UTC timestamps.
- List/dict fields use SQLite JSON columns.
- Rich text (notes, reference pages) is stored as sanitized HTML (TipTap output);
  a plain-text copy is kept alongside for search.
- `source_type` on content distinguishes official guidance, external facts,
  original seed content, AI-generated practice material, and the user's own work.
- No secrets are stored in any table.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


SKILLS = ("listening", "reading", "writing", "speaking")


# ---------------------------------------------------------------- settings
class UserSettings(TimestampMixin, Base):
    __tablename__ = "user_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    exam_date: Mapped[date] = mapped_column(Date, default=date(2026, 12, 3))
    target_levels: Mapped[dict] = mapped_column(
        JSON, default=lambda: {s: 12 for s in SKILLS}
    )
    daily_module_count: Mapped[int] = mapped_column(Integer, default=2)
    daily_minutes: Mapped[int] = mapped_column(Integer, default=90)
    study_days: Mapped[list] = mapped_column(JSON, default=lambda: [0, 1, 2, 3, 4, 5, 6])
    ai_provider: Mapped[str] = mapped_column(String(20), default="anthropic")
    ai_model: Mapped[str] = mapped_column(String(80), default="claude-opus-5-5")
    # Mock exams can use a different (usually stronger) provider/model than daily practice.
    mock_ai_provider: Mapped[str] = mapped_column(String(20), default="anthropic", server_default="anthropic")
    mock_ai_model: Mapped[str] = mapped_column(String(80), default="claude-opus-5-5", server_default="claude-opus-5-5")
    # Off: mock-exam speaking is evaluated by the practice model (same provider that transcribes it).
    mock_model_for_speaking: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    ai_effort: Mapped[str] = mapped_column(String(10), default="medium")
    ai_max_output_tokens: Mapped[int] = mapped_column(Integer, default=12000)
    ai_timeout_seconds: Mapped[int] = mapped_column(Integer, default=180)
    ai_refusal_fallback: Mapped[bool] = mapped_column(Boolean, default=True)
    daily_request_limit: Mapped[int] = mapped_column(Integer, default=60)
    daily_spend_limit_usd: Mapped[float] = mapped_column(Float, default=3.0)
    feedback_strictness: Mapped[str] = mapped_column(String(20), default="examiner")
    feedback_language_level: Mapped[str] = mapped_column(String(20), default="clear")
    audio_retention: Mapped[bool] = mapped_column(Boolean, default=True)
    transcription_mode: Mapped[str] = mapped_column(String(20), default="manual")
    listening_study_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    theme: Mapped[str] = mapped_column(String(10), default="system")
    srs_intervals: Mapped[list] = mapped_column(JSON, default=lambda: [1, 3, 7, 14, 30, 60])
    vocab_daily_new_limit: Mapped[int] = mapped_column(Integer, default=10)
    onboarding_done: Mapped[bool] = mapped_column(Boolean, default=False)


class StudyGoal(TimestampMixin, Base):
    __tablename__ = "study_goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    skill: Mapped[str] = mapped_column(String(20), index=True)
    target_level: Mapped[int] = mapped_column(Integer, default=12)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class OfficialScore(TimestampMixin, Base):
    """Actual official CELPIP results, entered by the user. Never computed."""
    __tablename__ = "official_scores"
    id: Mapped[int] = mapped_column(primary_key=True)
    test_date: Mapped[date] = mapped_column(Date)
    listening: Mapped[int | None] = mapped_column(Integer)
    reading: Mapped[int | None] = mapped_column(Integer)
    writing: Mapped[int | None] = mapped_column(Integer)
    speaking: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str] = mapped_column(Text, default="")


# ---------------------------------------------------------------- sources & topics
class ContentSource(TimestampMixin, Base):
    __tablename__ = "content_sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(500))
    source_type: Mapped[str] = mapped_column(String(40))  # official_celpip|government|statistics|news|educational
    feed_url: Mapped[str | None] = mapped_column(String(800))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[str] = mapped_column(Text, default="")
    last_checked_on: Mapped[date | None] = mapped_column(Date)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error: Mapped[str | None] = mapped_column(Text)


class TopicCategory(TimestampMixin, Base):
    __tablename__ = "topic_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    group: Mapped[str] = mapped_column(String(40), index=True)  # everyday|workplace|society|reference|general|current
    description: Mapped[str] = mapped_column(Text, default="")
    items: Mapped[list["TopicItem"]] = relationship(back_populates="category")


class TopicItem(TimestampMixin, Base):
    __tablename__ = "topic_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("topic_categories.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(20), default="scenario")  # scenario|reference
    scenario: Mapped[str] = mapped_column(Text, default="")
    background: Mapped[str] = mapped_column(Text, default="")
    content_html: Mapped[str] = mapped_column(Text, default="")
    key_vocabulary: Mapped[list] = mapped_column(JSON, default=list)  # [{term, meaning, example, tone}]
    viewpoints: Mapped[list] = mapped_column(JSON, default=list)
    audiences: Mapped[list] = mapped_column(JSON, default=list)
    purposes: Mapped[list] = mapped_column(JSON, default=list)
    details: Mapped[list] = mapped_column(JSON, default=list)
    skills: Mapped[list] = mapped_column(JSON, default=lambda: list(SKILLS))
    difficulty: Mapped[int] = mapped_column(Integer, default=3)
    source_type: Mapped[str] = mapped_column(String(30), default="original")
    source_id: Mapped[int | None] = mapped_column(ForeignKey("content_sources.id", ondelete="SET NULL"))
    references: Mapped[list] = mapped_column(JSON, default=list)  # [{title, url}]
    practice_count: Mapped[int] = mapped_column(Integer, default=0)
    last_practiced_at: Mapped[datetime | None] = mapped_column(DateTime)
    category: Mapped[TopicCategory] = relationship(back_populates="items")


class CurrentAffairsItem(TimestampMixin, Base):
    __tablename__ = "current_affairs_items"
    __table_args__ = (UniqueConstraint("url"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int | None] = mapped_column(ForeignKey("content_sources.id", ondelete="SET NULL"), index=True)
    headline: Mapped[str] = mapped_column(String(500))
    publisher: Mapped[str] = mapped_column(String(200))
    published_at: Mapped[datetime | None] = mapped_column(DateTime)
    url: Mapped[str] = mapped_column(String(800))
    feed_summary: Mapped[str] = mapped_column(Text, default="")  # short summary text supplied by the publisher's feed
    topic_category_id: Mapped[int | None] = mapped_column(ForeignKey("topic_categories.id", ondelete="SET NULL"))
    # Fields below are AI-generated interpretation (flagged) and never presented as reported fact.
    main_issue: Mapped[str] = mapped_column(Text, default="")
    important_facts: Mapped[list] = mapped_column(JSON, default=list)
    viewpoints: Mapped[list] = mapped_column(JSON, default=list)
    vocabulary: Mapped[list] = mapped_column(JSON, default=list)
    questions: Mapped[list] = mapped_column(JSON, default=list)
    difficulty: Mapped[int | None] = mapped_column(Integer)
    ai_enriched: Mapped[bool] = mapped_column(Boolean, default=False)
    user_summary: Mapped[str] = mapped_column(Text, default="")
    verification_status: Mapped[str] = mapped_column(String(30), default="retrieved")  # retrieved|historical|unverified
    retrieved_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime)


class ImportedResource(TimestampMixin, Base):
    __tablename__ = "imported_resources"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(40))  # markdown|json_backup|reference
    source_url: Mapped[str | None] = mapped_column(String(800))
    content: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(30), default="user")


# ---------------------------------------------------------------- templates
class Template(TimestampMixin, Base):
    __tablename__ = "templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    skill: Mapped[str] = mapped_column(String(20), index=True)
    task_type: Mapped[str] = mapped_column(String(60), index=True)
    intended_use: Mapped[str] = mapped_column(Text, default="")
    structure: Mapped[list] = mapped_column(JSON, default=list)  # [{step, guidance}]
    opening_phrases: Mapped[list] = mapped_column(JSON, default=list)
    transition_phrases: Mapped[list] = mapped_column(JSON, default=list)
    useful_expressions: Mapped[list] = mapped_column(JSON, default=list)
    example_prompt: Mapped[str] = mapped_column(Text, default="")
    example_response: Mapped[str] = mapped_column(Text, default="")
    why_it_works: Mapped[str] = mapped_column(Text, default="")
    common_mistakes: Mapped[list] = mapped_column(JSON, default=list)
    adaptation_guidance: Mapped[str] = mapped_column(Text, default="")
    vocabulary: Mapped[list] = mapped_column(JSON, default=list)
    time_plan: Mapped[str] = mapped_column(Text, default="")
    personal_version: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[int] = mapped_column(Integer, default=1)  # 1-5
    status: Mapped[str] = mapped_column(String(20), default="learning")  # learning|practicing|mastered|needs_revision
    times_practiced: Mapped[int] = mapped_column(Integer, default=0)
    times_without_looking: Mapped[int] = mapped_column(Integer, default=0)
    last_score: Mapped[float | None] = mapped_column(Float)
    last_practiced_at: Mapped[datetime | None] = mapped_column(DateTime)
    is_user_created: Mapped[bool] = mapped_column(Boolean, default=False)
    source_type: Mapped[str] = mapped_column(String(30), default="original")
    history: Mapped[list["TemplatePracticeHistory"]] = relationship(
        back_populates="template", cascade="all, delete-orphan"
    )


class TemplatePracticeHistory(Base):
    __tablename__ = "template_practice_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("practice_attempts.id", ondelete="SET NULL"))
    used_without_looking: Mapped[bool] = mapped_column(Boolean, default=False)
    score: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    template: Mapped[Template] = relationship(back_populates="history")


# ---------------------------------------------------------------- practice
class PracticeQuestion(TimestampMixin, Base):
    __tablename__ = "practice_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    skill: Mapped[str] = mapped_column(String(20), index=True)
    task_type: Mapped[str] = mapped_column(String(60), index=True)
    title: Mapped[str] = mapped_column(String(300))
    topic_item_id: Mapped[int | None] = mapped_column(ForeignKey("topic_items.id", ondelete="SET NULL"), index=True)
    current_affairs_id: Mapped[int | None] = mapped_column(ForeignKey("current_affairs_items.id", ondelete="SET NULL"))
    difficulty: Mapped[int] = mapped_column(Integer, default=3)  # 1-5
    audience: Mapped[str] = mapped_column(Text, default="")
    purpose: Mapped[str] = mapped_column(Text, default="")
    background: Mapped[str] = mapped_column(Text, default="")
    prompt: Mapped[str] = mapped_column(Text, default="")
    instructions: Mapped[str] = mapped_column(Text, default="")
    # content: reading passage(s) / listening script segments / speaking scene description / survey options
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    # objective items: [{id, stem, options[], answer (index), explanation, qtype}]
    items: Mapped[list] = mapped_column(JSON, default=list)
    prep_time_sec: Mapped[int | None] = mapped_column(Integer)
    time_limit_sec: Mapped[int | None] = mapped_column(Integer)
    word_min: Mapped[int | None] = mapped_column(Integer)
    word_max: Mapped[int | None] = mapped_column(Integer)
    expected_format: Mapped[str] = mapped_column(Text, default="")
    learning_objectives: Mapped[list] = mapped_column(JSON, default=list)
    sample_response: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(30), default="original")  # original|ai_generated|user
    source_refs: Mapped[list] = mapped_column(JSON, default=list)
    variation_note: Mapped[str] = mapped_column(Text, default="")
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[list["PracticeAttempt"]] = relationship(back_populates="question")


class PracticeAttempt(TimestampMixin, Base):
    __tablename__ = "practice_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int | None] = mapped_column(ForeignKey("practice_questions.id", ondelete="SET NULL"), index=True)
    skill: Mapped[str] = mapped_column(String(20), index=True)
    task_type: Mapped[str] = mapped_column(String(60), index=True)
    mode: Mapped[str] = mapped_column(String(20), default="practice")  # practice|exam|study|mock|retry
    status: Mapped[str] = mapped_column(String(20), default="submitted")  # draft|submitted|evaluated|eval_failed
    response_text: Mapped[str] = mapped_column(Text, default="")
    answers: Mapped[dict] = mapped_column(JSON, default=dict)  # {item_id: chosen_index}
    audio_path: Mapped[str | None] = mapped_column(String(500))
    transcript: Mapped[str | None] = mapped_column(Text)
    transcript_source: Mapped[str | None] = mapped_column(String(30))  # openai|browser|manual
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    word_count: Mapped[int | None] = mapped_column(Integer)
    score_correct: Mapped[int | None] = mapped_column(Integer)
    score_total: Mapped[int | None] = mapped_column(Integer)
    accuracy: Mapped[float | None] = mapped_column(Float)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    used_template_without_looking: Mapped[bool] = mapped_column(Boolean, default=False)
    study_session_id: Mapped[int | None] = mapped_column(ForeignKey("study_sessions.id", ondelete="SET NULL"), index=True)
    mock_exam_id: Mapped[int | None] = mapped_column(ForeignKey("mock_exams.id", ondelete="CASCADE"), index=True)
    parent_attempt_id: Mapped[int | None] = mapped_column(ForeignKey("practice_attempts.id", ondelete="SET NULL"))
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
    question: Mapped[PracticeQuestion | None] = relationship(back_populates="attempts")
    evaluations: Mapped[list["Evaluation"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan", order_by="Evaluation.id"
    )


class Evaluation(Base):
    __tablename__ = "evaluations"
    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("practice_attempts.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # ai_rubric|objective|ai_explanation
    provider: Mapped[str | None] = mapped_column(String(20))
    model: Mapped[str | None] = mapped_column(String(80))
    # Unofficial, AI-estimated CELPIP-aligned level (never an official score).
    estimated_level: Mapped[int | None] = mapped_column(Integer)
    estimated_level_range: Mapped[str | None] = mapped_column(String(20))
    confidence: Mapped[str | None] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(Text, default="")
    limitations: Mapped[str] = mapped_column(Text, default="")
    corrections: Mapped[list] = mapped_column(JSON, default=list)
    vocabulary_suggestions: Mapped[list] = mapped_column(JSON, default=list)
    improved_response: Mapped[str] = mapped_column(Text, default="")
    comparison: Mapped[list] = mapped_column(JSON, default=list)
    next_steps: Mapped[list] = mapped_column(JSON, default=list)
    retry_exercise: Mapped[str] = mapped_column(Text, default="")
    explanations: Mapped[list] = mapped_column(JSON, default=list)  # objective: per-item explanations
    raw: Mapped[dict] = mapped_column(JSON, default=dict)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cost_estimate_usd: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    attempt: Mapped[PracticeAttempt] = relationship(back_populates="evaluations")
    criteria: Mapped[list["EvaluationCriterion"]] = relationship(
        back_populates="evaluation", cascade="all, delete-orphan", order_by="EvaluationCriterion.id"
    )


class EvaluationCriterion(Base):
    __tablename__ = "evaluation_criteria"
    id: Mapped[int] = mapped_column(primary_key=True)
    evaluation_id: Mapped[int] = mapped_column(ForeignKey("evaluations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    level: Mapped[int | None] = mapped_column(Integer)
    assessed: Mapped[bool] = mapped_column(Boolean, default=True)
    strengths: Mapped[str] = mapped_column(Text, default="")
    weaknesses: Mapped[str] = mapped_column(Text, default="")
    examples: Mapped[list] = mapped_column(JSON, default=list)
    improvements: Mapped[str] = mapped_column(Text, default="")
    evaluation: Mapped[Evaluation] = relationship(back_populates="criteria")


class ApiUsage(Base):
    __tablename__ = "api_usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    provider: Mapped[str] = mapped_column(String(20))
    model: Mapped[str] = mapped_column(String(80))
    purpose: Mapped[str] = mapped_column(String(40))
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    error_type: Mapped[str | None] = mapped_column(String(60))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_estimate_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int | None] = mapped_column(Integer)


# ---------------------------------------------------------------- planner
class StudyPlan(TimestampMixin, Base):
    __tablename__ = "study_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    total_minutes: Mapped[int] = mapped_column(Integer, default=90)
    rationale: Mapped[str] = mapped_column(Text, default="")
    sessions: Mapped[list["StudySession"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="StudySession.order"
    )


class StudySession(TimestampMixin, Base):
    __tablename__ = "study_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("study_plans.id", ondelete="CASCADE"), index=True)
    order: Mapped[int] = mapped_column(Integer, default=0)
    skill: Mapped[str] = mapped_column(String(20))
    task_type: Mapped[str] = mapped_column(String(60))
    title: Mapped[str] = mapped_column(String(300))
    objective: Mapped[str] = mapped_column(Text, default="")
    duration_min: Mapped[int] = mapped_column(Integer, default=45)
    steps: Mapped[list] = mapped_column(JSON, default=list)  # activity breakdown
    question_id: Mapped[int | None] = mapped_column(ForeignKey("practice_questions.id", ondelete="SET NULL"))
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    topic_item_id: Mapped[int | None] = mapped_column(ForeignKey("topic_items.id", ondelete="SET NULL"))
    focus_mistake_id: Mapped[int | None] = mapped_column(ForeignKey("mistakes.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|in_progress|completed|skipped
    review_done: Mapped[bool] = mapped_column(Boolean, default=False)
    vocab_saved: Mapped[bool] = mapped_column(Boolean, default=False)
    reflection: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    plan: Mapped[StudyPlan] = relationship(back_populates="sessions")


# ---------------------------------------------------------------- notes
class NoteFolder(TimestampMixin, Base):
    __tablename__ = "note_folders"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("note_folders.id", ondelete="CASCADE"))
    order: Mapped[int] = mapped_column(Integer, default=0)
    icon: Mapped[str | None] = mapped_column(String(10))


class Note(TimestampMixin, Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("note_folders.id", ondelete="SET NULL"), index=True)
    title: Mapped[str] = mapped_column(String(300), default="Untitled")
    content_html: Mapped[str] = mapped_column(Text, default="")
    content_text: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    category: Mapped[str | None] = mapped_column(String(100))
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    icon: Mapped[str | None] = mapped_column(String(10))
    order: Mapped[int] = mapped_column(Integer, default=0)
    source_type: Mapped[str] = mapped_column(String(30), default="user")


class EntityLink(Base):
    """Generic links between notes, templates, vocabulary, attempts, mistakes, topics."""
    __tablename__ = "entity_links"
    __table_args__ = (
        UniqueConstraint("source_type", "source_id", "target_type", "target_id"),
        Index("ix_links_target", "target_type", "target_id"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    source_type: Mapped[str] = mapped_column(String(30))
    source_id: Mapped[int] = mapped_column(Integer)
    target_type: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


# ---------------------------------------------------------------- vocabulary
class VocabularyItem(TimestampMixin, Base):
    __tablename__ = "vocabulary_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    term: Mapped[str] = mapped_column(String(200), index=True)
    meaning: Mapped[str] = mapped_column(Text, default="")
    part_of_speech: Mapped[str] = mapped_column(String(40), default="")
    example: Mapped[str] = mapped_column(Text, default="")
    collocations: Mapped[list] = mapped_column(JSON, default=list)
    synonyms: Mapped[list] = mapped_column(JSON, default=list)
    usage_notes: Mapped[str] = mapped_column(Text, default="")
    formality: Mapped[str] = mapped_column(String(30), default="neutral")  # formal|neutral|informal
    skills: Mapped[list] = mapped_column(JSON, default=list)
    task_types: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    context: Mapped[str] = mapped_column(Text, default="")
    regional_note: Mapped[str] = mapped_column(Text, default="")
    practice_exercise: Mapped[str] = mapped_column(Text, default="")
    source_type: Mapped[str] = mapped_column(String(30), default="user")  # seed|evaluation|sample|note|topic|news|user
    source_attempt_id: Mapped[int | None] = mapped_column(ForeignKey("practice_attempts.id", ondelete="SET NULL"))
    source_ref: Mapped[str | None] = mapped_column(String(200))
    personal_example: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[int] = mapped_column(Integer, default=1)  # 1-5
    status: Mapped[str] = mapped_column(String(20), default="new")  # new|learning|familiar|mastered
    srs_step: Mapped[int] = mapped_column(Integer, default=0)
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    review_count: Mapped[int] = mapped_column(Integer, default=0)
    lapses: Mapped[int] = mapped_column(Integer, default=0)
    used_correctly_count: Mapped[int] = mapped_column(Integer, default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime)
    reviews: Mapped[list["VocabularyReviewHistory"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="VocabularyReviewHistory.id"
    )


class VocabularyReviewHistory(Base):
    __tablename__ = "vocabulary_review_history"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("vocabulary_items.id", ondelete="CASCADE"), index=True)
    reviewed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    mode: Mapped[str] = mapped_column(String(20))  # card|quiz|fill|usage
    result: Mapped[str] = mapped_column(String(10))  # again|hard|good|easy
    interval_days: Mapped[int] = mapped_column(Integer, default=0)
    item: Mapped[VocabularyItem] = relationship(back_populates="reviews")


# ---------------------------------------------------------------- mistakes
class Mistake(TimestampMixin, Base):
    __tablename__ = "mistakes"
    __table_args__ = (Index("ix_mistake_cat_skill", "category", "skill"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(40))
    skill: Mapped[str] = mapped_column(String(20))
    pattern: Mapped[str] = mapped_column(String(300))  # normalized short description of the recurring issue
    original_example: Mapped[str] = mapped_column(Text, default="")
    corrected_example: Mapped[str] = mapped_column(Text, default="")
    explanation: Mapped[str] = mapped_column(Text, default="")
    recommended_exercise: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[int] = mapped_column(Integer, default=2)  # 1 low - 3 high impact
    occurrence_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|improving|resolved
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    clean_checks: Mapped[int] = mapped_column(Integer, default=0)  # later attempts where it did not recur
    occurrences: Mapped[list["MistakeOccurrence"]] = relationship(
        back_populates="mistake", cascade="all, delete-orphan", order_by="MistakeOccurrence.id"
    )


class MistakeOccurrence(Base):
    __tablename__ = "mistake_occurrences"
    id: Mapped[int] = mapped_column(primary_key=True)
    mistake_id: Mapped[int] = mapped_column(ForeignKey("mistakes.id", ondelete="CASCADE"), index=True)
    attempt_id: Mapped[int | None] = mapped_column(ForeignKey("practice_attempts.id", ondelete="SET NULL"), index=True)
    evaluation_id: Mapped[int | None] = mapped_column(ForeignKey("evaluations.id", ondelete="SET NULL"))
    original: Mapped[str] = mapped_column(Text, default="")
    corrected: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    mistake: Mapped[Mistake] = relationship(back_populates="occurrences")


# ---------------------------------------------------------------- mock exams
class MockExam(TimestampMixin, Base):
    __tablename__ = "mock_exams"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(20), default="full")  # full|section
    status: Mapped[str] = mapped_column(String(20), default="not_started")  # not_started|in_progress|completed|abandoned
    current_section: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    sections: Mapped[list["MockExamSection"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="MockExamSection.order"
    )
    results: Mapped[list["MockExamResult"]] = relationship(back_populates="exam", cascade="all, delete-orphan")


class MockExamSection(Base):
    __tablename__ = "mock_exam_sections"
    id: Mapped[int] = mapped_column(primary_key=True)
    mock_exam_id: Mapped[int] = mapped_column(ForeignKey("mock_exams.id", ondelete="CASCADE"), index=True)
    order: Mapped[int] = mapped_column(Integer)
    skill: Mapped[str] = mapped_column(String(20))
    question_ids: Mapped[list] = mapped_column(JSON, default=list)
    current_index: Mapped[int] = mapped_column(Integer, default=0)
    time_limit_sec: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="not_started")
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    exam: Mapped[MockExam] = relationship(back_populates="sections")


class MockExamResult(Base):
    __tablename__ = "mock_exam_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    mock_exam_id: Mapped[int] = mapped_column(ForeignKey("mock_exams.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(20))
    objective_correct: Mapped[int | None] = mapped_column(Integer)
    objective_total: Mapped[int | None] = mapped_column(Integer)
    ai_estimated_level: Mapped[float | None] = mapped_column(Float)
    evaluated_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(Text, default="")
    improvement_plan: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    exam: Mapped[MockExam] = relationship(back_populates="results")
