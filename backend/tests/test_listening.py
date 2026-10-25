from sqlalchemy import select

from app import models
from app.services import listening


def _q(script, items):
    return models.PracticeQuestion(id=999, skill="listening", task_type="L1", title="t", content={"script": script}, items=items)


def test_starter_part1_sets_have_sections_in_order(db):
    for q in db.scalars(select(models.PracticeQuestion).where(models.PracticeQuestion.task_type == "L1")):
        plan = listening.section_plan(q)
        assert len(plan) == 3, q.title
        ids = [i for sec in plan for i in sec["item_ids"]]
        assert ids == [str(it["id"]) for it in q.items]  # every question once, in order
        assert all(sec["item_ids"] for sec in plan)  # each section is followed by questions


def test_single_section_parts_show_all_questions_after_audio(db):
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.task_type == "L4"))
    plan = listening.section_plan(q)
    assert len(plan) == 1 and len(plan[0]["item_ids"]) == len(q.items)


def test_fallback_assignment_is_monotonic_and_markers_not_spoken():
    script = [
        {"speaker": "Narrator", "text": "[Section 1]"},
        {"speaker": "A", "text": "The radiator in the bedroom is cold."},
        {"speaker": "Narrator", "text": "[Section 2]"},
        {"speaker": "B", "text": "The plumber will come on Thursday afternoon."},
    ]
    items = [
        {"id": "q1", "stem": "What is cold?", "options": ["radiator", "window", "door"], "answer": 0, "explanation": "bedroom radiator"},
        {"id": "q2", "stem": "When will the plumber come?", "options": ["Thursday afternoon", "Monday", "Friday"], "answer": 0, "explanation": ""},
        {"id": "q3", "stem": "Which room?", "options": ["bedroom", "kitchen", "hall"], "answer": 0, "explanation": "radiator bedroom cold"},
    ]
    plan = listening.section_plan(_q(script, items))
    assert plan[0]["item_ids"] == ["q1"]
    assert plan[1]["item_ids"] == ["q2", "q3"]  # never goes back to an earlier section
    secs = listening.split_sections(script)
    assert all(not s["speaker"].startswith("Narrator") for sec in secs for s in sec["segments"])


def test_audio_plan_without_gemini_key(client, db, monkeypatch):
    monkeypatch.setattr(listening, "tts_available", lambda: False)
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.task_type == "L1"))
    r = client.get(f"/api/questions/{q.id}/audio-plan").json()
    assert r["tts_available"] is False and len(r["sections"]) == 3
    assert client.get(f"/api/questions/{q.id}/audio/1.wav").status_code == 404


def test_daily_quota_error_is_recognised():
    from app.services.ai import _gemini_error

    class R:
        status_code = 429

        def json(self):
            return {"error": {"message": "quota", "details": [
                {"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel"}]}, {"retryDelay": "34303s"}]}}

    e = _gemini_error(R())
    assert e.code == "quota_daily" and not e.retryable and "9.5 hours" in e.message
