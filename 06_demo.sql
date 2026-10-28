-- =====================================================================
--  PlaceIQ  |  Live demo script for the presentation (M3 + M4)
--
--  psql -U postgres -h localhost -d placeiq -f 06_demo.sql
--
--  EVERYTHING runs inside one transaction that is ROLLED BACK at the end,
--  so you can rehearse as often as you like; the database is unchanged.
--  ON_ERROR_ROLLBACK makes psql wrap each statement in a savepoint, so the
--  statements that are SUPPOSED to fail don't abort the demo.
--
--  In pgAdmin: run one section at a time, starting with BEGIN; and ending
--  with ROLLBACK; and enable "Auto rollback on error" in the query tool.
-- =====================================================================

\set ON_ERROR_ROLLBACK on
\set VERBOSITY terse
SET search_path TO placeiq, public;

BEGIN;

-- =====================================================================
-- PART 1 (M3)  INTEGRITY CONSTRAINTS: every statement below must FAIL
-- =====================================================================

\echo '\n=== 1.1  Domain constraint: CGPA 11 (CHECK) ==='
UPDATE student SET cgpa = 11 WHERE roll_no = 'DBA12-039';

\echo '\n=== 1.2  Disjoint specialisation: make full-time job 25 an internship too (composite FK) ==='
INSERT INTO internship_role (job_id, stipend_monthly, duration_weeks) VALUES (25, 50000, 8);

\echo '\n=== 1.3  Total specialisation: a job with no subtype row (deferred constraint trigger) ==='
INSERT INTO job_role (company_id, cycle_id, title, role_type, location, openings, application_deadline)
VALUES (16, 2, 'Ghost Role', 'FULLTIME', 'Chennai', 1, '2026-12-31');
SET CONSTRAINTS ALL IMMEDIATE;   -- fire the deferred check now instead of at COMMIT
SET CONSTRAINTS ALL DEFERRED;

\echo '\n=== 1.4  BR-5: a Kestrel Capital recruiter posts a Tidewater job (composite FK) ==='
UPDATE job_role SET posted_by = 4 WHERE job_id = 25;

\echo '\n=== 1.5  BR-7: interview in round 9, which the job does not have (FK to weak entity) ==='
INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
SELECT student_id, job_id, 9, slot_start + INTERVAL '1 day', slot_end + INTERVAL '1 day', 'Room X'
FROM interview WHERE result = 'SCHEDULED' ORDER BY student_id, job_id LIMIT 1;

\echo '\n=== 1.6  BR-8: double-booking a student 30 minutes into an existing slot (EXCLUDE) ==='
INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
SELECT student_id, job_id, 2, slot_start + INTERVAL '30 minutes', slot_end + INTERVAL '30 minutes', 'Room X'
FROM interview WHERE result = 'SCHEDULED' ORDER BY student_id, job_id LIMIT 1;

\echo '\n=== 1.7  BR-15: delete a placed student (CASCADE to application, then RESTRICT on offer) ==='
DELETE FROM person
WHERE person_id = (SELECT student_id FROM offer WHERE status = 'ACCEPTED' ORDER BY offer_id LIMIT 1);


-- =====================================================================
-- PART 2 (M4)  TRIGGER T1: ELIGIBILITY ON APPLY
-- =====================================================================

SELECT roll_no AS low_cgpa_roll FROM student
WHERE NOT opted_out AND cgpa < 6.5 ORDER BY cgpa LIMIT 1 \gset

\echo '\n=== 2.1  Below the CGPA cut-off for job 25 (expect: trigger rejects) ==='
SELECT fn_apply_for_job(:'low_cgpa_roll', 25);

\echo '\n=== 2.2  Student who opted out (expect: trigger rejects) ==='
SELECT fn_apply_for_job('DBA12-023', 25);

\echo '\n=== 2.3  Deadline passed for job 11 (expect: trigger rejects) ==='
SELECT fn_apply_for_job('DBA12-039', 11);

\echo '\n=== 2.4  Tanvi (found by Query 2) applies to job 25 (expect: SUCCESS) ==='
SELECT fn_apply_for_job('DBA12-039', 25) AS new_application_id;

\echo '\n=== 2.5  ...and applies again (expect: UNIQUE violation, BR-6) ==='
SELECT fn_apply_for_job('DBA12-039', 25);


-- =====================================================================
-- PART 3 (M4)  TRIGGER T3 + PROCEDURE: ONE-OFFER POLICY, ATOMICALLY
--     PGP62-084 holds a pending offer from DataSutra (job 19), and is
--     shortlisted for two December interviews.
-- =====================================================================

\echo '\n=== 3.1  BEFORE: PGP62-084 applications, offers, interviews ==='
SELECT a.job_id, d.company_name, a.status AS application, o.status AS offer,
       (SELECT count(*) FROM interview i
        WHERE i.student_id = a.student_id AND i.job_id = a.job_id AND i.result = 'SCHEDULED') AS scheduled_interviews
FROM application a
JOIN student s ON s.person_id = a.student_id
JOIN v_job_details d ON d.job_id = a.job_id
LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
WHERE s.roll_no = 'PGP62-084' AND d.cycle_id = 2
ORDER BY a.job_id;

\echo '\n=== 3.2  A December recruiter makes a pre-placement offer on a SHORTLISTED application ==='
INSERT INTO offer (student_id, job_id, response_deadline)
SELECT a.student_id, a.job_id, now() + INTERVAL '7 days'
FROM application a JOIN student s ON s.person_id = a.student_id
WHERE s.roll_no = 'PGP62-084' AND a.status = 'SHORTLISTED'
ORDER BY a.job_id LIMIT 1
RETURNING offer_id, job_id, status;

SELECT o.offer_id AS demo_offer FROM offer o JOIN student s ON s.person_id = o.student_id
WHERE s.roll_no = 'PGP62-084' AND o.job_id = 19 \gset

\echo '\n=== 3.3  The student accepts the DataSutra offer: CALL sp_accept_offer ==='
CALL sp_accept_offer(:demo_offer);

\echo '\n=== 3.4  AFTER: other offer auto-DECLINED, open applications WITHDRAWN, interviews freed ==='
SELECT a.job_id, d.company_name, a.status AS application, o.status AS offer,
       (SELECT count(*) FROM interview i
        WHERE i.student_id = a.student_id AND i.job_id = a.job_id AND i.result = 'SCHEDULED') AS scheduled_interviews
FROM application a
JOIN student s ON s.person_id = a.student_id
JOIN v_job_details d ON d.job_id = a.job_id
LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
WHERE s.roll_no = 'PGP62-084' AND d.cycle_id = 2
ORDER BY a.job_id;

\echo '\n=== 3.5  Audit trail written by the trigger ==='
SELECT l.action, l.job_id, l.details
FROM placement_log l JOIN student s ON s.person_id = l.student_id
WHERE s.roll_no = 'PGP62-084' AND l.logged_at = now()
ORDER BY l.log_id;

\echo '\n=== 3.6  Derived status in the view flips to PLACED (BR-14) ==='
SELECT roll_no, placement_status, placed_with, placed_role, ctc_lpa
FROM v_placement_status WHERE roll_no = 'PGP62-084' AND cycle_id = 2;

\echo '\n=== 3.7  Placed student tries to apply to job 25 (expect: trigger rejects) ==='
SELECT fn_apply_for_job('PGP62-084', 25);

\echo '\n=== 3.8  ...or to accept the offer that was auto-declined (expect: rejected) ==='
UPDATE offer SET status = 'ACCEPTED', responded_at = now()
WHERE student_id = (SELECT person_id FROM student WHERE roll_no = 'PGP62-084')
  AND status = 'DECLINED';


-- =====================================================================
-- PART 4 (M4)  INDEXING: EXPLAIN ANALYZE BEFORE / AFTER
--     Our live tables are small enough that PostgreSQL rightly prefers a
--     sequential scan, so we build a 10-year application archive
--     (600,000 rows) inside this transaction to show the effect.
-- =====================================================================

\echo '\n=== 4.0  Building a 600k-row application archive (about 2 s) ==='
CREATE TABLE application_archive AS
SELECT g                                                       AS application_id,
       100 + (g % 180) + 1                                     AS student_id,
       1 + (g % 2500)                                          AS job_id,
       (ARRAY['APPLIED','SHORTLISTED','REJECTED','WITHDRAWN','OFFERED'])
           [CASE WHEN g % 100 < 2 THEN 1 WHEN g % 100 < 4 THEN 2
                 WHEN g % 100 < 85 THEN 3 WHEN g % 100 < 95 THEN 4 ELSE 5 END] AS status,
       TIMESTAMPTZ '2016-07-01' + (g % 3650) * INTERVAL '1 day' AS applied_at
FROM generate_series(1, 600000) AS g;
ANALYZE application_archive;

\echo '\n=== 4.1  BEFORE: open applications for job 1234 (expect Seq Scan) ==='
EXPLAIN (ANALYZE, COSTS OFF, TIMING ON, SUMMARY ON)
SELECT count(*) FROM application_archive
WHERE job_id = 1234 AND status IN ('APPLIED', 'SHORTLISTED');

\echo '\n=== 4.2  Composite B-tree index on (job_id, status) ==='
CREATE INDEX idx_archive_job_status ON application_archive (job_id, status);
ANALYZE application_archive;

EXPLAIN (ANALYZE, COSTS OFF, TIMING ON, SUMMARY ON)
SELECT count(*) FROM application_archive
WHERE job_id = 1234 AND status IN ('APPLIED', 'SHORTLISTED');

\echo '\n=== 4.3  Partial index: only the ~4% of rows that are still open ==='
CREATE INDEX idx_archive_open ON application_archive (job_id)
WHERE status IN ('APPLIED', 'SHORTLISTED');
ANALYZE application_archive;

EXPLAIN (ANALYZE, COSTS OFF, TIMING ON, SUMMARY ON)
SELECT count(*) FROM application_archive
WHERE job_id = 1234 AND status IN ('APPLIED', 'SHORTLISTED');

SELECT relname AS index_name, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class WHERE relname IN ('idx_archive_job_status', 'idx_archive_open');

\echo '\n=== 4.4  Leading-column rule: the composite index cannot help a filter on status alone ==='
EXPLAIN (COSTS OFF)
SELECT count(*) FROM application_archive WHERE status = 'OFFERED';


-- =====================================================================
-- PART 5 (M4)  SQL INJECTION: string concatenation vs bound parameters
-- =====================================================================

CREATE FUNCTION fn_find_student_unsafe(p_last_name TEXT)
RETURNS TABLE (roll_no VARCHAR, cgpa NUMERIC)
LANGUAGE plpgsql AS $$
BEGIN
    -- WRONG: user input is pasted into the SQL text
    RETURN QUERY EXECUTE
        'SELECT s.roll_no, s.cgpa FROM student s JOIN person p ON p.person_id = s.person_id '
        || 'WHERE p.last_name = ''' || p_last_name || '''';
END $$;

CREATE FUNCTION fn_find_student_safe(p_last_name TEXT)
RETURNS TABLE (roll_no VARCHAR, cgpa NUMERIC)
LANGUAGE plpgsql AS $$
BEGIN
    -- RIGHT: input is passed as a bound parameter ($1), never parsed as SQL
    RETURN QUERY EXECUTE
        'SELECT s.roll_no, s.cgpa FROM student s JOIN person p ON p.person_id = s.person_id '
        || 'WHERE p.last_name = $1'
    USING p_last_name;
END $$;

\echo '\n=== 5.1  Normal input: last name = Sen ==='
SELECT count(*) AS rows_returned FROM fn_find_student_unsafe('Sen');

\echo '\n=== 5.2  Malicious input  x'' OR ''1''=''1  on the UNSAFE function: leaks every student ==='
SELECT count(*) AS rows_returned FROM fn_find_student_unsafe('x'' OR ''1''=''1');

\echo '\n=== 5.3  Same input on the SAFE function: treated as a literal name, 0 rows ==='
SELECT count(*) AS rows_returned FROM fn_find_student_safe('x'' OR ''1''=''1');


-- =====================================================================
-- PART 6  ATOMICITY: undo everything
-- =====================================================================

ROLLBACK;

\echo '\n=== 6.1  After ROLLBACK: PGP62-084 is back to OFFER_PENDING, the archive table is gone ==='
SELECT roll_no, placement_status FROM v_placement_status WHERE roll_no = 'PGP62-084' AND cycle_id = 2;
SELECT to_regclass('placeiq.application_archive') AS archive_table;


-- =====================================================================
-- APPENDIX (M4, optional)  CONCURRENCY: two sessions, one student
--   Shows why sp_accept_offer locks the student row (FOR UPDATE) before
--   touching any offer. Open TWO psql / pgAdmin windows and run this by
--   hand. It COMMITS, so afterwards rebuild the database with run_all.ps1.
--
--   Setup (either window):
--     INSERT INTO offer (student_id, job_id, response_deadline)
--     SELECT a.student_id, a.job_id, now() + interval '7 days'
--     FROM application a JOIN student s ON s.person_id = a.student_id
--     WHERE s.roll_no = 'PGP62-084' AND a.status = 'SHORTLISTED'
--     ORDER BY a.job_id LIMIT 1;                      -- note the offer_id
--
--   Window A:  BEGIN;  CALL sp_accept_offer(<job-19 offer_id>);   -- don't commit yet
--   Window B:  BEGIN;  CALL sp_accept_offer(<new offer_id>);      -- BLOCKS on the student lock
--   Window A:  COMMIT;
--   Window B:  unblocks, re-reads its offer, finds it already DECLINED by
--              A's trigger, and fails with "only a PENDING offer can be
--              accepted". Isolation: B behaves as if it ran after A.
--              Without the lock, both sessions could check "no accepted
--              offer yet" before either commits, and the student would end
--              up with two accepted offers.
-- =====================================================================
