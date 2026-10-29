"""
PlaceIQ web app: a REST API over the PlaceIQ PostgreSQL database, plus the
single-page UI in ./static.

Run (from this folder):
    .venv\\Scripts\\python main.py           ->  http://127.0.0.1:8000
    Interactive API docs (Swagger):           http://127.0.0.1:8000/docs

Connection settings come from the standard libpq environment variables
(PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD); defaults suit a local
PostgreSQL install with the 'placeiq' database built by run_all.ps1.

Design notes
  * Every query that includes user input uses bound parameters (%s), so input
    is never parsed as SQL. The ONLY exception is the deliberately vulnerable
    branch of /api/security/search, which exists to demonstrate SQL injection
    and is sandboxed (read-only transaction, least-privilege role, timeout).
  * Business rules live in the database (constraints + triggers), not here.
    The API simply forwards PostgreSQL's error message, SQLSTATE and the
    trigger function that raised it, so the UI can show *why* the database
    refused an action.
"""

import os
import re
import subprocess
import time
from pathlib import Path
from typing import Literal, Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
STATIC_DIR = APP_DIR / "static"

DB_SETTINGS = {
    "host": os.getenv("PGHOST", "localhost"),
    "port": int(os.getenv("PGPORT", "5432")),
    "dbname": os.getenv("PGDATABASE", "placeiq"),
    "user": os.getenv("PGUSER", "postgres"),
    "password": os.getenv("PGPASSWORD", "postgres"),
}
PSQL_PATH = os.getenv("PLACEIQ_PSQL", r"C:\Program Files\PostgreSQL\18\bin\psql.exe")

app = FastAPI(
    title="PlaceIQ API",
    description="REST API for the PlaceIQ campus placement database (FDS course project).",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def connect() -> psycopg.Connection:
    """A new connection with dict rows and the placeiq schema on the path.
    Used as a context manager: commits on success, rolls back on error."""
    return psycopg.connect(
        **DB_SETTINGS,
        row_factory=dict_row,
        options="-c search_path=placeiq,public",
    )


def fetch_all(sql: str, params=None) -> list[dict]:
    with connect() as conn:
        return conn.execute(sql, params).fetchall()


def fetch_one(sql: str, params=None) -> Optional[dict]:
    with connect() as conn:
        return conn.execute(sql, params).fetchone()


_PLPGSQL_FN = re.compile(r"PL/pgSQL function (\w+)")


@app.exception_handler(psycopg.OperationalError)
async def db_unavailable(_: Request, exc: psycopg.OperationalError):
    return JSONResponse(
        status_code=503,
        content={"error": "Cannot reach the PlaceIQ database. Is PostgreSQL running and "
                          "has run_all.ps1 been executed?", "detail": str(exc).strip()},
    )


@app.exception_handler(psycopg.Error)
async def db_error(_: Request, exc: psycopg.Error):
    """Turn a PostgreSQL error into JSON the UI can explain."""
    diag = exc.diag
    raised_by = _PLPGSQL_FN.search(diag.context or "")
    integrity = (exc.sqlstate or "").startswith("23")
    return JSONResponse(
        status_code=409 if integrity else 400,
        content={
            "error": diag.message_primary or str(exc).strip(),
            "detail": diag.message_detail,
            "sqlstate": exc.sqlstate,
            "constraint": diag.constraint_name,
            "raised_by": raised_by.group(1) if raised_by else None,
        },
    )


# ---------------------------------------------------------------------------
# Health and dashboard
# ---------------------------------------------------------------------------

@app.get("/api/health", tags=["meta"])
def health():
    row = fetch_one("SELECT current_database() AS database, "
                    "split_part(version(), ' ', 2) AS postgres_version, now() AS server_time")
    return {"status": "ok", **row}


@app.get("/api/cycles", tags=["dashboard"])
def cycles():
    return fetch_all("SELECT cycle_id, cycle_name, cycle_type, start_date, end_date "
                     "FROM placement_cycle ORDER BY cycle_id")


@app.get("/api/summary", tags=["dashboard"])
def summary(cycle_id: int = 2):
    """KPIs, program-wise status breakdown and sector split for one cycle."""
    with connect() as conn:
        totals = conn.execute("""
            SELECT (SELECT count(*) FROM student)     AS students,
                   (SELECT count(*) FROM company)     AS companies,
                   (SELECT count(*) FROM job_role)    AS jobs,
                   (SELECT count(*) FROM application) AS applications,
                   (SELECT count(*) FROM offer)       AS offers
        """).fetchone()

        cycle = conn.execute("""
            SELECT pc.cycle_id, pc.cycle_name, pc.cycle_type,
                   count(ps.student_id) FILTER (WHERE ps.placement_status <> 'OPTED_OUT') AS participants,
                   count(*) FILTER (WHERE ps.placement_status = 'PLACED')                 AS placed,
                   count(*) FILTER (WHERE ps.placement_status = 'OFFER_PENDING')          AS offer_pending,
                   count(*) FILTER (WHERE ps.placement_status = 'IN_PROCESS')             AS in_process,
                   round(avg(ps.ctc_lpa), 2)                                              AS avg_ctc,
                   max(ps.ctc_lpa)                                                        AS max_ctc,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.ctc_lpa)                AS median_ctc,
                   round(avg(ps.stipend_monthly))                                         AS avg_stipend,
                   max(ps.stipend_monthly)                                                AS max_stipend
            FROM placement_cycle pc
            LEFT JOIN v_placement_status ps ON ps.cycle_id = pc.cycle_id
            WHERE pc.cycle_id = %s
            GROUP BY pc.cycle_id
        """, (cycle_id,)).fetchone()
        if cycle is None:
            raise HTTPException(404, f"No placement cycle {cycle_id}")

        offers = conn.execute("""
            SELECT o.status, count(*) AS n
            FROM offer o JOIN job_role j ON j.job_id = o.job_id
            WHERE j.cycle_id = %s
            GROUP BY o.status
        """, (cycle_id,)).fetchall()

        programs = conn.execute("""
            SELECT program_code, placement_status, count(*) AS n
            FROM v_placement_status
            WHERE cycle_id = %s
            GROUP BY program_code, placement_status
            ORDER BY program_code
        """, (cycle_id,)).fetchall()

        sectors = conn.execute("""
            SELECT d.sector,
                   count(*)                                     AS offers,
                   count(*) FILTER (WHERE o.status = 'ACCEPTED') AS accepted,
                   round(avg(d.ctc_lpa), 2)                     AS avg_ctc,
                   round(avg(d.stipend_monthly))                AS avg_stipend
            FROM offer o JOIN v_job_details d ON d.job_id = o.job_id
            WHERE d.cycle_id = %s
            GROUP BY d.sector
            ORDER BY offers DESC, d.sector
        """, (cycle_id,)).fetchall()

    return {"totals": totals, "cycle": cycle, "offers": offers,
            "programs": programs, "sectors": sectors}


@app.get("/api/velocity", tags=["dashboard"])
def velocity(cycle_id: int = 2):
    """Cumulative % of each batch placed per day (the Query 4 pattern)."""
    return fetch_all("""
        WITH accepted AS (
            SELECT s.program_id, (o.responded_at AT TIME ZONE 'Asia/Kolkata')::date AS day
            FROM offer o
            JOIN job_role j ON j.job_id = o.job_id
            JOIN student s  ON s.person_id = o.student_id
            WHERE j.cycle_id = %(c)s AND o.status = 'ACCEPTED'
        ),
        calendar AS (
            SELECT generate_series(min(day) - 1, max(day), INTERVAL '1 day')::date AS day
            FROM accepted
        ),
        batch AS (
            SELECT pr.program_id, pr.program_code,
                   count(*) FILTER (WHERE NOT s.opted_out) AS batch_size
            FROM program pr JOIN student s ON s.program_id = pr.program_id
            WHERE EXISTS (SELECT 1 FROM eligibility e JOIN job_role j ON j.job_id = e.job_id
                          WHERE j.cycle_id = %(c)s AND e.program_id = pr.program_id)
            GROUP BY pr.program_id, pr.program_code
        ),
        daily AS (
            SELECT program_id, day, count(*) AS n FROM accepted GROUP BY program_id, day
        )
        SELECT c.day, b.program_code,
               COALESCE(d.n, 0) AS placed_today,
               SUM(COALESCE(d.n, 0)) OVER w AS placed_cumulative,
               round(100.0 * SUM(COALESCE(d.n, 0)) OVER w / b.batch_size, 1) AS pct_placed
        FROM calendar c
        CROSS JOIN batch b
        LEFT JOIN daily d ON d.program_id = b.program_id AND d.day = c.day
        WINDOW w AS (PARTITION BY b.program_id ORDER BY c.day)
        ORDER BY b.program_code, c.day
    """, {"c": cycle_id})


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------

@app.get("/api/programs", tags=["students"])
def programs():
    return fetch_all("SELECT program_id, program_code, program_name FROM program ORDER BY program_id")


@app.get("/api/students", tags=["students"])
def list_students(
    cycle_id: int = 2,
    q: str = "",
    program: str = "",
    status: str = "",
):
    """Students with their DERIVED placement status for a cycle (v_placement_status)."""
    return fetch_all("""
        SELECT roll_no, student_name, program_code, cgpa, placement_status,
               placed_with, placed_role, ctc_lpa, stipend_monthly, applications, offers_received
        FROM v_placement_status
        WHERE cycle_id = %(cycle)s
          AND (%(q)s = '' OR roll_no ILIKE %(pattern)s OR student_name ILIKE %(pattern)s)
          AND (%(program)s = '' OR program_code = %(program)s)
          AND (%(status)s = '' OR placement_status = %(status)s)
        ORDER BY roll_no
    """, {"cycle": cycle_id, "q": q.strip(), "pattern": f"%{q.strip()}%",
          "program": program, "status": status})


@app.get("/api/students/{roll_no}", tags=["students"])
def student_profile(roll_no: str):
    with connect() as conn:
        student = conn.execute("""
            SELECT s.person_id, s.roll_no, p.first_name, p.last_name, p.email, p.phone,
                   pr.program_code, pr.program_name, s.batch_year, s.cgpa,
                   s.active_backlogs, s.opted_out, cm.cc_role
            FROM student s
            JOIN person p   ON p.person_id = s.person_id
            JOIN program pr ON pr.program_id = s.program_id
            LEFT JOIN committee_member cm ON cm.person_id = s.person_id
            WHERE s.roll_no = %s
        """, (roll_no,)).fetchone()
        if student is None:
            raise HTTPException(404, f"No student with roll number {roll_no}")
        sid = student["person_id"]

        statuses = conn.execute("""
            SELECT cycle_id, cycle_name, placement_status, placed_with, placed_role,
                   ctc_lpa, stipend_monthly
            FROM v_placement_status WHERE student_id = %s ORDER BY cycle_id
        """, (sid,)).fetchall()

        skills = conn.execute("""
            SELECT k.skill_name, ss.proficiency
            FROM student_skill ss JOIN skill k ON k.skill_id = ss.skill_id
            WHERE ss.student_id = %s
            ORDER BY ss.proficiency DESC, k.skill_name
        """, (sid,)).fetchall()

        applications = conn.execute("""
            SELECT a.application_id, a.job_id, d.company_name, d.title, d.cycle_id, d.cycle_name,
                   d.role_type, d.ctc_lpa, d.stipend_monthly, a.status, a.applied_at,
                   a.status_updated_at, o.offer_id, o.status AS offer_status,
                   o.offered_at, o.response_deadline
            FROM application a
            JOIN v_job_details d ON d.job_id = a.job_id
            LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
            WHERE a.student_id = %s
            ORDER BY d.cycle_id DESC, a.job_id
        """, (sid,)).fetchall()

        interviews = conn.execute("""
            SELECT i.job_id, d.company_name, i.round_no, r.round_type, i.slot_start, i.slot_end,
                   i.venue, i.result, i.score
            FROM interview i
            JOIN interview_round r ON r.job_id = i.job_id AND r.round_no = i.round_no
            JOIN v_job_details d   ON d.job_id = i.job_id
            WHERE i.student_id = %s
            ORDER BY i.slot_start DESC, i.round_no DESC
        """, (sid,)).fetchall()

        # Every job not yet applied to, open or closed. The UI lets the user
        # try any of them so the eligibility trigger can be seen rejecting.
        jobs = conn.execute("""
            SELECT d.job_id, d.company_name, d.title, d.cycle_name, d.application_deadline,
                   d.application_deadline > now() AS is_open
            FROM v_job_details d
            WHERE NOT EXISTS (SELECT 1 FROM application a
                              WHERE a.student_id = %s AND a.job_id = d.job_id)
            ORDER BY (d.application_deadline > now()) DESC, d.cycle_id DESC, d.job_id
        """, (sid,)).fetchall()

        log = conn.execute("""
            SELECT action, job_id, details, logged_at
            FROM placement_log WHERE student_id = %s
            ORDER BY logged_at DESC, log_id DESC LIMIT 20
        """, (sid,)).fetchall()

    return {"student": student, "statuses": statuses, "skills": skills,
            "applications": applications, "interviews": interviews,
            "available_jobs": jobs, "log": log}


# ---------------------------------------------------------------------------
# Actions: these go through the database's triggers and procedures
# ---------------------------------------------------------------------------

class ApplyRequest(BaseModel):
    roll_no: str = Field(..., examples=["DBA12-039"])
    job_id: int = Field(..., examples=[25])


class OfferRequest(BaseModel):
    roll_no: str = Field(..., examples=["PGP62-084"])
    job_id: int = Field(..., examples=[21])
    response_days: int = Field(7, ge=1, le=60)


@app.post("/api/applications", tags=["actions"], status_code=201)
def apply_for_job(req: ApplyRequest):
    """Calls fn_apply_for_job(); trigger T1 enforces eligibility."""
    row = fetch_one("SELECT fn_apply_for_job(%s, %s) AS application_id", (req.roll_no, req.job_id))
    return {"application_id": row["application_id"],
            "message": f"{req.roll_no} applied to job {req.job_id}"}


@app.post("/api/offers", tags=["actions"], status_code=201)
def make_offer(req: OfferRequest):
    """Recruiter action. Trigger T2 requires a live application."""
    row = fetch_one("""
        INSERT INTO offer (student_id, job_id, response_deadline)
        SELECT person_id, %s, now() + make_interval(days => %s)
        FROM student WHERE roll_no = %s
        RETURNING offer_id
    """, (req.job_id, req.response_days, req.roll_no))
    if row is None:
        raise HTTPException(404, f"No student with roll number {req.roll_no}")
    return {"offer_id": row["offer_id"],
            "message": f"Offer {row['offer_id']} made to {req.roll_no} for job {req.job_id}"}


@app.post("/api/offers/{offer_id}/accept", tags=["actions"])
def accept_offer(offer_id: int):
    """CALL sp_accept_offer(); trigger T3 applies the one-offer policy in the
    same transaction. Returns the cascade the trigger wrote to the audit log."""
    with connect() as conn:
        notices: list[str] = []
        conn.add_notice_handler(lambda d: notices.append(d.message_primary))
        conn.execute("CALL sp_accept_offer(%s)", (offer_id,))
        cascade = conn.execute("""
            SELECT l.action, l.job_id, d.company_name, l.details
            FROM placement_log l LEFT JOIN v_job_details d ON d.job_id = l.job_id
            WHERE l.logged_at = now()
              AND l.student_id = (SELECT student_id FROM offer WHERE offer_id = %s)
            ORDER BY l.log_id
        """, (offer_id,)).fetchall()
    return {"message": notices[-1] if notices else f"Offer {offer_id} accepted",
            "cascade": cascade}


@app.post("/api/offers/{offer_id}/decline", tags=["actions"])
def decline_offer(offer_id: int):
    row = fetch_one("""
        UPDATE offer SET status = 'DECLINED', responded_at = now()
        WHERE offer_id = %s AND status = 'PENDING'
        RETURNING offer_id
    """, (offer_id,))
    if row is None:
        raise HTTPException(409, f"Offer {offer_id} is not pending")
    return {"message": f"Offer {offer_id} declined"}


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

@app.get("/api/jobs", tags=["jobs"])
def list_jobs(cycle_id: Optional[int] = None):
    return fetch_all("""
        SELECT d.job_id, d.company_name, d.sector, d.cycle_id, d.cycle_name, d.title,
               d.role_type, d.location, d.openings, d.application_deadline,
               d.ctc_lpa, d.stipend_monthly, d.application_deadline > now() AS is_open,
               (SELECT count(*) FROM application a WHERE a.job_id = d.job_id) AS applicants,
               (SELECT count(*) FROM offer o WHERE o.job_id = d.job_id)       AS offers,
               (SELECT count(*) FROM offer o WHERE o.job_id = d.job_id
                                               AND o.status = 'ACCEPTED')    AS accepted
        FROM v_job_details d
        WHERE %(cycle)s::int IS NULL OR d.cycle_id = %(cycle)s
        ORDER BY d.cycle_id DESC, d.job_id
    """, {"cycle": cycle_id})


@app.get("/api/jobs/{job_id}", tags=["jobs"])
def job_detail(job_id: int):
    with connect() as conn:
        job = conn.execute("""
            SELECT d.*, d.application_deadline > now() AS is_open,
                   concat_ws(' ', p.first_name, p.last_name) AS posted_by_name, r.designation
            FROM v_job_details d
            JOIN job_role jr ON jr.job_id = d.job_id
            LEFT JOIN recruiter r ON r.person_id = jr.posted_by
            LEFT JOIN person p    ON p.person_id = jr.posted_by
            WHERE d.job_id = %s
        """, (job_id,)).fetchone()
        if job is None:
            raise HTTPException(404, f"No job {job_id}")

        eligibility = conn.execute("""
            SELECT pr.program_code, e.min_cgpa, e.max_backlogs
            FROM eligibility e JOIN program pr ON pr.program_id = e.program_id
            WHERE e.job_id = %s ORDER BY pr.program_id
        """, (job_id,)).fetchall()

        skills = conn.execute("""
            SELECT k.skill_name, r.min_proficiency
            FROM job_required_skill r JOIN skill k ON k.skill_id = r.skill_id
            WHERE r.job_id = %s ORDER BY r.min_proficiency DESC, k.skill_name
        """, (job_id,)).fetchall()

        rounds = conn.execute("""
            SELECT r.round_no, r.round_type, r.is_elimination,
                   count(i.student_id)                            AS candidates,
                   count(*) FILTER (WHERE i.result = 'CLEARED')   AS cleared,
                   count(*) FILTER (WHERE i.result = 'SCHEDULED') AS scheduled
            FROM interview_round r
            LEFT JOIN interview i ON i.job_id = r.job_id AND i.round_no = r.round_no
            WHERE r.job_id = %s
            GROUP BY r.round_no, r.round_type, r.is_elimination
            ORDER BY r.round_no
        """, (job_id,)).fetchall()

        funnel = conn.execute("""
            SELECT (SELECT count(*) FROM application WHERE job_id = %(j)s)                  AS applied,
                   (SELECT count(DISTINCT student_id) FROM interview WHERE job_id = %(j)s)  AS interviewed,
                   (SELECT count(*) FROM offer WHERE job_id = %(j)s)                        AS offered,
                   (SELECT count(*) FROM offer WHERE job_id = %(j)s AND status = 'ACCEPTED') AS accepted
        """, {"j": job_id}).fetchone()

        applicants = conn.execute("""
            SELECT s.roll_no, concat_ws(' ', p.first_name, p.last_name) AS student_name,
                   pr.program_code, s.cgpa, a.status, a.applied_at,
                   o.offer_id, o.status AS offer_status,
                   (SELECT round(avg(i.score), 1) FROM interview i
                    WHERE i.student_id = a.student_id AND i.job_id = a.job_id) AS avg_score
            FROM application a
            JOIN student s  ON s.person_id = a.student_id
            JOIN person p   ON p.person_id = s.person_id
            JOIN program pr ON pr.program_id = s.program_id
            LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
            WHERE a.job_id = %s
            ORDER BY (a.status = 'OFFERED') DESC, (a.status = 'SHORTLISTED') DESC,
                     avg_score DESC NULLS LAST, s.cgpa DESC
        """, (job_id,)).fetchall()

        # Query 2 (relational division), parameterised by job.
        talent = conn.execute("""
            SELECT s.roll_no, concat_ws(' ', p.first_name, p.last_name) AS student_name,
                   pr.program_code, s.cgpa,
                   EXISTS (SELECT 1 FROM application a
                           WHERE a.student_id = s.person_id AND a.job_id = %(j)s) AS applied
            FROM eligibility e
            JOIN student s  ON s.program_id = e.program_id
            JOIN person p   ON p.person_id = s.person_id
            JOIN program pr ON pr.program_id = s.program_id
            WHERE e.job_id = %(j)s
              AND s.cgpa >= e.min_cgpa
              AND s.active_backlogs <= e.max_backlogs
              AND NOT s.opted_out
              AND NOT EXISTS (
                    SELECT 1 FROM job_required_skill r
                    WHERE r.job_id = %(j)s
                      AND NOT EXISTS (SELECT 1 FROM student_skill ss
                                      WHERE ss.student_id = s.person_id
                                        AND ss.skill_id = r.skill_id
                                        AND ss.proficiency >= r.min_proficiency))
              AND NOT EXISTS (
                    SELECT 1 FROM offer o
                    JOIN job_role j  ON j.job_id = o.job_id
                    JOIN job_role jt ON jt.job_id = %(j)s
                    WHERE o.student_id = s.person_id AND o.status = 'ACCEPTED'
                      AND j.cycle_id = jt.cycle_id)
            ORDER BY s.cgpa DESC
        """, {"j": job_id}).fetchall()

    return {"job": job, "eligibility": eligibility, "skills": skills, "rounds": rounds,
            "funnel": funnel, "applicants": applicants, "talent_match": talent}


# ---------------------------------------------------------------------------
# SQL analytics: the five queries, read straight from ../05_queries.sql
# ---------------------------------------------------------------------------

_QUERY_HEADER = re.compile(r"^-- Q(\d)\.\s+(.*)$")
_SECTIONS = {"BUSINESS QUESTION": "question", "FDS CONCEPTS": "concepts",
             "RELATIONAL ALGEBRA": "algebra", "Q&A NOTE": "note"}
_KEEP_UPPER = {"CTC", "CGPA", "SQL"}


def _sentence_case(title: str) -> str:
    words = title.split()
    out = [w if w.strip("?:,()") in _KEEP_UPPER else w.lower() for w in words]
    return out[0][:1].upper() + out[0][1:] + " " + " ".join(out[1:]) if out else title


def load_queries() -> list[dict]:
    """Parse 05_queries.sql so the UI always shows exactly the SQL in the repo."""
    lines = (PROJECT_DIR / "05_queries.sql").read_text(encoding="utf-8").splitlines()
    queries, i = [], 0
    while i < len(lines):
        match = _QUERY_HEADER.match(lines[i])
        i += 1
        if not match:
            continue
        meta = {key: [] for key in _SECTIONS.values()}
        current = None
        while i < len(lines) and lines[i].startswith("--"):
            text = lines[i][2:].strip()
            i += 1
            if not text or set(text) == {"="}:
                continue
            heading = next((k for k in _SECTIONS if text.startswith(k)), None)
            if heading:
                current = _SECTIONS[heading]
            elif current:
                meta[current].append(text)
        sql = []
        while i < len(lines):
            line = lines[i]
            i += 1
            if not sql and not line.strip():
                continue
            sql.append(line)
            if line.split("--", 1)[0].rstrip().endswith(";"):
                break
        queries.append({
            "id": int(match.group(1)),
            "title": _sentence_case(match.group(2).strip()),
            "question": " ".join(meta["question"]),
            "concepts": " ".join(meta["concepts"]),
            "algebra": "\n".join(meta["algebra"]),
            "note": " ".join(meta["note"]),
            "sql": "\n".join(sql).rstrip().rstrip(";"),
        })
    return queries


@app.get("/api/queries", tags=["analytics"])
def list_queries():
    return load_queries()


@app.post("/api/queries/{query_id}/run", tags=["analytics"])
def run_query(query_id: int):
    query = next((q for q in load_queries() if q["id"] == query_id), None)
    if query is None:
        raise HTTPException(404, f"No query Q{query_id}")
    with connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        started = time.perf_counter()
        cur = conn.execute(query["sql"])
        rows = cur.fetchall()
        elapsed_ms = (time.perf_counter() - started) * 1000
        columns = [c.name for c in cur.description]
        conn.rollback()
    return {"columns": columns, "rows": [[r[c] for c in columns] for r in rows],
            "row_count": len(rows), "elapsed_ms": round(elapsed_ms, 2)}


# ---------------------------------------------------------------------------
# SQL-injection lab
# ---------------------------------------------------------------------------

_SEARCH_BASE = ("SELECT s.roll_no, concat_ws(' ', p.first_name, p.last_name) AS student_name, "
                "p.email FROM student s JOIN person p ON p.person_id = s.person_id "
                "WHERE p.last_name = ")


@app.get("/api/security/search", tags=["security lab"])
def injection_demo(name: str, mode: Literal["unsafe", "safe"]):
    """Look a student up by last name, the WRONG way or the RIGHT way.

    unsafe: the input is pasted into the SQL text (vulnerable ON PURPOSE).
    safe:   the input is sent separately as a bound parameter ($1).

    Both run sandboxed: a READ ONLY transaction, as the least-privilege role
    placeiq_readonly (SELECT on student and person only), with a 2 s timeout,
    and everything is rolled back.
    """
    with connect() as conn:
        conn.execute("SET TRANSACTION READ ONLY")
        conn.execute("SET LOCAL ROLE placeiq_readonly")
        conn.execute("SET LOCAL statement_timeout = '2s'")
        if mode == "unsafe":
            sent = _SEARCH_BASE + "'" + name + "'"        # DELIBERATELY VULNERABLE
            cur = conn.execute(sent)
            params = None
        else:
            cur = conn.execute(_SEARCH_BASE + "%s", (name,))
            sent, params = _SEARCH_BASE + "$1", [name]
        rows = cur.fetchall()
        conn.rollback()
    return {"mode": mode, "sql_sent": sent, "parameters": params,
            "row_count": len(rows), "rows": rows}


# ---------------------------------------------------------------------------
# Audit log and admin
# ---------------------------------------------------------------------------

@app.get("/api/log", tags=["audit"])
def audit_log(limit: int = Query(100, ge=1, le=1000)):
    return fetch_all("""
        SELECT l.log_id, l.action, l.details, l.logged_at, s.roll_no,
               d.job_id, d.company_name, d.title
        FROM placement_log l
        LEFT JOIN student s       ON s.person_id = l.student_id
        LEFT JOIN v_job_details d ON d.job_id = l.job_id
        ORDER BY l.logged_at DESC, l.log_id DESC
        LIMIT %s
    """, (limit,))


@app.post("/api/admin/reset", tags=["admin"])
def reset_database():
    """Rebuild schema, logic and seeded data (same as run_all.ps1)."""
    if not Path(PSQL_PATH).exists():
        raise HTTPException(500, f"psql not found at {PSQL_PATH}; set PLACEIQ_PSQL")
    env = {**os.environ, "PGPASSWORD": DB_SETTINGS["password"]}
    started = time.perf_counter()
    for script in ("02_ddl.sql", "03_logic.sql", "04_data.sql", "07_analytics.sql"):
        result = subprocess.run(
            [PSQL_PATH, "-h", DB_SETTINGS["host"], "-p", str(DB_SETTINGS["port"]),
             "-U", DB_SETTINGS["user"], "-d", DB_SETTINGS["dbname"],
             "-q", "-v", "ON_ERROR_STOP=1", "-f", str(PROJECT_DIR / script)],
            env=env, capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            raise HTTPException(500, f"{script} failed: {result.stderr.strip()[-800:]}")
    return {"message": "Demo data restored",
            "elapsed_s": round(time.perf_counter() - started, 1)}


# ---------------------------------------------------------------------------
# Static UI
# ---------------------------------------------------------------------------

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn

    # 127.0.0.1 only: this is a local teaching app with a deliberately
    # vulnerable endpoint; never expose it on a network interface.
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
