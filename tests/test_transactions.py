"""Transactions: atomicity, isolation under concurrency, deferred consistency."""

import threading
import time

import psycopg
import pytest

from conftest import connect, scalar, student_id


def _setup_two_pending_offers():
    """Commit a second pending offer for PGP62-084 (job 21). Returns (first, second) offer ids."""
    with connect() as conn:
        sid = student_id(conn, "PGP62-084")
        first = scalar(conn, "SELECT offer_id FROM offer WHERE student_id = %s AND job_id = 19", (sid,))
        second = scalar(conn, """INSERT INTO offer (student_id, job_id, response_deadline)
                                 VALUES (%s, 21, now() + interval '7 days') RETURNING offer_id""", (sid,))
    return sid, first, second


def test_rollback_undoes_cascade(db):
    """TC-TXN-01 | Atomicity | Rolling back an acceptance undoes the entire trigger cascade"""
    sid = student_id(db, "PGP62-084")
    offer = scalar(db, "SELECT offer_id FROM offer WHERE student_id = %s AND job_id = 19", (sid,))
    snapshot = lambda: (db.execute("SELECT job_id, status FROM application WHERE student_id = %s ORDER BY job_id", (sid,)).fetchall(),
                        scalar(db, "SELECT count(*) FROM interview WHERE student_id = %s", (sid,)),
                        scalar(db, "SELECT count(*) FROM placement_log"))
    before = snapshot()
    try:
        with db.transaction():
            db.execute("CALL sp_accept_offer(%s)", (offer,))
            assert snapshot() != before
            raise RuntimeError("force rollback")
    except RuntimeError:
        pass
    assert snapshot() == before


def test_concurrent_acceptance_blocks(reset_after):
    """TC-TXN-02 | Isolation | A second session accepting another offer for the same student waits on the student row lock"""
    sid, first, second = _setup_two_pending_offers()
    a, b = connect(), connect()
    try:
        a.execute("CALL sp_accept_offer(%s)", (first,))          # holds the lock, not committed
        b.execute("SET lock_timeout = '700ms'")
        with pytest.raises(psycopg.errors.LockNotAvailable):
            b.execute("CALL sp_accept_offer(%s)", (second,))
    finally:
        a.rollback(); b.rollback(); a.close(); b.close()


def test_concurrent_acceptance_serialises(reset_after):
    """TC-TXN-03 | Isolation | When the first session commits, the waiting session fails and the student ends with exactly one accepted offer
    Session B waits on the lock, then re-reads its offer, finds it DECLINED by A's trigger, and aborts."""
    sid, first, second = _setup_two_pending_offers()
    a, b = connect(), connect()
    outcome = {}

    def session_b():
        try:
            b.execute("CALL sp_accept_offer(%s)", (second,))
            b.commit()
            outcome["b"] = "committed"
        except psycopg.Error as e:
            b.rollback()
            outcome["b"] = str(e)

    try:
        a.execute("CALL sp_accept_offer(%s)", (first,))
        worker = threading.Thread(target=session_b)
        worker.start()
        time.sleep(0.6)
        assert worker.is_alive(), "session B should be blocked while A holds the lock"
        a.commit()
        worker.join(timeout=10)
        assert "only a PENDING offer" in outcome["b"]
        with connect() as check:
            assert scalar(check, "SELECT count(*) FROM offer WHERE student_id = %s AND status = 'ACCEPTED'", (sid,)) == 1
    finally:
        a.close(); b.close()


def test_deferred_constraint_at_commit():
    """TC-TXN-04 | Consistency | COMMIT fails for a job without a subtype and leaves the database unchanged"""
    conn = connect()
    try:
        conn.execute("""INSERT INTO job_role (company_id, cycle_id, title, role_type, location, openings,
                        application_deadline) VALUES (16, 2, 'Orphan', 'FULLTIME', 'X', 1, now() + interval '5 days')""")
        with pytest.raises(psycopg.errors.IntegrityConstraintViolation):
            conn.commit()
    finally:
        conn.close()
    with connect() as check:
        assert scalar(check, "SELECT count(*) FROM job_role WHERE title = 'Orphan'") == 0
