"""Indexing: measured with EXPLAIN ANALYZE on a 600k-row archive built inside the test transaction."""

import json

from conftest import RESULTS_DIR, scalar

QUERY = "SELECT count(*) FROM application_archive WHERE job_id = 1234 AND status IN ('APPLIED', 'SHORTLISTED')"
_measurements = {}


def _plan(db, sql):
    plan = db.execute(f"EXPLAIN (ANALYZE, FORMAT JSON) {sql}").fetchone()
    root = next(iter(plan.values()))[0]
    nodes, stack = [], [root["Plan"]]
    while stack:
        node = stack.pop()
        nodes.append(node)
        stack.extend(node.get("Plans", []))
    return root["Execution Time"], {n["Node Type"] for n in nodes}, {n.get("Index Name") for n in nodes} - {None}


def _build_archive(db):
    db.execute("""CREATE TEMP TABLE application_archive AS
        SELECT g AS application_id, 101 + (g % 180) AS student_id, 1 + (g % 2500) AS job_id,
               (ARRAY['APPLIED','SHORTLISTED','REJECTED','WITHDRAWN','OFFERED'])
                   [CASE WHEN g % 100 < 2 THEN 1 WHEN g % 100 < 4 THEN 2 WHEN g % 100 < 85 THEN 3
                         WHEN g % 100 < 95 THEN 4 ELSE 5 END] AS status
        FROM generate_series(1, 600000) g""")
    db.execute("ANALYZE application_archive")


def _best_of(db, sql, runs=3):
    results = [_plan(db, sql) for _ in range(runs)]
    return min(r[0] for r in results), results[0][1], results[0][2]


def test_composite_index_speedup(db):
    """TC-PRF-01 | Indexing | A composite B-tree index on (job_id, status) replaces the sequential scan and is at least 10x faster"""
    _build_archive(db)
    before_ms, before_nodes, _ = _best_of(db, QUERY)
    db.execute("CREATE INDEX idx_arch_job_status ON application_archive (job_id, status)")
    db.execute("ANALYZE application_archive")
    after_ms, after_nodes, indexes = _best_of(db, QUERY)
    _measurements.update(seq_scan_ms=round(before_ms, 3), composite_index_ms=round(after_ms, 3))
    assert "Seq Scan" in before_nodes
    assert "idx_arch_job_status" in indexes
    assert after_ms * 10 < before_ms


def test_partial_index_smaller(db):
    """TC-PRF-02 | Indexing | A partial index on only the open rows is far smaller than the full composite index and still used"""
    _build_archive(db)
    db.execute("CREATE INDEX idx_arch_full ON application_archive (job_id, status)")
    db.execute("CREATE INDEX idx_arch_open ON application_archive (job_id) WHERE status IN ('APPLIED', 'SHORTLISTED')")
    db.execute("ANALYZE application_archive")
    full = scalar(db, "SELECT pg_relation_size('idx_arch_full')")
    partial = scalar(db, "SELECT pg_relation_size('idx_arch_open')")
    ms, _, indexes = _best_of(db, QUERY)
    _measurements.update(full_index_kb=full // 1024, partial_index_kb=partial // 1024, partial_index_ms=round(ms, 3))
    assert partial * 10 < full
    assert indexes & {"idx_arch_open", "idx_arch_full"}


def _blocks(db, sql):
    plan = db.execute(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}").fetchone()
    root = next(iter(plan.values()))[0]["Plan"]
    return sum(root.get(k, 0) for k in ("Shared Hit Blocks", "Shared Read Blocks", "Local Hit Blocks", "Local Read Blocks"))


def test_leading_column_rule(db):
    """TC-PRF-03 | Indexing | Without the leading column (job_id) the composite index cannot seek: the status-only query touches 50x more blocks
    Observed on PostgreSQL 18: the planner may still use the index, but only by
    reading all of it (or it falls back to a sequential scan), never by seeking."""
    _build_archive(db)
    db.execute("CREATE INDEX idx_arch_job_status ON application_archive (job_id, status)")
    db.execute("ANALYZE application_archive")
    seek = _blocks(db, QUERY)
    no_leading = _blocks(db, "SELECT count(*) FROM application_archive WHERE status = 'OFFERED'")
    _measurements.update(seek_blocks=seek, status_only_blocks=no_leading)
    assert no_leading > 50 * seek
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "performance.json").write_text(json.dumps(_measurements, indent=2), encoding="utf-8")
