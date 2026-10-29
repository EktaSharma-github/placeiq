"""
Exports every figure the deck and documents quote into deliverables/src/data.json,
so no number in them is typed by hand.

    app\\.venv\\Scripts\\python deliverables\\src\\export_data.py
(run after tests, so tests/results/*.json exist, and after analytics/placeiq_kmeans.ipynb,
so the segment tables and analytics/results.json are filled)
"""

import datetime as dt
import decimal
import json
import re
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "app"))
from main import load_queries  # noqa: E402


def load_analytics_queries():
    """Labelled queries (A1..A5, S1, S2) from 07_analytics.sql; same parser as the notebook."""
    pattern = re.compile(r"^-- ([AS]\d)\. ([^\n]*)\n.*?^-- =+\n\n(.*?;)\s*$", re.M | re.S)
    return {m[1]: m[3] for m in pattern.finditer((ROOT / "07_analytics.sql").read_text(encoding="utf-8"))}


def default(o):
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (dt.date, dt.datetime)):
        return o.isoformat()
    raise TypeError(type(o))


def main():
    conn = psycopg.connect(host="localhost", dbname="placeiq", user="postgres", password="postgres",
                           row_factory=dict_row, options="-c search_path=placeiq,public")
    q = lambda sql, p=None: conn.execute(sql, p).fetchall()
    one = lambda sql, p=None: conn.execute(sql, p).fetchone()

    data = {}
    data["counts"] = {t: one(f"SELECT count(*) AS n FROM {t}")["n"] for t in (
        "program", "placement_cycle", "company", "person", "student", "recruiter", "alumnus", "committee_member",
        "job_role", "internship_role", "fulltime_role", "eligibility", "skill", "student_skill", "job_required_skill",
        "application", "interview_round", "interview", "offer", "placement_log", "sponsor", "sponsorship")}
    # The catalog describes the designed (EER-mapped) schema; the two Phase 4
    # analytics tables are counted separately so the schema slides stay right.
    analytics_tables = ("segment", "student_segment")
    data["catalog"] = {
        "tables": one("""SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='placeiq'
                         AND table_type='BASE TABLE' AND table_name <> ALL(%s)""", (list(analytics_tables),))["n"],
        "analytics_tables": len(analytics_tables),
        "constraints": {r["contype"]: r["n"] for r in q(
            """SELECT k.contype, count(*) AS n FROM pg_constraint k LEFT JOIN pg_class c ON c.oid = k.conrelid
               WHERE k.connamespace='placeiq'::regnamespace AND coalesce(c.relname, '') <> ALL(%s)
               GROUP BY k.contype""", (list(analytics_tables),))},
        "indexes": one("SELECT count(*) AS n FROM pg_indexes WHERE schemaname='placeiq' AND tablename <> ALL(%s)",
                       (list(analytics_tables),))["n"],
        "triggers": one("""SELECT count(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                           WHERE c.relnamespace='placeiq'::regnamespace AND NOT t.tgisinternal""")["n"],
    }
    data["cycles"] = q("""
        SELECT pc.cycle_id, pc.cycle_name,
               count(*) FILTER (WHERE ps.placement_status <> 'OPTED_OUT') AS participants,
               count(*) FILTER (WHERE ps.placement_status = 'PLACED') AS placed,
               count(*) FILTER (WHERE ps.placement_status = 'OFFER_PENDING') AS offer_pending,
               max(ps.ctc_lpa) AS max_ctc, round(avg(ps.ctc_lpa), 2) AS avg_ctc,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY ps.ctc_lpa) AS median_ctc,
               max(ps.stipend_monthly) AS max_stipend, round(avg(ps.stipend_monthly)) AS avg_stipend
        FROM placement_cycle pc JOIN v_placement_status ps ON ps.cycle_id = pc.cycle_id
        GROUP BY pc.cycle_id ORDER BY pc.cycle_id""")
    data["offer_status"] = q("""SELECT j.cycle_id, o.status, count(*) AS n FROM offer o JOIN job_role j USING (job_id)
                                GROUP BY 1, 2 ORDER BY 1, 2""")
    data["program_status"] = q("""SELECT program_code, placement_status, count(*) AS n FROM v_placement_status
                                  WHERE cycle_id = 2 GROUP BY 1, 2 ORDER BY 1, 2""")

    data["queries"] = []
    for query in load_queries():
        cur = conn.execute(query["sql"])
        cols = [c.name for c in cur.description]
        rows = [[r[c] for c in cols] for r in cur.fetchall()]
        data["queries"].append({**query, "columns": cols, "rows": rows})

    data["role_privileges"] = q("""SELECT table_name, privilege_type FROM information_schema.role_table_grants
                                   WHERE grantee = 'placeiq_readonly' ORDER BY table_name""")

    # Phase 4 analytics: SQL results from 07_analytics.sql, model statistics from the notebook.
    analytics = {label: conn.execute(sql).fetchall() for label, sql in load_analytics_queries().items()}
    analytics["segment_profile"] = q("SELECT * FROM v_segment_profile ORDER BY segment")
    analytics["s2_actions"] = q("""SELECT segment_name, suggested_action, count(*) AS n
                                   FROM (""" + load_analytics_queries()["S2"].rstrip("; \n") + """) s2
                                   GROUP BY 1, 2 ORDER BY 1, 3 DESC""")
    if not analytics["segment_profile"]:
        sys.exit("No segments in the database: run analytics/placeiq_kmeans.ipynb first.")
    analytics["model"] = json.loads((ROOT / "analytics" / "results.json").read_text(encoding="utf-8"))
    data["analytics"] = analytics
    conn.close()

    results = ROOT / "tests" / "results"
    data["tests"] = json.loads((results / "results.json").read_text(encoding="utf-8"))
    data["performance"] = json.loads((results / "performance.json").read_text(encoding="utf-8"))
    steps = ROOT / "deliverables" / "screenshots" / "demo_steps.json"
    data["demo_steps"] = json.loads(steps.read_text(encoding="utf-8")) if steps.exists() else []

    out = Path(__file__).resolve().parent / "data.json"
    out.write_text(json.dumps(data, indent=2, default=default), encoding="utf-8")
    print("wrote", out, f"({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
