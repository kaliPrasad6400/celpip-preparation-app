"""Test setup: every test session uses a throwaway data directory and .env file,
so tests never touch the real database or API keys."""
import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="celpip-test-")
os.environ["CELPIP_DATA_DIR"] = _tmp
os.environ["CELPIP_DB_PATH"] = os.path.join(_tmp, "test.db")
os.environ["CELPIP_ENV_FILE"] = os.path.join(_tmp, ".env")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db(client):
    from app import db as dbmod

    s = dbmod.SessionLocal()
    try:
        yield s
    finally:
        s.close()


def fake_evaluation(level=9, mistake_pattern="Missing article before singular countable nouns", checks=None):
    crit = lambda name: {  # noqa: E731
        "name": name, "assessed": True, "level": level, "strengths": "Clear purpose.",
        "weaknesses": "Some article errors.", "examples": ["I need new key"], "improvements": "Check articles.",
    }
    return {
        "overall": {"summary": "Solid response.", "level_supported": True, "estimated_level": level, "level_range": "8-10",
                    "confidence": "medium", "limitations": "Single sample."},
        "criteria": [crit("Task fulfillment"), crit("Grammar and sentence structure")],
        "corrections": [{"original": "I need new key.", "corrected": "I need a new key.", "explanation": "Article needed.",
                         "natural_alternative": "I need a replacement key.", "category": "grammar"}],
        "vocabulary": [{"original": "fix", "suggestion": "resolve", "meaning": "to settle a problem",
                        "example": "Could you resolve this by Friday?", "collocations": ["resolve an issue"], "formality": "formal"}],
        "improved_response": "Dear Ms. Tremblay, ...",
        "comparison": [{"aspect": "Tone", "mine": "abrupt", "improved": "polite", "why_it_matters": "Audience."}] * 3,
        "next_steps": ["Check articles", "Add a detail", "Use a closing request"],
        "retry_exercise": {"instruction": "Rewrite paragraph 2.", "target_excerpt": "I need new key."},
        "mistakes": [{"category": "grammar", "pattern": mistake_pattern, "original": "I need new key.",
                      "corrected": "I need a new key.", "explanation": "Singular countable nouns need an article.",
                      "recommended_exercise": "Underline every noun and check its article.", "severity": 2}],
        "recurring_checks": checks or [],
    }
