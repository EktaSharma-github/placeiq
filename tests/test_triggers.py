"""Procedural integrity: triggers, the stored function and the procedures."""

from conftest import expect_error, one, scalar, student_id


def _open_job(db, programs=("PGDBA",), min_cgpa=0, max_backlogs=0):
    """Create a job open for applications (inside the test's transaction)."""
    jid = scalar(db, """INSERT INTO job_role (company_id, cycle_id, title, role_type, location, openings,
                        application_deadline) VALUES (16, 2, 'Test Role', 'FULLTIME', 'Chennai', 2,
                        now() + interval '10 days') RETURNING job_id""")
    db.execute("INSERT INTO fulltime_role (job_id, ctc_lpa, fixed_lpa) VALUES (%s, 12, 10)", (jid,))
    for code in programs:
        db.execute("""INSERT INTO eligibility (job_id, program_id, min_cgpa, max_backlogs)
                      SELECT %s, program_id, %s, %s FROM program WHERE program_code = %s""",
                   (jid, min_cgpa, max_backlogs, code))
    return jid


def _pgp084(db):
    sid = student_id(db, "PGP62-084")
    offer = scalar(db, "SELECT offer_id FROM offer WHERE student_id = %s AND job_id = 19", (sid,))
    return sid, offer


def test_rejects_below_cutoff(db):
    """TC-TRG-01 | BR-11 | Applying with a CGPA below the job's cut-off is rejected by the trigger"""
    expect_error(db, "SELECT fn_apply_for_job('PGP62-022', 25)", sqlstate="23514", match="below the cut-off")


def test_rejects_opted_out(db):
    """TC-TRG-02 | BR-11 | A student who opted out of placements cannot apply"""
    expect_error(db, "SELECT fn_apply_for_job('DBA12-023', 25)", sqlstate="23514", match="opted out")


def test_rejects_after_deadline(db):
    """TC-TRG-03 | BR-11 | Applying after the application deadline is rejected"""
    expect_error(db, "SELECT fn_apply_for_job('DBA12-039', 11)", sqlstate="23514", match="closed")


def test_rejects_ineligible_program(db):
    """TC-TRG-04 | BR-11 | A student whose program is not eligible for the job cannot apply"""
    jid = _open_job(db, programs=("PGDBA",))
    expect_error(db, "SELECT fn_apply_for_job('PGP62-001', %s)", (jid,), sqlstate="23514", match="not eligible")


def test_rejects_backlogs(db):
    """TC-TRG-05 | BR-11 | A student with more active backlogs than the job allows cannot apply"""
    roll = scalar(db, """SELECT roll_no FROM student WHERE program_id = 1 AND active_backlogs > 0
                         AND NOT opted_out ORDER BY roll_no LIMIT 1""")
    jid = _open_job(db, programs=("PGDBA",), max_backlogs=0)
    expect_error(db, "SELECT fn_apply_for_job(%s, %s)", (roll, jid), sqlstate="23514", match="backlog")


def test_rejects_already_placed(db):
    """TC-TRG-06 | BR-11 | A student already placed in the cycle cannot apply to another job in it"""
    roll = scalar(db, """SELECT s.roll_no FROM offer o JOIN job_role j ON j.job_id = o.job_id
                         JOIN student s ON s.person_id = o.student_id
                         WHERE o.status = 'ACCEPTED' AND j.cycle_id = 2 ORDER BY o.offer_id LIMIT 1""")
    expect_error(db, "SELECT fn_apply_for_job(%s, 25)", (roll,), sqlstate="23514", match="already accepted")


def test_accepts_eligible_application(db):
    """TC-TRG-07 | BR-11 | An eligible student's application is accepted with status APPLIED"""
    app_id = scalar(db, "SELECT fn_apply_for_job('DBA12-039', 25)")
    assert one(db, "SELECT status FROM application WHERE application_id = %s", (app_id,)) == {"status": "APPLIED"}


def test_offer_requires_open_application(db):
    """TC-TRG-08 | Offer rule | An offer cannot be made on a REJECTED or WITHDRAWN application"""
    app = one(db, "SELECT student_id, job_id FROM application WHERE status = 'REJECTED' ORDER BY application_id LIMIT 1")
    expect_error(db, "INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, %s, now() + interval '7 days')",
                 (app["student_id"], app["job_id"]), sqlstate="23514", match="status is REJECTED")


def test_offer_marks_application_offered(db):
    """TC-TRG-09 | Offer rule | Making an offer moves the application to OFFERED (AFTER INSERT trigger)"""
    sid, _ = _pgp084(db)
    db.execute("INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, 21, now() + interval '7 days')", (sid,))
    assert scalar(db, "SELECT status FROM application WHERE student_id = %s AND job_id = 21", (sid,)) == "OFFERED"


def test_accept_cascade(db):
    """TC-TRG-10 | BR-12 | Accepting an offer declines other offers, withdraws open applications, frees interview slots and logs it
    Scenario: PGP62-084 holds a pending offer for job 19, gets a second offer for
    job 21, and is shortlisted with a scheduled interview for job 22."""
    sid, offer = _pgp084(db)
    db.execute("INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, 21, now() + interval '7 days')", (sid,))
    db.execute("CALL sp_accept_offer(%s)", (offer,))
    offers = {r["job_id"]: r["status"] for r in db.execute("SELECT job_id, status FROM offer WHERE student_id = %s", (sid,))}
    assert offers == {19: "ACCEPTED", 21: "DECLINED"}
    assert scalar(db, "SELECT status FROM application WHERE student_id = %s AND job_id = 22", (sid,)) == "WITHDRAWN"
    assert scalar(db, "SELECT count(*) FROM interview WHERE student_id = %s AND result = 'SCHEDULED'", (sid,)) == 0
    actions = sorted(r["action"] for r in db.execute(
        "SELECT action FROM placement_log WHERE student_id = %s AND logged_at = now()", (sid,)))
    assert actions == ["AUTO_DECLINED", "AUTO_WITHDRAWN", "OFFER_ACCEPTED"]


def test_view_reflects_acceptance(db):
    """TC-TRG-11 | BR-14 | After acceptance the derived status in v_placement_status becomes PLACED"""
    sid, offer = _pgp084(db)
    before = scalar(db, "SELECT placement_status FROM v_placement_status WHERE student_id = %s AND cycle_id = 2", (sid,))
    db.execute("CALL sp_accept_offer(%s)", (offer,))
    after = one(db, "SELECT placement_status, placed_with FROM v_placement_status WHERE student_id = %s AND cycle_id = 2", (sid,))
    assert before == "OFFER_PENDING"
    assert after == {"placement_status": "PLACED", "placed_with": "DataSutra Labs"}


def test_cannot_accept_declined_offer(db):
    """TC-TRG-12 | BR-12 | An offer that was declined (manually or by the cascade) cannot later be accepted"""
    sid, offer = _pgp084(db)
    second = scalar(db, "INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, 21, now() + interval '7 days') RETURNING offer_id", (sid,))
    db.execute("CALL sp_accept_offer(%s)", (offer,))
    expect_error(db, "CALL sp_accept_offer(%s)", (second,), sqlstate="23514", match="only a PENDING offer")
    expect_error(db, "UPDATE offer SET status = 'ACCEPTED', responded_at = now() WHERE offer_id = %s", (second,),
                 sqlstate="23514", match="only a PENDING offer")


def test_one_offer_rule_is_per_cycle(db):
    """TC-TRG-13 | BR-12 | A student placed in summer can still apply to and accept a final-placement offer"""
    roll = scalar(db, """SELECT s.roll_no FROM student s
                         JOIN offer o ON o.student_id = s.person_id AND o.status = 'ACCEPTED'
                         JOIN job_role j ON j.job_id = o.job_id AND j.cycle_id = 1
                         WHERE s.cgpa >= 6.5 AND s.active_backlogs <= 1
                           AND NOT EXISTS (SELECT 1 FROM offer o2 JOIN job_role j2 ON j2.job_id = o2.job_id
                                           WHERE o2.student_id = s.person_id AND j2.cycle_id = 2)
                         ORDER BY s.roll_no LIMIT 1""")
    sid = student_id(db, roll)
    db.execute("SELECT fn_apply_for_job(%s, 25)", (roll,))
    oid = scalar(db, "INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, 25, now() + interval '7 days') RETURNING offer_id", (sid,))
    db.execute("CALL sp_accept_offer(%s)", (oid,))
    assert scalar(db, "SELECT count(*) FROM offer WHERE student_id = %s AND status = 'ACCEPTED'", (sid,)) == 2


def test_cannot_accept_after_deadline(db):
    """TC-TRG-14 | BR-12 | Accepting an offer after its response deadline is rejected"""
    _, offer = _pgp084(db)
    db.execute("""UPDATE offer SET offered_at = now() - interval '10 days', response_deadline = now() - interval '1 day'
                  WHERE offer_id = %s""", (offer,))
    expect_error(db, "CALL sp_accept_offer(%s)", (offer,), sqlstate="23514", match="expired")


def test_expire_stale_offers(db):
    """TC-TRG-15 | Procedure | sp_expire_stale_offers() expires overdue pending offers and logs each one"""
    _, offer = _pgp084(db)
    db.execute("""UPDATE offer SET offered_at = now() - interval '10 days', response_deadline = now() - interval '1 day'
                  WHERE offer_id = %s""", (offer,))
    db.execute("CALL sp_expire_stale_offers()")
    assert scalar(db, "SELECT status FROM offer WHERE offer_id = %s", (offer,)) == "EXPIRED"
    assert scalar(db, "SELECT count(*) FROM placement_log WHERE action = 'OFFER_EXPIRED' AND details LIKE %s",
                  (f"Offer {offer} %",)) == 1


def test_apply_unknown_roll(db):
    """TC-TRG-16 | Function | fn_apply_for_job reports an unknown roll number clearly"""
    expect_error(db, "SELECT fn_apply_for_job('NOPE-000', 25)", match="No student with roll number")
