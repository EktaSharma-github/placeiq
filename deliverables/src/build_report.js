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

// ------------------------------------------------------------ Phase 4 analytics
// Query text, business question and relational algebra come straight from
// 07_analytics.sql (same "-- A1. TITLE" block format the notebook parses).
const fs = require("fs");
const path = require("path");
const A = D.analytics, M = A.model;
const ASQL = (() => {
  const src = fs.readFileSync(path.join(L.PROJECT, "07_analytics.sql"), "utf8").replace(/\r/g, "");
  const out = {};
  for (const m of src.matchAll(/^-- ([AS]\d)\. ([^\n]*)\n([\s\S]*?)^-- =+\n\n([\s\S]*?;)\s*$/gm)) {
    const header = m[3].split("\n").map((l) => l.replace(/^--\s?/, ""));
    const section = (name) => {
      const i = header.findIndex((l) => l.trim() === name);
      if (i < 0) return "";
      const rest = header.slice(i + 1);
      const end = rest.findIndex((l) => /^[A-Z][A-Z ]+$/.test(l.trim()));
      return rest.slice(0, end < 0 ? undefined : end).map((l) => l.trim()).filter(Boolean).join(" ");
    };
    const raLines = (() => {
      const i = header.findIndex((l) => l.trim().startsWith("RELATIONAL ALGEBRA"));
      return header.slice(i + 1).map((l) => l.replace(/^ {2}/, "")).filter((l) => l.trim()).join("\n");
    })();
    out[m[1]] = { title: m[2].trim(), question: section("BUSINESS QUESTION"), concepts: section("FDS CONCEPTS"), algebra: raLines, sql: m[4] };
  }
  out.featureView = src.match(/CREATE VIEW v_student_features AS[\s\S]*?;/)[0];
  out.segmentDDL = src.match(/CREATE TABLE IF NOT EXISTS segment \([\s\S]*?CREATE INDEX[^;]*;/)[0];
  return out;
})();
const pctR = (n) => Math.round(Number(n));
const rowsOf = (objs, cols) => objs.map((o) => cols.map((k) => show(o[k])));
const seg = (name) => A.segment_profile.find((g) => g.segment_name === name);
const t6 = M.threshold.find((r) => Math.abs(r.t - 0.6) < 1e-9);
const s2Total = A.s2_actions.reduce((t, r) => t + r.n, 0);
const FIG = (f) => path.join(L.PROJECT, "analytics", "figures", f);

function analyticsQuery(label, resultRows, fractions, extra = []) {
  const q = ASQL[label];
  return [
    H3(`${label}. ${(q.title.charAt(0) + q.title.slice(1).toLowerCase()).replace(/\bcgpa\b/g, "CGPA")}`),
    P(`**Business question.** ${q.question}`),
    P(`**Concepts.** ${q.concepts}`),
    P("**Relational algebra.**"), code(q.algebra),
    code(q.sql),
    tcap(`${label} result`),
    table(Object.keys(A[label][0]), resultRows || rowsOf(A[label], Object.keys(A[label][0])), fractions || Object.keys(A[label][0]).map(() => 1), { size: 16 }),
    ...extra,
  ];
}

// A function, so its figures and tables are numbered where the chapter sits in the document.
const analyticsChapter = () => [
  H1("10. Analytics: statistics in SQL and k-means segmentation"),
  P("Analytics means taking decisions from data. Chapters 3–9 built a database that stores a placement season correctly; this chapter uses it to answer a question the committee cannot answer from a spreadsheet:"),
  callout("Analytical question", "Which kinds of students does the current placement process serve badly, and what should the committee do for each kind?", { fill: L.COLOR.tealSoft, color: L.COLOR.teal }),
  P("The workflow follows the order taught in class. Statistics first, then the model. The database does as much of the work as possible, so only a small feature matrix ever leaves it:"),
  ...numbered([
    "**Descriptive statistics and cross-tabs in SQL** (queries A1–A5 in 07_analytics.sql).",
    "**Feature engineering in SQL:** the view v_student_features turns six normalized tables into one row per student.",
    "**Statistical tests** (correlation, ANOVA, point-biserial) to see which features carry signal before any model is fitted.",
    "**k-means clustering** in Python (scikit-learn) on standardized profile features; k chosen by elbow and silhouette.",
    "**Validation against outcomes** that were never clustering inputs (χ² and Kruskal–Wallis tests).",
    "**Write-back:** cluster labels are stored in BCNF tables, and SQL queries them again (S1, S2).",
    "**Classification threshold:** a logistic model of P(offer) shows the false-positive / false-negative trade-off.",
  ]),
  callout("Why a DBMS for analytics?", [
    "An algorithm runs in memory, and loading every raw record for every question does not scale. Most questions need only an aggregate: \"how many students with a CGPA of 8–9 were placed?\" is one GROUP BY.",
    `In PlaceIQ the DBMS computes all statistics and the whole feature matrix. Python receives ${M.n_students} rows × ${M.features.length} features, not the ${fmt(c.application)} applications and ${fmt(c.interview)} interviews they summarise.`,
  ]),

  H2("10.1 Descriptive statistics in SQL"),
  P("Each query below carries its business question, the course concepts it demonstrates and its relational algebra, exactly as written in 07_analytics.sql."),
  ...analyticsQuery("A1", null, null, [
    P(`**Reading.** Mean ≈ median (${A.A1.find((r) => r.program === "ALL").mean} vs ${A.A1.find((r) => r.program === "ALL").median}), so CGPA is roughly symmetric. The three programs have almost the same centre and spread; a one-way ANOVA confirms it (F = ${M.anova_cgpa_program.F}, p = ${M.anova_cgpa_program.p}), so program and CGPA carry different information.`),
  ]),
  ...analyticsQuery("A2", null, [1, 1.4, 1, 1, 1, 1.2], [
    ...figure(FIG("01_cgpa_band.png"), "Final placement rate by CGPA band (query A2).", 5.2),
    P(`**Reading.** No student below a CGPA of 7 has a final placement yet, against ${pctR(A.A2[A.A2.length - 1].placed_pct)}% of those above 9. CGPA is a strong feature, but not a sufficient one: most of the 8–9 band is still unplaced.`),
  ]),
  ...analyticsQuery("A3", null, null, [
    P("**Reading.** About 45% of applications reach an interview in every program, yet only 4–9% become offers: students are lost after the interview, not at CV screening."),
  ]),
  ...analyticsQuery("A4", null, [2, 1.2, 1.4, 1.2], [
    P(`**Reading.** ${A.A4[0].skill_name}, ${A.A4[1].skill_name} and ${A.A4[2].skill_name} have the most jobs per proficient student, so skill workshops there have the highest return.`),
  ]),
  ...analyticsQuery("A5", null, null, [
    P(`**Reading.** For PGP the mean CTC (₹${A.A5.find((r) => r.program === "PGP").mean_ctc} L) is well above the median (₹${A.A5.find((r) => r.program === "PGP").median_ctc} L): a few high offers skew the distribution, so the brochure should quote the median.`),
  ]),

  H2("10.2 Feature engineering"),
  P("Feature engineering means modelling the problem as data, which needs domain knowledge. The committee can see five things about a student early in the season:"),
  tcap("Profile features (clustering inputs)"),
  table(["Feature", "Why it should matter", "Built from"], [
    ["cgpa", "Recruiters' first filter (A2)", "student"],
    ["tech_score", "Analytics roles screen on Python, SQL, ML, Statistics, Big Data, Tableau, R", "Σ proficiency over technical skills (student_skill ⋈ skill)"],
    ["biz_score", "Consulting and finance roles screen on cases, Excel, communication, financial modelling, product management", "Σ proficiency over business skills"],
    ["applications", "No application, no offer", "count(application)"],
    ["interview_rate", "Share of applications that reached an interview: a proxy for CV quality", "application, interview"],
  ], [1.3, 3.6, 2.8], { size: 17 }),
  P("**Outcomes are deliberately not inputs.** offers, accepted_offer and best_ctc_lpa are kept in the view for validation only. Clustering on them would make \"students with offers do well\" true by construction; instead we cluster on profile and judge the segments on outcome."),
  P("The view is a single statement over six tables. Every column is recomputed from the normalized data whenever it is read, so the features can never go stale."),
  code(ASQL.featureView),

  H2("10.3 Statistics before modelling"),
  ...figure(FIG("02_correlation.png"), "Pearson correlations between profile features and outcomes.", 4.6),
  tcap("Statistical tests"),
  table(["Test", "Hypothesis / measure", "Result", "Conclusion"], [
    ["Pearson correlation", "tech_score vs biz_score", `r = ${M.corr_tech_biz}`, "Students specialise; the main axis the clusters will find"],
    ["One-way ANOVA", "H₀: equal mean CGPA in all programs", `F = ${M.anova_cgpa_program.F}, p = ${M.anova_cgpa_program.p}`, "Not rejected: programs do not differ in CGPA"],
    ...Object.entries(M.pointbiserial_accepted).map(([f, v]) => [
      "Point-biserial", `accepted_offer vs ${f}`, `r = ${v.r}, p = ${v.p}`, v.p < 0.05 ? "Significant association" : "Not significant on its own"]),
  ], [1.5, 2.6, 1.7, 2.6], { size: 17 }),

  H2("10.4 k-means clustering"),
  P("**Scaling.** k-means assigns points to the nearest centroid by Euclidean distance. Unscaled, applications (0–14) would dominate interview_rate (0–1), so every feature is standardized to mean 0 and standard deviation 1 (StandardScaler)."),
  P("**Algorithm.** k-means++ initialisation, 20 restarts, fixed random seed (reproducible). For each k it minimises the within-cluster sum of squares (inertia)."),
  P("**Choosing k.** Inertia always falls as k grows, so we look for the elbow and check it against the silhouette score: how much closer each point is to its own cluster than to the next, from −1 to 1."),
  tcap("k scan"),
  table(["k", "Inertia", "Mean silhouette"], M.k_scan.map((r) => [r.k, r.inertia, r.silhouette]), [1, 2, 2]),
  ...figure(FIG("03_choose_k.png"), `Elbow and silhouette: both point to k = ${M.k}.`, 6.0),
  P(`k = ${M.k} gives the highest silhouette (${M.k_scan.find((r) => r.k === M.k).silhouette}) and sits at the elbow. A silhouette near 0.3 means the segments overlap somewhat, which is normal for data about people. The segments are named from their centroids by rule (most technical; then most applications; then highest interview rate), so the names do not depend on the arbitrary cluster numbering.`),
  ...figure(FIG("04_segments_pca.png"), `The segments on the first two principal components (${M.pca_var_pct[0]}% and ${M.pca_var_pct[1]}% of variance), one panel per segment.`),
  ...figure(FIG("05_segment_fingerprints.png"), "Segment fingerprints: each centroid in standard deviations from the campus mean."),
  tcap("Segment profiles (view v_segment_profile)"),
  table(["Segment", "n", "CGPA", "Tech", "Biz", "Apps", "Interview rate", "Offers", "Accepted %", "Best CTC"],
    A.segment_profile.map((g) => [g.segment_name, g.students, g.avg_cgpa, g.avg_tech, g.avg_biz, g.avg_apps, g.avg_interview_rate, g.avg_offers, g.accepted_pct, show(g.avg_best_ctc)]),
    [2.4, 0.6, 0.8, 0.8, 0.8, 0.8, 1.1, 0.9, 1.1, 1], { size: 16 }),

  H2("10.5 Validating the segments against outcomes"),
  P(`The segments were built without any outcome data. If they still differ in outcomes, the profile features capture something real. A χ² test of independence between segment and accepted offer gives χ² = ${M.chi2_segment_offer.chi2} (dof ${M.chi2_segment_offer.dof}, p = ${M.chi2_segment_offer.p}); a Kruskal–Wallis test on the number of offers gives H = ${M.kruskal_offers.H} (p = ${M.kruskal_offers.p}). Both reject independence decisively.`),
  ...figure(FIG("06_segment_outcomes.png"), "Share of each segment with an accepted offer.", 5.2),
  tcap("Interpretation and recommended action"),
  table(["Segment", "Who they are", "Recommended action"], [
    ["High-Achieving Generalists", `High CGPA (${seg("High-Achieving Generalists").avg_cgpa}), business skills, about ${pctR(seg("High-Achieving Generalists").avg_apps)} applications each; ${pctR(seg("High-Achieving Generalists").accepted_pct)}% accepted`, "Nothing urgent; help them choose between offers"],
    ["Tech Specialists", `Mostly PGDBA, strong technical skills; ${pctR(seg("Tech Specialists").accepted_pct)}% accepted, highest CTC (₹${seg("Tech Specialists").avg_best_ctc} L)`, "Steer towards analytics roles where A4 shows demand"],
    ["Selective Appliers", `Average CGPA, ${pctR(seg("Selective Appliers").avg_interview_rate * 100)}% reach interview, but only ${seg("Selective Appliers").avg_apps} applications; ${pctR(seg("Selective Appliers").accepted_pct)}% accepted`, "Apply more widely: their CVs work, their reach does not"],
    ["At-Risk", `Lowest CGPA (${seg("At-Risk").avg_cgpa}), few applications, rarely shortlisted; ${pctR(seg("At-Risk").accepted_pct)}% accepted`, "Priority: CV review, then mock interviews"],
  ], [1.8, 3.6, 2.4], { size: 17 }),
  P("The non-obvious finding is the Selective Appliers. Their CGPA is near the average, so no CGPA cut-off would flag them; the clustering found them through behaviour."),

  H2("10.6 Writing the segments back to the database"),
  P("The labels are stored in the database, not in a CSV on one laptop, so every other query can join on them. Two tables keep the design in BCNF: segment → segment_name would be a dependency on a non-key attribute if the name were stored with each student. The foreign keys guarantee that every label belongs to a real student and a real segment, and the foreign key is indexed like every other in the schema."),
  code(ASQL.segmentDDL),
  P("The notebook replaces the whole segmentation in one transaction (DELETE both tables, INSERT the new rows, COMMIT). Either every student gets the new label or nothing changes, so a failed run can never leave a mixture of old and new labels."),
  ...analyticsQuery("S1", null, [1.2, 2.2, 1, 1.3], [
    P("**Reading.** PGDBA is almost a single segment, but PGP and PGPEX each spread across three. A program-wide policy (\"one workshop for all PGP students\") would miss most of their at-risk students."),
  ]),
  ...(() => {
    const q = ASQL.S2;
    return [
      H3("S2. Who needs help now?"),
      P(`**Business question.** ${q.question}`), P(`**Concepts.** ${q.concepts}`),
      P("**Relational algebra.**"), code(q.algebra), code(q.sql),
      tcap(`S2 result, summarised (${s2Total} students)`),
      table(["Segment", "Suggested action", "Students"], A.s2_actions.map((r) => [r.segment_name, r.suggested_action, r.n]), [2, 3, 1]),
      P(`**Reading.** The query turns the analysis into a weekly to-do list for the committee. More than half of the ${s2Total} students simply need to apply to more roles, which costs the committee only a reminder.`),
    ];
  })(),

  H2("10.7 Choosing a classification threshold"),
  P("A classifier outputs a probability. Someone must choose the threshold t that turns it into a decision. Here a logistic regression estimates P(offer | profile) with 5-fold cross-validation, so every student is scored by a model that never saw them. A student is flagged for support if P(offer) < t."),
  tcap("Threshold sweep (positive class: student with no offer)"),
  table(["t", "Flagged", "TP", "FP", "FN", "TN", "Precision", "Recall"],
    M.threshold.map((r) => [r.t, r.flagged, r.TP, r.FP, r.FN, r.TN, r.precision, r.recall]), [1, 1, 1, 1, 1, 1, 1.2, 1.2], { size: 17 }),
  ...figure(FIG("07_threshold.png"), "Precision and recall as the threshold changes.", 5.2),
  P(`A low t misses students who end up with no offer (false negatives). A high t spends workshop seats on students who would have been fine (false positives). A missed student costs more, so a threshold around 0.6 is defensible: it catches ${pctR(t6.recall * 100)}% of the students with no offer at ${pctR(t6.precision * 100)}% precision. The standardized coefficients agree with the clusters: CGPA (${M.logit_coef.cgpa}) and applications (${M.logit_coef.applications}) dominate.`),

  H2("10.8 Limitations of the analysis"),
  ...bullets([
    "The data is simulated by 04_data.sql, so effect sizes reflect how the simulation was written. The method, not the numbers, is what transfers to a real season.",
    "The final cycle is in progress; outcomes are a snapshot and will change.",
    `A silhouette of ${M.k_scan.find((r) => r.k === M.k).silhouette} means the segment boundaries are soft: borderline students deserve individual attention.`,
    "Segments are recomputed by running the notebook; a database rebuild empties the segment tables until it is run again.",
  ]),
];

const children = [
  ...cover({ kind: "Project report", title: "PlaceIQ", subtitle: "Campus Placement & Recruitment Management System: a PostgreSQL database that enforces its own rules" }),

  L.H1n("Abstract"),
  P(`Campus placement committees typically run recruitment from shared spreadsheets: one row per student, per company, per interview round. Such files duplicate data, suffer update, insertion and deletion anomalies, and cannot enforce policy. PlaceIQ replaces the spreadsheet with a relational database in PostgreSQL 18 whose design follows the full arc of the Fundamentals of Database Systems course. We built an Enhanced ER model using overlapping and disjoint specialization, a weak entity, aggregation and a category (union type); mapped it to ${cat.tables} relations; and proved every relation to be in Boyce–Codd Normal Form. Fifteen business rules are enforced inside the database by ${cat.constraints.c} CHECK constraints, ${cat.constraints.f} foreign keys (several composite), an exclusion constraint, ${cat.triggers} triggers and stored procedures. Seeded mock data for ${c.student} students, ${c.company} companies, ${fmt(c.application)} applications and ${fmt(c.interview)} interviews is loaded through those same rules. Five analytical queries demonstrate joins, HAVING, relational division, correlated subqueries and window functions. An analytics layer then asks which students the process serves badly: descriptive statistics and a feature matrix are computed in SQL, and k-means clustering finds ${A.segment_profile.length} student segments that differ sharply in placement outcome (χ² p = ${M.chi2_segment_offer.p}) although outcomes were never clustering inputs. The segments are written back to BCNF tables, and a SQL query turns them into an action list of ${s2Total} students. A composite index made a representative query ${fmt(speedup)} times faster on 600,000 rows. A FastAPI web interface, an SQL-injection laboratory sandboxed by a least-privilege role, and an automated suite of ${T.total} tests (all passing) complete the project.`),

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
    "Analyse the data: descriptive statistics and feature engineering in SQL, then k-means segmentation validated with statistical tests, with the results stored back in the database.",
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
    ["Scripts", "SQL files 02–07, PowerShell run_all.ps1", "Repeatable build: DDL → logic → data → queries → demo → analytics"],
    ["Analytics", "Jupyter, pandas, scikit-learn, SciPy, matplotlib", "Statistical tests, k-means, logistic regression, figures"],
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
  P(`The counts describe the designed schema. The analytics layer (chapter 10) adds ${cat.analytics_tables} tables (segment, student_segment), two foreign keys with their index, and two views (v_student_features, v_segment_profile).`),
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

  ...analyticsChapter(),

  // ------------------------------------------------------------------ 11
  H1("11. Transactions and concurrency"),
  tcap("ACID properties in PlaceIQ"),
  table(["Property", "How the project demonstrates it", "Test"], [
    ["Atomicity", "Accepting an offer and its whole cascade is one transaction; a ROLLBACK restores offers, applications, interviews and the log", "TC-TXN-01"],
    ["Consistency", "Constraints at statement end; deferred totality trigger at COMMIT; a job without a subtype cannot commit", "TC-TXN-04, TC-CON-05"],
    ["Isolation", "Concurrent acceptances for one student are serialized by a row lock on the student", "TC-TXN-02, 03"],
    ["Durability", "After COMMIT returns, PostgreSQL's write-ahead log preserves the change across a crash", "(engine guarantee)"],
  ], [1.3, 4.8, 1.6], { size: 17 }),
  H2("11.1 The concurrency scenario"),
  P("Under the default READ COMMITTED isolation level, two sessions accepting two different offers for the same student could both pass the 'no other accepted offer' check before either commits, leaving the student with two accepted offers. sp_accept_offer therefore takes SELECT … FOR UPDATE on the student's row before touching any offer. Session B blocks until session A commits; it then re-reads its offer, finds that A's cascade has already declined it, and aborts. The automated test runs this with two real connections and a thread, and asserts that exactly one accepted offer remains."),
  H2("11.2 Lock order and deadlock"),
  P("An earlier version locked the offer row first. Two concurrent acceptances could then each hold one offer while their cascades needed the other's, a classic deadlock (PostgreSQL would detect it and abort one session). Locking the common parent row, the student, first imposes a single global lock order, which eliminates the cycle."),

  // ------------------------------------------------------------------ 12
  H1("12. Performance and indexing"),
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

  // ------------------------------------------------------------------ 13
  H1("13. Security"),
  H2("13.1 SQL injection"),
  P("Every query in the application passes user input as a bound parameter (psycopg %s placeholders, sent separately from the SQL text as $1, $2 …), so input can never change the structure of a statement. To demonstrate the difference, the web interface includes a laboratory that runs the same student search two ways."),
  table(["Input", "String concatenation", "Bound parameter"], [
    ["Sen", "6 rows", "6 rows"], ["x' OR '1'='1", "180 rows: every student leaked", "0 rows"],
    ["x' UNION SELECT roll_no, cgpa::text, phone …", "180 rows of CGPAs and phone numbers", "0 rows"],
    ["x'; DROP TABLE student; --", "Refused: SQLSTATE 25006 (read-only transaction)", "0 rows"],
  ], [2.8, 2.7, 1.6], { size: 17 }),
  H2("13.2 Least privilege (DCL)"),
  code(`CREATE ROLE placeiq_readonly NOLOGIN;
GRANT USAGE  ON SCHEMA placeiq TO placeiq_readonly;
GRANT SELECT ON placeiq.student, placeiq.person TO placeiq_readonly;`),
  P("The deliberately vulnerable path runs as this role, inside a READ ONLY transaction with a two-second statement timeout, and is always rolled back. Even a successful injection can therefore only read two tables: writes fail, other tables are denied (SQLSTATE 42501) and superuser functions such as pg_read_file are unavailable. The web server binds to 127.0.0.1 only."),

  // ------------------------------------------------------------------ 14
  H1("14. Application layer"),
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

  // ------------------------------------------------------------------ 15
  H1("15. Testing summary"),
  P(`The automated suite (tests/) contains ${T.total} test cases that run against the real database with pytest; all ${T.passed} pass. Each test runs in a transaction that is rolled back, the database is rebuilt at the start and end of a run, and tests that must commit (concurrency, API writes) restore the seed afterwards. Full details, the traceability matrix and the defect log are in the separate Testing Report.`),
  (() => { const m = {}; D.tests.tests.forEach((t) => { m[t.module] = (m[t.module] || 0) + 1; });
    return table(["Module", "Tests", "Result"], Object.entries(m).map(([k, v]) => [k, v, "All passed"]), [3, 1, 2]); })(),

  // ------------------------------------------------------------------ 16
  H1("16. Learnings, limitations and future work"),
  H2("16.1 What we learned"),
  ...bullets([
    "**Modelling decides what can be enforced.** Treating the application as an aggregation is what made it possible to guarantee, with plain foreign keys, that interviews and offers belong to a real application.",
    "**Normalization is a proof, not a feeling.** Writing every functional dependency exposed the transitive dependency hidden in min_cgpa and justified the Eligibility table.",
    "**Declare before you code.** CHECK constraints, composite foreign keys and an exclusion constraint reject bad data even when the application is bypassed; triggers are for what cannot be declared.",
    "**Concurrency must be tested, not assumed.** A two-connection test showed why lock order matters and turned a possible deadlock into a clean queue.",
    "**Measure performance.** The leading-column rule behaved differently on PostgreSQL 18 than the textbook summary suggested; measuring blocks read gave the accurate explanation.",
    "**Let the DBMS do the first pass of analytics.** Statistics, cross-tabs and the feature matrix are SQL; only a small matrix reached Python.",
    "**Cluster on profile, judge on outcome.** Keeping outcomes out of the clustering made the χ² validation meaningful, and surfaced the Selective Appliers, whom a CGPA cut-off would never flag.",
  ]),
  H2("16.2 Limitations"),
  ...bullets([
    "Synthetic data: distributions are plausible but not drawn from a real placement season, so the analytics findings illustrate the method rather than a real campus.",
    "No user authentication or row-level security per student or recruiter.",
    "The UI is a teaching interface, tested end to end through the recorded demo rather than a browser test suite.",
  ]),
  H2("16.3 Future work"),
  ...bullets([
    "Row-level security policies so that each student sees only their own rows.",
    "SERIALIZABLE isolation as an alternative to explicit locking, with retry logic.",
    "Table partitioning of the application archive by academic year.",
    "Materialized views for the dashboard with scheduled refresh.",
  ]),

  // ------------------------------------------------------------------ 17
  H1("17. Team contribution"),
  table(["Member", "Name", "Owned in the project and the presentation"], [
    ["M1", TEAM[0], "Problem analysis, business rules, EER model (both views), Chen diagrams"],
    ["M2", TEAM[1], "ER-to-relational mapping, keys, functional dependencies, normalization to BCNF and proofs, DDL and integrity techniques"],
    ["M3", TEAM[2], "Data generation, the five analytical queries, triggers and procedures, transactions and concurrency, live demo"],
    ["M4", TEAM[3], "Analytics (SQL statistics, feature engineering, k-means, validation, write-back), indexing, security, testing"],
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
app\\.venv\\Scripts\\python -m pytest tests -v

# 5. Analytics (after any rebuild; fills the segment tables)
cd analytics
jupyter nbconvert --to notebook --execute --inplace placeiq_kmeans.ipynb`),
  H1n("Appendix B. Repository contents"),
  table(["Path", "Contents"], [
    ["01_design.md", "Design notes: rules, EER, mapping, normalization"], ["02_ddl.sql", "Schema"], ["03_logic.sql", "Views, triggers, procedures, role"],
    ["04_data.sql", "Seeded data and recruitment simulation"], ["05_queries.sql", "The five queries"], ["06_demo.sql", "Scripted psql demo"],
    ["07_analytics.sql", "SQL statistics, feature view, segment tables and queries"], ["analytics/", "k-means notebook (also as HTML) and figures"],
    ["app/", "FastAPI backend and web UI"], ["tests/", "pytest suite and results"], ["deliverables/", "Report, guide, testing report, runbook, slides, video, diagrams"],
  ], [2, 5]),
];

build("PlaceIQ_Project_Report.docx", "Project Report", children);
