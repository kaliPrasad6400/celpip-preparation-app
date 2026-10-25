from sqlalchemy import select

from app import models


def test_note_sanitized_and_backlinks(client, db):
    tpl = db.scalar(select(models.Template))
    html = (
        '<h2>Plan</h2><p>See <a href="app://template/%d" data-link-type="template" data-link-id="%d">tpl</a></p>'
        '<script>alert(1)</script><p onclick="x()">ok</p>' % (tpl.id, tpl.id)
    )
    n = client.post("/api/notes", json={"title": "Linked note", "content_html": html, "tags": ["t1"]}).json()
    assert "<script" not in n["content_html"] and "onclick" not in n["content_html"]
    t = client.get(f"/api/templates/{tpl.id}").json()
    assert any(b["kind"] == "note" and b["id"] == n["id"] for b in t["backlinks"])
    # autosave-style patch and search
    client.patch(f"/api/notes/{n['id']}", json={"content_html": "<p>Discuss eavestrough maintenance</p>"})
    res = client.get("/api/search?q=eavestrough").json()
    assert any(r["kind"] == "note" and r["id"] == n["id"] for r in res)
    t = client.get(f"/api/templates/{tpl.id}").json()
    assert not any(b["kind"] == "note" and b["id"] == n["id"] for b in t["backlinks"])  # link removed


def test_vocab_review_and_quiz(client):
    v = client.post("/api/vocabulary", json={"term": "unprecedented test term", "meaning": "never done before",
                                               "example": "It was an unprecedented test term moment."}).json()
    r = client.post(f"/api/vocabulary/{v['id']}/review", json={"result": "good", "mode": "card"}).json()
    assert r["review_count"] == 1 and r["status"] == "learning"
    quiz = client.get("/api/vocabulary/quiz?kind=fill&n=5").json()
    assert quiz and all(0 <= q["answer"] < len(q["options"]) for q in quiz)
    dup = client.post("/api/vocabulary", json={"term": "Unprecedented Test Term"}).json()
    assert dup.get("duplicate")


def test_template_crud_and_recall(client):
    t = client.post("/api/templates", json={"name": "My W2 frame", "skill": "writing", "task_type": "W2",
                                            "structure": [{"step": "Choose", "guidance": "state option"}]}).json()
    r = client.post(f"/api/templates/{t['id']}/recall", json={"success": True}).json()
    assert r["times_without_looking"] == 1
    rec = client.get("/api/templates/recommend?skill=writing&task_type=W2").json()
    assert rec["id"] == t["id"]  # user's own template preferred
    assert client.delete(f"/api/templates/{t['id']}").status_code == 200


def test_topics_filter_and_offline_generation(client):
    cats = client.get("/api/topic-categories").json()
    groups = {c["group"] for c in cats}
    assert {"everyday", "workplace", "society", "reference", "general"} <= groups
    work = client.get("/api/topics?group=workplace").json()
    assert len(work) >= 10
    t = work[0]
    r = client.post(f"/api/topics/{t['id']}/generate", json={"task_types": ["W1", "W2", "S1", "S7"], "use_ai": False}).json()
    assert len(r["created"]) == 4, r
    r2 = client.post(f"/api/topics/{t['id']}/generate", json={"task_types": ["W1"], "use_ai": False}).json()
    if r2["created"]:
        a = client.get(f"/api/questions/{r['created'][0]['id']}").json()
        b = client.get(f"/api/questions/{r2['created'][0]['id']}").json()
        assert a["prompt"] != b["prompt"]  # a different audience/purpose combination
    filt = client.get("/api/topics?skill=writing&difficulty=3").json()
    assert all(x["difficulty"] == 3 for x in filt)
    sv = client.post(f"/api/topics/{t['id']}/save-vocab", json={"index": 0}).json()
    assert sv["term"]


def test_mock_exam_flow(client):
    m = client.post("/api/mock-exams", json={"mode": "section", "skills": ["reading"]}).json()
    assert m["sections"][0]["skill"] == "reading"
    assert client.post(f"/api/mock-exams/{m['id']}/sections/1/start").status_code in (404, 409)
    s = client.post(f"/api/mock-exams/{m['id']}/sections/0/start").json()
    q = s["sections"][0]["questions"][0]
    assert all("answer" not in it for it in q["items"])
    client.post("/api/attempts", json={"question_id": q["id"], "answers": {it["id"]: 0 for it in q["items"]}, "mock_exam_id": m["id"], "mode": "mock"})
    client.post(f"/api/mock-exams/{m['id']}/sections/0/complete")
    r = client.post(f"/api/mock-exams/{m['id']}/finish", json={"evaluate": False}).json()
    assert r["status"] == "completed"
    res = r["results"][0]
    assert res["objective_total"] >= len(q["items"]) and res["objective_correct"] is not None


def test_backup_and_restore_roundtrip(client):
    n = client.post("/api/notes", json={"title": "Before backup"}).json()
    b = client.post("/api/data/backups").json()
    client.delete(f"/api/notes/{n['id']}")
    assert client.get(f"/api/notes/{n['id']}").status_code == 404
    assert client.post("/api/data/restore", json={"name": b["name"], "confirm": "nope"}).status_code == 400
    r = client.post("/api/data/restore", json={"name": b["name"], "confirm": "RESTORE"})
    assert r.status_code == 200
    assert client.get(f"/api/notes/{n['id']}").json()["title"] == "Before backup"
    names = [x["name"] for x in client.get("/api/data/backups").json()]
    assert r.json()["safety_backup"] in names


def test_exports(client):
    data = client.get("/api/data/export.json").json()
    assert "notes" in data and "vocabulary" in data
    csv = client.get("/api/data/export/vocabulary.csv")
    assert csv.status_code == 200 and "term" in csv.text.splitlines()[0]


def test_analytics_keeps_data_types_separate(client):
    a = client.get("/api/analytics").json()
    assert a["skills"]["reading"]["measure"] == "objective_accuracy"
    assert a["skills"]["writing"]["measure"] == "ai_estimated_level"
    assert "probability" in a["readiness"]["formula"]
    assert isinstance(a["official_scores"], list)
