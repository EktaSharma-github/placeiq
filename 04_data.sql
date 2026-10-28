-- =====================================================================
--  PlaceIQ  |  Phase 3b : Mock data
--
--  Run after 03_logic.sql. The whole load is ONE transaction: if any row
--  breaks a constraint or trigger, nothing is loaded.
--
--  Part A  reference data, hand-written INSERTs (readable on a slide)
--  Part B  180 students and their skills, generated set-based
--  Part C  applications, generated, each one checked by the T1 trigger
--  Part D  recruitment simulation: shortlist -> rounds -> offers ->
--          accept / decline, driven through the real triggers
--
--  All company and person names are fictional. setseed() makes the
--  "random" data identical on every run, so query outputs on the slides
--  stay reproducible.
--
--  Story as of 28 Oct 2026:
--    Summer placements 2026-27 (Aug 2026)       complete
--    Final placements, jobs 11-20 (18-27 Oct)   interviews done, offers out
--    Final placements, jobs 21-24 (1-4 Dec)     shortlisted, round 1 scheduled
--    Final placements, job 25                   just posted, applications open
--    Lateral placements 2026-27                 no jobs yet
-- =====================================================================

SET search_path TO placeiq, public;

BEGIN;

SELECT setseed(0.2026);


-- =====================================================================
-- PART A. REFERENCE DATA
-- =====================================================================

INSERT INTO program (program_id, program_code, program_name, duration_months) VALUES
    (1, 'PGDBA', 'Post Graduate Diploma in Business Analytics',  24),
    (2, 'PGP',   'Post Graduate Programme in Management',        24),
    (3, 'PGPEX', 'Post Graduate Programme for Executives',       12);

INSERT INTO placement_cycle (cycle_id, cycle_name, cycle_type, academic_year, start_date, end_date) VALUES
    (1, 'Summer Placements 2026-27',  'SUMMER',  '2026-27', '2026-07-01', '2026-09-30'),
    (2, 'Final Placements 2026-27',   'FINAL',   '2026-27', '2026-10-01', '2027-01-31'),
    (3, 'Lateral Placements 2026-27', 'LATERAL', '2026-27', '2027-01-15', '2027-03-31');

INSERT INTO skill (skill_id, skill_name) VALUES
    (1, 'Python'), (2, 'SQL'), (3, 'R'), (4, 'Excel'), (5, 'Tableau'), (6, 'Machine Learning'),
    (7, 'Statistics'), (8, 'Financial Modelling'), (9, 'Case Solving'), (10, 'Communication'),
    (11, 'Product Management'), (12, 'Big Data');

-- Category (union type): 3 company sponsors, 2 alumni sponsors.
INSERT INTO sponsor (sponsor_id, sponsor_type) VALUES
    (1, 'COMPANY'), (2, 'COMPANY'), (3, 'COMPANY'), (4, 'ALUMNUS'), (5, 'ALUMNUS');

INSERT INTO company (company_id, company_name, sector, hq_city, website, sponsor_id) VALUES
    ( 1, 'Northbridge Consulting',     'CONSULTING',    'Mumbai',    'https://northbridge.example.com', 1),
    ( 2, 'Arcadia Strategy Partners',  'CONSULTING',    'Gurugram',  'https://arcadia.example.com',     NULL),
    ( 3, 'Kestrel Capital',            'BFSI',          'Mumbai',    'https://kestrel.example.com',     2),
    ( 4, 'Vertex Bank',                'BFSI',          'Mumbai',    'https://vertexbank.example.com',  NULL),
    ( 5, 'Meridian Insurance',         'BFSI',          'Pune',      'https://meridian.example.com',    NULL),
    ( 6, 'Lumen Technologies',         'TECHNOLOGY',    'Bengaluru', 'https://lumen.example.com',       NULL),
    ( 7, 'Quanta Cloud',               'TECHNOLOGY',    'Hyderabad', 'https://quanta.example.com',      NULL),
    ( 8, 'Helix Analytics',            'ANALYTICS',     'Bengaluru', 'https://helix.example.com',       3),
    ( 9, 'DataSutra Labs',             'ANALYTICS',     'Kolkata',   'https://datasutra.example.com',   NULL),
    (10, 'Saffron Consumer Goods',     'FMCG',          'Kolkata',   'https://saffron.example.com',     NULL),
    (11, 'Monsoon Foods',              'FMCG',          'Mumbai',    'https://monsoon.example.com',     NULL),
    (12, 'Cartwheel Commerce',         'E-COMMERCE',    'Bengaluru', 'https://cartwheel.example.com',   NULL),
    (13, 'Bazaarline',                 'E-COMMERCE',    'Gurugram',  'https://bazaarline.example.com',  NULL),
    (14, 'Ironleaf Manufacturing',     'MANUFACTURING', 'Chennai',   'https://ironleaf.example.com',    NULL),
    (15, 'Orbit Mobility',             'OTHER',         'Pune',      'https://orbit.example.com',       NULL),
    (16, 'Tidewater Logistics',        'OTHER',         'Chennai',   'https://tidewater.example.com',   NULL);

-- Person ids:  1-20 recruiters | 21-30 alumni | 31 faculty placement chair
--              101-280 students (Part B)
INSERT INTO person (person_id, first_name, last_name, email, phone) VALUES
    ( 1, 'Ananya',   'Kapoor',    'ananya.kapoor@northbridge.example.com',  '+919810000001'),
    ( 2, 'Rohit',    'Malhotra',  'rohit.malhotra@northbridge.example.com', '+919810000002'),
    ( 3, 'Sunita',   'Rao',       'sunita.rao@arcadia.example.com',         '+919810000003'),
    ( 4, 'Vikram',   'Sethi',     'vikram.sethi@kestrel.example.com',       '+919810000004'),
    ( 5, 'Neeraj',   'Bhatia',    'neeraj.bhatia@kestrel.example.com',      '+919810000005'),
    ( 6, 'Farah',    'Qureshi',   'farah.qureshi@vertexbank.example.com',   '+919810000006'),
    ( 7, 'Anil',     'Deshpande', 'anil.deshpande@meridian.example.com',    '+919810000007'),
    ( 8, 'Kiran',    'Shetty',    'kiran.shetty@lumen.example.com',         '+919810000008'),
    ( 9, 'Maya',     'Fernandes', 'maya.fernandes@lumen.example.com',       '+919810000009'),
    (10, 'Harsh',    'Vardhan',   'harsh.vardhan@quanta.example.com',       '+919810000010'),
    (11, 'Leela',    'Krishnan',  'leela.krishnan@helix.example.com',       '+919810000011'),
    (12, 'Sourav',   'Dutta',     'sourav.dutta@datasutra.example.com',     '+919810000012'),
    (13, 'Ritu',     'Basu',      'ritu.basu@saffron.example.com',          '+919810000013'),
    (14, 'Imran',    'Sheikh',    'imran.sheikh@monsoon.example.com',       '+919810000014'),
    (15, 'Aditya',   'Hegde',     'aditya.hegde@cartwheel.example.com',     '+919810000015'),
    (16, 'Nisha',    'Thomas',    'nisha.thomas@cartwheel.example.com',     '+919810000016'),
    (17, 'Kunal',    'Arora',     'kunal.arora@bazaarline.example.com',     '+919810000017'),
    (18, 'Revathi',  'Subramani', 'revathi.subramani@ironleaf.example.com', '+919810000018'),
    (19, 'Omkar',    'Kulkarni',  'omkar.kulkarni@orbit.example.com',       '+919810000019'),
    (20, 'Joseph',   'Mathew',    'joseph.mathew@tidewater.example.com',    '+919810000020'),
    (21, 'Arnab',    'Sinha',     'arnab.sinha@alumni.iimc.example',        '+919830000021'),
    (22, 'Payal',    'Chopra',    'payal.chopra@alumni.iimc.example',       '+919830000022'),
    (23, 'Rajat',    'Bansal',    'rajat.bansal@alumni.iimc.example',       '+919830000023'),
    (24, 'Shalini',  'Mitra',     'shalini.mitra@alumni.iimc.example',      '+919830000024'),
    (25, 'Debashis', 'Pal',       'debashis.pal@alumni.iimc.example',       '+919830000025'),
    (26, 'Kavita',   'Iyengar',   'kavita.iyengar@alumni.iimc.example',     '+919830000026'),
    (27, 'Sameer',   'Kohli',     'sameer.kohli@alumni.iimc.example',       '+919830000027'),
    (28, 'Tanya',    'Grover',    'tanya.grover@alumni.iimc.example',       '+919830000028'),
    (29, 'Abhijit',  'Sarkar',    'abhijit.sarkar@alumni.iimc.example',     '+919830000029'),
    (30, 'Nandini',  'Venkat',    'nandini.venkat@alumni.iimc.example',     '+919830000030'),
    (31, 'Partha',   'Lahiri',    'partha.lahiri@faculty.iimc.example',     '+919830000031');

INSERT INTO recruiter (person_id, company_id, designation) VALUES
    ( 1,  1, 'Partner'),              ( 2,  1, 'Recruiting Manager'),
    ( 3,  2, 'Principal'),            ( 4,  3, 'Managing Director'),
    ( 5,  3, 'Vice President, HR'),   ( 6,  4, 'Head of Campus Hiring'),
    ( 7,  5, 'Chief Actuary'),        ( 8,  6, 'Director of Product'),
    ( 9,  6, 'Talent Partner'),       (10,  7, 'Head of Strategy'),
    (11,  8, 'Chief Data Scientist'), (12,  9, 'Co-founder'),
    (13, 10, 'Marketing Director'),   (14, 11, 'Sales Director'),
    (15, 12, 'Category Head'),        (16, 12, 'HR Business Partner'),
    (17, 13, 'VP Growth'),            (18, 14, 'Plant Strategy Head'),
    (19, 15, 'COO'),                  (20, 16, 'Head of Supply Chain');

INSERT INTO alumnus (person_id, program_id, graduation_year, current_employer, sponsor_id) VALUES
    (21, 1, 2018, 'Helix Analytics',        NULL),
    (22, 2, 2012, 'Northbridge Consulting', 4),
    (23, 2, 2009, 'Kestrel Capital',        NULL),
    (24, 1, 2020, 'Lumen Technologies',     NULL),
    (25, 2, 2001, 'Self-employed',          5),
    (26, 3, 2015, 'Vertex Bank',            NULL),
    (27, 2, 2016, 'Cartwheel Commerce',     NULL),
    (28, 1, 2021, 'DataSutra Labs',         NULL),
    (29, 2, 2005, 'Saffron Consumer Goods', NULL),
    (30, 3, 2019, 'Orbit Mobility',         NULL);

INSERT INTO sponsorship (sponsor_id, cycle_id, purpose, amount_inr) VALUES
    (1, 2, 'EVENT',          500000),
    (2, 1, 'SCHOLARSHIP',    300000),
    (3, 2, 'AWARD',          150000),
    (4, 2, 'SCHOLARSHIP',    200000),
    (5, 1, 'INFRASTRUCTURE', 1000000);

-- Jobs 1-10: summer internships. Jobs 11-25: final full-time roles.
-- Each job_role row is followed by its subtype row in the same transaction;
-- the deferred trigger T4 checks at COMMIT that none was missed.
INSERT INTO job_role (job_id, company_id, cycle_id, posted_by, title, role_type, location, openings, application_deadline) VALUES
    ( 1,  1, 1,  1, 'Summer Associate',                  'INTERNSHIP', 'Mumbai',    4, '2026-07-20 23:59+05:30'),
    ( 2,  2, 1,  3, 'Strategy Intern',                   'INTERNSHIP', 'Gurugram',  3, '2026-07-20 23:59+05:30'),
    ( 3,  3, 1,  4, 'Investment Banking Summer Analyst', 'INTERNSHIP', 'Mumbai',    3, '2026-07-20 23:59+05:30'),
    ( 4,  4, 1,  6, 'Risk Analytics Intern',             'INTERNSHIP', 'Mumbai',    5, '2026-07-20 23:59+05:30'),
    ( 5,  6, 1,  8, 'Product Management Intern',         'INTERNSHIP', 'Bengaluru', 4, '2026-07-20 23:59+05:30'),
    ( 6,  8, 1, 11, 'Data Science Intern',               'INTERNSHIP', 'Bengaluru', 6, '2026-07-20 23:59+05:30'),
    ( 7,  9, 1, 12, 'Analytics Intern',                  'INTERNSHIP', 'Kolkata',   6, '2026-07-20 23:59+05:30'),
    ( 8, 10, 1, 13, 'Brand Management Intern',           'INTERNSHIP', 'Kolkata',   3, '2026-07-20 23:59+05:30'),
    ( 9, 12, 1, 15, 'Category Management Intern',        'INTERNSHIP', 'Bengaluru', 4, '2026-07-20 23:59+05:30'),
    (10, 14, 1, 18, 'Operations Strategy Intern',        'INTERNSHIP', 'Chennai',   3, '2026-07-20 23:59+05:30'),
    (11,  1, 2,  2, 'Associate Consultant',              'FULLTIME',   'Mumbai',    5, '2026-10-15 23:59+05:30'),
    (12,  2, 2,  3, 'Strategy Consultant',               'FULLTIME',   'Gurugram',  4, '2026-10-15 23:59+05:30'),
    (13,  3, 2,  5, 'Investment Banking Associate',      'FULLTIME',   'Mumbai',    3, '2026-10-15 23:59+05:30'),
    (14,  4, 2,  6, 'Credit Risk Analyst',               'FULLTIME',   'Mumbai',    6, '2026-10-15 23:59+05:30'),
    (15,  5, 2,  7, 'Actuarial & Pricing Analyst',       'FULLTIME',   'Pune',      4, '2026-10-15 23:59+05:30'),
    (16,  6, 2,  9, 'Product Manager',                   'FULLTIME',   'Bengaluru', 5, '2026-10-15 23:59+05:30'),
    (17,  7, 2, 10, 'Cloud Solutions Strategist',        'FULLTIME',   'Hyderabad', 4, '2026-10-15 23:59+05:30'),
    (18,  8, 2, 11, 'Senior Data Scientist',             'FULLTIME',   'Bengaluru', 6, '2026-10-15 23:59+05:30'),
    (19,  9, 2, 12, 'Decision Scientist',                'FULLTIME',   'Kolkata',   6, '2026-10-15 23:59+05:30'),
    (20, 10, 2, 13, 'Brand Manager',                     'FULLTIME',   'Kolkata',   4, '2026-10-15 23:59+05:30'),
    (21, 11, 2, 14, 'Sales & Marketing Manager',         'FULLTIME',   'Mumbai',    4, '2026-10-15 23:59+05:30'),
    (22, 12, 2, 16, 'Category Manager',                  'FULLTIME',   'Bengaluru', 5, '2026-10-15 23:59+05:30'),
    (23, 13, 2, 17, 'Growth Analytics Manager',          'FULLTIME',   'Gurugram',  4, '2026-10-15 23:59+05:30'),
    (24, 15, 2, 19, 'Strategy & Operations Manager',     'FULLTIME',   'Pune',      3, '2026-10-15 23:59+05:30'),
    (25, 16, 2, 20, 'Supply Chain Analytics Lead',       'FULLTIME',   'Chennai',   2, '2026-12-20 23:59+05:30');

INSERT INTO internship_role (job_id, stipend_monthly, duration_weeks, ppo_possible) VALUES
    ( 1, 175000,  8, TRUE),  ( 2, 160000,  8, TRUE),  ( 3, 200000, 10, TRUE),
    ( 4,  90000,  8, TRUE),  ( 5, 150000,  8, TRUE),  ( 6, 120000, 10, TRUE),
    ( 7,  70000,  8, FALSE), ( 8, 110000,  8, TRUE),  ( 9, 100000,  8, FALSE),
    (10,  80000,  8, FALSE);

INSERT INTO fulltime_role (job_id, ctc_lpa, fixed_lpa, joining_bonus) VALUES
    (11, 34.00, 26.00, 300000), (12, 31.50, 24.00, 250000), (13, 38.00, 25.00, 500000),
    (14, 22.00, 18.00, 100000), (15, 19.50, 16.00,      0), (16, 32.00, 24.00, 200000),
    (17, 27.00, 21.00, 150000), (18, 29.00, 23.00, 150000), (19, 21.00, 17.50,      0),
    (20, 24.50, 19.00, 100000), (21, 20.00, 16.50,      0), (22, 23.00, 18.00, 100000),
    (23, 25.00, 19.50, 100000), (24, 26.00, 20.00, 150000), (25, 18.50, 15.00,      0);

INSERT INTO eligibility (job_id, program_id, min_cgpa, max_backlogs) VALUES
    -- summer (PGPEX is a one-year programme: no summer internship)
    ( 1, 1, 8.0, 0), ( 1, 2, 8.0, 0),
    ( 2, 1, 7.8, 0), ( 2, 2, 7.8, 0),
    ( 3, 1, 7.5, 0), ( 3, 2, 7.5, 0),
    ( 4, 1, 7.0, 1), ( 4, 2, 7.0, 1),
    ( 5, 1, 7.2, 0), ( 5, 2, 7.2, 0),
    ( 6, 1, 7.0, 1),
    ( 7, 1, 6.5, 1), ( 7, 2, 6.5, 1),
    ( 8, 2, 7.0, 0),
    ( 9, 1, 6.8, 1), ( 9, 2, 6.8, 1),
    (10, 1, 6.5, 1), (10, 2, 6.5, 1),
    -- final
    (11, 1, 8.0, 0), (11, 2, 8.0, 0), (11, 3, 8.2, 0),
    (12, 1, 7.8, 0), (12, 2, 7.8, 0), (12, 3, 8.0, 0),
    (13, 1, 7.5, 0), (13, 2, 7.5, 0),
    (14, 1, 7.0, 1), (14, 2, 7.0, 1), (14, 3, 7.0, 1),
    (15, 1, 7.0, 1), (15, 2, 7.2, 1),
    (16, 1, 7.2, 0), (16, 2, 7.2, 0), (16, 3, 7.5, 0),
    (17, 1, 7.0, 0), (17, 3, 7.0, 0),
    (18, 1, 7.5, 0),
    (19, 1, 6.5, 1), (19, 2, 7.0, 1),
    (20, 2, 7.0, 0), (20, 3, 7.0, 0),
    (21, 2, 6.5, 1), (21, 3, 6.5, 1),
    (22, 1, 6.8, 1), (22, 2, 6.8, 1), (22, 3, 6.8, 1),
    (23, 1, 6.8, 1), (23, 2, 7.0, 1),
    (24, 1, 6.8, 0), (24, 2, 6.8, 0), (24, 3, 6.8, 0),
    (25, 1, 6.5, 1), (25, 2, 6.5, 1), (25, 3, 6.5, 1);

INSERT INTO job_required_skill (job_id, skill_id, min_proficiency) VALUES
    ( 1, 9, 3), ( 1, 10, 3), ( 1, 4, 2),
    ( 2, 9, 3), ( 2, 10, 3),
    ( 3, 8, 3), ( 3, 4, 3),
    ( 4, 7, 3), ( 4, 2, 2), ( 4, 3, 2),
    ( 5, 11, 3), ( 5, 2, 2),
    ( 6, 1, 3), ( 6, 6, 3), ( 6, 7, 3),
    ( 7, 2, 3), ( 7, 4, 2), ( 7, 5, 2),
    ( 8, 10, 3), ( 8, 4, 2),
    ( 9, 4, 3), ( 9, 2, 2),
    (10, 4, 2), (10, 9, 2),
    (11, 9, 4), (11, 10, 3),
    (12, 9, 3), (12, 10, 3), (12, 4, 3),
    (13, 8, 4), (13, 4, 3),
    (14, 7, 3), (14, 2, 3),
    (15, 7, 4), (15, 4, 3),
    (16, 11, 3), (16, 2, 3), (16, 10, 3),
    (17, 12, 2), (17, 2, 3),
    (18, 1, 4), (18, 6, 4), (18, 7, 3),
    (19, 1, 3), (19, 2, 3), (19, 7, 3),
    (20, 10, 3), (20, 4, 2),
    (21, 10, 3),
    (22, 4, 3), (22, 2, 2),
    (23, 2, 3), (23, 5, 2), (23, 7, 2),
    (24, 9, 3), (24, 4, 3),
    (25, 2, 3), (25, 1, 2), (25, 4, 3);

-- Interview rounds (weak entity) from three templates.
INSERT INTO interview_round (job_id, round_no, round_type, is_elimination)
SELECT j.job_id, t.round_no, t.round_type, t.is_elimination
FROM job_role j
JOIN (VALUES ('CONS', 1, 'CASE',      TRUE), ('CONS', 2, 'CASE',      TRUE), ('CONS', 3, 'HR', FALSE),
             ('TECH', 1, 'APTITUDE',  TRUE), ('TECH', 2, 'TECHNICAL', TRUE), ('TECH', 3, 'HR', FALSE),
             ('GEN',  1, 'GD',        TRUE), ('GEN',  2, 'HR',        FALSE)
     ) AS t (template, round_no, round_type, is_elimination)
  ON t.template = CASE WHEN j.job_id IN (1, 2, 3, 11, 12, 13)                  THEN 'CONS'
                       WHEN j.job_id IN (4, 6, 7, 14, 15, 17, 18, 19, 23, 25)  THEN 'TECH'
                       ELSE 'GEN' END;


-- =====================================================================
-- PART B. STUDENTS (180): 60 PGDBA, 90 PGP, 30 PGPEX
-- =====================================================================

INSERT INTO person (person_id, first_name, last_name, email, phone)
SELECT 100 + g,
       n.first_name,
       n.last_name,
       lower(n.first_name || '.' || n.last_name || g) || '@student.iimc.example',
       '+9198' || lpad((40000000 + g * 7919)::text, 8, '0')
FROM generate_series(1, 180) AS g
CROSS JOIN LATERAL (
    SELECT (ARRAY['Aarav','Aditi','Akash','Ananya','Arjun','Bhavya','Chetan','Deepika','Dev','Divya',
                  'Gaurav','Isha','Ishaan','Kavya','Karan','Lakshmi','Manish','Meera','Mohit','Neha',
                  'Nikhil','Pooja','Pranav','Priya','Rahul','Riya','Rohan','Sakshi','Sameer','Sanya',
                  'Shreya','Siddharth','Sneha','Tanvi','Tarun','Varun','Vidya','Vikram','Yash','Zoya'])[1 + (g * 7) % 40]  AS first_name,
           (ARRAY['Agarwal','Banerjee','Bose','Chatterjee','Das','Desai','Ghosh','Gupta','Iyer','Jain',
                  'Joshi','Kapoor','Khan','Kumar','Mehta','Menon','Mishra','Mukherjee','Nair','Patel',
                  'Pillai','Rao','Reddy','Roy','Saxena','Sen','Shah','Sharma','Singh','Verma'])[1 + (g * 11) % 30] AS last_name
) AS n;

-- CGPA ~ triangular on [6.0, 9.8] (sum of two uniforms), about 6% with a backlog.
INSERT INTO student (person_id, roll_no, program_id, batch_year, cgpa, active_backlogs, opted_out)
SELECT 100 + g,
       CASE WHEN g <= 60  THEN 'DBA12-' || lpad(g::text, 3, '0')
            WHEN g <= 150 THEN 'PGP62-' || lpad((g - 60)::text, 3, '0')
            ELSE               'PGX20-' || lpad((g - 150)::text, 3, '0') END,
       CASE WHEN g <= 60 THEN 1 WHEN g <= 150 THEN 2 ELSE 3 END,
       2027,
       round((6.0 + (random() + random()) * 1.9)::numeric, 2),
       CASE WHEN random() < 0.06 THEN 1 ELSE 0 END,
       g IN (23, 97, 171)                                  -- three students opted out
FROM generate_series(1, 180) AS g;

UPDATE person SET created_at = '2026-06-01 10:00+05:30';

-- Overlapping specialisation: students 101, 102, 161, 162 are also on the
-- committee; person 31 (faculty) is a committee member but not a student.
INSERT INTO committee_member (person_id, cc_role, term_start, term_end) VALUES
    (101, 'COORDINATOR', '2026-04-01', '2027-03-31'),
    (102, 'MEMBER',      '2026-04-01', '2027-03-31'),
    (161, 'SECRETARY',   '2026-04-01', '2027-03-31'),
    (162, 'MEMBER',      '2026-04-01', '2027-03-31'),
    ( 31, 'COORDINATOR', '2025-07-01', '2027-06-30');

-- Skills: each program has "affinity" skills that its students are much
-- more likely to have, and at a higher level.
INSERT INTO student_skill (student_id, skill_id, proficiency)
SELECT s.person_id,
       k.skill_id,
       LEAST(5, 1 + floor(random() * 4)::int + CASE WHEN a.affinity THEN 1 ELSE 0 END)
FROM student s
CROSS JOIN skill k
CROSS JOIN LATERAL (
    SELECT (s.program_id = 1      AND k.skill_id IN (1, 2, 3, 6, 7, 12))
        OR (s.program_id IN (2, 3) AND k.skill_id IN (4, 8, 9, 10, 11)) AS affinity
) AS a
WHERE random() < CASE WHEN a.affinity THEN 0.80 ELSE 0.30 END;


-- =====================================================================
-- PART C. APPLICATIONS
--     Each eligible (student, job) pair applies with probability 0.45,
--     within the 10 days before the deadline. Job 25 is left empty for the
--     live demo. Every row passes through trigger T1.
-- =====================================================================

INSERT INTO application (student_id, job_id, applied_at, status, status_updated_at)
SELECT s.person_id, j.job_id, t.ts, 'APPLIED', t.ts
FROM student s
JOIN eligibility e ON e.program_id = s.program_id
JOIN job_role    j ON j.job_id     = e.job_id
CROSS JOIN LATERAL (
    SELECT j.application_deadline - (0.1 + random() * 10) * INTERVAL '1 day' AS ts
) AS t
WHERE j.job_id <> 25
  AND NOT s.opted_out
  AND s.cgpa >= e.min_cgpa
  AND s.active_backlogs <= e.max_backlogs
  AND random() < 0.45;


-- =====================================================================
-- PART D. RECRUITMENT SIMULATION
-- =====================================================================

-- Interview day per job: summer 3-12 Aug, final 18-27 Oct (done),
-- final 1-4 Dec (scheduled). Job 25 is still open.
CREATE TEMP TABLE job_schedule ON COMMIT DROP AS
SELECT job_id,
       CASE WHEN job_id <= 10 THEN DATE '2026-08-03' + (job_id - 1)
            WHEN job_id <= 20 THEN DATE '2026-10-18' + (job_id - 11)
            ELSE                   DATE '2026-12-01' + (job_id - 21) END AS interview_day,
       CASE WHEN job_id <= 20 THEN 'DONE'
            WHEN job_id <= 24 THEN 'SCHEDULED'
            ELSE                   'OPEN' END                            AS phase
FROM job_role;

-- D1. Shortlisting, released 2 days after each deadline.
--     P(shortlist) rises with CGPA: 0.25 at 6.0, about 0.72 at 9.8.
UPDATE application a
   SET status            = CASE WHEN random() < 0.25 + (s.cgpa - 6) / 8 THEN 'SHORTLISTED' ELSE 'REJECTED' END,
       status_updated_at = j.application_deadline + INTERVAL '2 days'
  FROM student s, job_role j, job_schedule js
 WHERE s.person_id = a.student_id
   AND j.job_id    = a.job_id
   AND js.job_id   = a.job_id
   AND js.phase   <> 'OPEN';

-- D2. Rounds, offers and responses, one job at a time in date order, so
--     an acceptance on 19 Oct (via trigger T3) withdraws that student from
--     every later job in the same cycle.
DO $$
DECLARE
    j           record;
    r           record;
    o           record;
    v_day0      timestamptz;
    v_offer_at  timestamptz;
    v_deadline  timestamptz;
    v_roll      double precision;
    v_quick     boolean;        -- offers with a 3-day deadline (summer, first 4 final jobs)
BEGIN
    FOR j IN
        SELECT jr.job_id, jr.cycle_id, jr.openings, js.interview_day, js.phase
        FROM job_role jr JOIN job_schedule js USING (job_id)
        WHERE js.phase <> 'OPEN'
        ORDER BY js.interview_day
    LOOP
        v_day0 := (j.interview_day + TIME '09:00') AT TIME ZONE 'Asia/Kolkata';

        -- Future jobs: book round 1 for the shortlisted students and stop.
        IF j.phase = 'SCHEDULED' THEN
            INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue)
            SELECT a.student_id, j.job_id, 1, v_day0, v_day0 + INTERVAL '1 hour',
                   'Placement Hall ' || (1 + a.student_id % 4)
            FROM application a
            WHERE a.job_id = j.job_id AND a.status = 'SHORTLISTED';
            CONTINUE;
        END IF;

        -- Rounds are 2 hours apart, 1 hour long. A student sits round k only
        -- if they CLEARED every earlier round. Score rises with CGPA;
        -- 3% are absent.
        FOR r IN SELECT round_no, is_elimination FROM interview_round
                 WHERE job_id = j.job_id ORDER BY round_no
        LOOP
            INSERT INTO interview (student_id, job_id, round_no, slot_start, slot_end, venue, result, score)
            SELECT a.student_id, j.job_id, r.round_no,
                   v_day0 + (r.round_no - 1) * INTERVAL '2 hours',
                   v_day0 + (r.round_no - 1) * INTERVAL '2 hours' + INTERVAL '1 hour',
                   'Interview Room ' || (1 + a.student_id % 6),
                   CASE WHEN x.absent                              THEN 'ABSENT'
                        WHEN NOT r.is_elimination OR x.score >= 72 THEN 'CLEARED'
                        ELSE 'NOT_CLEARED' END,
                   CASE WHEN x.absent THEN NULL ELSE x.score END
            FROM application a
            JOIN student s ON s.person_id = a.student_id
            CROSS JOIN LATERAL (
                SELECT random() < 0.03                                          AS absent,
                       round(LEAST(100, 25 + s.cgpa * 5 + random() * 30)::numeric, 2) AS score
            ) AS x
            WHERE a.job_id = j.job_id
              AND a.status = 'SHORTLISTED'
              AND NOT EXISTS (SELECT 1 FROM interview i
                              WHERE i.student_id = a.student_id AND i.job_id = j.job_id
                                AND i.round_no < r.round_no AND i.result <> 'CLEARED');
        END LOOP;

        -- Anyone who failed or missed a round is rejected that evening.
        UPDATE application a
           SET status = 'REJECTED',
               status_updated_at = GREATEST(a.applied_at, v_day0 + INTERVAL '8 hours')
         WHERE a.job_id = j.job_id
           AND a.status = 'SHORTLISTED'
           AND EXISTS (SELECT 1 FROM interview i
                       WHERE i.student_id = a.student_id AND i.job_id = j.job_id
                         AND i.result <> 'CLEARED');

        -- Offers to the top (openings + 1) by average score, at 8 pm.
        v_offer_at := v_day0 + INTERVAL '11 hours';
        v_quick    := (j.cycle_id = 1 OR j.job_id <= 14);
        v_deadline := CASE WHEN v_quick THEN v_offer_at + INTERVAL '3 days'
                           ELSE TIMESTAMPTZ '2026-12-15 23:59+05:30' END;

        INSERT INTO offer (student_id, job_id, offered_at, response_deadline)
        SELECT t.student_id, j.job_id, v_offer_at, v_deadline
        FROM (SELECT a.student_id, avg(i.score) AS avg_score
              FROM application a
              JOIN interview i ON i.student_id = a.student_id AND i.job_id = a.job_id
              WHERE a.job_id = j.job_id AND a.status = 'SHORTLISTED'
              GROUP BY a.student_id
              ORDER BY avg_score DESC
              LIMIT j.openings + 1) AS t;

        -- Cleared every round but not selected: waitlisted, then rejected.
        UPDATE application
           SET status = 'REJECTED', status_updated_at = GREATEST(applied_at, v_offer_at)
         WHERE job_id = j.job_id AND status = 'SHORTLISTED';

        -- Responses. Accepting fires T3, which withdraws the student from
        -- later jobs in this cycle and declines their other pending offers.
        FOR o IN SELECT offer_id FROM offer
                 WHERE job_id = j.job_id AND status = 'PENDING'
                 ORDER BY offer_id
        LOOP
            v_roll := random();
            IF v_quick THEN
                IF v_roll < 0.80 THEN
                    UPDATE offer SET status = 'ACCEPTED', responded_at = v_offer_at + INTERVAL '1 day'
                     WHERE offer_id = o.offer_id;
                ELSIF v_roll < 0.92 THEN
                    UPDATE offer SET status = 'DECLINED', responded_at = v_offer_at + INTERVAL '2 days'
                     WHERE offer_id = o.offer_id;
                ELSE
                    UPDATE offer SET status = 'EXPIRED' WHERE offer_id = o.offer_id;
                END IF;
            ELSE
                IF v_roll < 0.55 THEN
                    UPDATE offer SET status = 'ACCEPTED', responded_at = v_offer_at + INTERVAL '1 day'
                     WHERE offer_id = o.offer_id;
                ELSIF v_roll < 0.65 THEN
                    UPDATE offer SET status = 'DECLINED', responded_at = v_offer_at + INTERVAL '2 days'
                     WHERE offer_id = o.offer_id;
                END IF;                                   -- else: still PENDING
            END IF;
        END LOOP;
    END LOOP;
END $$;


-- =====================================================================
-- Rows above were inserted with explicit ids, which does NOT advance the
-- identity sequences. Move each sequence past the current maximum so the
-- next INSERT that omits the id does not collide.
-- =====================================================================
SELECT setval(pg_get_serial_sequence('placeiq.program',         'program_id'), (SELECT max(program_id) FROM program));
SELECT setval(pg_get_serial_sequence('placeiq.placement_cycle', 'cycle_id'),   (SELECT max(cycle_id)   FROM placement_cycle));
SELECT setval(pg_get_serial_sequence('placeiq.skill',           'skill_id'),   (SELECT max(skill_id)   FROM skill));
SELECT setval(pg_get_serial_sequence('placeiq.sponsor',         'sponsor_id'), (SELECT max(sponsor_id) FROM sponsor));
SELECT setval(pg_get_serial_sequence('placeiq.company',         'company_id'), (SELECT max(company_id) FROM company));
SELECT setval(pg_get_serial_sequence('placeiq.person',          'person_id'),  (SELECT max(person_id)  FROM person));
SELECT setval(pg_get_serial_sequence('placeiq.job_role',        'job_id'),     (SELECT max(job_id)     FROM job_role));

COMMIT;

-- Refresh planner statistics after the bulk load.
ANALYZE;
