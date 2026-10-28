"""Invariants that must hold for the whole seeded dataset."""

from conftest import connect, rebuild_database, scalar


def test_seed_volumes(db):
    """TC-DAT-01 | Data | The seed produces the documented volumes (reproducible with setseed)"""
    counts = {t: scalar(db, f"SELECT count(*) FROM {t}") for t in
              ("program", "company", "job_role", "student", "application", "interview", "offer")}
    assert counts == {"program": 3, "company": 16, "job_role": 25, "student": 180,
                      "application": 1184, "interview": 1057, "offer": 96}


def test_seed_is_deterministic(reset_after):
    """TC-DAT-02 | Data | Rebuilding the database twice produces byte-identical application and offer data"""
    def fingerprint():
        with connect() as conn:
            return scalar(conn, """SELECT md5(string_agg(concat_ws(',', a.student_id, a.job_id, a.status, o.status),
                                                         ';' ORDER BY a.student_id, a.job_id))
                                   FROM application a LEFT JOIN offer o USING (student_id, job_id)""")
    first = fingerprint()
    rebuild_database()
    assert fingerprint() == first


def test_one_accepted_offer_per_cycle(db):
    """TC-DAT-03 | BR-12 | No student holds more than one accepted offer in any cycle"""
    assert scalar(db, """SELECT count(*) FROM (
        SELECT o.student_id, j.cycle_id FROM offer o JOIN job_role j ON j.job_id = o.job_id
        WHERE o.status = 'ACCEPTED' GROUP BY 1, 2 HAVING count(*) > 1) x""") == 0


def test_no_overlapping_interviews(db):
    """TC-DAT-04 | BR-8 | No student has two overlapping interview slots"""
    assert scalar(db, """SELECT count(*) FROM interview a JOIN interview b
        ON a.student_id = b.student_id AND (a.job_id, a.round_no) < (b.job_id, b.round_no)
        AND tstzrange(a.slot_start, a.slot_end) && tstzrange(b.slot_start, b.slot_end)""") == 0


def test_applications_meet_eligibility(db):
    """TC-DAT-05 | BR-11 | Every application meets its job's program, CGPA, backlog and deadline rules"""
    assert scalar(db, """SELECT count(*) FROM application a
        JOIN student s ON s.person_id = a.student_id JOIN job_role j ON j.job_id = a.job_id
        LEFT JOIN eligibility e ON e.job_id = a.job_id AND e.program_id = s.program_id
        WHERE e.job_id IS NULL OR s.cgpa < e.min_cgpa OR s.active_backlogs > e.max_backlogs
           OR a.applied_at > j.application_deadline OR s.opted_out""") == 0


def test_timestamps_consistent(db):
    """TC-DAT-06 | Data | Status timestamps never precede the event they follow"""
    assert scalar(db, "SELECT count(*) FROM application WHERE status_updated_at < applied_at") == 0
    assert scalar(db, "SELECT count(*) FROM offer WHERE responded_at < offered_at OR response_deadline <= offered_at") == 0


def test_offers_mark_applications(db):
    """TC-DAT-07 | Offer rule | Every application that received an offer has status OFFERED"""
    assert scalar(db, """SELECT count(*) FROM offer o JOIN application a USING (student_id, job_id)
                         WHERE a.status <> 'OFFERED'""") == 0


def test_every_job_has_exactly_one_subtype(db):
    """TC-DAT-08 | BR-4 | Every job has exactly one subtype row (disjoint and total)"""
    assert scalar(db, """SELECT count(*) FROM job_role j
        WHERE (EXISTS (SELECT 1 FROM internship_role i WHERE i.job_id = j.job_id))::int
            + (EXISTS (SELECT 1 FROM fulltime_role f WHERE f.job_id = j.job_id))::int <> 1""") == 0


def test_round_progression(db):
    """TC-DAT-09 | Data | A student only sits round k of a job after clearing round k-1"""
    assert scalar(db, """SELECT count(*) FROM interview i
        WHERE i.round_no > 1 AND NOT EXISTS (
              SELECT 1 FROM interview p WHERE p.student_id = i.student_id AND p.job_id = i.job_id
                AND p.round_no = i.round_no - 1 AND p.result = 'CLEARED')""") == 0
