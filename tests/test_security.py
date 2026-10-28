"""Security: least-privilege role (DCL) and SQL-injection behaviour."""

import sys
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import expect_error, scalar

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from main import app  # noqa: E402

client = TestClient(app)
OR_PAYLOAD = "x' OR '1'='1"


def _as_readonly(db):
    db.execute("SET LOCAL ROLE placeiq_readonly")


def test_readonly_can_read_granted_tables(db):
    """TC-SEC-01 | DCL | placeiq_readonly can SELECT the two tables it was granted"""
    _as_readonly(db)
    assert scalar(db, "SELECT count(*) FROM student") == 180
    assert scalar(db, "SELECT count(*) FROM person") > 180


def test_readonly_cannot_read_other_tables(db):
    """TC-SEC-02 | DCL | placeiq_readonly is denied SELECT on tables it was not granted (offer)"""
    _as_readonly(db)
    expect_error(db, "SELECT count(*) FROM offer", sqlstate="42501")


def test_readonly_cannot_write(db):
    """TC-SEC-03 | DCL | placeiq_readonly cannot INSERT, UPDATE, DELETE or DROP"""
    _as_readonly(db)
    for sql in ("UPDATE student SET cgpa = 10", "DELETE FROM person", "DROP TABLE student",
                "INSERT INTO person (first_name, email) VALUES ('x', 'x@y.in')"):
        expect_error(db, sql, sqlstate="42501")


def test_readonly_cannot_read_server_files(db):
    """TC-SEC-04 | DCL | placeiq_readonly cannot call pg_read_file (unlike the postgres superuser)"""
    _as_readonly(db)
    expect_error(db, "SELECT pg_read_file('postgresql.conf')", sqlstate="42501")


def test_unsafe_search_leaks_everything():
    """TC-SEC-05 | Injection | The deliberately unsafe search returns all 180 students for x' OR '1'='1"""
    r = client.get("/api/security/search", params={"name": OR_PAYLOAD, "mode": "unsafe"})
    assert r.status_code == 200 and r.json()["row_count"] == 180


def test_safe_search_treats_input_as_data():
    """TC-SEC-06 | Injection | The parameterised search returns 0 rows for the same payload"""
    r = client.get("/api/security/search", params={"name": OR_PAYLOAD, "mode": "safe"})
    body = r.json()
    assert r.status_code == 200 and body["row_count"] == 0
    assert body["sql_sent"].endswith("$1") and body["parameters"] == [OR_PAYLOAD]


def test_union_injection_exposes_other_columns():
    """TC-SEC-07 | Injection | A UNION payload on the unsafe path exposes phone numbers, showing the real risk"""
    payload = "x' UNION SELECT roll_no, cgpa::text, phone FROM student JOIN person USING (person_id) --"
    rows = client.get("/api/security/search", params={"name": payload, "mode": "unsafe"}).json()["rows"]
    assert len(rows) == 180 and all(r["email"].startswith("+91") for r in rows)


def test_destructive_injection_is_contained(db):
    """TC-SEC-08 | Defence in depth | A DROP TABLE payload is refused by the read-only transaction and the table survives"""
    r = client.get("/api/security/search", params={"name": "x'; DROP TABLE student; --", "mode": "unsafe"})
    assert r.status_code == 400 and r.json()["sqlstate"] == "25006"
    assert scalar(db, "SELECT count(*) FROM student") == 180


def test_parameterised_procedure_is_injection_safe(db):
    """TC-SEC-09 | Parameterisation | An injection string passed to fn_apply_for_job is treated as a literal roll number"""
    expect_error(db, "SELECT fn_apply_for_job(%s, 25)", ("x'; DELETE FROM student; --",), match="No student with roll number")
    assert scalar(db, "SELECT count(*) FROM student") == 180
