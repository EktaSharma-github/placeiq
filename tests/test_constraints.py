"""Declarative integrity: each business rule enforced by the schema itself."""

from conftest import expect_error, one, scalar, student_id


def test_cgpa_domain(db):
    """TC-CON-01 | BR-3 | CGPA outside 0-10 is rejected by a CHECK constraint"""
    expect_error(db, "UPDATE student SET cgpa = 10.5 WHERE roll_no = 'DBA12-039'", sqlstate="23514")
    expect_error(db, "UPDATE student SET cgpa = -1 WHERE roll_no = 'DBA12-039'", sqlstate="23514")
    db.execute("UPDATE student SET cgpa = 10 WHERE roll_no = 'DBA12-039'")  # boundary value is legal


def test_email_domain(db):
    """TC-CON-02 | Domain | Malformed or upper-case e-mail addresses are rejected"""
    for bad in ("no-at-sign.example.com", "Upper@Case.com", "a@b"):
        expect_error(db, "INSERT INTO person (first_name, email) VALUES ('X', %s)", (bad,), sqlstate="23514")


def test_roll_number_alternate_key(db):
    """TC-CON-03 | BR-2 | A duplicate roll number is rejected (UNIQUE alternate key)"""
    pid = scalar(db, "INSERT INTO person (first_name, email) VALUES ('Dup', 'dup@x.in') RETURNING person_id")
    expect_error(db, """INSERT INTO student (person_id, roll_no, program_id, batch_year, cgpa)
                        VALUES (%s, 'DBA12-039', 1, 2027, 8)""", (pid,), sqlstate="23505")


def test_disjoint_specialisation(db):
    """TC-CON-04 | BR-4 | A full-time job cannot also be given an internship row (disjoint)
    The composite FK (job_id, role_type) only matches when role_type = 'INTERNSHIP'."""
    expect_error(db, "INSERT INTO internship_role (job_id, stipend_monthly, duration_weeks) VALUES (25, 1, 8)",
                 sqlstate="23503")


def test_total_specialisation(db):
    """TC-CON-05 | BR-4 | A job without any subtype row fails the deferred totality check
    Inserting the job and its subtype in the same transaction passes."""
    expect_error(db, """INSERT INTO job_role (company_id, cycle_id, title, role_type, location, openings,
                        application_deadline) VALUES (16, 2, 'Ghost', 'FULLTIME', 'X', 1, now() + interval '9 days')""",
                 sqlstate="23000", immediate=True, match="specialisation is total")
    with db.transaction():
        jid = scalar(db, """INSERT INTO job_role (company_id, cycle_id, title, role_type, location, openings,
                            application_deadline) VALUES (16, 2, 'Real', 'FULLTIME', 'X', 1, now() + interval '9 days')
                            RETURNING job_id""")
        db.execute("INSERT INTO fulltime_role (job_id, ctc_lpa, fixed_lpa) VALUES (%s, 10, 8)", (jid,))
        db.execute("SET CONSTRAINTS ALL IMMEDIATE")


def test_recruiter_must_work_for_company(db):
    """TC-CON-06 | BR-5 | A recruiter cannot post a job for a company they do not work for"""
    expect_error(db, "UPDATE job_role SET posted_by = 4 WHERE job_id = 25", sqlstate="23503",
                 match="fk_job_posted_by")


def test_apply_at_most_once(db):
    """TC-CON-07 | BR-6 | A student cannot apply to the same job twice"""
    db.execute("SELECT fn_apply_for_job('DBA12-039', 25)")
    expect_error(db, "SELECT fn_apply_for_job('DBA12-039', 25)", sqlstate="23505",
                 match="uq_application_student_job")


def test_interview_round_must_exist(db):
    """TC-CON-08 | BR-7 | An interview in a round the job does not have is rejected (FK to weak entity)"""
    expect_error(db, """INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
                        SELECT student_id, job_id, 9, slot_start + interval '1 day', slot_end + interval '1 day', 'X'
                        FROM interview WHERE result = 'SCHEDULED' ORDER BY student_id LIMIT 1""",
                 sqlstate="23503", match="fk_interview_round")


def test_interview_requires_application(db):
    """TC-CON-09 | BR-7 | A student cannot be interviewed for a job they never applied to (aggregation FK)"""
    sid = student_id(db, "DBA12-023")  # opted out, has no applications
    expect_error(db, """INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
                        VALUES (%s, 19, 1, now(), now() + interval '1 hour', 'X')""", (sid,),
                 sqlstate="23503", match="fk_interview_application")


def test_no_double_booking(db):
    """TC-CON-10 | BR-8 | Overlapping interview slots for one student are rejected; back-to-back slots are allowed"""
    iv = one(db, "SELECT * FROM interview WHERE result = 'SCHEDULED' ORDER BY student_id, job_id LIMIT 1")
    expect_error(db, """INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
                        VALUES (%s, %s, 2, %s + interval '30 minutes', %s + interval '30 minutes', 'X')""",
                 (iv["student_id"], iv["job_id"], iv["slot_start"], iv["slot_end"]), sqlstate="23P01")
    db.execute("""INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
                  VALUES (%s, %s, 2, %s, %s + interval '1 hour', 'X')""",
               (iv["student_id"], iv["job_id"], iv["slot_end"], iv["slot_end"]))


def test_slot_order(db):
    """TC-CON-11 | Domain | An interview that ends before it starts is rejected"""
    expect_error(db, """UPDATE interview SET slot_end = slot_start - interval '1 minute'
                        WHERE result = 'SCHEDULED'""", sqlstate="23514")


def test_one_offer_per_application(db):
    """TC-CON-12 | BR-9 | A second offer on the same application is rejected"""
    o = one(db, "SELECT student_id, job_id FROM offer ORDER BY offer_id LIMIT 1")
    err = expect_error(db, "INSERT INTO offer (student_id, job_id, response_deadline) VALUES (%s, %s, now() + interval '5 days')",
                       (o["student_id"], o["job_id"]))
    assert err.sqlstate in ("23505", "23514")


def test_responded_at_iff_responded(db):
    """TC-CON-13 | BR-10 | ACCEPTED or DECLINED offers must carry responded_at"""
    oid = scalar(db, "SELECT offer_id FROM offer WHERE status = 'PENDING' ORDER BY offer_id LIMIT 1")
    expect_error(db, "UPDATE offer SET status = 'DECLINED' WHERE offer_id = %s", (oid,), sqlstate="23514",
                 match="chk_offer_response")
    expect_error(db, "UPDATE offer SET responded_at = now() WHERE offer_id = %s", (oid,), sqlstate="23514")


def test_sponsor_union_type(db):
    """TC-CON-14 | BR-13 | A company cannot claim a sponsor row typed ALUMNUS (category / union type)"""
    expect_error(db, "UPDATE company SET sponsor_id = 4 WHERE company_id = 2", sqlstate="23503")


def test_restrict_blocks_cascade(db):
    """TC-CON-15 | BR-15 | Deleting a student who holds an offer is blocked (CASCADE then RESTRICT)"""
    sid = scalar(db, "SELECT student_id FROM offer WHERE status = 'ACCEPTED' ORDER BY offer_id LIMIT 1")
    expect_error(db, "DELETE FROM person WHERE person_id = %s", (sid,), sqlstate="23001",
                 match="fk_offer_application")


def test_cascade_delete_student_without_offers(db):
    """TC-CON-16 | Referential actions | Deleting a student with no offers cascades to all dependent rows"""
    sid = scalar(db, """SELECT s.person_id FROM student s
                        WHERE EXISTS (SELECT 1 FROM interview i WHERE i.student_id = s.person_id)
                          AND NOT EXISTS (SELECT 1 FROM offer o WHERE o.student_id = s.person_id)
                        ORDER BY s.person_id LIMIT 1""")
    db.execute("DELETE FROM person WHERE person_id = %s", (sid,))
    for table, col in [("student", "person_id"), ("application", "student_id"),
                       ("interview", "student_id"), ("student_skill", "student_id")]:
        assert scalar(db, f"SELECT count(*) FROM {table} WHERE {col} = %s", (sid,)) == 0


def test_set_null_on_recruiter_delete(db):
    """TC-CON-17 | Referential actions | Deleting a recruiter nulls job_role.posted_by but keeps the job"""
    db.execute("DELETE FROM person WHERE person_id = 20")
    job = one(db, "SELECT posted_by, company_id FROM job_role WHERE job_id = 25")
    assert job == {"posted_by": None, "company_id": 16}


def test_program_restrict(db):
    """TC-CON-18 | Referential actions | A program that still has students cannot be deleted"""
    expect_error(db, "DELETE FROM program WHERE program_id = 1", sqlstate="23001")


def test_fixed_pay_not_above_ctc(db):
    """TC-CON-19 | Domain | Fixed pay above total CTC is rejected"""
    expect_error(db, "UPDATE fulltime_role SET fixed_lpa = ctc_lpa + 1 WHERE job_id = 11", sqlstate="23514")


def test_cycle_dates(db):
    """TC-CON-20 | Domain | A placement cycle that ends before it starts is rejected"""
    expect_error(db, "UPDATE placement_cycle SET end_date = start_date - 1 WHERE cycle_id = 1", sqlstate="23514")
