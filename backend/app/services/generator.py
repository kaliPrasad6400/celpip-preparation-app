"""Topic-to-task generator.

Two paths:
1. Offline composer (no internet): builds writing and speaking prompts from a topic's
   audiences × purposes × details × viewpoints, choosing a combination not used before,
   so variations differ in audience, purpose and constraints — not just names.
2. AI generator: creates any task type (incl. listening/reading with an answer key fixed
   at generation time, before any attempt). Output is validated and stored with
   source_type="ai_generated".
"""
from __future__ import annotations

import itertools
import random

from pydantic import BaseModel, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import celpip_format as fmt
from ..models import PracticeQuestion, TopicItem, UserSettings, utcnow
from .ai import AIError, complete_json
from .evaluator import _arr, _bool, _int, _obj, _str

OFFLINE_TASKS = ("W1", "W2", "S1", "S2", "S4", "S5", "S6", "S7")


def _used_variations(db: Session, topic_id: int, task_type: str) -> set[str]:
    return {
        v
        for v in db.scalars(
            select(PracticeQuestion.variation_note).where(
                PracticeQuestion.topic_item_id == topic_id, PracticeQuestion.task_type == task_type
            )
        )
        if v
    }


def compose_offline(db: Session, topic: TopicItem, task_type: str, rng: random.Random | None = None) -> PracticeQuestion:
    if task_type not in OFFLINE_TASKS:
        raise ValueError(f"Offline generation supports {', '.join(OFFLINE_TASKS)}; use AI generation for {task_type}.")
    rng = rng or random.Random()
    audiences = topic.audiences or ["a friend"]
    purposes = topic.purposes or ["share your view"]
    details = topic.details or [topic.scenario]
    views = topic.viewpoints or []
    used = _used_variations(db, topic.id, task_type)
    combos = list(itertools.product(range(len(audiences)), range(len(purposes))))
    rng.shuffle(combos)
    pick = next((c for c in combos if f"{task_type}:{c[0]}:{c[1]}" not in used), None)
    if pick is None:
        raise ValueError("All offline variations of this topic and task have been generated. Use AI generation for new ones.")
    ai, pi = pick
    audience, purpose = audiences[ai], purposes[pi]
    ds = sorted(rng.sample(details, k=min(3, len(details))), key=details.index)  # keep the topic's natural order
    skill, task = fmt.task_by_key(task_type)
    q = PracticeQuestion(
        skill=skill,
        task_type=task_type,
        topic_item_id=topic.id,
        difficulty=topic.difficulty,
        audience=audience,
        purpose=purpose,
        background=topic.scenario,
        source_type="original",
        variation_note=f"{task_type}:{ai}:{pi}",
        learning_objectives=[f"Adapt the {task['name']} structure to: {purpose}"],
    )
    if task_type == "W1":
        q.title = f"Email — {topic.title}"
        q.prompt = (
            f"{topic.scenario}\n\nWrite an email to {audience} to {purpose}. In your email, do the following:\n"
            + "\n".join(f"• {d}" for d in ds)
        )
        q.word_min, q.word_max, q.time_limit_sec = 150, 200, 27 * 60
        q.expected_format = "Email with greeting, clear purpose, three developed points, closing and sign-off."
    elif task_type == "W2":
        a, b = (views + [{"label": "Option A", "argument": ""}, {"label": "Option B", "argument": ""}])[:2]
        q.title = f"Survey — {topic.title}"
        q.prompt = (
            f"{topic.scenario}\n\nA survey asks residents and stakeholders which option they prefer. "
            f"Choose ONE option and explain the reasons for your choice.\n\n"
            f"Option A: {a['label']}\nOption B: {b['label']}"
        )
        q.content = {"options": [a["label"], b["label"]]}
        q.word_min, q.word_max, q.time_limit_sec = 150, 200, 26 * 60
        q.expected_format = "Clear choice, two or three well-supported reasons, acknowledgement of the other option."
    elif task_type == "S1":
        q.title = f"Advice — {topic.title}"
        q.prompt = f"{audience.capitalize()} is dealing with this situation: {topic.scenario} Advise them on how to {purpose}."
    elif task_type == "S2":
        q.title = f"Personal experience — {topic.title}"
        q.prompt = (
            f"Talk about a time when you experienced something related to this: {topic.scenario} "
            f"Describe what happened, how you handled it, and what you learned. Mention: {ds[0]}."
        )
    elif task_type == "S4":
        q.title = f"Predictions — {topic.title}"
        q.prompt = f"Imagine the situation below one month from now. Predict what will probably happen next and why.\n\n{topic.scenario} Details: {'; '.join(ds)}."
    elif task_type == "S5":
        a, b = (views + [{"label": "Option A"}, {"label": "Option B"}])[:2]
        q.title = f"Comparing and persuading — {topic.title}"
        q.prompt = (
            f"{topic.scenario}\n\nYou prefer “{a['label']}”. {audience.capitalize()} prefers “{b['label']}”. "
            f"Persuade {audience} that your choice is better, comparing both options."
        )
        q.content = {"options": [a["label"], b["label"]]}
    elif task_type == "S6":
        q.title = f"Difficult situation — {topic.title}"
        q.prompt = (
            f"{topic.scenario}\n\nChoose ONE:\nOption 1: Talk to {audience} and explain why you need to {purpose}.\n"
            f"Option 2: Talk to {audiences[(ai + 1) % len(audiences)]} and propose an alternative that solves the problem."
        )
    elif task_type == "S7":
        a, b = (views + [{"label": "Yes"}, {"label": "No"}])[:2]
        q.title = f"Opinion — {topic.title}"
        q.prompt = f"{topic.scenario}\n\nWhich do you support: “{a['label']}” or “{b['label']}”? Explain your opinion with reasons and examples."
    if skill == "speaking":
        q.prep_time_sec = task["prep"]
        q.time_limit_sec = task["response"]
        q.expected_format = "Spoken response that fills the time with a clear structure."
    db.add(q)
    topic.practice_count += 0  # generation is not practice
    db.commit()
    db.refresh(q)
    return q


# ------------------------------------------------------------------ AI generation
ITEM = _obj(
    {
        "id": _str,
        "stem": _str,
        "options": _arr(_str),
        "answer": _int,
        "explanation": _str,
        "qtype": {"type": "string", "enum": ["detail", "gist", "inference", "viewpoint", "purpose", "vocabulary", "apply_information"]},
        "section": _int,
    }
)

GEN_SCHEMA = _obj(
    {
        "title": _str,
        "audience": _str,
        "purpose": _str,
        "background": _str,
        "prompt": _str,
        "instructions": _str,
        "difficulty": _int,
        "learning_objectives": _arr(_str),
        "passage": _str,
        "diagram_text": _str,
        "script": _arr(_obj({"speaker": _str, "text": _str})),
        "scene_description": _str,
        "options": _arr(_str),
        "items": _arr(ITEM),
        "sample_response": _str,
        "is_original": _bool,
    }
)


class _Item(BaseModel):
    id: str
    stem: str
    options: list[str]
    answer: int
    explanation: str
    qtype: str
    section: int = 1

    @field_validator("options")
    @classmethod
    def opts(cls, v):
        if len(v) < 3:
            raise ValueError("need at least 3 options")
        return v


TASK_GUIDE = {
    "L1": "A conversation where two people solve a problem, in 3 short sections. Start each section with a script turn "
    "{speaker: 'Narrator', text: '[Section N]'}. The test plays one section, then asks only that section's questions, so set "
    "each item's `section` (1-3) to the section that answers it, in order (about 3, 3 and 2 items). Items test details and decisions.",
    "L2": "A short everyday conversation (e.g. at a service counter). Items test detail and speaker intention.",
    "L3": "A conversation in which one person gives information to another. Items test specific information.",
    "L4": "A short radio-style news item about a local or community event. Items test main idea and details.",
    "L5": "A discussion among three people (e.g. at work). Items test who said what, opinions and decisions.",
    "L6": "A short talk or broadcast presenting viewpoints on an issue. Items test viewpoints, inference and purpose.",
    "R1": "A personal or workplace email/letter and a reply. Items test detail, purpose and inference.",
    "R2": "A diagram/notice/schedule described in text (diagram_text, as a table or list) plus an email that refers to it. Items require applying the diagram information.",
    "R3": "An informational article of 4-5 labelled paragraphs (A-E). Items ask which paragraph contains given information (options are paragraph letters plus 'Not given').",
    "R4": "An article presenting a debate with several viewpoints, followed by a reader's comment. Items test viewpoints, inference, and the writer's attitude.",
    "W1": "Email task: situation + 3 bullet points to address; 150-200 words; 27 minutes.",
    "W2": "Survey task: a survey scenario with two options; choose one and explain; 150-200 words; 26 minutes.",
    "S1": "Giving Advice: 30 s prep, 90 s response.",
    "S2": "Talking about a Personal Experience: 30 s prep, 60 s response.",
    "S3": "Describing a Scene: describe a picture (provide a vivid scene_description of a busy everyday scene); 30 s prep, 60 s.",
    "S4": "Making Predictions: same scene as S3 style; predict what happens next; 30 s prep, 60 s.",
    "S5": "Comparing and Persuading: two options with details; choose one and persuade a family member; 60 s prep, 60 s.",
    "S6": "Dealing with a Difficult Situation: choose between two hard options (e.g. talk to X or Y); 60 s prep, 60 s.",
    "S7": "Expressing Opinions: a yes/no question on an issue; 30 s prep, 90 s.",
    "S8": "Describing an Unusual Situation: describe an unusual object/scene to someone who cannot see it (scene_description); 30 s prep, 60 s.",
}

ITEM_COUNTS = {t["key"]: t["questions"] for t in fmt.LISTENING_TASKS + fmt.READING_TASKS}


def generate_ai(
    db: Session,
    s: UserSettings,
    *,
    skill: str,
    task_type: str,
    topic: TopicItem | None = None,
    difficulty: int = 3,
    variation_hint: str = "",
    current_affairs_context: str = "",
    current_affairs_id: int | None = None,
) -> PracticeQuestion:
    found = fmt.task_by_key(task_type)
    if not found or found[0] != skill:
        raise AIError("bad_request", "Unknown task type for this skill.")
    task = found[1]
    existing = []
    if topic:
        existing = list(
            db.scalars(select(PracticeQuestion.prompt).where(PracticeQuestion.topic_item_id == topic.id).limit(8))
        )
    objective = skill in ("listening", "reading")
    n_items = ITEM_COUNTS.get(task_type, 0)
    n_items = min(n_items, 8) if objective else 0
    user = [
        f"Create ONE original CELPIP-General-style practice item.\nComponent: {skill}. Task: {task_type} — {task['name']}.",
        f"Format guidance: {TASK_GUIDE[task_type]}",
        f"Difficulty {difficulty}/5. Increase difficulty through denser information, competing viewpoints, subtler "
        "implications and tighter constraints — not obscure vocabulary.",
    ]
    if topic:
        user.append(
            f"Topic: {topic.title} ({topic.category.name if topic.category else ''}). Scenario: {topic.scenario}\n"
            f"Background: {topic.background}"
        )
    if current_affairs_context:
        user.append(
            "Base the scenario on this real news context (summary supplied by the publisher's feed). Do NOT invent "
            "facts, statistics or quotations beyond it; frame the practice item as an original scenario inspired by "
            f"the issue, with neutral framing:\n{current_affairs_context}"
        )
    if variation_hint:
        user.append(f"Variation requirement: {variation_hint}")
    if existing:
        user.append(
            "Avoid repeating these existing prompts — change the audience, purpose, constraints and details, not just names:\n- "
            + "\n- ".join(p[:200] for p in existing)
        )
    if objective:
        user.append(
            f"Provide exactly {n_items} multiple-choice items with 4 options each (R3: options are paragraph letters "
            "and 'Not given'). `answer` is the 0-based index of the correct option; the answer must be unambiguously "
            "supported by the text. Give each item a short id like 'q1'. Mix qtypes (detail, inference, viewpoint, "
            "gist, apply_information). Do not put the answer in a distinctive position pattern. Set `section` to 1 "
            "unless the task has sections."
        )
        if skill == "listening":
            user.append("Put the spoken material in `script` as speaker turns (natural spoken Canadian English, ~350-600 words). Leave passage empty.")
        else:
            user.append("Put the reading text in `passage` (~350-550 words). For R2 also fill `diagram_text`. Leave script empty.")
        user.append("Leave sample_response empty and options empty.")
    else:
        user.append(
            "Leave items, script, passage and diagram_text empty. For W2/S5/S7 put the choices in `options`. For "
            "S3/S8 fill `scene_description`. Write a strong, natural `sample_response` that fits the word count or "
            "speaking time."
        )
    user.append("Set is_original=true. Never claim this is an official, past, leaked or predicted exam question.")

    res = complete_json(
        db,
        s,
        system="You write original, realistic CELPIP-General-style practice material in natural Canadian English. "
        "Content must be original; never reproduce official CELPIP test questions.",
        user="\n\n".join(user),
        schema=GEN_SCHEMA,
        purpose=f"generate_{task_type}",
        max_tokens=10000,
    )
    d = res.data
    items = []
    if objective:
        try:
            items = [_Item.model_validate(i).model_dump() for i in d.get("items", [])]
        except ValidationError as e:
            raise AIError("invalid_output", f"Generated questions failed validation: {e}", True)
        for i, it in enumerate(items):
            it["id"] = f"q{i + 1}"
            if not 0 <= it["answer"] < len(it["options"]):
                raise AIError("invalid_output", "Generated answer key was out of range. Try again.", True)
        if len(items) < 3:
            raise AIError("invalid_output", "Too few questions were generated. Try again.", True)
        body = d.get("script") if skill == "listening" else d.get("passage")
        if not body:
            raise AIError("invalid_output", "The generated item had no listening script / reading passage.", True)

    content: dict = {}
    if d.get("passage"):
        content["passage"] = d["passage"]
    if d.get("diagram_text"):
        content["diagram_text"] = d["diagram_text"]
    if d.get("script"):
        content["script"] = d["script"]
    if d.get("scene_description"):
        content["scene_description"] = d["scene_description"]
    if d.get("options"):
        content["options"] = d["options"]

    q = PracticeQuestion(
        skill=skill,
        task_type=task_type,
        title=d.get("title") or task["name"],
        topic_item_id=topic.id if topic else None,
        current_affairs_id=current_affairs_id,
        difficulty=max(1, min(5, d.get("difficulty") or difficulty)),
        audience=d.get("audience", ""),
        purpose=d.get("purpose", ""),
        background=d.get("background", ""),
        prompt=d.get("prompt", ""),
        instructions=d.get("instructions", ""),
        content=content,
        items=items,
        learning_objectives=d.get("learning_objectives", []),
        sample_response=d.get("sample_response", ""),
        source_type="ai_generated",
        variation_note=f"ai:{utcnow().isoformat()}",
    )
    if skill == "writing":
        q.word_min, q.word_max, q.time_limit_sec = 150, 200, task["minutes"] * 60
    elif skill == "speaking":
        q.prep_time_sec, q.time_limit_sec = task["prep"], task["response"]
    else:
        q.time_limit_sec = 60 * (10 if skill == "reading" else 8)
    db.add(q)
    db.commit()
    db.refresh(q)
    return q
