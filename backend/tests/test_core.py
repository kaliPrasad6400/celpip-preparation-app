from datetime import date

from sqlalchemy import func, select

from app import models
from app.services import ai


def test_health_and_seed_content(client, db):
    assert client.get("/api/health").json()["ok"]
    # starter library is loaded for all four skills
    for skill in ("listening", "reading", "writing", "speaking"):
        n = db.scalar(select(func.count(models.PracticeQuestion.id)).where(models.PracticeQuestion.skill == skill))
        assert n > 0, skill
    assert db.scalar(select(func.count(models.Template.id))) >= 20
    assert db.scalar(select(func.count(models.VocabularyItem.id))) >= 100
    assert db.scalar(select(func.count(models.Note.id))) >= 10
    assert db.scalar(select(func.count(models.TopicItem.id))) >= 50


def test_seed_is_idempotent(client, db):
    from app.seed.loader import seed_all

    before = db.scalar(select(func.count(models.Template.id)))
    assert seed_all(db) == {}
    assert db.scalar(select(func.count(models.Template.id))) == before


def test_listening_reading_have_valid_answer_keys(db):
    for q in db.scalars(select(models.PracticeQuestion).where(models.PracticeQuestion.skill.in_(["listening", "reading"]))):
        assert q.items, q.title
        for it in q.items:
            assert 0 <= it["answer"] < len(it["options"]), (q.title, it["id"])


def test_dashboard_exam_date_and_days_remaining(client):
    d = client.get("/api/dashboard").json()
    assert d["exam_date"] == "2026-12-03"
    assert d["days_remaining"] == (date(2026, 12, 3) - date.today()).days


def test_daily_plan_has_two_distinct_skill_modules(client):
    p = client.get("/api/plans/today").json()
    assert len(p["sessions"]) == 2
    assert len({s["skill"] for s in p["sessions"]}) == 2
    for s in p["sessions"]:
        assert s["question"] is not None
        assert s["status"] == "pending"  # opening/generating never completes a module


def test_answer_key_hidden_before_submission(client, db):
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.skill == "listening"))
    d = client.get(f"/api/questions/{q.id}?reveal=true").json()
    assert all("answer" not in it and "explanation" not in it for it in d["items"])
    assert "script" not in d["content"]  # study mode is off by default


def test_objective_scoring_is_deterministic(client, db):
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.skill == "reading"))
    answers = {it["id"]: it["answer"] for it in q.items}
    answers[q.items[0]["id"]] = (q.items[0]["answer"] + 1) % len(q.items[0]["options"])  # one wrong
    a = client.post("/api/attempts", json={"question_id": q.id, "answers": answers}).json()
    assert a["score_total"] == len(q.items)
    assert a["score_correct"] == len(q.items) - 1
    assert abs(a["accuracy"] - (len(q.items) - 1) / len(q.items)) < 1e-3
    # after submission the key is revealed
    assert "answer" in a["question"]["items"][0]


def test_session_completion_requires_attempt_and_review(client):
    p = client.get("/api/plans/today").json()
    s = p["sessions"][0]
    assert client.post(f"/api/sessions/{s['id']}/complete").status_code == 409
    q = s["question"]["id"]
    full = client.get(f"/api/questions/{q}").json()
    body = {"question_id": q, "study_session_id": s["id"]}
    if full["skill"] in ("listening", "reading"):
        body["answers"] = {it["id"]: 0 for it in full["items"]}
    else:
        body["response_text"] = "This is my practice response with enough words to be accepted by the server."
    assert client.post("/api/attempts", json=body).status_code == 200
    assert client.post(f"/api/sessions/{s['id']}/complete").status_code == 409  # review not confirmed
    client.patch(f"/api/sessions/{s['id']}", json={"review_done": True})
    r = client.post(f"/api/sessions/{s['id']}/complete")
    assert r.status_code == 200 and r.json()["status"] == "completed"


def test_missing_api_key_is_handled_gracefully(client, db):
    q = db.scalar(select(models.PracticeQuestion).where(models.PracticeQuestion.skill == "writing"))
    a = client.post("/api/attempts", json={"question_id": q.id, "response_text": "Dear manager, I am writing to ask about the schedule for next week."}).json()
    r = client.post(f"/api/attempts/{a['id']}/evaluate")
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "no_key"
    # the attempt itself is preserved
    assert client.get(f"/api/attempts/{a['id']}").json()["response_text"].startswith("Dear manager")


def test_api_key_never_returned_or_stored_in_db(client, db):
    secret = "sk-ant-test-THISISASECRETVALUE1234567890"
    r = client.put("/api/settings/api-key", json={"provider": "anthropic", "api_key": secret}).json()
    assert r["keys"]["anthropic"]["configured"] is True
    assert secret not in str(r)
    assert secret not in client.get("/api/settings").text
    assert secret not in client.get("/api/diagnostics").text
    # not in any DB table
    import sqlite3
    from app import config

    con = sqlite3.connect(config.DB_PATH)
    dump = "\n".join(con.iterdump())
    con.close()
    assert secret not in dump
    client.delete("/api/settings/api-key/anthropic")
    assert client.get("/api/settings").json()["keys"]["anthropic"]["configured"] is False


def test_srs_schedule():
    from app.services import srs

    item = models.VocabularyItem(term="x", srs_step=0, review_count=0, lapses=0, confidence=1)
    item.reviews = []
    d0 = date(2026, 1, 1)
    srs.review(item, "good", "card", [1, 3, 7], d0)
    assert item.due_date == date(2026, 1, 2) and item.status == "learning"
    srs.review(item, "good", "card", [1, 3, 7], d0)
    assert item.due_date == date(2026, 1, 4)
    srs.review(item, "easy", "card", [1, 3, 7], d0)
    assert item.status == "mastered"
    srs.review(item, "again", "card", [1, 3, 7], d0)
    assert item.srs_step == 0 and item.lapses == 1 and item.due_date == date(2026, 1, 2)


def test_spend_limit_blocks_calls(client, db):
    s = db.scalar(select(models.UserSettings))
    s.daily_request_limit = 1
    db.commit()
    db.add(models.ApiUsage(provider="anthropic", model="claude-opus-5-5", purpose="t", success=True))
    db.commit()
    try:
        ai.check_limits(db, s)
        assert False, "expected limit error"
    except ai.AIError as e:
        assert e.code == "limit_requests"
    finally:
        s.daily_request_limit = 60
        db.query(models.ApiUsage).delete()
        db.commit()
