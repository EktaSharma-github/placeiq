"""Views and the five analytical queries return correct answers."""

import sys
from decimal import Decimal
from pathlib import Path

from conftest import scalar

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))
from main import load_queries  # noqa: E402  (parses ../05_queries.sql)

QUERIES = {q["id"]: q["sql"] for q in load_queries()}


def run(db, n):
    return db.execute(QUERIES[n]).fetchall()


def test_all_five_queries_parsed():
    """TC-QRY-01 | Queries | All five queries are present in 05_queries.sql and parse"""
    assert sorted(QUERIES) == [1, 2, 3, 4, 5]


def test_placement_status_matches_offers(db):
    """TC-QRY-02 | BR-14 | v_placement_status says PLACED exactly when the student has an accepted offer in that cycle"""
    mismatches = scalar(db, """
        SELECT count(*) FROM v_placement_status v
        WHERE (v.placement_status = 'PLACED') <> EXISTS (
              SELECT 1 FROM offer o JOIN job_role j ON j.job_id = o.job_id
              WHERE o.student_id = v.student_id AND j.cycle_id = v.cycle_id AND o.status = 'ACCEPTED')""")
    assert mismatches == 0


def test_job_details_one_pay_per_job(db):
    """TC-QRY-03 | Views | v_job_details has one row per job with exactly one of CTC / stipend"""
    rows = db.execute("SELECT job_id, ctc_lpa, stipend_monthly FROM v_job_details").fetchall()
    assert len(rows) == scalar(db, "SELECT count(*) FROM job_role")
    assert all((r["ctc_lpa"] is None) != (r["stipend_monthly"] is None) for r in rows)


def test_q1_selectivity(db):
    """TC-QRY-04 | Q1 | Every company returned has >= 20 applicants and an offer rate below the campus average"""
    rows = run(db, 1)
    avg = scalar(db, """SELECT count(o.offer_id)::numeric / count(*) FROM application a
                        JOIN job_role j ON j.job_id = a.job_id
                        LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
                        WHERE j.cycle_id = 2 AND EXISTS (SELECT 1 FROM offer x WHERE x.job_id = a.job_id)""")
    assert len(rows) == 5
    for r in rows:
        assert r["applicants"] >= 20
        assert Decimal(r["offers"]) / r["applicants"] < avg


def test_q2_talent_match(db):
    """TC-QRY-05 | Q2 | The talent match for job 25 returns the 8 expected students, led by DBA12-039"""
    rows = run(db, 2)
    assert len(rows) == 8
    assert rows[0]["roll_no"] == "DBA12-039"


def test_q2_division_equals_counting(db):
    """TC-QRY-06 | Q2 | Double NOT EXISTS gives the same answer as division-by-counting for every job
    Cross-checks the two classic SQL formulations of relational division."""
    job_ids = [r["job_id"] for r in db.execute("SELECT job_id FROM job_role ORDER BY job_id")]
    for job_id in job_ids:
        not_exists = {r["person_id"] for r in db.execute("""
            SELECT s.person_id FROM student s
            WHERE NOT EXISTS (SELECT 1 FROM job_required_skill r WHERE r.job_id = %(j)s
                  AND NOT EXISTS (SELECT 1 FROM student_skill ss WHERE ss.student_id = s.person_id
                                  AND ss.skill_id = r.skill_id AND ss.proficiency >= r.min_proficiency))
        """, {"j": job_id})}
        counting = {r["student_id"] for r in db.execute("""
            SELECT ss.student_id FROM job_required_skill r
            JOIN student_skill ss ON ss.skill_id = r.skill_id AND ss.proficiency >= r.min_proficiency
            WHERE r.job_id = %(j)s GROUP BY ss.student_id
            HAVING count(*) = (SELECT count(*) FROM job_required_skill WHERE job_id = %(j)s)
        """, {"j": job_id})}
        assert not_exists == counting, f"job {job_id}"


def test_q3_ranking(db):
    """TC-QRY-07 | Q3 | DENSE_RANK puts the program's highest CTC at rank 1 and above_avg_by equals CTC minus the program average"""
    rows = run(db, 3)
    assert rows
    for r in rows:
        assert r["rank_in_program"] <= 3
        assert abs(r["above_avg_by"] - (r["ctc_lpa"] - r["program_avg_ctc"])) <= Decimal("0.01")
    for program in {r["program_code"] for r in rows}:
        top = max(r["ctc_lpa"] for r in rows if r["program_code"] == program)
        assert all(r["rank_in_program"] == 1 for r in rows if r["program_code"] == program and r["ctc_lpa"] == top)


def test_q4_running_total(db):
    """TC-QRY-08 | Q4 | The running total never decreases and ends at the program's number of final placements"""
    rows = run(db, 4)
    by_program = {}
    for r in rows:
        by_program.setdefault(r["program_code"], []).append(r)
    for program, series in by_program.items():
        totals = [r["placed_cumulative"] for r in series]
        assert totals == sorted(totals)
        placed = scalar(db, """SELECT count(*) FROM offer o JOIN job_role j ON j.job_id = o.job_id
                               JOIN student s ON s.person_id = o.student_id JOIN program p ON p.program_id = s.program_id
                               WHERE j.cycle_id = 2 AND o.status = 'ACCEPTED' AND p.program_code = %s""", (program,))
        assert totals[-1] == placed


def test_q5_hidden_gems(db):
    """TC-QRY-09 | Q5 | Every 'hidden gem' is unplaced, out-scored the selected students' average CGPA, and failed or missed a round"""
    rows = run(db, 5)
    assert len(rows) == 3
    for r in rows:
        assert r["cgpa"] > r["selected_avg_cgpa"]
        assert "NOT_CLEARED" in r["eliminated_in"] or "ABSENT" in r["eliminated_in"]
        status = scalar(db, "SELECT placement_status FROM v_placement_status WHERE roll_no = %s AND cycle_id = 2", (r["roll_no"],))
        assert status in ("UNPLACED", "IN_PROCESS")
