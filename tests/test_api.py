"""REST API: endpoints return correct data and surface database rule violations."""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from main import app  # noqa: E402

client = TestClient(app)


def test_health():
    """TC-API-01 | API | GET /api/health reports the placeiq database as reachable"""
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["database"] == "placeiq"


def test_summary_kpis():
    """TC-API-02 | API | GET /api/summary returns the final-cycle KPIs (30 of 177 placed)"""
    cycle = client.get("/api/summary", params={"cycle_id": 2}).json()["cycle"]
    assert (cycle["placed"], cycle["participants"]) == (30, 177)


def test_student_search():
    """TC-API-03 | API | Student search is case-insensitive and matches names"""
    rows = client.get("/api/students", params={"q": "SEN"}).json()
    assert rows and all("sen" in (r["student_name"] + r["roll_no"]).lower() for r in rows)


def test_unknown_student_404():
    """TC-API-04 | API | An unknown roll number returns HTTP 404"""
    assert client.get("/api/students/NOPE-000").status_code == 404


def test_job_endpoints():
    """TC-API-05 | API | Jobs list has 25 jobs; job 19's funnel shows 70 applicants"""
    assert len(client.get("/api/jobs").json()) == 25
    assert client.get("/api/jobs/19").json()["funnel"]["applied"] == 70


def test_queries_run():
    """TC-API-06 | API | All five analytical queries run through the API in a read-only transaction"""
    for q in client.get("/api/queries").json():
        r = client.post(f"/api/queries/{q['id']}/run")
        assert r.status_code == 200 and r.json()["row_count"] > 0


def test_rule_violation_is_explained():
    """TC-API-07 | API | A rejected application returns HTTP 409 with the SQLSTATE and the trigger that raised it"""
    r = client.post("/api/applications", json={"roll_no": "PGP62-022", "job_id": 25})
    body = r.json()
    assert r.status_code == 409
    assert body["sqlstate"] == "23514" and body["raised_by"] == "fn_check_application_eligibility"


def test_accept_offer_returns_cascade(reset_after):
    """TC-API-08 | API | Accepting an offer via the API returns the cascade the trigger performed"""
    assert client.post("/api/offers", json={"roll_no": "PGP62-084", "job_id": 21}).status_code == 201
    offer_id = next(a["offer_id"] for a in client.get("/api/students/PGP62-084").json()["applications"]
                    if a["job_id"] == 19)
    body = client.post(f"/api/offers/{offer_id}/accept").json()
    assert {c["action"] for c in body["cascade"]} == {"AUTO_DECLINED", "AUTO_WITHDRAWN", "OFFER_ACCEPTED"}


def test_decline_non_pending_conflict():
    """TC-API-09 | API | Declining an offer that is not pending returns HTTP 409"""
    accepted = client.get("/api/students/PGP62-086").json()["applications"]
    offer_id = next(a["offer_id"] for a in accepted if a["offer_status"] == "ACCEPTED")
    assert client.post(f"/api/offers/{offer_id}/decline").status_code == 409


def test_ui_served():
    """TC-API-10 | UI | The single-page UI and its assets are served"""
    assert "PlaceIQ" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200


def test_reset_endpoint():
    """TC-API-11 | API | POST /api/admin/reset rebuilds the seeded database"""
    r = client.post("/api/admin/reset")
    assert r.status_code == 200
    status = next(s for s in client.get("/api/students/PGP62-084").json()["statuses"] if s["cycle_id"] == 2)
    assert status["placement_status"] == "OFFER_PENDING"
