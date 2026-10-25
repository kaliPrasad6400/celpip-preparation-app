"""CELPIP-General task catalog.

Structure and task names follow the publicly described CELPIP-General format.
See CONTENT_SOURCES.md for the references and the date they were checked.
Practice material in this app is original; it is not official test content.
"""
from __future__ import annotations

CHECKED_ON = "2026-10-21"

LISTENING_TASKS = [
    {"key": "L1", "name": "Listening to Problem Solving", "questions": 8},
    {"key": "L2", "name": "Listening to a Daily Life Conversation", "questions": 5},
    {"key": "L3", "name": "Listening for Information", "questions": 6},
    {"key": "L4", "name": "Listening to a News Item", "questions": 5},
    {"key": "L5", "name": "Listening to a Discussion", "questions": 8},
    {"key": "L6", "name": "Listening to Viewpoints", "questions": 6},
]

READING_TASKS = [
    {"key": "R1", "name": "Reading Correspondence", "questions": 11},
    {"key": "R2", "name": "Reading to Apply a Diagram", "questions": 8},
    {"key": "R3", "name": "Reading for Information", "questions": 9},
    {"key": "R4", "name": "Reading for Viewpoints", "questions": 10},
]

WRITING_TASKS = [
    {"key": "W1", "name": "Writing an Email", "minutes": 27, "words": [150, 200]},
    {"key": "W2", "name": "Responding to Survey Questions", "minutes": 26, "words": [150, 200]},
]

# Preparation / response seconds per task (Task 5 has an additional 60 s selection phase).
SPEAKING_TASKS = [
    {"key": "S1", "name": "Giving Advice", "prep": 30, "response": 90},
    {"key": "S2", "name": "Talking about a Personal Experience", "prep": 30, "response": 60},
    {"key": "S3", "name": "Describing a Scene", "prep": 30, "response": 60},
    {"key": "S4", "name": "Making Predictions", "prep": 30, "response": 60},
    {"key": "S5", "name": "Comparing and Persuading", "prep": 60, "response": 60, "selection": 60},
    {"key": "S6", "name": "Dealing with a Difficult Situation", "prep": 60, "response": 60},
    {"key": "S7", "name": "Expressing Opinions", "prep": 30, "response": 90},
    {"key": "S8", "name": "Describing an Unusual Situation", "prep": 30, "response": 60},
]

COMPONENTS = {
    "listening": {"name": "Listening", "minutes": "46–55", "mock_minutes": 50, "tasks": LISTENING_TASKS},
    "reading": {"name": "Reading", "minutes": "43–56", "mock_minutes": 55, "tasks": READING_TASKS},
    "writing": {"name": "Writing", "minutes": "53", "mock_minutes": 53, "tasks": WRITING_TASKS},
    "speaking": {"name": "Speaking", "minutes": "15–20", "mock_minutes": 20, "tasks": SPEAKING_TASKS},
}

ORDER = ["listening", "reading", "writing", "speaking"]

SCORING_NOTE = (
    "Official CELPIP results are reported as a separate level (0–12) for each skill. "
    "Levels 3–12 correspond to the same CLB number. Practice accuracy and AI estimates "
    "in this app are unofficial and are not CELPIP scores."
)

WRITING_CRITERIA = [
    "Task fulfillment",
    "Relevance and completeness",
    "Organization and coherence",
    "Vocabulary range and precision",
    "Grammar and sentence structure",
    "Clarity and readability",
    "Tone and appropriateness",
    "Supporting details and examples",
    "Word count and task constraints",
]

SPEAKING_CRITERIA = [
    "Task fulfillment",
    "Relevance and completeness",
    "Organization",
    "Vocabulary range",
    "Grammatical accuracy",
    "Coherence and transitions",
    "Naturalness and clarity",
    "Development of ideas",
    "Time management",
    "Pronunciation, pace and fluency",
]

MISTAKE_CATEGORIES = [
    "grammar",
    "vocabulary",
    "sentence_structure",
    "organization",
    "relevance",
    "incomplete_development",
    "weak_examples",
    "repetition",
    "unnatural_expression",
    "tone",
    "timing",
    "task_requirements",
    "listening_comprehension",
    "reading_comprehension",
    "spelling_punctuation",
    "other",
]


def task(skill: str, key: str) -> dict | None:
    for t in COMPONENTS[skill]["tasks"]:
        if t["key"] == key:
            return t
    return None


def task_by_key(key: str) -> tuple[str, dict] | None:
    for skill, comp in COMPONENTS.items():
        for t in comp["tasks"]:
            if t["key"] == key:
                return skill, t
    return None


def task_name(key: str) -> str:
    found = task_by_key(key)
    return found[1]["name"] if found else key
