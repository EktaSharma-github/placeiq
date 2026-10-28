/* Builds deliverables/PlaceIQ_Project_Report.docx   (node build_report.js) */
const L = require("./doclib");
const { D, TEAM, SEG, P, H1, H1n, H2, H3, bullets, numbered, table, tcap, callout, code, figure, cover, toc, build } = L;

const c = D.counts, cat = D.catalog, perf = D.performance, T = D.tests.totals;
const fin = D.cycles.find((x) => x.cycle_id === 2), sum = D.cycles.find((x) => x.cycle_id === 1);
const Q = Object.fromEntries(D.queries.map((q) => [q.id, q]));
const fmt = (n) => Number(n).toLocaleString("en-IN");
const speedup = Math.round(perf.seq_scan_ms / perf.composite_index_ms);
const shrink = Math.round(perf.full_index_kb / perf.partial_index_kb);

function show(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
  return String(v);
}
function resultTable(q, rows, fr) {
  return table(q.columns, rows.map((r) => r.map(show)), fr || q.columns.map(() => 1), { size: 16 });
}

const BR = [
  ["BR-1", "Every student belongs to exactly one program", "NOT NULL foreign key student.program_id"],
  ["BR-2", "Roll number and e-mail are unique", "UNIQUE constraints (alternate keys)"],
  ["BR-3", "CGPA lies between 0 and 10", "CHECK constraint"],
  ["BR-4", "A job is an internship or a full-time role: never both, never neither", "Composite FK on (job_id, role_type) for disjointness; deferred constraint trigger for totality"],
  ["BR-5", "The recruiter posting a job works for that company", "Composite FK (posted_by, company_id) → recruiter(person_id, company_id)"],
  ["BR-6", "A student applies to a job at most once", "UNIQUE (student_id, job_id)"],
  ["BR-7", "Interviews only in a round of the job applied for", "Two composite FKs on interview sharing job_id"],
  ["BR-8", "No overlapping interview slots for a student", "EXCLUDE USING gist (student_id =, tstzrange &&)"],
  ["BR-9", "An offer needs an application; at most one per application", "FK + UNIQUE; trigger requires a live application"],
  ["BR-10", "responded_at is set iff the offer was accepted or declined", "CHECK constraint"],
  ["BR-11", "Eligibility to apply: program, CGPA, backlogs, deadline, not opted out, not placed", "BEFORE INSERT trigger (spans 4 tables)"],
  ["BR-12", "One accepted offer per student per cycle; accepting withdraws the rest", "BEFORE + AFTER triggers, stored procedure, row lock"],
  ["BR-13", "A sponsor is a company or an alumnus (union type)", "Discriminator + composite FK"],
  ["BR-14", "Placed status is derived, never typed in", "View v_placement_status"],
  ["BR-15", "A student holding an offer cannot be deleted", "ON DELETE RESTRICT blocks the cascade"],
];

const children = [
  ...cover({ kind: "Project report", title: "PlaceIQ", subtitle: "Campus Placement & Recruitment Management System: a PostgreSQL database that enforces its own rules" }),

  L.H1n("Abstract"),
  P(`Campus placement committees typically run recruitment from shared spreadsheets: one row per student, per company, per interview round. Such files duplicate data, suffer update, insertion and deletion anomalies, and cannot enforce policy. PlaceIQ replaces the spreadsheet with a relational database in PostgreSQL 18 whose design follows the full arc of the Fundamentals of Database Systems course. We built an Enhanced ER model using overlapping and disjoint specialization, a weak entity, aggregation and a category (union type); mapped it to ${cat.tables} relations; and proved every relation to be in Boyce–Codd Normal Form. Fifteen business rules are enforced inside the database by ${cat.constraints.c} CHECK constraints, ${cat.constraints.f} foreign keys (several composite), an exclusion constraint, ${cat.triggers} triggers and stored procedures. Seeded mock data for ${c.student} students, ${c.company} companies, ${fmt(c.application)} applications and ${fmt(c.interview)} interviews is loaded through those same rules. Five analytical queries demonstrate joins, HAVING, relational division, correlated subqueries and window functions. A composite index made a representative query ${fmt(speedup)} times faster on 600,000 rows. A FastAPI web interface, an SQL-injection laboratory sandboxed by a least-privilege role, and an automated suite of ${T.total} tests (all passing) complete the project.`),

  ...toc(),

  // ------------------------------------------------------------------ 1
  H1("1. Introduction"),
  H2("1.1 Background and problem"),
  P("Every year the placement committee coordinates hundreds of students, dozens of recruiters and several hiring cycles (summer internships, final placements and lateral hiring). The committee's working tool is a spreadsheet. Because a spreadsheet is a single flat file, the same company details repeat on every applicant's row, nothing prevents an ineligible student from being added, two interviews can be booked into the same slot, and a student who has already accepted an offer can keep interviewing. These are the classic limitations of file-processing systems discussed in Module 1: redundancy and inconsistency, difficulty of access, integrity problems, atomicity problems and concurrent-access anomalies."),
  H2("1.2 Objectives"),
  ...bullets([
    "Model the placement domain conceptually with an Enhanced ER diagram that uses every Module 4 construct.",
    "Map the model to a relational schema and normalize it to BCNF, with explicit functional dependencies and proofs of lossless, dependency-preserving decomposition.",
    "Enforce the committee's policy inside the database: declaratively where possible, procedurally (triggers) where a rule spans several tables.",
    "Generate realistic, reproducible data and answer real business questions with advanced SQL.",
    "Demonstrate transactions, concurrency control, indexing and SQL-injection defence with measurements, not assertions.",
    "Verify everything with an automated test suite and present it through a working web interface.",
  ]),
  H2("1.3 Scope and assumptions"),
  ...bullets([
    "One institute, three programs (PGDBA, PGP, PGPEX) and three placement cycles for the academic year 2026-27.",
    "All company and person names are fictional; the dataset is synthetic but statistically plausible.",
    "The data snapshot is taken on 28 October 2026: summer placements are complete, final placements are in progress, one job is newly posted.",
    "Authentication of real users is out of scope; the web interface is a local teaching application.",
  ]),
  H2("1.4 Tools and environment"),
  tcap("Technology stack"),
  table(["Layer", "Technology", "Purpose"], [
    ["Database", "PostgreSQL 18.6 (pgAdmin, psql)", "Schema, constraints, triggers, procedures, views, roles"],
    ["Scripts", "SQL files 02–06, PowerShell run_all.ps1", "Repeatable build: DDL → logic → data → queries → demo"],
    ["Application", "Python 3.12, FastAPI, psycopg 3", "REST API using parameterized SQL only"],
    ["Front end", "HTML, CSS, vanilla JavaScript", "Single-page UI: dashboard, students, jobs, analytics, labs"],
    ["Testing", "pytest 8, FastAPI TestClient", `${T.total} automated tests against the real database`],
    ["Version control", "Git, GitHub", "github.com/EktaSharma-github/placeiq"],
  ], [1.2, 2.4, 4]),

  // ------------------------------------------------------------------ 2
  H1("2. Requirements"),
  H2("2.1 Users"),
  table(["User", "Needs"], [
    ["Student", "See eligible jobs, apply, track interviews and offers, accept or decline an offer"],
    ["Recruiter", "Post jobs with eligibility and skill requirements, shortlist, interview, make offers"],
    ["Placement committee", "Enforce policy, schedule interviews without clashes, monitor progress, report statistics"],
    ["Sponsors", "Companies and alumni who fund scholarships, events and awards for a cycle"],
  ], [1.5, 5]),
  H2("2.2 Business rules"),
  P("The rules below were collected from the committee's policy and drive every constraint in the design. The third column states where each rule is enforced."),
  tcap("Business rules and their enforcement mechanism"),
  table(["ID", "Rule", "Enforced by"], BR, [0.7, 3.4, 3.4], { size: 17 }),
  H2("2.3 Functional requirements"),
  ...numbered([
    "Maintain programs, cycles, companies, recruiters, students, alumni, committee members and sponsors.",
    "Post jobs (internship or full-time) with eligibility per program, required skills and interview rounds.",
    "Accept applications only from eligible students, before the deadline.",
    "Schedule interview rounds without overlap and record results and scores.",
    "Make offers; accept, decline or expire them; apply the one-offer policy automatically.",
    "Report placement status, compensation statistics, selectivity and progress over time.",
  ]),
  H2("2.4 Non-functional requirements"),
  ...bullets([
    "**Integrity:** rules hold even if the application layer is bypassed (enforced in the DBMS).",
    "**Atomicity:** multi-step operations such as accepting an offer either complete fully or not at all.",
    "**Reproducibility:** the database can be rebuilt to an identical state in about two seconds.",
    "**Security:** no SQL injection in application queries; least privilege where untrusted input is demonstrated.",
    "**Performance:** foreign keys indexed; hot lookups supported by composite and partial indexes.",
  ]),

  // ------------------------------------------------------------------ 3
  H1("3. Conceptual design: Enhanced ER model"),
  P("The EER model is presented in two views for readability. Figure 1 covers people, programs and sponsorship; Figure 2 covers the recruitment pipeline. Both use Chen notation: rectangles for entities (double for weak), diamonds for relationships (double for identifying), ovals for attributes, double lines for total participation, and circles for specialization ('o' overlapping, 'd' disjoint, 'U' category)."),
  ...figure("diagrams/eer_people.png", "EER view 1: Person hierarchy (overlapping, partial), programs, and the Sponsor category (union type)."),
  ...figure("diagrams/eer_pipeline.png", "EER view 2: recruitment pipeline with aggregation, weak entity INTERVIEW_ROUND and disjoint, total job specialization."),
  H2("3.1 Entities and attributes"),
  tcap("Entities"),
  table(["Entity", "Type", "Key and notable attributes"], [
    ["PERSON", "Strong, superclass", "person_id (key); name (composite: first, last); email (candidate key); phone"],
    ["STUDENT", "Subclass of PERSON", "roll_no (candidate key), cgpa, backlogs, opted_out; {skills} multi-valued; placement_status derived"],
    ["RECRUITER / COMMITTEE_MEMBER / ALUMNUS", "Subclasses of PERSON", "designation / cc_role, term / graduation_year, current_employer"],
    ["PROGRAM, COMPANY, PLACEMENT_CYCLE, SKILL", "Strong", "Surrogate id plus natural candidate key (program_code, company_name, cycle_name, skill_name)"],
    ["SPONSOR", "Category of COMPANY ∪ ALUMNUS", "sponsor_id (surrogate), sponsor_type"],
    ["JOB_ROLE", "Strong, superclass", "job_id; title, location, openings, deadline"],
    ["INTERNSHIP_ROLE / FULLTIME_ROLE", "Subclasses of JOB_ROLE", "stipend_monthly, duration_weeks, ppo_possible / ctc_lpa, fixed_lpa, joining_bonus"],
    ["INTERVIEW_ROUND", "Weak, owner JOB_ROLE", "round_no (partial key), round_type, is_elimination"],
    ["OFFER", "Strong (via aggregation)", "offered_at, response_deadline, status, responded_at"],
  ], [2.2, 1.8, 4], { size: 17 }),
  H2("3.2 Relationships"),
  tcap("Relationships with cardinality and participation"),
  table(["Relationship", "Between", "Cardinality", "Participation / notes"], [
    ["ENROLLED_IN", "STUDENT – PROGRAM", "N : 1", "Student total"],
    ["GRADUATED_FROM", "ALUMNUS – PROGRAM", "N : 1", "Alumnus total"],
    ["WORKS_FOR", "RECRUITER – COMPANY", "N : 1", "Recruiter total"],
    ["OFFERS / IN_CYCLE", "COMPANY – JOB_ROLE / JOB_ROLE – CYCLE", "1 : N / N : 1", "Job total in both"],
    ["ELIGIBLE_FOR", "JOB_ROLE – PROGRAM", "M : N", "Attributes min_cgpa, max_backlogs"],
    ["HAS_SKILL / REQUIRES", "STUDENT – SKILL / JOB_ROLE – SKILL", "M : N", "proficiency / min_proficiency"],
    ["APPLIES_TO", "STUDENT – JOB_ROLE", "M : N", "status, applied_at; treated as an aggregate"],
    ["HAS_ROUND", "JOB_ROLE – INTERVIEW_ROUND", "1 : N", "Identifying; round total"],
    ["EVALUATED_IN", "[APPLIES_TO] – INTERVIEW_ROUND", "M : N", "slot, venue, result, score"],
    ["RESULTS_IN", "[APPLIES_TO] – OFFER", "1 : 0..1", "Offer total"],
    ["SPONSORS", "SPONSOR – PLACEMENT_CYCLE", "M : N", "purpose, amount"],
  ], [1.7, 2.6, 1.1, 2.4], { size: 17 }),
  H2("3.3 Design decisions"),
  ...bullets([
    "**Overlapping, partial specialization of PERSON:** a student may also be a committee member; a guest speaker is only a person.",
    "**Disjoint, total specialization of JOB_ROLE:** stipend and CTC are different attributes and every job is exactly one kind.",
    "**Aggregation of APPLIES_TO:** an interview evaluates a specific application (a student for a job), not a student in general; the same applies to an offer. Modelling it this way makes it possible to enforce that a student is interviewed only for a job they applied to.",
    "**Weak entity INTERVIEW_ROUND:** 'round 2' has no identity outside its job.",
    "**Category SPONSOR:** companies and alumni are different entity types that play the same sponsoring role.",
    "**Derived attribute placement_status:** computed from offers, so it can never disagree with them.",
  ]),

  // ------------------------------------------------------------------ 4
  H1("4. Logical design: relational schema"),
  H2("4.1 Mapping the EER model"),
  tcap("ER-to-relational mapping steps (Elmasri–Navathe)"),
  table(["Step", "Rule", "Applied to"], [
    ["1", "Strong entity → relation", "program, person, company, placement_cycle, job_role, skill"],
    ["2", "Weak entity → relation; PK = owner PK + partial key", "interview_round (job_id, round_no)"],
    ["3", "1:1 → FK on the total side + UNIQUE", "offer → application (student_id, job_id)"],
    ["4", "1:N → FK on the N side", "student.program_id, recruiter.company_id, job_role.company_id, cycle_id, posted_by"],
    ["5", "M:N → bridge relation", "eligibility, student_skill, job_required_skill, application, interview, sponsorship"],
    ["6", "Multi-valued attribute → relation", "student_skill"],
    ["8A", "Specialization → one relation per subclass sharing the superclass key", "student, recruiter, committee_member, alumnus; internship_role, fulltime_role"],
    ["9", "Category → surrogate key relation; FK in each member", "sponsor ← company.sponsor_id, alumnus.sponsor_id"],
  ], [0.6, 3.3, 3.8], { size: 17 }),
  P("Option 8A (a table per subclass) was preferred over a single wide JOB_ROLE table because the single table would need NULLs in half its rows and could not declare that CTC is mandatory for full-time roles with a simple NOT NULL. With 8A every subtype attribute is NOT NULL."),
  ...figure("diagrams/schema.png", `Relational schema generated from the live catalog: ${cat.tables} relations; arrows point from a foreign key to the referenced relation.`),
  H2("4.2 Keys"),
  tcap("Keys in the schema"),
  table(["Key type", "Definition", "Example in PlaceIQ"], [
    ["Super key", "Any attribute set that uniquely identifies a tuple", "(person_id, email) in person"],
    ["Candidate key", "A minimal super key", "placement_cycle has three: cycle_id; cycle_name; (cycle_type, academic_year)"],
    ["Primary key", "The candidate key chosen for identification", "job_id in job_role"],
    ["Alternate key", "A candidate key not chosen as primary, kept UNIQUE", "(company_id, cycle_id, title) in job_role; roll_no; email"],
    ["Foreign key", "Attributes referencing a key of another relation", `${cat.constraints.f} in total, e.g. composite (posted_by, company_id) → recruiter`],
  ], [1.4, 2.6, 3.8], { size: 17 }),
  P("Surrogate keys were introduced after normalization for convenience (short, stable, efficient joins). Every natural key was preserved as a UNIQUE constraint, so no functional dependency is lost by the substitution."),

  // ------------------------------------------------------------------ 5
  H1("5. Normalization"),
  H2("5.1 The starting relation and its anomalies"),
  P("The committee's spreadsheet is an unnormalized relation PLACEMENT_SHEET(roll_no, name, email, prog_code, prog_name, cgpa, {skills}, company, sector, hq_city, cycle, job_title, role_type, pay, min_cgpa, round_no, round_type, slot, result, app_status)."),
  ...bullets([
    "**Update anomaly:** a company changing its headquarters must be edited on every applicant and round row.",
    "**Insertion anomaly:** a job cannot be recorded before someone applies, because roll_no is part of the key.",
    "**Deletion anomaly:** deleting the only applicant to a job deletes the job's pay, cut-off and rounds.",
  ]),
  H2("5.2 Functional dependencies"),
  P("Let J denote (company, cycle, job_title), the natural identifier of a job."),
  tcap("Functional dependencies of PLACEMENT_SHEET"),
  table(["FD", "Dependency"], [
    ["FD1", "roll_no → name, email, prog_code, cgpa"], ["FD2", "email → roll_no"], ["FD3", "prog_code → prog_name"],
    ["FD4", "company → sector, hq_city"], ["FD5", "J → role_type, pay"], ["FD6", "J, prog_code → min_cgpa"],
    ["FD7", "J, round_no → round_type"], ["FD8", "roll_no, J → app_status"], ["FD9", "roll_no, J, round_no → slot, result"],
    ["MVD", "roll_no →→ skills (independent of every other attribute)"],
  ], [0.8, 6]),
  ...figure("diagrams/normalization.png", "Decomposition from the spreadsheet to BCNF."),
  H2("5.3 First normal form"),
  P("skills is a list, violating atomicity. Splitting it into one row per skill would multiply rows by the number of rounds and skills (the multi-valued dependency at work), so it moves to StudentSkill(roll_no, skill). The remaining relation has atomic values and key {roll_no, company, cycle, job_title, round_no}."),
  H2("5.4 Second normal form"),
  P("Several non-key attributes depend on part of the composite key: student details on roll_no (FD1), company details on company (FD4), job details on J (FD5), round type on (J, round_no) (FD7) and application status on (roll_no, J) (FD8). Each partial dependency becomes its own relation: Student, Company, Job, Round, Application and Interview."),
  H2("5.5 Third normal form"),
  P("Two transitive dependencies remain. In Student, roll_no → prog_code → prog_name, so Program(prog_code, prog_name) is separated. In Application, (roll_no, J) → roll_no → prog_code and (J, prog_code) → min_cgpa, so the cut-off moves to Eligibility(J, prog_code, min_cgpa)."),
  H2("5.6 Boyce–Codd normal form"),
  tcap("BCNF verification"),
  table(["Relation", "Non-trivial FDs", "Every determinant a super key?"], [
    ["Program", "prog_code → prog_name", "Yes"],
    ["Student", "roll_no → all; email → roll_no", "Yes: roll_no and email are both candidate keys"],
    ["Company", "company → sector, hq_city", "Yes"],
    ["Job", "J → role_type, pay", "Yes"],
    ["Eligibility", "(J, prog_code) → min_cgpa", "Yes"],
    ["Round", "(J, round_no) → round_type", "Yes"],
    ["Application", "(roll_no, J) → app_status", "Yes"],
    ["Interview", "(roll_no, J, round_no) → slot, result", "Yes"],
    ["StudentSkill", "none non-trivial (MVD isolated, so also 4NF)", "Yes"],
    ["placement_cycle", "each of three candidate keys → all", "Yes"],
  ], [1.6, 3.2, 3]),
  H2("5.7 Lossless join and dependency preservation"),
  P("Each decomposition step split a relation R on a dependency X → Y into (X ∪ Y) and (R − Y), where X is a key of the first part. By Heath's theorem such a binary decomposition is lossless: the natural join of the parts reproduces R exactly. Every dependency FD1–FD9 is contained within a single resulting relation, so the decomposition is also dependency-preserving and every rule can be checked locally."),
  H2("5.8 The 3NF-but-not-BCNF case we avoided"),
  callout("Design discussion", [
    "Suppose each recruiter interviewed for exactly one job. A relation Panel(student, job, recruiter) would have (student, job) → recruiter and recruiter → job.",
    "recruiter is not a super key, so Panel violates BCNF; but job is a prime attribute, so Panel is still in 3NF.",
    "The BCNF decomposition (recruiter, job) + (student, recruiter) is lossless but not dependency-preserving: (student, job) → recruiter can no longer be checked inside one table.",
    "Decision: the business does not need the rule (a recruiter may interview for several roles), so it was not modelled and the schema remains in BCNF without loss.",
  ]),
  H2("5.9 Deliberately non-redundant choices"),
  table(["Not stored", "Reason"], [
    ["CTC or stipend on offer", "offer → job_id → ctc_lpa would be a transitive dependency; the job subtype tables hold pay"],
    ["placement_status on student", "Derived from offers by the view v_placement_status"],
    ["cycle_id on application", "job_id → cycle_id would be transitive; the one-offer-per-cycle rule is a trigger instead"],
  ], [2, 5]),
  P("The constant discriminator columns (for example internship_role.role_type = 'INTERNSHIP') are not a normal-form violation: their domain has a single value, so they introduce no non-trivial dependency. They exist only so that composite foreign keys can enforce disjointness declaratively."),

  // ------------------------------------------------------------------ 6
  H1("6. Physical design and DDL"),
  H2("6.1 Data types"),
  table(["Kind of data", "Type chosen", "Why"], [
    ["Surrogate keys", "INT / SMALLINT GENERATED BY DEFAULT AS IDENTITY", "Standard SQL identity columns; small tables use SMALLINT"],
    ["Money and grades", "NUMERIC(p, s)", "Exact decimal arithmetic; never floating point"],
    ["Timestamps", "TIMESTAMPTZ", "Unambiguous across time zones; required by tstzrange for EXCLUDE"],
    ["Codes and enumerations", "VARCHAR + CHECK (… IN (…))", "Readable values with a closed domain"],
    ["Flags", "BOOLEAN", "opted_out, ppo_possible, is_elimination"],
  ], [1.8, 3, 3], { size: 17 }),
  H2("6.2 Integrity techniques"),
  H3("Disjoint specialization with a composite foreign key"),
  code(`CREATE TABLE internship_role (
    job_id           INT           PRIMARY KEY,
    role_type        VARCHAR(10)   NOT NULL DEFAULT 'INTERNSHIP' CHECK (role_type = 'INTERNSHIP'),
    stipend_monthly  NUMERIC(10,2) NOT NULL CHECK (stipend_monthly >= 0),
    duration_weeks   SMALLINT      NOT NULL CHECK (duration_weeks BETWEEN 4 AND 26),
    ppo_possible     BOOLEAN       NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_internship_job FOREIGN KEY (job_id, role_type)
        REFERENCES job_role (job_id, role_type) ON DELETE CASCADE
);`),
  P("job_role declares UNIQUE (job_id, role_type). A full-time job has role_type 'FULLTIME', so an internship row for it has nothing to reference and is rejected by the database. Totality (every job has some subtype row) cannot be expressed declaratively and is checked by a deferred constraint trigger at COMMIT."),
  H3("Interview integrity across the aggregation"),
  code(`CONSTRAINT fk_interview_application FOREIGN KEY (student_id, job_id)
    REFERENCES application (student_id, job_id) ON DELETE CASCADE,
CONSTRAINT fk_interview_round FOREIGN KEY (job_id, round_no)
    REFERENCES interview_round (job_id, round_no) ON DELETE CASCADE,
CONSTRAINT excl_student_double_booking
    EXCLUDE USING gist (student_id WITH =, tstzrange(slot_start, slot_end) WITH &&)`),
  P("The two foreign keys share job_id, which guarantees that a student is interviewed only in a round belonging to the job they applied for (BR-7). The exclusion constraint forbids two rows for the same student whose time ranges overlap (BR-8), something no UNIQUE constraint can express; it relies on the btree_gist extension."),
  H3("Cross-entity consistency"),
  code(`CONSTRAINT fk_job_posted_by FOREIGN KEY (posted_by, company_id)
    REFERENCES recruiter (person_id, company_id) ON DELETE SET NULL (posted_by)`),
  P("A recruiter can post a job only for the company they work for (BR-5). The PostgreSQL 15+ column list in SET NULL (posted_by) nulls only the recruiter reference if the recruiter is deleted, keeping the job and its company."),
  H2("6.3 Referential actions"),
  table(["Action", "Used for", "Reason"], [
    ["CASCADE", "person → subtypes; job_role → rounds and subtypes; application → interviews", "The dependent row has no meaning without its owner"],
    ["RESTRICT", "program → student; job_role → application; application → offer", "Protect history and formal records"],
    ["SET NULL (col)", "recruiter → job_role.posted_by; sponsor → company/alumnus", "Keep the row, forget the link"],
  ], [1.3, 3.6, 2.8], { size: 17 }),
  L.spacer(80),   // keeps Word from merging the two adjacent tables
  callout("The RESTRICT-blocks-CASCADE chain (BR-15)", "Deleting a person cascades to student and then to application; if an application has an offer, the RESTRICT on offer aborts the entire statement. A student who holds an offer therefore cannot be erased.", { fill: L.COLOR.tealSoft, color: L.COLOR.teal }),
  H2("6.4 Catalog summary"),
  tcap("Objects in the placeiq schema (from the system catalog)"),
  table(["Object", "Count"], [
    ["Tables", cat.tables], ["Primary keys", cat.constraints.p], ["Foreign keys", cat.constraints.f], ["UNIQUE constraints", cat.constraints.u],
    ["CHECK constraints", cat.constraints.c], ["EXCLUDE constraints", cat.constraints.x], ["Indexes (including key indexes)", cat.indexes],
    ["Triggers", cat.triggers], ["Views", 2], ["Stored routines", 3],
  ], [4, 1]),
  P("PostgreSQL indexes primary keys and UNIQUE constraints automatically but not foreign-key columns. The DDL therefore creates an index for every foreign key not already covered by the leading columns of another index; test TC-SCH-04 verifies this for all 30 foreign keys."),

  // ------------------------------------------------------------------ 7
  H1("7. Business logic: views, triggers and procedures"),
  P("Rules that involve several tables cannot be CHECK constraints, which see only the row being written. These are implemented in PL/pgSQL in 03_logic.sql and are installed before the data is loaded, so the seeded data itself passes them."),
  tcap("Triggers"),
  table(["Trigger", "Timing", "Rule"], [
    ["trg_application_eligibility", "BEFORE INSERT/UPDATE on application", "BR-11: opted out, deadline, program eligible, CGPA cut-off, backlogs, already placed in cycle"],
    ["trg_offer_requires_open_app", "BEFORE INSERT on offer", "An offer needs an APPLIED or SHORTLISTED application"],
    ["trg_offer_marks_app_offered", "AFTER INSERT on offer", "Application status becomes OFFERED"],
    ["trg_offer_accept_guard", "BEFORE INSERT/UPDATE on offer", "BR-12: only pending offers, before the deadline, no second acceptance in the cycle; locks the student row"],
    ["trg_offer_accept_cascade_upd / _ins", "AFTER UPDATE/INSERT on offer", "Decline other offers, withdraw open applications, free interview slots, write the audit log"],
    ["trg_job_total_on_* (3)", "Deferred constraint triggers", "BR-4 totality: every job has a subtype row at COMMIT"],
  ], [2.4, 2.1, 3.3], { size: 17 }),
  ...figure("diagrams/trigger_flow.png", "Accepting an offer: procedure, guard trigger and cascade trigger inside one transaction."),
  H3("The cascade (excerpt)"),
  code(`WITH withdrawn AS (
    UPDATE application a
       SET status = 'WITHDRAWN',
           status_updated_at = GREATEST(v_when, a.applied_at)
      FROM job_role j
     WHERE j.job_id = a.job_id AND j.cycle_id = v_cycle
       AND a.student_id = NEW.student_id
       AND a.status IN ('APPLIED', 'SHORTLISTED')
    RETURNING a.job_id
)
INSERT INTO placement_log (student_id, job_id, action, details, logged_at)
SELECT NEW.student_id, w.job_id, 'AUTO_WITHDRAWN', ..., v_when FROM withdrawn w;`),
  tcap("Views and stored routines"),
  table(["Object", "Purpose"], [
    ["v_job_details", "Flattens the job specialization: one row per job with its CTC or stipend (LEFT JOINs to both subtypes)"],
    ["v_placement_status", "BR-14: derived status per (student, cycle): PLACED, OFFER_PENDING, IN_PROCESS, UNPLACED, NOT_APPLIED, OPTED_OUT"],
    ["fn_apply_for_job(roll_no, job_id)", "Parameterized entry point for applying; the trigger validates"],
    ["sp_accept_offer(offer_id)", "Locks the student row first, re-reads the offer, accepts it; the triggers cascade; reports a summary"],
    ["sp_expire_stale_offers()", "Batch job: expires overdue pending offers and logs each"],
  ], [2.4, 5.3], { size: 17 }),

  // ------------------------------------------------------------------ 8
  H1("8. Data generation"),
  P("Reference data (programs, cycles, skills, sixteen fictional companies, recruiters, alumni, jobs, eligibility, required skills) is written as plain INSERT statements so that it can be read on a slide. Students are generated set-based with generate_series; setseed() makes the pseudo-random CGPAs, skills and applications identical on every run. A PL/pgSQL block then simulates recruitment job by job in date order: shortlisting weighted by CGPA, interview rounds with scores, offers to the top performers, and responses. Each acceptance fires the real trigger, which withdraws the student from later jobs in the same cycle."),
  P("The whole load is a single transaction. Because the triggers are already installed, every row is validated as it is inserted: if any row broke a rule nothing would be loaded. Identity sequences are advanced with setval() afterwards, because inserting explicit ids does not move them."),
  tcap("Data volumes"),
  table(["Table", "Rows", "Table", "Rows"], [
    ["student", c.student, "application", fmt(c.application)], ["company", c.company, "interview", fmt(c.interview)],
    ["job_role", c.job_role, "offer", c.offer], ["student_skill", fmt(c.student_skill), "placement_log", c.placement_log],
    ["person", c.person, "eligibility", c.eligibility],
  ], [2, 1, 2, 1]),
  P(`As of the snapshot, summer placements placed ${sum.placed} of ${sum.participants} participating students; final placements have placed ${fin.placed} of ${fin.participants} so far, with ${fin.offer_pending} offers pending and a median accepted CTC of ₹${fin.median_ctc} LPA (highest ₹${fin.max_ctc} LPA).`),

  // ------------------------------------------------------------------ 9
  H1("9. Analytical queries"),
  P("The five queries in 05_queries.sql each answer a question the committee actually asks. Results below were produced on the seeded database."),
  ...[1, 2, 3, 4, 5].flatMap((n) => {
    const q = Q[n];
    let rows = q.rows;
    if (n === 4) { const last = {}; q.rows.forEach((r) => { last[r[1]] = r; }); rows = Object.values(last); }
    const out = [H2(`Q${n}. ${q.title}`), P(`**Business question.** ${q.question}`), P(`**Concepts.** ${q.concepts}`)];
    if (q.algebra) out.push(P("**Relational algebra.**"), code(q.algebra));
    out.push(code(q.sql + ";"));
    out.push(tcap(n === 4 ? "Q4 result: final day for each program (full output has one row per program per day)" : `Q${n} result (${q.rows.length} rows)`));
    out.push(resultTable(q, rows.slice(0, 14)));
    if (q.note) out.push(P(`**Note.** ${q.note}`));
    return out;
  }),
  P("Q2 was additionally cross-checked against the division-by-counting formulation (GROUP BY … HAVING count(*) = number of required skills) for all 25 jobs; both give identical sets (test TC-QRY-06)."),

  // ------------------------------------------------------------------ 10
  H1("10. Transactions and concurrency"),
  tcap("ACID properties in PlaceIQ"),
  table(["Property", "How the project demonstrates it", "Test"], [
    ["Atomicity", "Accepting an offer and its whole cascade is one transaction; a ROLLBACK restores offers, applications, interviews and the log", "TC-TXN-01"],
    ["Consistency", "Constraints at statement end; deferred totality trigger at COMMIT; a job without a subtype cannot commit", "TC-TXN-04, TC-CON-05"],
    ["Isolation", "Concurrent acceptances for one student are serialized by a row lock on the student", "TC-TXN-02, 03"],
    ["Durability", "After COMMIT returns, PostgreSQL's write-ahead log preserves the change across a crash", "(engine guarantee)"],
  ], [1.3, 4.8, 1.6], { size: 17 }),
  H2("10.1 The concurrency scenario"),
  P("Under the default READ COMMITTED isolation level, two sessions accepting two different offers for the same student could both pass the 'no other accepted offer' check before either commits, leaving the student with two accepted offers. sp_accept_offer therefore takes SELECT … FOR UPDATE on the student's row before touching any offer. Session B blocks until session A commits; it then re-reads its offer, finds that A's cascade has already declined it, and aborts. The automated test runs this with two real connections and a thread, and asserts that exactly one accepted offer remains."),
  H2("10.2 Lock order and deadlock"),
  P("An earlier version locked the offer row first. Two concurrent acceptances could then each hold one offer while their cascades needed the other's, a classic deadlock (PostgreSQL would detect it and abort one session). Locking the common parent row, the student, first imposes a single global lock order, which eliminates the cycle."),

  // ------------------------------------------------------------------ 11
  H1("11. Performance and indexing"),
  P("The live tables are small enough that sequential scans are optimal, so indexing was measured on a 600,000-row application archive built inside a transaction. Each figure is the best of three EXPLAIN ANALYZE runs recorded by the performance tests."),
  tcap("Index measurements (query: open applications for one job)"),
  table(["Configuration", "Plan", "Execution time", "Index size"], [
    ["No index", "Sequential scan of 600,000 rows", `${perf.seq_scan_ms.toFixed(3)} ms`, "—"],
    ["B-tree (job_id, status)", "Bitmap index scan", `${perf.composite_index_ms} ms`, `${fmt(perf.full_index_kb)} KB`],
    ["Partial (job_id) WHERE status IN ('APPLIED','SHORTLISTED')", "Bitmap index scan", `${perf.partial_index_ms} ms`, `${perf.partial_index_kb} KB`],
  ], [3, 2.2, 1.4, 1.2], { size: 17 }),
  P(`The composite index is about ${fmt(speedup)} times faster than the sequential scan. The partial index, covering only the roughly 4% of rows that are still open, is ${shrink} times smaller than the full index and faster still. A partial index is used in production too: idx_offer_accepted_student supports the triggers' 'has an accepted offer?' lookups.`),
  callout("Finding: the leading-column rule on PostgreSQL 18", [
    `We expected a filter on status alone to ignore the (job_id, status) index. PostgreSQL 18 did use it, but by reading the entire index: ${fmt(perf.status_only_blocks)} blocks, against ${perf.seek_blocks} blocks for a proper seek on job_id.`,
    "The accurate statement of the rule is that an index cannot be used to seek on a non-leading column; at best the whole index (or the whole table) is read. Our test and demo script were corrected accordingly.",
  ]),

  // ------------------------------------------------------------------ 12
  H1("12. Security"),
  H2("12.1 SQL injection"),
  P("Every query in the application passes user input as a bound parameter (psycopg %s placeholders, sent separately from the SQL text as $1, $2 …), so input can never change the structure of a statement. To demonstrate the difference, the web interface includes a laboratory that runs the same student search two ways."),
  table(["Input", "String concatenation", "Bound parameter"], [
    ["Sen", "6 rows", "6 rows"], ["x' OR '1'='1", "180 rows: every student leaked", "0 rows"],
    ["x' UNION SELECT roll_no, cgpa::text, phone …", "180 rows of CGPAs and phone numbers", "0 rows"],
    ["x'; DROP TABLE student; --", "Refused: SQLSTATE 25006 (read-only transaction)", "0 rows"],
  ], [2.8, 2.7, 1.6], { size: 17 }),
  H2("12.2 Least privilege (DCL)"),
  code(`CREATE ROLE placeiq_readonly NOLOGIN;
GRANT USAGE  ON SCHEMA placeiq TO placeiq_readonly;
GRANT SELECT ON placeiq.student, placeiq.person TO placeiq_readonly;`),
  P("The deliberately vulnerable path runs as this role, inside a READ ONLY transaction with a two-second statement timeout, and is always rolled back. Even a successful injection can therefore only read two tables: writes fail, other tables are denied (SQLSTATE 42501) and superuser functions such as pg_read_file are unavailable. The web server binds to 127.0.0.1 only."),

  // ------------------------------------------------------------------ 13
  H1("13. Application layer"),
  ...figure("diagrams/architecture.png", "Three-tier architecture: browser single-page app, FastAPI REST API, PostgreSQL."),
  P("The REST API (app/main.py) is a thin layer: it calls the views, the stored function and the procedures, and translates database errors into JSON containing PostgreSQL's message, the SQLSTATE and the name of the trigger function that raised it. The browser shows that explanation directly, so users see why the database refused an action."),
  tcap("Main REST endpoints"),
  table(["Method and path", "Purpose"], [
    ["GET /api/summary, /api/velocity", "Dashboard KPIs, status by program, cumulative placement series"],
    ["GET /api/students, /api/students/{roll}", "Search; full profile with applications, interviews, skills, audit trail"],
    ["POST /api/applications", "Apply (fn_apply_for_job; eligibility trigger)"],
    ["POST /api/offers, /api/offers/{id}/accept | decline", "Recruiter offer; acceptance via sp_accept_offer with the cascade returned"],
    ["GET /api/jobs, /api/jobs/{id}", "Jobs, funnel, rounds, applicants, talent match (Query 2)"],
    ["GET/POST /api/queries, /api/queries/{n}/run", "The five queries, parsed from 05_queries.sql, run read-only"],
    ["GET /api/security/search", "SQL-injection laboratory (sandboxed)"],
    ["POST /api/admin/reset", "Rebuild the seeded database"],
  ], [3.2, 4.5], { size: 17 }),
  ...figure(L.PROJECT + "/docs/screenshots/dashboard.png", "Dashboard: KPIs, placement velocity (window function) and status by program (view).", 6.0),
  ...figure(L.ROOT + "/screenshots/demo_05_accept_cascade.png", "Student profile after accepting an offer: the cascade declined one offer and withdrew one application.", 6.0),

  // ------------------------------------------------------------------ 14
  H1("14. Testing summary"),
  P(`The automated suite (tests/) contains ${T.total} test cases that run against the real database with pytest; all ${T.passed} pass. Each test runs in a transaction that is rolled back, the database is rebuilt at the start and end of a run, and tests that must commit (concurrency, API writes) restore the seed afterwards. Full details, the traceability matrix and the defect log are in the separate Testing Report.`),
  (() => { const m = {}; D.tests.tests.forEach((t) => { m[t.module] = (m[t.module] || 0) + 1; });
    return table(["Module", "Tests", "Result"], Object.entries(m).map(([k, v]) => [k, v, "All passed"]), [3, 1, 2]); })(),

  // ------------------------------------------------------------------ 15
  H1("15. Learnings, limitations and future work"),
  H2("15.1 What we learned"),
  ...bullets([
    "**Modelling decides what can be enforced.** Treating the application as an aggregation is what made it possible to guarantee, with plain foreign keys, that interviews and offers belong to a real application.",
    "**Normalization is a proof, not a feeling.** Writing every functional dependency exposed the transitive dependency hidden in min_cgpa and justified the Eligibility table.",
    "**Declare before you code.** CHECK constraints, composite foreign keys and an exclusion constraint reject bad data even when the application is bypassed; triggers are for what cannot be declared.",
    "**Concurrency must be tested, not assumed.** A two-connection test showed why lock order matters and turned a possible deadlock into a clean queue.",
    "**Measure performance.** The leading-column rule behaved differently on PostgreSQL 18 than the textbook summary suggested; measuring blocks read gave the accurate explanation.",
  ]),
  H2("15.2 Limitations"),
  ...bullets([
    "Synthetic data: distributions are plausible but not drawn from a real placement season.",
    "No user authentication or row-level security per student or recruiter.",
    "The UI is a teaching interface, tested end to end through the recorded demo rather than a browser test suite.",
  ]),
  H2("15.3 Future work"),
  ...bullets([
    "Row-level security policies so that each student sees only their own rows.",
    "SERIALIZABLE isolation as an alternative to explicit locking, with retry logic.",
    "Table partitioning of the application archive by academic year.",
    "Materialized views for the dashboard with scheduled refresh.",
  ]),

  // ------------------------------------------------------------------ 16
  H1("16. Team contribution"),
  table(["Member", "Name", "Owned in the project and the presentation"], [
    ["M1", TEAM[0], "Problem analysis, business rules, EER model (both views), Chen diagrams"],
    ["M2", TEAM[1], "ER-to-relational mapping, keys, functional dependencies, normalization to BCNF and proofs"],
    ["M3", TEAM[2], "DDL and integrity techniques, data generation, the five analytical queries"],
    ["M4", TEAM[3], "Triggers and procedures, transactions and concurrency, indexing, security, testing, live demo"],
  ], [0.8, 1.7, 5.2]),
  P("All members reviewed each other's sections; the presentation follows the same split."),

  H1("References"),
  ...numbered([
    "A. Silberschatz, H. F. Korth and S. Sudarshan, Database System Concepts, 7th ed., McGraw-Hill Education, 2019.",
    "R. Elmasri and S. B. Navathe, Fundamentals of Database Systems, 7th ed., Pearson, 2016.",
    "PostgreSQL Global Development Group, PostgreSQL 18 Documentation: constraints, triggers, transaction isolation, indexes, EXPLAIN.",
    "NPTEL (IIT Madras), Database Management Systems: ER model, relational model, SQL, relational schema design, storage and indexing.",
    "Course material, Fundamentals of Database Systems, PGDBA Batch 12: data models, relational algebra, SQL, query optimization, SQL injection, REST and databases.",
  ]),

  H1("Appendix A. How to run"),
  code(`# 1. Database (PostgreSQL 15+; from the Project folder)
.\\run_all.ps1 -Password <postgres-password>

# 2. Queries and the scripted demo
psql -U postgres -h localhost -d placeiq -f 05_queries.sql
psql -U postgres -h localhost -d placeiq -f 06_demo.sql      # ends in ROLLBACK

# 3. Web UI
cd app
python -m venv .venv
.venv\\Scripts\\pip install -r requirements.txt
.venv\\Scripts\\python main.py                               # http://127.0.0.1:8000

# 4. Tests (pip install pytest httpx into the same venv)
app\\.venv\\Scripts\\python -m pytest tests -v`),
  H1n("Appendix B. Repository contents"),
  table(["Path", "Contents"], [
    ["01_design.md", "Design notes: rules, EER, mapping, normalization"], ["02_ddl.sql", "Schema"], ["03_logic.sql", "Views, triggers, procedures, role"],
    ["04_data.sql", "Seeded data and recruitment simulation"], ["05_queries.sql", "The five queries"], ["06_demo.sql", "Scripted psql demo"],
    ["app/", "FastAPI backend and web UI"], ["tests/", "pytest suite and results"], ["deliverables/", "Report, guide, testing report, runbook, slides, video, diagrams"],
  ], [2, 5]),
];

build("PlaceIQ_Project_Report.docx", "Project Report", children);
