-- =====================================================================
--  PlaceIQ  |  Phase 3a : Views, Triggers, Stored Procedures
--
--  Run after 02_ddl.sql and BEFORE 04_data.sql, so that every mock row
--  is loaded through the same business rules a real user would hit.
--
--  Contents
--    V1  v_job_details          one row per job with its compensation
--    V2  v_placement_status     derived placement status (BR-14)
--    T1  trg_application_eligibility   BR-11  who may apply
--    T2  trg_offer_requires_open_app   an offer needs a live application
--        trg_offer_marks_app_offered   application -> OFFERED
--    T3  trg_offer_accept_guard        BR-12  one accepted offer per cycle
--        trg_offer_accept_cascade      BR-12  withdraw / decline the rest
--    T4  trg_job_total_*               BR-4   total specialisation (deferred)
--    P1  fn_apply_for_job(roll_no, job_id)
--    P2  sp_accept_offer(offer_id)
--    P3  sp_expire_stale_offers()
-- =====================================================================

SET search_path TO placeiq, public;


-- =====================================================================
-- VIEWS
-- =====================================================================

-- V1. Flattens the job specialisation hierarchy back into one row per job.
--     LEFT JOINs because each job has exactly one of the two subtypes.
CREATE OR REPLACE VIEW v_job_details AS
SELECT j.job_id,
       c.company_id,
       c.company_name,
       c.sector,
       pc.cycle_id,
       pc.cycle_name,
       pc.cycle_type,
       j.title,
       j.role_type,
       j.location,
       j.openings,
       j.application_deadline,
       f.ctc_lpa,
       f.fixed_lpa,
       f.joining_bonus,
       i.stipend_monthly,
       i.duration_weeks,
       i.ppo_possible
FROM job_role j
JOIN company         c  ON c.company_id = j.company_id
JOIN placement_cycle pc ON pc.cycle_id  = j.cycle_id
LEFT JOIN fulltime_role   f ON f.job_id = j.job_id
LEFT JOIN internship_role i ON i.job_id = j.job_id;


-- V2. BR-14: placement status is DERIVED, never stored.
--     One row per (student, cycle) for every cycle that has at least one
--     job open to the student's program.
CREATE OR REPLACE VIEW v_placement_status AS
SELECT s.person_id                                   AS student_id,
       s.roll_no,
       concat_ws(' ', p.first_name, p.last_name)     AS student_name,
       pr.program_code,
       s.cgpa,
       pc.cycle_id,
       pc.cycle_name,
       CASE
           WHEN s.opted_out            THEN 'OPTED_OUT'
           WHEN acc.job_id IS NOT NULL THEN 'PLACED'
           WHEN off.pending > 0        THEN 'OFFER_PENDING'
           WHEN app.active > 0         THEN 'IN_PROCESS'
           WHEN app.total > 0          THEN 'UNPLACED'
           ELSE 'NOT_APPLIED'
       END                                           AS placement_status,
       acc.company_name                              AS placed_with,
       acc.title                                     AS placed_role,
       acc.ctc_lpa,
       acc.stipend_monthly,
       COALESCE(app.total, 0)                        AS applications,
       COALESCE(off.total, 0)                        AS offers_received
FROM student s
JOIN person  p  ON p.person_id   = s.person_id
JOIN program pr ON pr.program_id = s.program_id
JOIN placement_cycle pc
     ON EXISTS (SELECT 1
                FROM job_role j
                JOIN eligibility e ON e.job_id = j.job_id
                WHERE j.cycle_id = pc.cycle_id AND e.program_id = s.program_id)
LEFT JOIN LATERAL (
        SELECT count(*)                                                   AS total,
               count(*) FILTER (WHERE a.status IN ('APPLIED', 'SHORTLISTED')) AS active
        FROM application a JOIN job_role j ON j.job_id = a.job_id
        WHERE a.student_id = s.person_id AND j.cycle_id = pc.cycle_id) app ON TRUE
LEFT JOIN LATERAL (
        SELECT count(*)                                     AS total,
               count(*) FILTER (WHERE o.status = 'PENDING') AS pending
        FROM offer o JOIN job_role j ON j.job_id = o.job_id
        WHERE o.student_id = s.person_id AND j.cycle_id = pc.cycle_id) off ON TRUE
LEFT JOIN LATERAL (
        SELECT d.job_id, d.company_name, d.title, d.ctc_lpa, d.stipend_monthly
        FROM offer o JOIN v_job_details d ON d.job_id = o.job_id
        WHERE o.student_id = s.person_id AND d.cycle_id = pc.cycle_id
          AND o.status = 'ACCEPTED') acc ON TRUE;


-- =====================================================================
-- T1. BR-11  APPLICATION ELIGIBILITY
--     A CHECK constraint can only see the row being inserted. This rule
--     needs student, eligibility, job_role and offer, so it is a trigger.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_application_eligibility()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_student  student%ROWTYPE;
    v_job      job_role%ROWTYPE;
    v_elig     eligibility%ROWTYPE;
BEGIN
    SELECT * INTO v_student FROM student  WHERE person_id = NEW.student_id;
    SELECT * INTO v_job     FROM job_role WHERE job_id    = NEW.job_id;
    IF v_student.person_id IS NULL OR v_job.job_id IS NULL THEN
        RETURN NEW;                       -- let the foreign key report it
    END IF;

    IF v_student.opted_out THEN
        RAISE EXCEPTION 'Student % has opted out of placements', v_student.roll_no
              USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.applied_at > v_job.application_deadline THEN
        RAISE EXCEPTION 'Applications for job % (%) closed at %',
                        v_job.job_id, v_job.title, v_job.application_deadline
              USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO v_elig
    FROM eligibility
    WHERE job_id = NEW.job_id AND program_id = v_student.program_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student %''s program is not eligible for job % (%)',
                        v_student.roll_no, v_job.job_id, v_job.title
              USING ERRCODE = 'check_violation';
    END IF;

    IF v_student.cgpa < v_elig.min_cgpa THEN
        RAISE EXCEPTION 'Student % has CGPA %, below the cut-off % for job % (%)',
                        v_student.roll_no, v_student.cgpa, v_elig.min_cgpa, v_job.job_id, v_job.title
              USING ERRCODE = 'check_violation';
    END IF;

    IF v_student.active_backlogs > v_elig.max_backlogs THEN
        RAISE EXCEPTION 'Student % has % active backlog(s); job % allows at most %',
                        v_student.roll_no, v_student.active_backlogs, v_job.job_id, v_elig.max_backlogs
              USING ERRCODE = 'check_violation';
    END IF;

    IF EXISTS (SELECT 1
               FROM offer o JOIN job_role j ON j.job_id = o.job_id
               WHERE o.student_id = NEW.student_id
                 AND o.status = 'ACCEPTED'
                 AND j.cycle_id = v_job.cycle_id) THEN
        RAISE EXCEPTION 'Student % has already accepted an offer in this placement cycle',
                        v_student.roll_no
              USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER trg_application_eligibility
BEFORE INSERT OR UPDATE OF student_id, job_id ON application
FOR EACH ROW EXECUTE FUNCTION fn_check_application_eligibility();


-- =====================================================================
-- T2. OFFER <-> APPLICATION CONSISTENCY
-- =====================================================================

-- An offer may only be made on an application that is still in play.
CREATE OR REPLACE FUNCTION fn_offer_requires_open_application()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_status application.status%TYPE;
BEGIN
    SELECT status INTO v_status
    FROM application
    WHERE student_id = NEW.student_id AND job_id = NEW.job_id;
    IF NOT FOUND THEN
        RETURN NEW;                       -- let the foreign key report it
    END IF;

    IF v_status NOT IN ('APPLIED', 'SHORTLISTED') THEN
        RAISE EXCEPTION 'Cannot make an offer on an application whose status is %', v_status
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_offer_requires_open_app
BEFORE INSERT ON offer
FOR EACH ROW EXECUTE FUNCTION fn_offer_requires_open_application();

-- Making an offer moves the application to OFFERED.
CREATE OR REPLACE FUNCTION fn_offer_marks_application()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE application
       SET status            = 'OFFERED',
           status_updated_at = GREATEST(NEW.offered_at, applied_at)
     WHERE student_id = NEW.student_id AND job_id = NEW.job_id;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_offer_marks_app_offered
AFTER INSERT ON offer
FOR EACH ROW EXECUTE FUNCTION fn_offer_marks_application();


-- =====================================================================
-- T3. BR-12  ONE-OFFER POLICY
--     (a) BEFORE: refuse a second accepted offer in the same cycle, a late
--         acceptance, or accepting a non-pending offer.
--     (b) AFTER : in the same transaction, decline the student's other
--         pending offers, withdraw their open applications, cancel their
--         scheduled interviews, and write the audit log.
--     Because (a) and (b) run inside the accepting statement, the whole
--     cascade commits or rolls back as one unit (atomicity).
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_offer_accept_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cycle placement_cycle.cycle_id%TYPE;
BEGIN
    IF NEW.status <> 'ACCEPTED' THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'ACCEPTED' THEN
            RETURN NEW;                   -- unrelated update of an accepted offer
        ELSIF OLD.status <> 'PENDING' THEN
            RAISE EXCEPTION 'Offer % is %; only a PENDING offer can be accepted', NEW.offer_id, OLD.status
                  USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    IF COALESCE(NEW.responded_at, now()) > NEW.response_deadline THEN
        RAISE EXCEPTION 'Offer % expired at %', NEW.offer_id, NEW.response_deadline
              USING ERRCODE = 'check_violation';
    END IF;

    -- Concurrency control: lock the student's row so two sessions accepting
    -- two different offers for the same student are serialised. The second
    -- session waits here, then its EXISTS check below sees the first
    -- session's committed acceptance and fails.
    PERFORM 1 FROM student WHERE person_id = NEW.student_id FOR UPDATE;

    SELECT cycle_id INTO v_cycle FROM job_role WHERE job_id = NEW.job_id;

    IF EXISTS (SELECT 1
               FROM offer o JOIN job_role j ON j.job_id = o.job_id
               WHERE o.student_id = NEW.student_id
                 AND o.status = 'ACCEPTED'
                 AND j.cycle_id = v_cycle
                 AND o.offer_id <> NEW.offer_id) THEN
        RAISE EXCEPTION 'Student % has already accepted an offer in this placement cycle', NEW.student_id
              USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END $$;

-- Partial index: T1 and T3 both ask "does this student hold an ACCEPTED
-- offer?". Only accepted offers are indexed, so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_offer_accepted_student
    ON offer (student_id) WHERE status = 'ACCEPTED';

CREATE TRIGGER trg_offer_accept_guard
BEFORE INSERT OR UPDATE OF status ON offer
FOR EACH ROW EXECUTE FUNCTION fn_offer_accept_guard();


CREATE OR REPLACE FUNCTION fn_offer_accept_cascade()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_cycle placement_cycle.cycle_id%TYPE;
    v_when  timestamptz := COALESCE(NEW.responded_at, now());
BEGIN
    SELECT cycle_id INTO v_cycle FROM job_role WHERE job_id = NEW.job_id;

    -- 1. decline the student's other pending offers in this cycle
    WITH declined AS (
        UPDATE offer o
           SET status = 'DECLINED',
               responded_at = GREATEST(v_when, o.offered_at)
          FROM job_role j
         WHERE j.job_id = o.job_id
           AND j.cycle_id = v_cycle
           AND o.student_id = NEW.student_id
           AND o.status = 'PENDING'
           AND o.offer_id <> NEW.offer_id
        RETURNING o.job_id
    )
    INSERT INTO placement_log (student_id, job_id, action, details, logged_at)
    SELECT NEW.student_id, d.job_id, 'AUTO_DECLINED',
           format('Offer declined automatically: offer %s (job %s) was accepted', NEW.offer_id, NEW.job_id),
           v_when
    FROM declined d;

    -- 2. withdraw the student's other open applications in this cycle
    WITH withdrawn AS (
        UPDATE application a
           SET status = 'WITHDRAWN',
               status_updated_at = GREATEST(v_when, a.applied_at)
          FROM job_role j
         WHERE j.job_id = a.job_id
           AND j.cycle_id = v_cycle
           AND a.student_id = NEW.student_id
           AND a.status IN ('APPLIED', 'SHORTLISTED')
        RETURNING a.job_id
    )
    INSERT INTO placement_log (student_id, job_id, action, details, logged_at)
    SELECT NEW.student_id, w.job_id, 'AUTO_WITHDRAWN',
           format('Application withdrawn automatically: offer %s (job %s) was accepted', NEW.offer_id, NEW.job_id),
           v_when
    FROM withdrawn w;

    -- 3. free every interview slot the student still holds for OTHER jobs in
    --    this cycle (withdrawn applications and declined offers alike)
    DELETE FROM interview i
     USING job_role j
     WHERE j.job_id     = i.job_id
       AND j.cycle_id   = v_cycle
       AND i.student_id = NEW.student_id
       AND i.job_id    <> NEW.job_id
       AND i.result     = 'SCHEDULED';

    -- 4. audit the acceptance itself
    INSERT INTO placement_log (student_id, job_id, action, details, logged_at)
    VALUES (NEW.student_id, NEW.job_id, 'OFFER_ACCEPTED',
            format('Offer %s accepted', NEW.offer_id), v_when);

    RETURN NULL;
END $$;

-- Two triggers: OLD does not exist for INSERT, so one WHEN clause can't serve both.
CREATE TRIGGER trg_offer_accept_cascade_upd
AFTER UPDATE OF status ON offer
FOR EACH ROW
WHEN (NEW.status = 'ACCEPTED' AND OLD.status <> 'ACCEPTED')
EXECUTE FUNCTION fn_offer_accept_cascade();

CREATE TRIGGER trg_offer_accept_cascade_ins
AFTER INSERT ON offer
FOR EACH ROW
WHEN (NEW.status = 'ACCEPTED')
EXECUTE FUNCTION fn_offer_accept_cascade();


-- =====================================================================
-- T4. BR-4  TOTAL SPECIALISATION OF job_role
--     Every job must have a row in internship_role or fulltime_role.
--     The check is DEFERRED to COMMIT: inside one transaction you insert
--     the job_role row first and its subtype row second.
--     (Disjointness is already guaranteed by the composite FKs in the DDL.)
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_check_job_has_subtype()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_job_id int;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_job_id := OLD.job_id;
    ELSE
        v_job_id := NEW.job_id;
    END IF;

    IF EXISTS     (SELECT 1 FROM job_role        WHERE job_id = v_job_id)
       AND NOT EXISTS (SELECT 1 FROM internship_role WHERE job_id = v_job_id)
       AND NOT EXISTS (SELECT 1 FROM fulltime_role   WHERE job_id = v_job_id) THEN
        RAISE EXCEPTION 'Job % has no internship_role or fulltime_role row (specialisation is total)', v_job_id
              USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_job_total_on_insert
AFTER INSERT ON job_role
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_check_job_has_subtype();

CREATE CONSTRAINT TRIGGER trg_job_total_on_intern_delete
AFTER DELETE ON internship_role
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_check_job_has_subtype();

CREATE CONSTRAINT TRIGGER trg_job_total_on_fulltime_delete
AFTER DELETE ON fulltime_role
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION fn_check_job_has_subtype();


-- =====================================================================
-- STORED ROUTINES
--     Applications call these with bound parameters. A parameter is
--     always treated as a value, never as SQL text, so it cannot be used
--     for SQL injection.
-- =====================================================================

-- P1. Apply for a job by roll number. T1 does the eligibility checks.
CREATE OR REPLACE FUNCTION fn_apply_for_job(p_roll_no VARCHAR, p_job_id INT)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE
    v_student_id student.person_id%TYPE;
    v_app_id     application.application_id%TYPE;
BEGIN
    SELECT person_id INTO v_student_id FROM student WHERE roll_no = p_roll_no;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No student with roll number %', p_roll_no;
    END IF;

    INSERT INTO application (student_id, job_id)
    VALUES (v_student_id, p_job_id)
    RETURNING application_id INTO v_app_id;

    RETURN v_app_id;
END $$;


-- P2. Accept an offer. The UPDATE fires T3, which does the cascade.
CREATE OR REPLACE PROCEDURE sp_accept_offer(p_offer_id INT)
LANGUAGE plpgsql AS $$
DECLARE
    v_student_id offer.student_id%TYPE;
    v_offer      offer%ROWTYPE;
    v_withdrawn  int;
    v_declined   int;
BEGIN
    SELECT student_id INTO v_student_id FROM offer WHERE offer_id = p_offer_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Offer % does not exist', p_offer_id;
    END IF;

    -- Lock order: student row FIRST, then the offer. Two sessions accepting
    -- offers for the same student queue on the student lock instead of
    -- each grabbing one offer and deadlocking in the cascade.
    PERFORM 1 FROM student WHERE person_id = v_student_id FOR UPDATE;

    -- Re-read under the lock: another session may have just changed it.
    SELECT * INTO v_offer FROM offer WHERE offer_id = p_offer_id FOR UPDATE;
    IF v_offer.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Offer % is %; only a PENDING offer can be accepted', p_offer_id, v_offer.status
              USING ERRCODE = 'check_violation';
    END IF;

    UPDATE offer
       SET status = 'ACCEPTED', responded_at = now()
     WHERE offer_id = p_offer_id;

    -- now() is fixed for the whole transaction, so these are exactly the
    -- log rows written by this acceptance.
    SELECT count(*) FILTER (WHERE action = 'AUTO_WITHDRAWN'),
           count(*) FILTER (WHERE action = 'AUTO_DECLINED')
      INTO v_withdrawn, v_declined
      FROM placement_log
     WHERE student_id = v_offer.student_id AND logged_at = now();

    RAISE NOTICE 'Offer % accepted: % application(s) withdrawn, % other offer(s) declined',
                 p_offer_id, v_withdrawn, v_declined;
END $$;


-- P3. Batch job: expire every pending offer whose deadline has passed.
CREATE OR REPLACE PROCEDURE sp_expire_stale_offers()
LANGUAGE plpgsql AS $$
DECLARE
    v_count int;
BEGIN
    WITH expired AS (
        UPDATE offer
           SET status = 'EXPIRED'
         WHERE status = 'PENDING' AND response_deadline < now()
        RETURNING student_id, job_id, offer_id
    )
    INSERT INTO placement_log (student_id, job_id, action, details)
    SELECT student_id, job_id, 'OFFER_EXPIRED', format('Offer %s expired unanswered', offer_id)
    FROM expired;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE '% offer(s) expired', v_count;
END $$;


-- =====================================================================
-- LEAST-PRIVILEGE ROLE (DCL)
--     The web UI's SQL-injection lab runs its deliberately unsafe query
--     as this role inside a READ ONLY transaction. Even a successful
--     injection can only read these two tables; it cannot write, drop,
--     or reach server files the way the postgres superuser could.
--     Roles are cluster-wide, so create it only if missing.
-- =====================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'placeiq_readonly') THEN
        CREATE ROLE placeiq_readonly NOLOGIN;
    END IF;
END $$;

GRANT USAGE  ON SCHEMA placeiq        TO placeiq_readonly;
GRANT SELECT ON placeiq.student,
                placeiq.person        TO placeiq_readonly;
