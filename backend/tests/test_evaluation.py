import pytest
from sqlalchemy import select

from app import models
from app.services import ai, evaluator
from tests.conftest import fake_evaluation


@pytest.fixture()
def fake_ai(monkeypatch):
    calls = []

    def fake(db, s, *, system, user, schema, purpose, max_tokens=None, route="practice"):
        calls.append({"purpose": purpose, "user": user, "route": route})
        data = calls_data.pop(0) if calls_data else fake_evaluation()
        return ai.AIResult(data, "anthropic", "claude-opus-5-5", 1000, 2000, ai.estimate_cost("claude-opus-5-5", 1000, 2000))

    calls_data: list = []
    monkeypatch.setattr(evaluator, "complete_json", fake)
    return calls, calls_data


def _writing_attempt(client, db, text="Dear Ms. Tremblay, I need new key for my apartment because I lost it yesterday at the gym."):
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.task_type == "W1"))
    return client.post("/api/attempts", json={"question_id": q.id, "response_text": text}).json()


def test_writing_evaluation_saved_with_criteria_and_mistakes(client, db, fake_ai):
    calls, _ = fake_ai
    a = _writing_attempt(client, db)
    r = client.post(f"/api/attempts/{a['id']}/evaluate")
    assert r.status_code == 200, r.text
    ev = [e for e in r.json()["evaluations"] if e["kind"] == "ai_rubric"][0]
    assert ev["estimated_level"] == 9
    assert len(ev["criteria"]) == 2
    assert ev["corrections"][0]["corrected"] == "I need a new key."
    assert len(ev["comparison"]) == 3
    # prompt contains task metadata and the response, wrapped as data
    assert "<response>" in calls[0]["user"] and "W1" in calls[0]["user"]
    m = db.scalar(select(models.Mistake).where(models.Mistake.pattern.like("Missing article%")))
    assert m and m.occurrence_count >= 1
    # persisted: survives a fresh read
    again = client.get(f"/api/attempts/{a['id']}").json()
    assert again["status"] == "evaluated"


def test_recurring_mistake_is_merged_and_tracked(client, db, fake_ai):
    _, data = fake_ai
    data.append(fake_evaluation(mistake_pattern="Missing articles before singular countable nouns"))
    a = _writing_attempt(client, db)
    client.post(f"/api/attempts/{a['id']}/evaluate")
    ms = list(db.scalars(select(models.Mistake).where(models.Mistake.category == "grammar")))
    assert len(ms) == 1, [m.pattern for m in ms]  # near-duplicate pattern merged
    assert ms[0].occurrence_count >= 2


def test_recurring_check_improves_status(client, db, fake_ai):
    calls, data = fake_ai
    m = db.scalar(select(models.Mistake).where(models.Mistake.category == "grammar"))
    for _ in range(2):
        ev = fake_evaluation()
        ev["mistakes"] = []
        ev["recurring_checks"] = [{"mistake_id": m.id, "result": "not_observed", "evidence": "articles correct"}]
        data.append(ev)
        a = _writing_attempt(client, db, "Dear Ms. Tremblay, I need a new key for my apartment because I lost the old one.")
        client.post(f"/api/attempts/{a['id']}/evaluate")
    db.refresh(m)
    assert m.status == "improving"
    assert f"id={m.id}" in calls[-1]["user"]  # known mistakes are surfaced to the evaluator


def test_invalid_ai_output_is_rejected(client, db, fake_ai):
    _, data = fake_ai
    data.extend([{"overall": {}}, {"nonsense": True}])
    a = _writing_attempt(client, db)
    r = client.post(f"/api/attempts/{a['id']}/evaluate")
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "invalid_output"
    assert client.get(f"/api/attempts/{a['id']}").json()["status"] == "eval_failed"


def test_speaking_text_only_limitation(client, db, fake_ai):
    calls, _ = fake_ai
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.task_type == "S7"))
    a = client.post("/api/attempts", json={"question_id": q.id, "response_text": "In my opinion cities should invest in public transit because it reduces traffic."}).json()
    r = client.post(f"/api/attempts/{a['id']}/evaluate").json()
    ev = [e for e in r["evaluations"] if e["kind"] == "ai_rubric"][0]
    assert "pronunciation" in ev["limitations"].lower()
    assert "TYPED" in calls[-1]["user"]


def test_save_vocab_from_evaluation(client, db, fake_ai):
    a = _writing_attempt(client, db)
    r = client.post(f"/api/attempts/{a['id']}/evaluate").json()
    ev = [e for e in r["evaluations"] if e["kind"] == "ai_rubric"][0]
    v = client.post("/api/vocabulary/from-evaluation", json={"evaluation_id": ev["id"], "index": 0}).json()
    assert v["term"] == "resolve"
    assert v["source_attempt_id"] == a["id"] or v.get("duplicate")


def test_mock_attempts_route_to_mock_model(client, db, monkeypatch):
    """Practice uses the practice provider; mock-exam attempts use the mock-exam provider."""
    seen = []

    def fake_call(provider):
        def _f(key, s, model, system, user, schema, max_tokens):
            import json

            seen.append((provider, model))
            return json.dumps(fake_evaluation()), 100, 200
        return _f

    monkeypatch.setattr(ai, "_gemini_call", fake_call("gemini"))
    monkeypatch.setattr(ai, "_anthropic_call", fake_call("anthropic"))
    monkeypatch.setattr(ai.config, "get_secret", lambda name: "test-key")
    client.put("/api/settings", json={"ai_provider": "gemini", "ai_model": "gemini-pro-latest",
                                       "mock_ai_provider": "anthropic", "mock_ai_model": "claude-opus-5-5"})
    a = _writing_attempt(client, db)
    assert client.post(f"/api/attempts/{a['id']}/evaluate").status_code == 200
    m = client.post("/api/mock-exams", json={"mode": "section", "skills": ["writing"]}).json()
    q = m["sections"][0]["question_ids"][0]
    ma = client.post("/api/attempts", json={"question_id": q, "mode": "mock", "mock_exam_id": m["id"],
                                             "response_text": "Dear Ms. Tremblay, I am writing about the community centre schedule."}).json()
    assert client.post(f"/api/attempts/{ma['id']}/evaluate").status_code == 200
    assert seen == [("gemini", "gemini-pro-latest"), ("anthropic", "claude-opus-5-5")]
    ev = client.get(f"/api/attempts/{ma['id']}").json()["evaluations"][-1]
    assert ev["provider"] == "anthropic"
    client.put("/api/settings", json={"ai_provider": "anthropic", "ai_model": "claude-opus-5-5"})


def test_gemini_response_parsing(monkeypatch):
    class R:
        status_code = 200

        def json(self):
            return {"candidates": [{"finishReason": "STOP", "content": {"parts": [
                {"text": "thinking...", "thought": True}, {"text": '{"status": "ok"}'}]}}],
                "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "thoughtsTokenCount": 7}}

    monkeypatch.setattr(ai, "_gemini_post", lambda *a, **k: R())
    s = models.UserSettings(ai_timeout_seconds=30)
    text, inp, out = ai._gemini_call("k", s, "gemini-pro-latest", "sys", "user", {}, 100)
    assert text == '{"status": "ok"}' and inp == 10 and out == 12  # thoughts excluded from text, billed as output

    class Bad:
        status_code = 403

        def json(self):
            return {"error": {"message": "API key not valid"}}

    monkeypatch.setattr(ai, "_gemini_post", lambda *a, **k: Bad())
    with pytest.raises(ai.AIError) as e:
        ai._gemini_call("k", s, "gemini-pro-latest", "sys", "user", {}, 100)
    assert e.value.code == "auth"


def test_mock_speaking_uses_practice_model_by_default(client, db):
    from app.services.evaluator import route_for

    s = db.scalar(select(models.UserSettings))
    w = models.PracticeAttempt(skill="writing", task_type="W1", mode="mock", mock_exam_id=1)
    sp = models.PracticeAttempt(skill="speaking", task_type="S1", mode="mock", mock_exam_id=1)
    practice = models.PracticeAttempt(skill="speaking", task_type="S1", mode="practice")
    assert route_for(w, s) == "mock"
    assert route_for(sp, s) == "practice"
    assert route_for(practice, s) == "practice"
    s.mock_model_for_speaking = True
    assert route_for(sp, s) == "mock"
    s.mock_model_for_speaking = False
