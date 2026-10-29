-- =====================================================================
--  PlaceIQ  |  Phase 4 : Analytics layer  (SQL statistics + features)
--
--  The DBMS does the first pass of analytics: descriptive statistics,
--  distributions and cross-tabs are answered by queries, so the whole
--  table never has to be loaded into memory. Only the final, small
--  feature matrix (one row per student) leaves the database, for
--  k-means clustering in analytics/placeiq_kmeans.ipynb. The cluster
--  labels are then written back to the table STUDENT_SEGMENT and
--  analysed with SQL again (S1, S2 at the end).
--
--  Each query is labelled with:
--    BUSINESS QUESTION   what the placement committee wants to know
--    FDS CONCEPTS        what the query demonstrates
--    RELATIONAL ALGEBRA  the core expression
--
--  A1  Descriptive statistics of CGPA by program  (mean, median, mode, SD, quartiles)
--  A2  CGPA band x placement outcome cross-tab     (histogram with width_bucket)
--  A3  Hiring funnel by program                    (conditional aggregation)
--  A4  Skill supply vs demand gap                  (two aggregates joined)
--  A5  Salary statistics of accepted offers        (percentiles over a view)
--  F   Feature view V_STUDENT_FEATURES             (feature engineering in SQL)
--  S   Segment table + profile view + S1, S2       (clusters back in the DB)
--
--  Run after 02-04:  psql -U postgres -h localhost -d placeiq -f 07_analytics.sql
--  Re-run           : safe; views are recreated, segment tables kept.
-- =====================================================================

SET search_path TO placeiq, public;


-- =====================================================================
-- A1. WHAT DOES THE CGPA DISTRIBUTION LOOK LIKE IN EACH PROGRAM?
-- BUSINESS QUESTION
--   Recruiters set CGPA cut-offs. Before agreeing to one, the committee
--   needs the centre, spread and quartiles of CGPA for each program.
-- FDS CONCEPTS
--   Aggregate functions, ordered-set aggregates (percentile_cont, mode),
--   GROUP BY ROLLUP for a grand-total row.
-- RELATIONAL ALGEBRA
--   γ program_code; count(*), avg(cgpa), stddev(cgpa), ... ( Student ⋈ Program )
-- =====================================================================

SELECT coalesce(p.program_code, 'ALL')                                        AS program,
       count(*)                                                               AS n,
       round(avg(s.cgpa), 2)                                                  AS mean,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY s.cgpa)::numeric, 2) AS median,
       (mode() WITHIN GROUP (ORDER BY round(s.cgpa * 2) / 2))::numeric(3,1)   AS mode_half_pt,
       round(stddev_samp(s.cgpa), 2)                                          AS sd,
       min(s.cgpa)                                                            AS min,
       round(percentile_cont(0.25) WITHIN GROUP (ORDER BY s.cgpa)::numeric, 2) AS q1,
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY s.cgpa)::numeric, 2) AS q3,
       max(s.cgpa)                                                            AS max
FROM student s
JOIN program p ON p.program_id = s.program_id
GROUP BY ROLLUP (p.program_code)
ORDER BY p.program_code NULLS LAST;


-- =====================================================================
-- A2. DOES CGPA DRIVE PLACEMENT?  (CGPA band x outcome)
-- BUSINESS QUESTION
--   "How many students have a CGPA between 7 and 8, and how many of them
--   got placed?" -- for every band. If the placement rate climbs steeply
--   with CGPA, CGPA is a strong feature; if not, something else matters.
-- FDS CONCEPTS
--   width_bucket for a histogram, LEFT JOIN to a view (students with no
--   placement row still count), aggregate FILTER, derived percentage.
-- RELATIONAL ALGEBRA
--   γ band; count(*), count(σ status='PLACED')
--     ( Student ⟕ σ cycle_type='FINAL' (PlacementStatus) )
-- =====================================================================

WITH final_status AS (
    SELECT v.student_id, v.placement_status, v.ctc_lpa
    FROM v_placement_status v
    JOIN placement_cycle pc ON pc.cycle_id = v.cycle_id
    WHERE pc.cycle_type = 'FINAL'
)
SELECT width_bucket(s.cgpa, 6.0, 10.0, 4)                              AS band_no,
       to_char(6.0 + (width_bucket(s.cgpa, 6.0, 10.0, 4) - 1), 'FM9.0') || ' - ' ||
       to_char(6.0 +  width_bucket(s.cgpa, 6.0, 10.0, 4),      'FM90.0') AS cgpa_band,
       count(*)                                                        AS students,
       count(*) FILTER (WHERE f.placement_status = 'PLACED')           AS placed,
       round(100.0 * count(*) FILTER (WHERE f.placement_status = 'PLACED') / count(*), 1)
                                                                       AS placed_pct,
       round(avg(f.ctc_lpa), 2)                                        AS avg_ctc_lpa
FROM student s
LEFT JOIN final_status f ON f.student_id = s.person_id
WHERE NOT s.opted_out
GROUP BY band_no, cgpa_band
ORDER BY band_no;


-- =====================================================================
-- A3. WHERE DO STUDENTS DROP OUT OF THE HIRING FUNNEL?
-- BUSINESS QUESTION
--   For each program: of all applications, how many reached an interview,
--   how many got an offer, and how many offers were accepted? A low
--   applied-to-interview ratio points at CVs; a low interview-to-offer
--   ratio points at interview preparation.
-- FDS CONCEPTS
--   Conditional aggregation with FILTER, EXISTS inside FILTER, outer join.
-- RELATIONAL ALGEBRA
--   γ program; count(*), count(σ ∃interview), count(offer_id), ...
--     ( Application ⋈ Student ⋈ Program ⟕ Offer )
-- =====================================================================

SELECT p.program_code,
       count(*)                                                       AS applications,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM interview i
                                      WHERE i.student_id = a.student_id
                                        AND i.job_id     = a.job_id)) AS interviewed,
       count(o.offer_id)                                              AS offers,
       count(o.offer_id) FILTER (WHERE o.status = 'ACCEPTED')         AS accepted,
       round(100.0 * count(o.offer_id) / count(*), 1)                 AS app_to_offer_pct
FROM application a
JOIN student s  ON s.person_id = a.student_id
JOIN program p  ON p.program_id = s.program_id
LEFT JOIN offer o ON o.student_id = a.student_id AND o.job_id = a.job_id
GROUP BY p.program_code
ORDER BY app_to_offer_pct DESC;


-- =====================================================================
-- A4. WHICH SKILLS ARE IN SHORT SUPPLY?
-- BUSINESS QUESTION
--   For each skill: how many jobs ask for it, and how many students hold
--   it at proficiency 3 or more? Skills with many jobs per qualified
--   student are where the committee should run workshops.
-- FDS CONCEPTS
--   Two independent aggregates joined on the key they share, LEFT JOINs
--   so a skill nobody asks for still appears, NULLIF to avoid /0.
-- RELATIONAL ALGEBRA
--   Demand = γ skill_id; count(job_id) (JobRequiredSkill)
--   Supply = γ skill_id; count(student_id) (σ proficiency ≥ 3 (StudentSkill))
--   Result = Skill ⟕ Demand ⟕ Supply
-- =====================================================================

SELECT sk.skill_name,
       coalesce(d.jobs, 0)                                          AS jobs_requiring,
       coalesce(su.students, 0)                                     AS students_proficient,
       round(coalesce(d.jobs, 0)::numeric / NULLIF(su.students, 0), 3) AS jobs_per_student
FROM skill sk
LEFT JOIN (SELECT skill_id, count(*) AS jobs
           FROM job_required_skill GROUP BY skill_id) d  ON d.skill_id  = sk.skill_id
LEFT JOIN (SELECT skill_id, count(*) AS students
           FROM student_skill WHERE proficiency >= 3
           GROUP BY skill_id)                         su ON su.skill_id = sk.skill_id
ORDER BY jobs_per_student DESC NULLS LAST;


-- =====================================================================
-- A5. WHAT DO PLACED STUDENTS EARN?
-- BUSINESS QUESTION
--   Mean, median and spread of CTC for accepted full-time offers, by
--   program. The median is what the placement brochure should quote,
--   because a few very high offers pull the mean up.
-- FDS CONCEPTS
--   Aggregates over a view that hides the specialization join
--   (Job -> Full-time), percentile_cont, stddev, mean vs median.
-- RELATIONAL ALGEBRA
--   γ program; avg(ctc), median(ctc), ...
--     ( σ status='ACCEPTED' ∧ role_type='FULLTIME' (Offer ⋈ JobDetails) ⋈ Student ⋈ Program )
-- =====================================================================

SELECT coalesce(p.program_code, 'ALL')                                        AS program,
       count(*)                                                               AS accepted_offers,
       round(avg(d.ctc_lpa), 2)                                               AS mean_ctc,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ctc_lpa)::numeric, 2) AS median_ctc,
       round(stddev_samp(d.ctc_lpa), 2)                                       AS sd_ctc,
       min(d.ctc_lpa)                                                         AS min_ctc,
       max(d.ctc_lpa)                                                         AS max_ctc
FROM offer o
JOIN v_job_details d ON d.job_id = o.job_id
JOIN student s       ON s.person_id = o.student_id
JOIN program p       ON p.program_id = s.program_id
WHERE o.status = 'ACCEPTED' AND d.role_type = 'FULLTIME'
GROUP BY ROLLUP (p.program_code)
ORDER BY p.program_code NULLS LAST;


-- =====================================================================
-- F. FEATURE ENGINEERING:  V_STUDENT_FEATURES
--   One row per student who is in the placement process (not opted out).
--   Every column is computed from the normalized tables, so the features
--   are always consistent with the data; no spreadsheet copy is kept.
--
--   PROFILE features (the inputs to k-means: what a student brings)
--     cgpa             academic record
--     tech_score       sum of proficiency over technical skills
--                      (Python, SQL, R, ML, Statistics, Big Data, Tableau)
--     biz_score        sum of proficiency over business skills
--                      (Excel, Financial Modelling, Case Solving,
--                       Communication, Product Management)
--     applications     how actively the student applies
--     interview_rate   share of applications that reached an interview
--
--   OUTCOME columns (NOT used for clustering; used to judge the segments)
--     offers, accepted_offer (any cycle: summer or final),
--     best_ctc_lpa (full-time offers only), avg_interview_score
--
--   Why profile and outcome are kept apart: if offers were a clustering
--   input, "students with many offers do well" would be circular. We
--   cluster on what the committee can see early in the year, then check
--   whether the segments differ in outcomes.
--
-- RELATIONAL ALGEBRA (shape)
--   σ ¬opted_out (Student) ⋈ Program
--     ⟕ γ student; Σ proficiency (StudentSkill ⋈ Skill)
--     ⟕ γ student; count(*) (Application)
--     ⟕ γ student; avg(score) (Interview)
--     ⟕ γ student; count(*), max(ctc) (Offer ⟕ FulltimeRole)
-- =====================================================================

-- Dropped first because CREATE OR REPLACE VIEW cannot rename or remove columns.
DROP VIEW IF EXISTS v_segment_profile, v_student_features;

CREATE VIEW v_student_features AS
WITH skills AS (
    SELECT ss.student_id,
           sum(ss.proficiency) FILTER (WHERE sk.skill_name IN
               ('Python', 'SQL', 'R', 'Machine Learning', 'Statistics', 'Big Data', 'Tableau'))   AS tech_score,
           sum(ss.proficiency) FILTER (WHERE sk.skill_name IN
               ('Excel', 'Financial Modelling', 'Case Solving', 'Communication', 'Product Management')) AS biz_score
    FROM student_skill ss
    JOIN skill sk ON sk.skill_id = ss.skill_id
    GROUP BY ss.student_id
),
apps AS (
    SELECT a.student_id,
           count(*) AS applications,
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM interview i
                                          WHERE i.student_id = a.student_id
                                            AND i.job_id     = a.job_id)) AS interviewed
    FROM application a
    GROUP BY a.student_id
),
interviews AS (
    SELECT student_id, avg(score) AS avg_score
    FROM interview
    WHERE score IS NOT NULL
    GROUP BY student_id
),
offers AS (
    SELECT o.student_id,
           count(*)                                    AS offers,
           bool_or(o.status = 'ACCEPTED')              AS accepted_offer,
           max(f.ctc_lpa)                              AS best_ctc_lpa
    FROM offer o
    LEFT JOIN fulltime_role f ON f.job_id = o.job_id
    GROUP BY o.student_id
)
SELECT s.person_id                                                    AS student_id,
       s.roll_no,
       p.program_code,
       -- profile features
       s.cgpa,
       coalesce(sk.tech_score, 0)::int                                AS tech_score,
       coalesce(sk.biz_score, 0)::int                                 AS biz_score,
       coalesce(ap.applications, 0)::int                              AS applications,
       round(coalesce(ap.interviewed::numeric / NULLIF(ap.applications, 0), 0), 3)
                                                                      AS interview_rate,
       -- outcomes
       coalesce(o.offers, 0)::int                                     AS offers,
       coalesce(o.accepted_offer, FALSE)                              AS accepted_offer,
       o.best_ctc_lpa,
       round(iv.avg_score, 1)                                         AS avg_interview_score
FROM student s
JOIN program p          ON p.program_id  = s.program_id
LEFT JOIN skills sk     ON sk.student_id = s.person_id
LEFT JOIN apps ap       ON ap.student_id = s.person_id
LEFT JOIN interviews iv ON iv.student_id = s.person_id
LEFT JOIN offers o      ON o.student_id  = s.person_id
WHERE NOT s.opted_out;


-- =====================================================================
-- S. SEGMENTS: k-means labels stored back in the database
--   The notebook fills SEGMENT (one row per cluster) and STUDENT_SEGMENT
--   (one row per student). Keeping the labels in tables, not a CSV, means
--   any query can join on them, and the FKs guarantee every label belongs
--   to a real student and a real segment.
--   The name lives in SEGMENT, not STUDENT_SEGMENT: segment -> segment_name
--   would otherwise be a dependency on a non-key, breaking BCNF.
-- =====================================================================

CREATE TABLE IF NOT EXISTS segment (
    segment      smallint    PRIMARY KEY CHECK (segment >= 0),
    segment_name varchar(40) NOT NULL UNIQUE,
    description  text        NOT NULL
);

CREATE TABLE IF NOT EXISTS student_segment (
    student_id   integer     PRIMARY KEY REFERENCES student (person_id) ON DELETE CASCADE,
    segment      smallint    NOT NULL REFERENCES segment (segment) ON DELETE CASCADE,
    assigned_at  timestamptz NOT NULL DEFAULT now()
);

-- Every FK gets an index (project convention, test TC-SCH-04): joins on
-- segment and ON DELETE CASCADE from SEGMENT must not scan the whole table.
CREATE INDEX IF NOT EXISTS idx_student_segment_segment ON student_segment (segment);

-- Profile of each segment: the "interpret the clusters" table.
-- RELATIONAL ALGEBRA
--   γ segment, segment_name; count(*), avg(cgpa), ..., avg(offers)
--     ( Segment ⋈ StudentSegment ⋈ StudentFeatures )
CREATE VIEW v_segment_profile AS
SELECT g.segment,
       sg.segment_name,
       count(*)                                                     AS students,
       round(avg(f.cgpa), 2)                                        AS avg_cgpa,
       round(avg(f.tech_score), 1)                                  AS avg_tech,
       round(avg(f.biz_score), 1)                                   AS avg_biz,
       round(avg(f.applications), 1)                                AS avg_apps,
       round(avg(f.interview_rate), 2)                              AS avg_interview_rate,
       round(avg(f.offers), 2)                                      AS avg_offers,
       round(100.0 * count(*) FILTER (WHERE f.accepted_offer) / count(*), 1) AS accepted_pct,
       round(avg(f.best_ctc_lpa), 2)                                AS avg_best_ctc
FROM student_segment g
JOIN segment sg           ON sg.segment = g.segment
JOIN v_student_features f ON f.student_id = g.student_id
GROUP BY g.segment, sg.segment_name;


-- The two queries below return rows only after the notebook has run.

-- =====================================================================
-- S1. HOW IS EACH PROGRAM SPREAD ACROSS THE SEGMENTS?
-- BUSINESS QUESTION
--   Are segments just programs in disguise, or does each program contain
--   several kinds of students? Mixed programs mean a program-level policy
--   (one workshop for all PGP students) misses part of the cohort.
-- FDS CONCEPTS
--   Join of a table written by an external tool, GROUP BY two columns,
--   window function (share within program).
-- RELATIONAL ALGEBRA
--   γ program_code, segment_name; count(*)
--     ( Segment ⋈ StudentSegment ⋈ StudentFeatures )
-- =====================================================================

SELECT f.program_code,
       sg.segment_name,
       count(*)                                                                 AS students,
       round(100.0 * count(*) / sum(count(*)) OVER (PARTITION BY f.program_code), 1) AS pct_of_program
FROM student_segment g
JOIN segment sg           ON sg.segment = g.segment
JOIN v_student_features f ON f.student_id = g.student_id
GROUP BY f.program_code, sg.segment_name
ORDER BY f.program_code, students DESC;


-- =====================================================================
-- S2. WHO NEEDS HELP NOW?
-- BUSINESS QUESTION
--   Students without an accepted offer in every segment whose acceptance
--   rate is below the campus average, with a suggested action, so the
--   committee can contact them this week.
-- FDS CONCEPTS
--   Nested subqueries (IN over a view, compared with a scalar aggregate),
--   join with the segment lookup, CASE to derive a recommendation.
-- RELATIONAL ALGEBRA
--   Weak = π segment ( σ accepted_pct < avg_rate (SegmentProfile) )
--   π roll_no, ... ( σ ¬accepted_offer ( StudentSegment ⋉ Weak ⋈ Segment ⋈ StudentFeatures ) )
-- =====================================================================

SELECT sg.segment_name,
       f.roll_no,
       f.program_code,
       f.cgpa,
       f.tech_score,
       f.biz_score,
       f.applications,
       f.interview_rate,
       CASE
           WHEN f.applications < 3          THEN 'Apply to more roles'
           WHEN f.interview_rate < 0.4      THEN 'CV review'
           WHEN f.tech_score < f.biz_score  THEN 'Technical skills workshop'
           ELSE                                  'Mock interviews'
       END AS suggested_action
FROM student_segment g
JOIN segment sg           ON sg.segment = g.segment
JOIN v_student_features f ON f.student_id = g.student_id
WHERE NOT f.accepted_offer
  AND g.segment IN (SELECT segment FROM v_segment_profile
                    WHERE accepted_pct < (SELECT 100.0 * avg(accepted_offer::int)
                                          FROM v_student_features))
ORDER BY sg.segment_name, f.applications, f.cgpa;
