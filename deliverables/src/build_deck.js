/*
 * Builds deliverables/PlaceIQ_Presentation.pptx (20 slides, 15 minutes, 4 presenters).
 *   node deliverables/src/build_deck.js
 * Every number comes from data.json (exported from the database and test results).
 */
const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

const D = JSON.parse(fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
const ROOT = path.resolve(__dirname, "..");
const PROJECT = path.resolve(ROOT, "..");
const img = (p) => path.join(ROOT, p);
const TEAM = ["Ekta Sharma", "[Member 2]", "[Member 3]", "[Member 4]"];
const SEG = ["Problem & EER", "Schema, normalization & DDL", "SQL queries & rules", "Analytics & performance"];

const C = {
  navy: "111827", ink: "1F2937", body: "374151", muted: "6B7280", line: "E5E7EB", soft: "F6F7FB",
  indigo: "4F46E5", indigoSoft: "EEF0FF", indigoDark: "312E81",
  amber: "C2410C", amberSoft: "FFF4E6", teal: "0F766E", tealSoft: "E6F6F3",
  red: "DC2626", redSoft: "FDECEA", white: "FFFFFF", slate: "CBD5E1",
};
const HEAD = "Cambria", BODY = "Calibri", MONO = "Courier New";

// ------------------------------------------------------------ derived figures
const counts = D.counts;
const finalCycle = D.cycles.find((c) => c.cycle_id === 2);
const summer = D.cycles.find((c) => c.cycle_id === 1);
const perf = D.performance;
const speedup = Math.round(perf.seq_scan_ms / perf.composite_index_ms);
const shrink = Math.round(perf.full_index_kb / perf.partial_index_kb);
const T = D.tests.totals;
const Q = Object.fromEntries(D.queries.map((q) => [q.id, q]));
const q1top = Q[1].rows[0];
const q4 = Q[4];
const pgdbaFinal = q4.rows.filter((r) => r[1] === "PGDBA").slice(-1)[0];
const fmt = (n) => Number(n).toLocaleString("en-IN");
const pct = (n) => Math.round(Number(n));

// analytics (07_analytics.sql + analytics/placeiq_kmeans.ipynb)
const A = D.analytics;
const M = A.model;
const a1All = A.A1.find((r) => r.program === "ALL");
const funnel = {
  intMin: Math.min(...A.A3.map((r) => pct(100 * r.interviewed / r.applications))),
  intMax: Math.max(...A.A3.map((r) => pct(100 * r.interviewed / r.applications))),
  offMin: Math.min(...A.A3.map((r) => pct(r.app_to_offer_pct))),
  offMax: Math.max(...A.A3.map((r) => pct(r.app_to_offer_pct))),
};
const seg = (name) => A.segment_profile.find((g) => g.segment_name === name);
// same colours as analytics/figures, so a segment looks the same everywhere
const SEGCOLOR = { "High-Achieving Generalists": "1BAF7A", "Tech Specialists": "2A78D6", "Selective Appliers": "EDA100", "At-Risk": "EB6834" };

// ------------------------------------------------------------ presentation
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
pres.title = "PlaceIQ: Campus Placement & Recruitment Database";
pres.author = TEAM.join(", ");
pres.company = "PGDBA Batch 12, IIM Calcutta";
pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };

pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.white },
  margin: [0.5, 0.6, 0.5, 0.6],
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.38, w: 10.0, h: 0.8, fontFace: HEAD,
      fontSize: 30, bold: true, color: C.navy, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "PlaceIQ  ·  Fundamentals of Database Systems", options: { x: 0.6, y: 7.02, w: 6, h: 0.3,
      fontSize: 10, color: C.muted, fontFace: BODY, margin: 0 } } },
  ],
  slideNumber: { x: 12.25, y: 7.02, w: 0.5, h: 0.3, fontSize: 10, color: C.muted, fontFace: BODY, align: "right" },
});
pres.defineSlideMaster({ title: "DARK", background: { color: C.navy }, objects: [] });

// ------------------------------------------------------------ helpers
function content(title, member, section) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  speaker(s, member);
  return s;
}

function speaker(s, m, dark = false) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 10.85, y: 0.5, w: 1.9, h: 0.44, rectRadius: 0.22,
    fill: { color: dark ? "1F2937" : C.indigoSoft }, line: { color: dark ? "374151" : C.indigoSoft }, objectName: "speaker-chip" });
  s.addText([{ text: `M${m}  `, options: { bold: true, color: dark ? "A5B4FC" : C.indigo } },
             { text: TEAM[m - 1], options: { color: dark ? C.slate : C.indigoDark } }],
    { x: 10.85, y: 0.5, w: 1.9, h: 0.44, fontSize: 12, align: "center", valign: "middle", margin: 0, isTextBox: true });
}

function card(s, x, y, w, h, { fill = C.soft, line = C.line, title, body, titleColor = C.ink, titleSize = 15, bodySize = 13, bodyColor = C.body } = {}) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: line, width: 1 } });
  const parts = [];
  if (title) parts.push({ text: title, options: { bold: true, fontSize: titleSize, color: titleColor, breakLine: !!body, paraSpaceAfter: 4 } });
  if (body) {
    const lines = Array.isArray(body) ? body : [body];
    lines.forEach((t, i) => parts.push({ text: t, options: { fontSize: bodySize, color: bodyColor, breakLine: i < lines.length - 1, paraSpaceAfter: 3 } }));
  }
  s.addText(parts, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: h - 0.24, valign: "top", margin: 0, isTextBox: true, fontFace: BODY });
}

function stat(s, x, y, w, value, label, color = C.indigo, valueSize = 34) {
  s.addText(value, { x, y, w, h: 0.7, fontSize: valueSize, bold: true, color, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText(label, { x, y: y + 0.72, w, h: 0.5, fontSize: 12.5, color: C.muted, margin: 0, isTextBox: true, valign: "top" });
}

function circleNum(s, x, y, text, fill = C.indigo, size = 0.5, fontSize = 16) {
  s.addShape(pres.shapes.OVAL, { x, y, w: size, h: size, fill: { color: fill }, line: { color: fill } });
  s.addText(text, { x, y, w: size, h: size, fontSize, bold: true, color: C.white, align: "center", valign: "middle", margin: 0, isTextBox: true });
}

function code(s, x, y, w, h, text, fontSize = 11.5) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: "0F172A" }, line: { color: "0F172A" } });
  s.addText(text, { x: x + 0.2, y: y + 0.15, w: w - 0.4, h: h - 0.3, fontFace: MONO, fontSize, color: "E2E8F0", valign: "top", margin: 0, isTextBox: true });
}

function image(s, file, x, y, w, h, border = true) {
  if (border) s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x - 0.04, y: y - 0.04, w: w + 0.08, h: h + 0.08, rectRadius: 0.05,
    fill: { color: C.white }, line: { color: C.line, width: 1 } });
  s.addImage({ path: img(file), x, y, w, h });
}

function table(s, rows, x, y, w, colW, { fontSize = 12, header = C.indigo, rowH = 0.36 } = {}) {
  const body = rows.map((r, i) => r.map((cell) => ({
    text: String(cell),
    options: i === 0
      ? { bold: true, color: C.white, fill: { color: header }, fontSize: fontSize }
      : { color: C.body, fill: { color: i % 2 ? C.white : C.soft }, fontSize },
  })));
  s.addTable(body, { x, y, w, colW, rowH, border: { type: "solid", pt: 0.75, color: C.line }, fontFace: BODY, valign: "middle", margin: [0.04, 0.08, 0.04, 0.08] });
}

// ============================================================ 1. Title (M1)
pres.addSection({ title: "M1 · Problem & EER" });
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: "M1 · Problem & EER" });
  s.addText("FDS COURSE PROJECT  ·  PGDBA BATCH 12  ·  IIM CALCUTTA", { x: 0.7, y: 1.0, w: 6.2, h: 0.35, fontSize: 12, bold: true, color: "FDBA74", charSpacing: 2, margin: 0, isTextBox: true });
  s.addText("PlaceIQ", { x: 0.7, y: 1.45, w: 6, h: 1.2, fontSize: 64, bold: true, color: C.white, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("A campus placement & recruitment database that enforces its own rules", { x: 0.7, y: 2.75, w: 5.8, h: 1.0, fontSize: 22, color: C.slate, margin: 0, isTextBox: true, valign: "top" });
  s.addText("Fundamentals of Database Systems  ·  Prof. Debapriyay Mukhopadhyay", { x: 0.7, y: 4.0, w: 6, h: 0.4, fontSize: 14, color: "94A3B8", margin: 0, isTextBox: true });
  TEAM.forEach((name, i) => {
    const x = 0.7 + (i % 2) * 2.95, y = 4.7 + Math.floor(i / 2) * 0.62;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 2.8, h: 0.5, rectRadius: 0.25, fill: { color: "1F2937" }, line: { color: "374151" } });
    s.addText([{ text: `M${i + 1}  `, options: { bold: true, color: "A5B4FC" } }, { text: name, options: { color: C.white } }],
      { x, y, w: 2.8, h: 0.5, fontSize: 14, align: "center", valign: "middle", margin: 0, isTextBox: true });
  });
  s.addText("November 2026", { x: 0.7, y: 6.6, w: 3, h: 0.35, fontSize: 12, color: "94A3B8", margin: 0, isTextBox: true });
  s.addImage({ path: path.join(PROJECT, "docs", "screenshots", "dashboard.png"), x: 7.0, y: 1.0, w: 5.75, h: 4.71, shadow: { type: "outer", blur: 12, offset: 4, angle: 90, color: "000000", opacity: 0.45 } });
  s.addText("Live web UI over PostgreSQL 18: every number on screen is computed by SQL", { x: 7.0, y: 5.85, w: 5.75, h: 0.4, fontSize: 12, italic: true, color: "94A3B8", margin: 0, isTextBox: true });
  s.addNotes(`[M1 · ${TEAM[0]} · 0:00–0:25]
Good morning. We are presenting PlaceIQ, a database for campus placements.
The one-line idea: today the placement committee runs recruitment from spreadsheets, and spreadsheets cannot stop anyone from breaking the rules or answer analytical questions. We moved the rules into the database itself, and then used the same database to analyse which students the process serves badly.
Each of the four of us will present one part: design, normalization, SQL and rules, and finally analytics.`);
}

// ============================================================ 2. Agenda (M1)
{
  const s = content("Four parts, four presenters", 1, "M1 · Problem & EER");
  const topics = [
    ["Problem & anomalies", "Business rules", "EER model: specialization, weak entity, aggregation, union type"],
    ["EER → relational mapping, keys", "FDs, 1NF → BCNF, lossless & dependency-preserving", "DDL: constraints as rules"],
    ["Seeded, reproducible data", "Five queries: division, windows, HAVING", "Triggers & live demo"],
    ["Statistics in SQL", "Feature engineering, k-means", "Segments back in the DB; indexing, security"],
  ];
  const times = ["0:00 – 3:15", "3:15 – 7:00", "7:00 – 10:30", "10:30 – 15:00"];
  TEAM.forEach((name, i) => {
    const x = 0.6 + i * 3.08;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.55, w: 2.88, h: 4.35, rectRadius: 0.1, fill: { color: i % 2 ? C.white : C.soft }, line: { color: C.line } });
    circleNum(s, x + 0.25, 1.8, `M${i + 1}`, C.indigo, 0.62, 15);
    s.addText(name, { x: x + 0.25, y: 2.55, w: 2.4, h: 0.4, fontSize: 17, bold: true, color: C.ink, margin: 0, isTextBox: true });
    s.addText(SEG[i], { x: x + 0.25, y: 2.95, w: 2.45, h: 0.6, fontSize: 14, color: C.indigo, bold: true, margin: 0, isTextBox: true, valign: "top" });
    s.addText(times[i], { x: x + 0.25, y: 3.55, w: 2.4, h: 0.35, fontSize: 13, color: C.muted, margin: 0, isTextBox: true });
    s.addText(topics[i].map((t, k) => ({ text: t, options: { bullet: true, breakLine: k < 2, paraSpaceAfter: 6 } })),
      { x: x + 0.2, y: 4.0, w: 2.5, h: 2.5, fontSize: 13.5, color: C.body, valign: "top", margin: 0, isTextBox: true });
  });
  s.addNotes(`[M1 · ${TEAM[0]} · 0:25–0:45]
Here is how the 15 minutes are split. I will cover the problem and the conceptual model. ${TEAM[1]} turns it into a normalized schema and DDL. ${TEAM[2]} shows the data, our queries and the triggers, live. ${TEAM[3]} shows what the data tells us: statistics in SQL and k-means clustering, then indexing and security.`);
}

// ============================================================ 3. Problem (M1)
{
  const s = content("One spreadsheet, three anomalies", 1, "M1 · Problem & EER");
  const sheet = [
    ["roll_no", "company", "hq_city", "role", "pay", "round", "result"],
    ["DBA12-007", "Northbridge", "Mumbai", "Assoc. Consultant", "34 LPA", "1 CASE", "CLEARED"],
    ["DBA12-007", "Northbridge", "Mumbai", "Assoc. Consultant", "34 LPA", "2 CASE", "SCHEDULED"],
    ["DBA12-019", "Northbridge", "Mumbai", "Assoc. Consultant", "34 LPA", "—", "REJECTED"],
    ["PGP62-003", "Northbridge", "Mumbai", "Assoc. Consultant", "34 LPA", "1 CASE", "CLEARED"],
  ];
  table(s, sheet, 0.6, 1.5, 7.2, [1.1, 1.15, 0.95, 1.45, 0.75, 0.85, 0.95], { fontSize: 11.5, header: C.red, rowH: 0.34 });
  s.addText("Company, city, role and pay repeat on every applicant × round row", { x: 0.6, y: 3.3, w: 7.2, h: 0.3, fontSize: 12, italic: true, color: C.muted, margin: 0, isTextBox: true });
  const an = [
    ["Update", "Northbridge moves HQ: edit every row, miss one and the data contradicts itself."],
    ["Insertion", "A new job cannot be recorded until a student applies (roll_no is part of the key)."],
    ["Deletion", "Delete the only applicant and the job's pay, cut-off and rounds disappear too."],
  ];
  an.forEach(([t, b], i) => card(s, 0.6 + i * 2.45, 3.8, 2.3, 2.35, { fill: C.redSoft, line: "F5C2BF", title: `${t} anomaly`, titleColor: "B91C1C", body: b, bodySize: 13.5 }));
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 8.2, y: 1.5, w: 4.55, h: 5.05, rectRadius: 0.1, fill: { color: C.indigoSoft }, line: { color: C.indigoSoft } });
  s.addText("15", { x: 8.5, y: 1.7, w: 2, h: 1.0, fontSize: 60, bold: true, color: C.indigo, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("business rules, each enforced by the database, not by people", { x: 8.5, y: 2.75, w: 4.0, h: 0.7, fontSize: 15, color: C.indigoDark, bold: true, margin: 0, isTextBox: true, valign: "top" });
  s.addText([
    { text: "Eligibility: program, CGPA cut-off, backlogs, deadline", options: { bullet: true, breakLine: true } },
    { text: "No overlapping interview slots", options: { bullet: true, breakLine: true } },
    { text: "One accepted offer per cycle, with automatic withdrawal elsewhere", options: { bullet: true, breakLine: true } },
    { text: "Placed status derived, never typed in", options: { bullet: true, breakLine: true } },
    { text: "A student holding an offer cannot be deleted", options: { bullet: true } },
  ], { x: 8.5, y: 3.6, w: 4.05, h: 2.8, fontSize: 14, color: C.body, valign: "top", paraSpaceAfter: 6, margin: 0, isTextBox: true });
  s.addNotes(`[M1 · ${TEAM[0]} · 0:45–1:40]
Why this problem? All four of us are going through placements, so we know the data and the pain first-hand, and placement data is a rich mix: people, jobs, a multi-stage process, and outcomes we can analyse.
This is what the committee's sheet looks like: one row per student, per company, per interview round.
Look at the red header columns: Northbridge, Mumbai, the role and the pay repeat on every row. That causes the three classic anomalies.
Update: if the company changes its HQ we must edit every row. Insertion: we cannot even record a new job until someone applies, because roll number is part of the key. Deletion: delete the only applicant and the job vanishes with them.
Beyond anomalies, a file system cannot enforce rules. So we listed 15 business rules, on the right, and every one of them is enforced inside PostgreSQL: by constraints, triggers or views.`);
}

// ============================================================ 4. EER 1 (M1)
{
  const s = content("EER model (1/2): people, programs and sponsors", 1, "M1 · Problem & EER");
  image(s, "diagrams/eer_people.png", 1.4, 1.35, 10.55, 5.53);
  s.addNotes(`[M1 · ${TEAM[0]} · 1:40–2:25]
Our EER model is split in two views for readability. This one covers people.
PERSON is a superclass with an OVERLAPPING, PARTIAL specialization (the 'o' circle) into STUDENT, COMMITTEE_MEMBER, ALUMNUS and RECRUITER: overlapping because a student can also sit on the placement committee; partial because a guest speaker is just a person.
Note the attribute types: person_id is the key, name is composite, skills is multi-valued (double oval), and placement_status is derived (dashed oval) — we never store it.
On the right is the rarest EER construct: a CATEGORY or union type. SPONSOR is a subset of COMPANY UNION ALUMNUS: two superclasses of different types sharing one role. Double lines mark total participation, for example every student must be enrolled in a program.`);
}

// ============================================================ 5. EER 2 (M1)
{
  const s = content("EER model (2/2): the recruitment pipeline", 1, "M1 · Problem & EER");
  image(s, "diagrams/eer_pipeline.png", 0.6, 1.35, 9.25, 5.08);
  const notes = [
    ["Aggregation", "APPLIES_TO is treated as an entity: interviews and offers attach to an application, not to a student."],
    ["Weak entity", "INTERVIEW_ROUND is identified by (job_id, round_no) through HAS_ROUND."],
    ["Disjoint & total", "Every job is exactly one of internship or full-time ('d', double line)."],
  ];
  notes.forEach(([t, b], i) => card(s, 10.1, 1.35 + i * 1.74, 2.65, 1.6, { fill: i === 0 ? "F5F3FF" : C.soft, line: i === 0 ? "DDD6FE" : C.line, title: t, titleColor: i === 0 ? "6D28D9" : C.ink, body: b, bodySize: 12.5, titleSize: 14 }));
  s.addNotes(`[M1 · ${TEAM[0]} · 2:25–3:15]
The second view is the recruitment pipeline. STUDENT APPLIES_TO JOB_ROLE is many-to-many with attributes, status and applied_at.
The key modelling decision is AGGREGATION, the purple box. You do not interview a student in general; you interview an application, a student for a specific job. So the whole APPLIES_TO relationship is treated as an entity that participates in EVALUATED_IN with INTERVIEW_ROUND, and in RESULTS_IN with OFFER.
INTERVIEW_ROUND is a WEAK entity, 'round 2' means nothing without its job, so it is identified through the double-diamond HAS_ROUND, with round_no as its partial key.
JOB_ROLE has a DISJOINT, TOTAL specialization into internship and full-time: a stipend and a CTC are different attributes, and every job is exactly one of the two.
I now hand over to ${TEAM[1]}, who will turn this model into tables.`);
}

// ============================================================ 6. Mapping & keys (M2)
pres.addSection({ title: "M2 · Schema, normalization & DDL" });
{
  const s = content(`From EER to ${D.catalog.tables} relations, and their keys`, 2, "M2 · Schema, normalization & DDL");
  table(s, [
    ["Step", "Mapping rule", "Applied to"],
    ["1", "Strong entity → table", "program, person, company, job_role …"],
    ["2", "Weak entity → PK = owner PK + partial key", "interview_round (job_id, round_no)"],
    ["3–4", "1:1 / 1:N → foreign key on the N side", "student.program_id, offer → application"],
    ["5", "M:N → bridge table", "application, eligibility, interview"],
    ["6", "Multi-valued attribute → own table", "student_skill"],
    ["8A", "Specialization → table per subclass", "student, recruiter; internship_role …"],
    ["9", "Category → surrogate key + FK in members", "sponsor ← company, alumnus"],
  ], 0.6, 1.5, 7.3, [0.6, 3.2, 3.5], { fontSize: 12.5, rowH: 0.42 });
  const keys = [
    ["Super key", "Any attribute set that identifies a row: (person_id, email)"],
    ["Candidate keys", "Minimal super keys. placement_cycle has three: cycle_id, cycle_name, (cycle_type, academic_year)"],
    ["Primary & alternate", "job_id is primary; (company_id, cycle_id, title) stays UNIQUE as the alternate key"],
    ["Foreign keys", `${D.catalog.constraints.f} FKs, some composite: (posted_by, company_id) → recruiter`],
  ];
  keys.forEach(([t, b], i) => card(s, 8.25, 1.5 + i * 1.3, 4.5, 1.18, { title: t, body: b, bodySize: 12.5, titleSize: 14, titleColor: C.indigo }));
  s.addNotes(`[M2 · ${TEAM[1]} · 3:15–4:05]
Thank you. We mapped the EER model with the standard Elmasri–Navathe steps, shown on the left. Strong entities became tables; the weak entity's primary key is its owner's key plus its partial key; many-to-many relationships became bridge tables; the multi-valued skills attribute became its own table; each subclass got its own table sharing the superclass key; and the union type got a surrogate sponsor_id.
The result is ${D.catalog.tables} tables.
On the right, keys. A super key is any identifying set. Candidate keys are the minimal ones — placement_cycle actually has three. We pick one as primary and keep natural keys as UNIQUE alternate keys, so introducing surrogate ids loses no rule. And we have ${D.catalog.constraints.f} foreign keys, including composite ones that enforce cross-table rules, which I will show in the DDL.`);
}

// ============================================================ 7. Normalization (M2)
{
  const s = content("Normalization: spreadsheet → BCNF", 2, "M2 · Schema, normalization & DDL");
  image(s, "diagrams/normalization.png", 1.35, 1.35, 10.6, 5.38);
  s.addNotes(`[M2 · ${TEAM[1]} · 4:05–5:20]
We started from the spreadsheet you saw, the UNF relation in red, and wrote down its functional dependencies. For example: roll_no determines name, email, program and CGPA; prog_code determines prog_name; company determines sector and city; a job, identified by company, cycle and title, determines its pay.
1NF: skills was a list, not atomic, so it moves to its own relation.
2NF: the key is roll_no, job and round. Many attributes depend on only part of it — student details on roll_no, company details on company — so we split those out.
3NF: two transitive dependencies remain. roll_no determines prog_code which determines prog_name, so PROGRAM separates. And min_cgpa really depends on the job and the program, not on the application, so ELIGIBILITY separates.
Every split is on a functional dependency whose left side becomes a key, so by Heath's theorem it is lossless, and every FD still lives inside one table, so it is dependency-preserving.`);
}

// ============================================================ 8. BCNF (M2)
{
  const s = content("Proving BCNF, and the trap we avoided", 2, "M2 · Schema, normalization & DDL");
  table(s, [
    ["Relation", "Non-trivial FDs", "Determinants are keys?"],
    ["student", "roll_no → all;  email → roll_no", "Yes: both are candidate keys"],
    ["program", "prog_code → prog_name", "Yes"],
    ["eligibility", "(job, program) → min_cgpa", "Yes"],
    ["interview_round", "(job, round_no) → round_type", "Yes"],
    ["interview", "(student, job, round) → slot, result", "Yes"],
    ["placement_cycle", "3 candidate keys, each → all", "Yes"],
  ], 0.6, 1.5, 7.0, [1.75, 3.15, 2.1], { fontSize: 12.5, rowH: 0.45 });
  s.addText("All 22 relations: every determinant is a super key → BCNF", { x: 0.6, y: 4.85, w: 7, h: 0.4, fontSize: 15, bold: true, color: C.teal, margin: 0, isTextBox: true });
  s.addText([
    { text: "Deliberately not stored: ", options: { bold: true, color: C.ink } },
    { text: "CTC on the offer (offer → job → ctc would be transitive), placement status (derived by a view), cycle on the application (job → cycle).", options: { color: C.body } },
  ], { x: 0.6, y: 5.35, w: 7.0, h: 1.2, fontSize: 13.5, margin: 0, isTextBox: true, valign: "top" });
  card(s, 8.0, 1.5, 4.75, 5.05, { fill: C.amberSoft, line: "FED7AA", titleColor: C.amber, title: "The 3NF-but-not-BCNF trap",
    body: ["Suppose: each recruiter interviews for exactly one job.", "Panel(student, job, recruiter) with  (student, job) → recruiter  and  recruiter → job.",
           "recruiter is not a super key → not BCNF. job is prime → still 3NF.",
           "BCNF split: (recruiter, job) + (student, recruiter) is lossless but NOT dependency-preserving.",
           "Our decision: the business does not need that rule, so we did not model it. The schema stays BCNF with nothing lost."], bodySize: 13.5 });
  s.addNotes(`[M2 · ${TEAM[1]} · 5:20–6:10]
To prove BCNF we checked, for every relation, that every determinant is a super key. The interesting row is student: email determines roll_no and roll_no determines email. That looks suspicious, but both are candidate keys, so BCNF holds.
We also made deliberate decisions not to store redundant data, listed bottom-left. For example, the offer does not copy the CTC: offer determines job, job determines CTC, so copying it would create a transitive dependency.
On the right is the classic trap we discussed as a team. If each recruiter interviewed for only one job, a Panel relation would be in 3NF but not BCNF, and decomposing it would lose a dependency. We avoided it at the requirements level: the business does not need that rule.
Now, how the schema is written down.`);
}

// ============================================================ 9. DDL (M2)
{
  const s = content("Integrity lives in the schema", 2, "M2 · Schema, normalization & DDL");
  code(s, 0.6, 1.5, 6.6, 5.05,
`-- Disjoint specialization, enforced declaratively
CREATE TABLE internship_role (
  job_id     INT PRIMARY KEY,
  role_type  VARCHAR(10) DEFAULT 'INTERNSHIP'
             CHECK (role_type = 'INTERNSHIP'),
  stipend_monthly NUMERIC(10,2) NOT NULL,
  FOREIGN KEY (job_id, role_type)
    REFERENCES job_role (job_id, role_type)
    ON DELETE CASCADE
);

-- No student in two interviews at once
CONSTRAINT excl_student_double_booking
  EXCLUDE USING gist (
    student_id WITH =,
    tstzrange(slot_start, slot_end) WITH &&)`, 12.5);
  const cons = D.catalog.constraints;
  const stats = [[cons.c, "CHECK constraints (domains)"], [cons.f, "foreign keys, with actions"], [cons.u, "UNIQUE (alternate keys)"],
                 [cons.x, "EXCLUDE (overlap ban)"], [cons.t, "deferred constraint triggers"], [D.catalog.indexes, "indexes incl. FK indexes"]];
  stats.forEach(([v, l], i) => stat(s, 7.6 + (i % 2) * 2.6, 1.45 + Math.floor(i / 2) * 1.35, 2.4, String(v), l, i < 2 ? C.indigo : C.teal, 32));
  card(s, 7.6, 5.55, 5.15, 1.0, { title: "ON DELETE, chosen per relationship", body: "CASCADE: subtypes & weak entity · RESTRICT: history (offers) · SET NULL (col): keep job, drop recruiter link", bodySize: 12.5, titleSize: 13.5 });
  s.addNotes(`[M2 · ${TEAM[1]} · 6:10–7:00]
Our principle in the DDL was: if a rule can be declared, declare it. On the left are two examples.
First, the disjoint specialization. Each subtype table carries a role_type column fixed by a CHECK to its own type, and a composite foreign key to (job_id, role_type) in job_role. So a full-time job simply cannot get an internship row — the foreign key has nothing to match. No trigger, no application code.
Second, an EXCLUDE constraint with a GiST index: no two interview rows for the same student may have overlapping time ranges. A UNIQUE constraint cannot express 'overlapping', this can.
On the right are the totals straight from the system catalog: ${cons.c} CHECK constraints, ${cons.f} foreign keys, ${cons.u} unique alternate keys, and the ON DELETE action we chose for each relationship.
Over to ${TEAM[2]} for the data and the queries.`);
}

// ============================================================ 10. Data (M3)
pres.addSection({ title: "M3 · SQL queries & rules" });
{
  const s = content("A realistic, reproducible test bed", 3, "M3 · SQL queries & rules");
  const st = [[counts.student, "students in 3 programs"], [counts.company, "fictional companies"], [counts.application, "applications"],
              [counts.interview, "interview slots"], [counts.offer, "offers made"]];
  st.forEach(([v, l], i) => stat(s, 0.6 + i * 2.5, 1.45, 2.3, fmt(v), l, C.indigo, 40));
  s.addText([
    { text: "Reference data is hand-written INSERTs, readable on a slide", options: { bullet: true, breakLine: true } },
    { text: "Students are generated set-based; setseed() makes every run identical", options: { bullet: true, breakLine: true } },
    { text: "A PL/pgSQL simulation runs shortlist → rounds → offers → accept, job by job", options: { bullet: true, breakLine: true } },
    { text: "Every row is loaded THROUGH the triggers, in one transaction: it all passed every rule, or nothing loads", options: { bullet: true } },
  ], { x: 0.6, y: 3.0, w: 6.2, h: 3.4, fontSize: 15, color: C.body, valign: "top", paraSpaceAfter: 10, margin: 0, isTextBox: true });
  image(s, "screenshots/demo_02_students.png", 7.2, 3.0, 5.55, 3.47);
  s.addNotes(`[M3 · ${TEAM[2]} · 7:00–7:30]
Thank you. What kind of data is this? Real placement records are confidential, so we simulated a season that behaves like one: CGPA drives shortlisting, programs drive skills, and every step follows the committee's rules. We say clearly that it is simulated.
To test the design we needed realistic data: ${counts.student} students, ${counts.company} companies, ${fmt(counts.application)} applications, ${fmt(counts.interview)} interview slots and ${counts.offer} offers.
Two points matter. First, it is seeded, so every rebuild produces exactly the same data and our query outputs are reproducible — our test suite even checks this with a fingerprint.
Second, we did not bypass our own rules: the triggers are installed before the data, and a simulation drives the whole recruitment process through them in one transaction. So the dataset itself is evidence that the rules are consistent.`);
}

// ============================================================ 11. Five queries (M3)
{
  const s = content("Five queries, five business questions", 3, "M3 · SQL queries & rules");
  const q4last = pgdbaFinal ? `${pgdbaFinal[5]}% of PGDBA placed by ${new Date(pgdbaFinal[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  table(s, [
    ["#", "Business question", "SQL technique", "Answer from our data"],
    ["Q1", "Which recruiters are hardest to crack?", "Joins, outer join, GROUP BY, HAVING vs scalar subquery", `${Q[1].rows.length} companies; ${q1top[0]} offers to ${q1top[6]}%`],
    ["Q2", "Who holds EVERY skill a new job needs?", "Relational division: double NOT EXISTS", `${Q[2].rows.length} students, led by ${Q[2].rows[0][0]}`],
    ["Q3", "Top earners per program?", "DENSE_RANK, NTILE, AVG() OVER on a view", `Top CTC ₹${Q[3].rows[0][5]} LPA`],
    ["Q4", "How fast is each batch getting placed?", "CTEs, generate_series, running SUM() OVER", q4last],
    ["Q5", "Strong students lost in interviews?", "Correlated subquery + LATERAL join", `${Q[5].rows.length} students flagged for coaching`],
  ], 0.6, 1.5, 12.15, [0.55, 3.6, 4.2, 3.8], { fontSize: 13.5, rowH: 0.78 });
  s.addNotes(`[M3 · ${TEAM[2]} · 7:30–8:10]
Each query answers a real question the committee asks. Q1 finds the most selective recruiters using HAVING compared against a scalar subquery — ${q1top[0]} makes offers to only ${q1top[6]} percent of applicants. Q2 is relational division. Q3 and Q4 use window functions. Q5 uses a correlated subquery to find strong students who keep failing interviews, so the committee can coach them. Let me zoom into two of them.`);
}

// ============================================================ 12. Spotlight (M3)
{
  const s = content("Spotlight: relational division and window functions", 3, "M3 · SQL queries & rules");
  code(s, 0.6, 1.5, 6.2, 3.55,
`-- students holding EVERY skill job 25 needs
SELECT s.roll_no FROM student s
WHERE NOT EXISTS (          -- no required skill
  SELECT 1 FROM job_required_skill r
  WHERE r.job_id = 25
    AND NOT EXISTS (        -- ... that s lacks
      SELECT 1 FROM student_skill ss
      WHERE ss.student_id = s.person_id
        AND ss.skill_id   = r.skill_id
        AND ss.proficiency >= r.min_proficiency));`, 12.5);
  s.addText("Qualified(student, skill) ÷ π skill (σ job = 25 (JobRequiredSkill))", { x: 0.6, y: 5.2, w: 6.2, h: 0.4, fontSize: 14, bold: true, color: C.indigo, margin: 0, isTextBox: true });
  s.addText("Cross-checked against division-by-counting (GROUP BY … HAVING count = …) for all 25 jobs: identical results (test TC-QRY-06).", { x: 0.6, y: 5.65, w: 6.2, h: 0.8, fontSize: 13, color: C.body, margin: 0, isTextBox: true, valign: "top" });
  const progs = [...new Set(q4.rows.map((r) => r[1]))];
  const labels = [...new Set(q4.rows.map((r) => new Date(r[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })))];
  const series = progs.map((p) => ({ name: p, labels, values: q4.rows.filter((r) => r[1] === p).map((r) => Number(r[5])) }));
  s.addChart(pres.charts.LINE, series, {
    x: 7.15, y: 1.45, w: 5.6, h: 4.6, chartColors: [C.indigo, "0EA5E9", "F59E0B"], lineSize: 2.5, lineDataSymbolSize: 6,
    showTitle: true, title: "Q4: cumulative % of batch placed (SUM() OVER)", titleFontSize: 13, titleColor: C.ink, titleFontFace: "+mn-lt",
    showLegend: true, legendPos: "b", legendFontSize: 11, legendFontFace: "+mn-lt",
    catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valAxisLabelFormatCode: '0"%"',
    valGridLine: { color: "E5E7EB", size: 0.75 }, catGridLine: { style: "none" },
  });
  s.addText("Window functions aggregate without collapsing rows: each day keeps its own row and gets a running total.", { x: 7.15, y: 6.15, w: 5.6, h: 0.5, fontSize: 12.5, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes(`[M3 · ${TEAM[2]} · 8:10–9:00]
Q2 is relational division, which SQL has no operator for. We express 'holds every required skill' as a double negation: there is no required skill that the student does not have. The algebra is shown below the code. To be sure it is right, our tests compare it with the other classic formulation, division by counting, for all 25 jobs, and they agree.
On the right is Q4. A window function — SUM OVER partitioned by program and ordered by day — gives a running total without collapsing the rows, and generate_series builds a calendar so that days with zero placements still appear. This is the committee's daily progress chart.
Queries read the data; now, the rules that guard every write.`);
}

// ============================================================ 13. Trigger flow (M3)
{
  const s = content("The one-offer policy, as a trigger", 3, "M3 · SQL queries & rules");
  image(s, "diagrams/trigger_flow.png", 1.85, 1.35, 9.6, 5.5);
  s.addNotes(`[M3 · ${TEAM[2]} · 9:00–9:35]
Some rules span several tables, so a CHECK cannot express them. The most important is the one-offer policy.
A student accepts through the stored procedure sp_accept_offer. It first locks the student's row, then re-reads the offer to make sure it is still pending. The UPDATE fires two triggers. The BEFORE trigger is the guard: deadline not passed, no other accepted offer in this cycle. The AFTER trigger is the cascade, in green: it declines the student's other pending offers, withdraws their open applications, frees their interview slots and writes an audit log.
Crucially, all of this happens in one transaction: either every step commits, or none does. And because the procedure locks the student's row first, two simultaneous acceptances queue up instead of both succeeding; our tests run exactly that with two real connections.`);
}

// ============================================================ 14. Demo (M4)
{
  const s = content("Live demo: accept an offer, watch the cascade", 3, "M3 · SQL queries & rules");
  image(s, "screenshots/demo_05_accept_cascade.png", 0.6, 1.45, 7.9, 4.94);
  const steps = [
    ["Second offer", "Monsoon Foods makes Dev Saxena an offer; trigger marks the application OFFERED"],
    ["Accept", "Dev accepts DataSutra: CALL sp_accept_offer()"],
    ["Cascade", "Other offer DECLINED, open application WITHDRAWN, interviews freed, all logged"],
    ["Guard", "Applying again, or a CGPA below the cut-off, is refused with the trigger's message"],
  ];
  steps.forEach(([t, b], i) => {
    const y = 1.45 + i * 1.18;
    circleNum(s, 8.85, y + 0.05, String(i + 1), C.amber, 0.48, 15);
    s.addText([{ text: t, options: { bold: true, color: C.ink, fontSize: 15, breakLine: true } }, { text: b, options: { color: C.body, fontSize: 13 } }],
      { x: 9.45, y, w: 3.3, h: 1.1, valign: "top", margin: 0, isTextBox: true });
  });
  s.addText("Backup if the live demo fails: PlaceIQ_Demo_Video.webm", { x: 8.85, y: 6.25, w: 3.9, h: 0.35, fontSize: 11.5, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes(`[M3 · ${TEAM[2]} · 9:35–10:30 · LIVE DEMO, about 55 seconds]
(Switch to the browser, http://127.0.0.1:8000. Press 'Reset demo data' beforehand.)
1. Jobs → Monsoon Foods (job 21) → 'Make offer' for PGP62-084. Dev now holds two pending offers.
2. Students → PGP62-084 → Accept on the DataSutra row → confirm.
3. Point at the toast: one offer auto-declined, one application withdrawn. Point at the table: Declined, Withdrawn. The final-placement card now says Placed — that status comes from the view.
4. In 'Apply for a job', choose job 25 → Apply: refused, 'already accepted an offer in this placement cycle'.
If anything fails, play the backup video, which shows exactly these steps.
(Back to the slides.) ${TEAM[3]} will now show what the data tells us.`);
}

// ============================================================ 15. Analytics 1: SQL statistics (M4)
pres.addSection({ title: "M4 · Analytics & performance" });
{
  const s = content("Analytics (1/4): the database does the statistics", 4, "M4 · Analytics & performance");
  s.addChart(pres.charts.BAR, [{ name: "% placed", labels: A.A2.map((r) => r.cgpa_band), values: A.A2.map((r) => r.placed_pct) }], {
    x: 0.6, y: 1.45, w: 6.3, h: 3.65, barDir: "col", chartColors: [C.indigo], barGapWidthPct: 70,
    showTitle: true, title: "A2: % placed in final cycle, by CGPA band", titleFontSize: 13, titleColor: C.ink, titleFontFace: "+mn-lt",
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelColor: C.ink, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: '0"%"',
    showLegend: false, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valAxisLabelFormatCode: '0"%"', valAxisMaxVal: 70,
    valGridLine: { color: "E5E7EB", size: 0.75 }, catGridLine: { style: "none" },
  });
  code(s, 0.6, 5.25, 6.3, 1.3,
`SELECT width_bucket(cgpa, 6, 10, 4) AS band, count(*),
       count(*) FILTER (WHERE status = 'PLACED')
FROM student LEFT JOIN v_placement_status ... GROUP BY band;`, 11);
  const cards = [
    ["A1 · CGPA", `Mean ${a1All.mean}, median ${a1All.median}, SD ${a1All.sd}: symmetric. ANOVA across programs p = ${M.anova_cgpa_program.p}: the programs do not differ.`],
    ["A3 · Funnel", `${funnel.intMin}–${funnel.intMax}% of applications reach an interview, but only ${funnel.offMin}–${funnel.offMax}% become offers: students fail after the interview, not at the CV.`],
    ["A4 · Skill gap", `${A.A4[0].skill_name} has the most jobs per proficient student, then ${A.A4[1].skill_name} and ${A.A4[2].skill_name}: run workshops there first.`],
  ];
  cards.forEach(([t, b], i) => card(s, 7.25, 1.45 + i * 1.55, 5.5, 1.4, { title: t, body: b, bodySize: 12.5, titleSize: 14, titleColor: C.indigo }));
  s.addText("γ band; count(*), count(σ status='PLACED') ( Student ⟕ σ cycle='FINAL' (PlacementStatus) )",
    { x: 7.25, y: 6.15, w: 5.5, h: 0.4, fontSize: 12, bold: true, color: C.indigo, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 10:30–11:20]
Thank you. The last part answers: what can the committee LEARN from this data? Analytics means decisions based on data, and the first pass is plain statistics, done inside the database.
The chart is query A2: students grouped into CGPA bands with width_bucket, joined to the placement view. Nobody below a CGPA of 7 is placed yet; ${pct(A.A2[3].placed_pct)} percent of those above 9 are. So CGPA is a strong feature. But look at the 8 to 9 band: most of them are still unplaced, so CGPA cannot be the whole story.
On the right: CGPA is symmetric, mean ${a1All.mean} and median ${a1All.median}, and an ANOVA shows the programs do not differ in CGPA. The funnel shows students drop out after the interview, not at CV screening. And SQL is the scarcest skill relative to demand.
The point for this course: the DBMS answers these with GROUP BY. We never loaded the raw tables into Python.`);
}

// ============================================================ 16. Analytics 2: features and k (M4)
{
  const s = content("Analytics (2/4): features in SQL, k from data", 4, "M4 · Analytics & performance");
  table(s, [
    ["Feature", "Why it should matter", "Built from"],
    ["cgpa", "Recruiters' first filter (A2)", "student"],
    ["tech_score", "Analytics roles screen on Python, SQL, ML", "student_skill ⋈ skill"],
    ["biz_score", "Consulting & finance screen on cases, Excel", "student_skill ⋈ skill"],
    ["applications", "No application, no offer", "application"],
    ["interview_rate", "Share of applications reaching interview", "application, interview"],
  ], 0.6, 1.5, 6.6, [1.45, 3.15, 2.0], { fontSize: 12.5, rowH: 0.44 });
  card(s, 0.6, 4.35, 6.6, 2.2, { fill: C.amberSoft, line: "FED7AA", titleColor: C.amber, title: "One view, one SELECT",
    body: [`v_student_features joins 6 normalized tables into ${M.n_students} rows × 5 features: the only student-level data that leaves PostgreSQL.`,
           "Offers and CTC are deliberately NOT inputs: we cluster on what the committee sees early, then test the segments against outcomes. Otherwise the result would be circular."], bodySize: 13 });
  image(s, "../analytics/figures/03_choose_k.png", 7.55, 1.5, 5.2, 2.15);
  const best = M.k_scan.find((r) => r.k === M.k);
  s.addText([
    { text: "Standardize first: ", options: { bold: true, color: C.ink } },
    { text: "k-means uses distance, so unscaled applications (0–14) would outvote interview_rate (0–1).", options: { color: C.body, breakLine: true } },
    { text: `k = ${M.k}: `, options: { bold: true, color: C.ink } },
    { text: `inertia flattens after it and the silhouette peaks there (${best.silhouette}).`, options: { color: C.body, breakLine: true } },
    { text: "Strongest structure: ", options: { bold: true, color: C.ink } },
    { text: `tech vs business skills, r = ${M.corr_tech_biz}. Students specialise.`, options: { color: C.body } },
  ], { x: 7.55, y: 3.9, w: 5.2, h: 2.65, fontSize: 13.5, valign: "top", paraSpaceAfter: 8, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 11:20–12:10]
Before any algorithm, feature engineering: translate the problem into data, using domain knowledge. We chose five things a committee can see early in the season: CGPA, technical skills, business skills, how many roles the student applies to, and what share of those reach an interview.
All five are computed by one SQL view over six tables. Notice what is NOT a feature: offers. If we clustered on offers, "students with offers do well" would be true by construction. So we cluster on profile and judge on outcome.
k-means measures distance, so we standardize first. To choose k we ran k from 2 to 8: the elbow and the silhouette both point at ${M.k}.`);
}

// ============================================================ 17. Analytics 3: segments (M4)
{
  const s = content("Analytics (3/4): four segments, profile only", 4, "M4 · Analytics & performance");
  image(s, "../analytics/figures/05_segment_fingerprints.png", 0.6, 1.4, 12.15, 2.82, false);
  const blurb = {
    "High-Achieving Generalists": "High CGPA, business skills, apply widely",
    "Tech Specialists": `Mostly PGDBA, technical skills, best CTC (₹${seg("Tech Specialists").avg_best_ctc} L)`,
    "Selective Appliers": `Avg CGPA; ${pct(seg("Selective Appliers").avg_interview_rate * 100)}% reach interview, but only ${seg("Selective Appliers").avg_apps} applications`,
    "At-Risk": "Low CGPA, few applications, rarely shortlisted",
  };
  A.segment_profile.forEach((g, i) => {
    const x = 0.6 + i * 3.08;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.4, w: 2.92, h: 1.75, rectRadius: 0.08, fill: { color: C.soft }, line: { color: C.line } });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 4.4, w: 0.09, h: 1.75, fill: { color: SEGCOLOR[g.segment_name] }, line: { color: SEGCOLOR[g.segment_name] } });
    s.addText([
      { text: g.segment_name, options: { bold: true, fontSize: 13.5, color: C.ink, breakLine: true } },
      { text: `${pct(g.accepted_pct)}%`, options: { bold: true, fontSize: 26, color: C.ink, fontFace: HEAD } },
      { text: `  accepted · n = ${g.students}`, options: { fontSize: 11.5, color: C.muted, breakLine: true } },
      { text: blurb[g.segment_name], options: { fontSize: 11.5, color: C.body } },
    ], { x: x + 0.22, y: 4.47, w: 2.62, h: 1.62, valign: "top", margin: 0, isTextBox: true });
  });
  const X = M.chi2_segment_offer;
  s.addText(`χ² test, segment × accepted offer: χ² = ${X.chi2}, dof = ${X.dof}, p = ${X.p}. The segments differ in outcome, so the clusters are real, not just geometry.`,
    { x: 0.6, y: 6.25, w: 12.15, h: 0.4, fontSize: 13, bold: true, color: C.teal, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 12:10–13:10]
These are the four segments. Each panel shows how far the segment's centre sits from the average student, in standard deviations.
Generalists and Tech Specialists are doing well, ${pct(seg("High-Achieving Generalists").accepted_pct)} and ${pct(seg("Tech Specialists").accepted_pct)} percent with an accepted offer. At-Risk is what you would expect: low CGPA, few applications, rarely shortlisted.
The interesting one is Selective Appliers, third panel. Their CGPA is average, so a CGPA cut-off would never flag them. They get to interview ${pct(seg("Selective Appliers").avg_interview_rate * 100)} percent of the time, yet apply to only about ${Math.round(seg("Selective Appliers").avg_apps)} roles, and ${pct(seg("Selective Appliers").accepted_pct)} percent of them have an accepted offer. Their CVs work; they just apply too narrowly.
Remember, offers were never an input. The chi-square test shows segment and outcome are strongly associated, p about ${X.p}. So the clusters capture something real.`);
}

// ============================================================ 18. Analytics 4: back to SQL (M4)
{
  const s = content("Analytics (4/4): clusters back in the database", 4, "M4 · Analytics & performance");
  code(s, 0.6, 1.5, 6.5, 3.15,
`-- S2: who needs help now?
SELECT sg.segment_name, f.roll_no, ...,
  CASE WHEN f.applications < 3   THEN 'Apply to more roles'
       WHEN f.interview_rate < 0.4 THEN 'CV review' ... END
FROM student_segment g
JOIN segment sg USING (segment)
JOIN v_student_features f USING (student_id)
WHERE NOT f.accepted_offer
  AND g.segment IN (
    SELECT segment FROM v_segment_profile
    WHERE accepted_pct <
      (SELECT 100.0 * avg(accepted_offer::int)
       FROM v_student_features));`, 11);
  s.addText("Weak = π segment (σ accepted_pct < campus avg (SegmentProfile));  result = σ ¬accepted (StudentSegment ⋉ Weak ⋈ Features)",
    { x: 0.6, y: 4.75, w: 6.5, h: 0.55, fontSize: 12, bold: true, color: C.indigo, margin: 0, isTextBox: true, valign: "top" });
  card(s, 0.6, 5.4, 6.5, 1.15, { title: "Stored like any other data", body: "Labels go into SEGMENT and STUDENT_SEGMENT (BCNF, foreign keys) in ONE transaction: every student is relabelled, or none is.", bodySize: 12.5, titleSize: 13.5 });
  const total = A.s2_actions.reduce((t, r) => t + r.n, 0);
  s.addText(`${total}`, { x: 7.5, y: 1.4, w: 1.6, h: 0.8, fontSize: 44, bold: true, color: C.amber, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("students flagged, each with one action", { x: 9.05, y: 1.55, w: 3.7, h: 0.6, fontSize: 13.5, color: C.muted, margin: 0, isTextBox: true, valign: "middle" });
  table(s, [["Segment", "Suggested action", "Students"], ...A.s2_actions.map((r) => [r.segment_name, r.suggested_action, r.n])],
    7.5, 2.35, 5.25, [1.8, 2.45, 1.0], { fontSize: 12, rowH: 0.36 });
  const pgpexRisk = A.S1.find((r) => r.program_code === "PGPEX" && r.segment_name === "At-Risk");
  const t6 = M.threshold.find((r) => Math.abs(r.t - 0.6) < 1e-9);
  s.addText([
    { text: "S1: ", options: { bold: true, color: C.ink } },
    { text: `PGP students fall into ${A.S1.filter((r) => r.program_code === "PGP").length} segments and ${pct(pgpexRisk.pct_of_program)}% of PGPEX are At-Risk, so a program-wide policy misses people.`, options: { color: C.body, breakLine: true } },
    { text: "Threshold t: ", options: { bold: true, color: C.ink } },
    { text: `flagging students whose P(offer) < ${t6.t} catches ${pct(t6.recall * 100)}% of those with no offer, at ${pct(t6.precision * 100)}% precision.`, options: { color: C.body } },
  ], { x: 7.5, y: 5.05, w: 5.25, h: 1.55, fontSize: 12.5, valign: "top", paraSpaceAfter: 6, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 13:10–13:55]
The labels do not stay in a notebook. We write them back into two BCNF tables with foreign keys, in one transaction, and from then on SQL can query them like any other data.
Query S2 turns the analysis into a list: every student without an accepted offer in a segment that places below the campus average, with one suggested action. ${total} students. Most of them simply need to apply to more roles, which costs the committee nothing.
Query S1 shows why segments beat programs: PGP students are spread across ${A.S1.filter((r) => r.program_code === "PGP").length} segments, so one workshop for "all PGP" would miss most of the at-risk ones.
Finally, the threshold trade-off from class: with a logistic model of P(offer), flagging below ${t6.t} catches ${pct(t6.recall * 100)} percent of the students who end up with no offer. A missed student costs more than a spare workshop seat, so we prefer high recall.`);
}

// ============================================================ 19. Indexing, security & testing (M4)
{
  const s = content("Indexing, security and testing", 4, "M4 · Analytics & performance");
  s.addChart(pres.charts.BAR, [{ name: "Execution time (ms)", labels: ["No index", "Composite", "Partial"],
    values: [perf.seq_scan_ms, perf.composite_index_ms, perf.partial_index_ms] }], {
    x: 0.6, y: 1.45, w: 4.6, h: 3.9, barDir: "col", chartColors: [C.red, C.indigo, C.teal], valAxisLogScaleBase: 10,
    valAxisMinVal: 0.01, valAxisMaxVal: 1000, valAxisCrossesAt: 0.01,  // headroom so the tallest label clears the title
    showTitle: true, title: "Same query, 600,000 rows, ms (log)", titleFontSize: 12.5, titleColor: C.ink, titleFontFace: "+mn-lt",
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 11, dataLabelColor: C.ink, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.00",
    showLegend: false, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: "E5E7EB", size: 0.75 }, catGridLine: { style: "none" },
  });
  stat(s, 0.6, 5.45, 2.2, `${fmt(speedup)}×`, "faster: composite B-tree", C.indigo, 30);
  stat(s, 2.9, 5.45, 2.3, `${shrink}×`, "smaller: partial index", C.teal, 30);
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 5.55, y: 1.45, w: 3.75, h: 5.1, rectRadius: 0.1, fill: { color: C.soft }, line: { color: C.line } });
  s.addText("SQL injection:  x' OR '1'='1", { x: 5.75, y: 1.6, w: 3.4, h: 0.4, fontSize: 14, bold: true, color: C.ink, margin: 0, isTextBox: true });
  stat(s, 5.75, 2.15, 1.6, "180", "rows leaked by string concatenation", C.red, 40);
  stat(s, 7.5, 2.15, 1.6, "0", "rows with a bound parameter", C.teal, 40);
  s.addText("The unsafe path runs as a SELECT-only role in a READ ONLY transaction: DROP TABLE is refused.",
    { x: 5.75, y: 3.75, w: 3.4, h: 1.5, fontSize: 13, color: C.body, margin: 0, isTextBox: true, valign: "top" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.6, y: 1.45, w: 3.15, h: 5.1, rectRadius: 0.1, fill: { color: C.tealSoft }, line: { color: C.tealSoft } });
  s.addText(`${T.passed} / ${T.total}`, { x: 9.8, y: 1.65, w: 2.8, h: 0.9, fontSize: 40, bold: true, color: C.teal, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("automated tests pass against the real database: constraints, triggers, queries, concurrency, performance, security, API",
    { x: 9.8, y: 2.6, w: 2.8, h: 2.2, fontSize: 13, color: C.body, margin: 0, isTextBox: true, valign: "top" });
  s.addNotes(`[M4 · ${TEAM[3]} · 13:55–14:35]
Three quick results. Indexing: on a 600,000-row archive, a composite B-tree index makes the same query about ${fmt(speedup)} times faster than a sequential scan, and a partial index covering only open applications is ${shrink} times smaller. We measured this with EXPLAIN ANALYZE rather than assuming it.
Security: pasting user input into SQL leaks all 180 students for the classic OR '1'='1' payload; a bound parameter returns zero. Even the deliberately unsafe path runs as a read-only role.
And ${T.total} automated tests run against the real database; all pass.`);
}

// ============================================================ 20. Learnings & Q&A (all)
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: "M4 · Analytics & performance" });
  s.addText("What we learned", { x: 0.7, y: 0.45, w: 9, h: 0.8, fontSize: 32, bold: true, color: C.white, fontFace: HEAD, margin: 0, isTextBox: true });
  const learn = [
    "Modelling decides everything downstream: treating the application as an aggregation is what made interview and offer integrity enforceable.",
    "Normalization is a proof: writing every FD exposed the transitive dependency hiding in min_cgpa. Declared constraints then hold even if the app is bypassed.",
    "Rules that span tables need triggers and transactions: lock order turned a possible deadlock into a clean queue.",
    "Cluster on profile, judge on outcome: the segments found Selective Appliers, whom a CGPA cut-off would never flag.",
  ];
  learn.forEach((t, i) => {
    const x = 0.7 + i * 3.02;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.55, w: 2.85, h: 3.4, rectRadius: 0.1, fill: { color: "1F2937" }, line: { color: "374151" } });
    s.addText([{ text: `M${i + 1}  `, options: { bold: true, color: "A5B4FC" } }, { text: TEAM[i], options: { bold: true, color: C.white } }],
      { x: x + 0.2, y: 1.72, w: 2.5, h: 0.4, fontSize: 14, margin: 0, isTextBox: true });
    s.addText(t, { x: x + 0.2, y: 2.25, w: 2.5, h: 2.6, fontSize: 14, color: C.slate, margin: 0, isTextBox: true, valign: "top" });
  });
  s.addText("Thank you. Questions?", { x: 0.7, y: 5.35, w: 8, h: 0.8, fontSize: 36, bold: true, color: C.white, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("github.com/EktaSharma-github/placeiq   ·   schema, data, queries, tests and the web UI", { x: 0.7, y: 6.2, w: 11, h: 0.4, fontSize: 14, color: "94A3B8", margin: 0, isTextBox: true });
  s.addNotes(`[ALL · 14:35–15:00, then Q&A]
Each of us closes with one sentence (read your own card).
Then: "Thank you. We are happy to take questions." Each member answers questions on their own section: M1 modelling, M2 keys, normalization and DDL, M3 queries, triggers and transactions, M4 statistics, k-means, indexing, security and testing.`);
}

const out = path.join(ROOT, "PlaceIQ_Presentation.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("wrote", out));
