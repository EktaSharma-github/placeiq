-- =====================================================================
--  PlaceIQ  |  Phase 3c : Five advanced queries
--
--  Each query is labelled with:
--    BUSINESS QUESTION   what the placement committee wants to know
--    FDS CONCEPTS        what the query demonstrates
--    RELATIONAL ALGEBRA  where it adds insight
--
--  Q1  Aggregation + GROUP BY + HAVING with a scalar subquery  (selectivity)
--  Q2  Relational DIVISION with double NOT EXISTS              (talent match)
--  Q3  Window functions: DENSE_RANK, NTILE, AVG OVER           (CTC leaderboard)
--  Q4  CTE + generate_series + OUTER JOIN + running SUM OVER   (placement velocity)
--  Q5  Correlated subquery + LATERAL join over a VIEW          (hidden gems)
-- =====================================================================

SET search_path TO placeiq, public;


-- =====================================================================
-- Q1. WHICH RECRUITERS ARE THE HARDEST TO CRACK?
-- BUSINESS QUESTION
--   Among final-placement companies that have finished their process and
--   attracted at least 20 applicants, which ones make offers to a
--   SMALLER share of applicants than the campus-wide average? Students use
--   this to decide where to spend their preparation time.
-- FDS CONCEPTS
--   4-way join through a view, outer join (not every application has an
--   offer), aggregate FILTER, GROUP BY, HAVING that compares a group
--   aggregate with a scalar subquery.
-- RELATIONAL ALGEBRA (core)
--   γ company; count(*)→applicants, count(offer_id)→offers
--     ( Application ⟕ Offer ⋈ JobDetails )
--   then σ applicants ≥ 20 ∧ offers/applicants < avg_rate
-- =====================================================================

SELECT d.company_name,
       d.sector,
       count(*)                                                AS applicants,
       count(*) FILTER (WHERE iv.interviewed)                  AS interviewed,
       count(o.offer_id)                                       AS offers,
       count(o.offer_id) FILTER (WHERE o.status = 'ACCEPTED')  AS accepted,
       round(100.0 * count(o.offer_id) / count(*), 1)          AS offer_rate_pct
FROM application a
JOIN v_job_details d ON d.job_id = a.job_id
LEFT JOIN offer o    ON o.student_id = a.student_id AND o.job_id = a.job_id
LEFT JOIN LATERAL (SELECT TRUE AS interviewed
                   FROM interview i
                   WHERE i.student_id = a.student_id AND i.job_id = a.job_id
                   LIMIT 1) iv ON TRUE
WHERE d.cycle_type = 'FINAL'
  AND EXISTS (SELECT 1 FROM offer x WHERE x.job_id = a.job_id)        -- process complete
GROUP BY d.company_id, d.company_name, d.sector
HAVING count(*) >= 20
   AND count(o.offer_id)::numeric / count(*) <
       (SELECT count(o2.offer_id)::numeric / count(*)                 -- campus-wide offer rate
        FROM application a2
        JOIN job_role j2 ON j2.job_id = a2.job_id
        LEFT JOIN offer o2 ON o2.student_id = a2.student_id AND o2.job_id = a2.job_id
        WHERE j2.cycle_id = 2
          AND EXISTS (SELECT 1 FROM offer x WHERE x.job_id = a2.job_id))
ORDER BY offer_rate_pct;


-- =====================================================================
-- Q2. TALENT MATCH FOR A NEWLY POSTED JOB  (relational division)
-- BUSINESS QUESTION
--   Job 25 (Tidewater Logistics, Supply Chain Analytics Lead) has just
--   been posted. Which students are eligible, not yet placed this cycle,
--   and hold EVERY skill the job requires at the required level? The
--   committee will nudge them to apply.
-- FDS CONCEPTS
--   Division expressed as "there is NO required skill that the student
--   does NOT have" (double NOT EXISTS, two nested correlated subqueries),
--   plus an anti-join for "not yet placed".
-- RELATIONAL ALGEBRA
--   Qualified(student, skill) = π student,skill (σ proficiency ≥ min (StudentSkill ⋈ JobRequiredSkill_25))
--   Result = Qualified ÷ π skill (σ job_id = 25 (JobRequiredSkill))
-- =====================================================================

WITH params AS (SELECT 25 AS job_id)
SELECT s.roll_no,
       concat_ws(' ', p.first_name, p.last_name) AS student_name,
       pr.program_code,
       s.cgpa
FROM params
JOIN eligibility e ON e.job_id = params.job_id
JOIN student s     ON s.program_id = e.program_id
JOIN person p      ON p.person_id = s.person_id
JOIN program pr    ON pr.program_id = s.program_id
WHERE s.cgpa >= e.min_cgpa
  AND s.active_backlogs <= e.max_backlogs
  AND NOT s.opted_out
  -- division: no required skill exists ...
  AND NOT EXISTS (
        SELECT 1
        FROM job_required_skill r
        WHERE r.job_id = params.job_id
          -- ... that this student lacks at the required level
          AND NOT EXISTS (
                SELECT 1
                FROM student_skill ss
                WHERE ss.student_id  = s.person_id
                  AND ss.skill_id    = r.skill_id
                  AND ss.proficiency >= r.min_proficiency))
  -- anti-join: not already placed in this job's cycle
  AND NOT EXISTS (
        SELECT 1
        FROM offer o
        JOIN job_role j  ON j.job_id = o.job_id
        JOIN job_role jt ON jt.job_id = params.job_id
        WHERE o.student_id = s.person_id
          AND o.status = 'ACCEPTED'
          AND j.cycle_id = jt.cycle_id)
ORDER BY s.cgpa DESC;

-- Q2 (alternative, for Q&A): division by COUNTING. Same answer for the
-- skill condition. A student qualifies if the number of required skills
-- they meet equals the number of skills the job requires.
--
-- SELECT ss.student_id
-- FROM job_required_skill r
-- JOIN student_skill ss ON ss.skill_id = r.skill_id AND ss.proficiency >= r.min_proficiency
-- WHERE r.job_id = 25
-- GROUP BY ss.student_id
-- HAVING count(*) = (SELECT count(*) FROM job_required_skill WHERE job_id = 25);


-- =====================================================================
-- Q3. FINAL-PLACEMENT CTC LEADERBOARD BY PROGRAM  (window functions)
-- BUSINESS QUESTION
--   For each program, who are the top 3 earners in final placements so
--   far, how far above their program's average are they, and which pay
--   quartile are they in? This feeds the placement report.
-- FDS CONCEPTS
--   Query over a VIEW (v_placement_status, a derived attribute); a named
--   WINDOW with PARTITION BY + ORDER BY; DENSE_RANK (ties share a rank,
--   no gaps), NTILE, AVG() OVER (aggregates without collapsing rows);
--   a subquery to filter on a window result (WHERE cannot see it directly).
-- Q&A NOTE
--   DENSE_RANK gives tied CTCs the same rank; NTILE does not. It deals rows
--   into 4 equal buckets, so two students with the same CTC can land in
--   different quartiles. Use PERCENT_RANK() if ties must stay together.
-- =====================================================================

SELECT program_code, rank_in_program, roll_no, student_name, placed_with, ctc_lpa,
       program_avg_ctc, above_avg_by, pay_quartile, placed_in_program
FROM (
    SELECT program_code,
           roll_no,
           student_name,
           placed_with,
           ctc_lpa,
           DENSE_RANK() OVER w                                           AS rank_in_program,
           round(AVG(ctc_lpa) OVER (PARTITION BY program_code), 2)       AS program_avg_ctc,
           round(ctc_lpa - AVG(ctc_lpa) OVER (PARTITION BY program_code), 2) AS above_avg_by,
           NTILE(4) OVER w                                               AS pay_quartile,
           COUNT(*) OVER (PARTITION BY program_code)                     AS placed_in_program
    FROM v_placement_status
    WHERE cycle_id = 2 AND placement_status = 'PLACED'
    WINDOW w AS (PARTITION BY program_code ORDER BY ctc_lpa DESC)
) ranked
WHERE rank_in_program <= 3
ORDER BY program_code, rank_in_program, roll_no;


-- =====================================================================
-- Q4. PLACEMENT VELOCITY: DAY-BY-DAY CUMULATIVE PROGRESS
-- BUSINESS QUESTION
--   During final placements, how many students from each program
--   accepted an offer each day, and what share of each batch is placed
--   by the end of each day? (The committee's daily progress chart.)
-- FDS CONCEPTS
--   Multiple CTEs; generate_series to build a calendar (so days with
--   zero placements still appear); CROSS JOIN calendar x program;
--   LEFT OUTER JOIN to the facts; running total with
--   SUM() OVER (PARTITION BY ... ORDER BY ...).
-- =====================================================================

WITH calendar AS (
    SELECT d::date AS day
    FROM generate_series(DATE '2026-10-18', DATE '2026-10-28', INTERVAL '1 day') AS d
),
batch AS (
    SELECT pr.program_id, pr.program_code,
           count(*) FILTER (WHERE NOT s.opted_out) AS batch_size
    FROM program pr JOIN student s ON s.program_id = pr.program_id
    GROUP BY pr.program_id, pr.program_code
),
daily AS (
    SELECT s.program_id,
           (o.responded_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           count(*) AS accepted
    FROM offer o
    JOIN job_role j ON j.job_id = o.job_id
    JOIN student s  ON s.person_id = o.student_id
    WHERE j.cycle_id = 2 AND o.status = 'ACCEPTED'
    GROUP BY s.program_id, (o.responded_at AT TIME ZONE 'Asia/Kolkata')::date
)
SELECT c.day,
       b.program_code,
       COALESCE(dl.accepted, 0)                                         AS placed_today,
       SUM(COALESCE(dl.accepted, 0)) OVER run                           AS placed_cumulative,
       b.batch_size,
       round(100.0 * SUM(COALESCE(dl.accepted, 0)) OVER run / b.batch_size, 1) AS pct_batch_placed
FROM calendar c
CROSS JOIN batch b
LEFT JOIN daily dl ON dl.program_id = b.program_id AND dl.day = c.day
WINDOW run AS (PARTITION BY b.program_id ORDER BY c.day)
ORDER BY b.program_code, c.day;


-- =====================================================================
-- Q5. HIDDEN GEMS: STRONG ACADEMICS, LOST IN THE INTERVIEW ROOM
-- BUSINESS QUESTION
--   Which students are still unplaced in final placements even though, at
--   a company that rejected them in an interview round, their CGPA was
--   HIGHER than the average CGPA of the students that company selected?
--   These students need interview coaching, not academic help, and the
--   failed round says which kind.
-- FDS CONCEPTS
--   Correlated subquery (re-evaluated for each application row) used both
--   in SELECT and in WHERE; LATERAL join to find the eliminating round;
--   join on a composite key (job_id, round_no); built on a VIEW.
-- =====================================================================

SELECT ps.roll_no,
       ps.student_name,
       ps.program_code,
       ps.cgpa,
       d.company_name,
       elim.round_no || ' - ' || elim.round_type || ' (' || elim.result || ')' AS eliminated_in,
       (SELECT round(avg(s2.cgpa), 2)
        FROM offer o2 JOIN student s2 ON s2.person_id = o2.student_id
        WHERE o2.job_id = a.job_id)                                        AS selected_avg_cgpa
FROM v_placement_status ps
JOIN application a   ON a.student_id = ps.student_id AND a.status = 'REJECTED'
JOIN v_job_details d ON d.job_id = a.job_id AND d.cycle_id = ps.cycle_id
JOIN LATERAL (
        SELECT i.round_no, r.round_type, i.result
        FROM interview i
        JOIN interview_round r ON r.job_id = i.job_id AND r.round_no = i.round_no
        WHERE i.student_id = a.student_id AND i.job_id = a.job_id
          AND i.result IN ('NOT_CLEARED', 'ABSENT')) elim ON TRUE
WHERE ps.cycle_id = 2
  AND ps.placement_status IN ('UNPLACED', 'IN_PROCESS')
  AND ps.cgpa > (SELECT avg(s2.cgpa)                                       -- correlated on a.job_id
                 FROM offer o2 JOIN student s2 ON s2.person_id = o2.student_id
                 WHERE o2.job_id = a.job_id)
ORDER BY ps.cgpa DESC, d.company_name;
