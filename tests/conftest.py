"""
Shared fixtures for the PlaceIQ test suite.

Run from the Project folder:
    app\\.venv\\Scripts\\python -m pytest tests -v

* The session starts by rebuilding the database (02 -> 03 -> 04), so every
  run starts from the same seeded state, and rebuilds it again at the end.
* `db` gives each test a connection whose work is ROLLED BACK afterwards, so
  tests cannot affect one another.
* `expect_error` runs a statement inside a SAVEPOINT and asserts it fails,
  so one test can check many violations in a row.
* Each test's docstring starts with "TC-ID | requirement | title". A small
  plugin below collects those plus the outcome into tests/results/results.json,
  which the testing report is generated from.
"""

import json
import os
import platform
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

PROJECT_DIR = Path(__file__).resolve().parent.parent
RESULTS_DIR = Path(__file__).resolve().parent / "results"

DB_SETTINGS = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", "5432")),
    "dbname": os.getenv("PGDATABASE", "placeiq"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "postgres"),
}
PSQL = os.getenv("PLACEIQ_PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")


def connect(autocommit: bool = False) -> psycopg.Connection:
    return psycopg.connect(**DB_SETTINGS, row_factory=dict_row, autocommit=autocommit,
                           options="-c search_path=placeiq,public")


def rebuild_database() -> float:
    env = {**os.environ, "PGPASSWORD": DB_SETTINGS["password"]}
    started = time.perf_counter()
    for script in ("02_ddl.sql", "03_logic.sql", "04_data.sql"):
        result = subprocess.run(
            [PSQL, "-h", DB_SETTINGS["host"], "-p", str(DB_SETTINGS["port"]), "-U", DB_SETTINGS["user"],
             "-d", DB_SETTINGS["dbname"], "-q", "-v", "ON_ERROR_STOP=1", "-f", str(PROJECT_DIR / script)],
            env=env, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"{script} failed:\n{result.stderr}")
    return time.perf_counter() - started


# ---------------------------------------------------------------- fixtures

@pytest.fixture(scope="session", autouse=True)
def seeded_database():
    rebuild_database()
    yield
    rebuild_database()


@pytest.fixture
def db():
    conn = connect()
    # Open the outer transaction now. psycopg's conn.transaction() on an IDLE
    # connection starts a real transaction that COMMITs on exit; once one is
    # open it becomes a SAVEPOINT instead, so nothing a test does can persist.
    conn.execute("SELECT 1")
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def reset_after():
    """For tests that must COMMIT (concurrency, API writes): restore the seed afterwards."""
    yield
    rebuild_database()


def expect_error(conn, sql, params=None, *, sqlstate=None, match=None, immediate=False):
    """Assert that `sql` fails. Runs inside a SAVEPOINT so the test can continue."""
    with pytest.raises(psycopg.Error) as info:
        with conn.transaction():
            conn.execute(sql, params)
            if immediate:
                conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    err = info.value
    if sqlstate:
        assert err.sqlstate == sqlstate, f"expected SQLSTATE {sqlstate}, got {err.sqlstate}: {err}"
    if match:
        assert match.lower() in str(err).lower(), f"expected '{match}' in: {err}"
    return err


def one(conn, sql, params=None):
    return conn.execute(sql, params).fetchone()


def scalar(conn, sql, params=None):
    row = conn.execute(sql, params).fetchone()
    return None if row is None else next(iter(row.values()))


def student_id(conn, roll_no):
    return scalar(conn, "SELECT person_id FROM student WHERE roll_no = %s", (roll_no,))


# ---------------------------------------------------------------- results plugin

_records: list[dict] = []
_started = None


def pytest_sessionstart(session):
    global _started
    _started = datetime.now(timezone.utc)


def _parse_doc(item):
    doc = (getattr(item, "function", None).__doc__ or "").strip()
    first = doc.splitlines()[0] if doc else item.name
    parts = [p.strip() for p in first.split("|")]
    if len(parts) >= 3:
        tc, req, title = parts[0], parts[1], " | ".join(parts[2:])
    else:
        tc, req, title = item.name, "", first
    detail = " ".join(line.strip() for line in doc.splitlines()[1:] if line.strip())
    return tc, req, title, detail


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        tc, req, title, detail = _parse_doc(item)
        _records.append({
            "id": tc, "requirement": req, "title": title, "detail": detail,
            "module": item.module.__name__.replace("test_", ""),
            "nodeid": item.nodeid, "outcome": report.outcome,
            "duration_ms": round(report.duration * 1000, 1),
            "message": str(report.longrepr).splitlines()[-1] if report.failed else "",
        })


def pytest_sessionfinish(session, exitstatus):
    RESULTS_DIR.mkdir(exist_ok=True)
    with connect() as conn:
        version = scalar(conn, "SELECT version()")
    summary = {
        "started_utc": _started.isoformat() if _started else None,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "postgres": version,
            "python": platform.python_version(),
            "pytest": pytest.__version__,
            "psycopg": psycopg.__version__,
            "os": f"{platform.system()} {platform.release()}",
        },
        "totals": {
            "total": len(_records),
            "passed": sum(r["outcome"] == "passed" for r in _records),
            "failed": sum(r["outcome"] == "failed" for r in _records),
            "skipped": sum(r["outcome"] == "skipped" for r in _records),
        },
        "tests": _records,
    }
    (RESULTS_DIR / "results.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
