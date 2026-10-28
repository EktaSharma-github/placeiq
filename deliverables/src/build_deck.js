/*
 * Builds deliverables/PlaceIQ_Presentation.pptx (18 slides, 15 minutes, 4 presenters).
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
const SEG = ["Problem & EER", "Schema & normalization", "DDL, data & queries", "Rules, transactions & performance"];

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
  s.addNotes(`[M1 · ${TEAM[0]} · 0:00–0:30]
Good morning. We are presenting PlaceIQ, a database for campus placements.
The one-line idea: today the placement committee runs recruitment from spreadsheets, and spreadsheets cannot stop anyone from breaking the rules. We moved those rules into the database itself, so that PostgreSQL refuses an ineligible application, a double-booked interview or a second accepted offer.
Each of the four of us will present one part of the pipeline: design, normalization, SQL, and finally rules, transactions and performance.`);
}

// ============================================================ 2. Agenda (M1)
{
  const s = content("Four parts, four presenters", 1, "M1 · Problem & EER");
  const topics = [
    ["Problem & anomalies", "Business rules", "EER model: specialization, weak entity, aggregation, union type"],
    ["EER → relational mapping", "Keys: super, candidate, alternate, foreign", "FDs, 1NF → BCNF, lossless & dependency-preserving"],
    ["DDL: constraints as rules", "Seeded, reproducible data", "Five advanced queries: division, windows, HAVING"],
    ["Triggers & stored procedures", "Live demo, ACID & concurrency", "Indexing, SQL injection, testing, learnings"],
  ];
  const times = ["0:00 – 3:45", "3:45 – 7:30", "7:30 – 11:15", "11:15 – 15:00"];
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
  s.addNotes(`[M1 · ${TEAM[0]} · 0:30–0:50]
Here is how the 15 minutes are split. I will cover the problem and the conceptual model. ${TEAM[1]} turns it into a normalized relational schema. ${TEAM[2]} shows the DDL, the data and our five queries. ${TEAM[3]} shows the triggers live, then transactions, indexing, security and testing.`);
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
  s.addNotes(`[M1 · ${TEAM[0]} · 0:50–1:50]
This is what the committee's sheet looks like: one row per student, per company, per interview round.
Look at the red header columns: Northbridge, Mumbai, the role and the pay repeat on every row. That causes the three classic anomalies.
Update: if the company changes its HQ we must edit every row. Insertion: we cannot even record a new job until someone applies, because roll number is part of the key. Deletion: delete the only applicant and the job vanishes with them.
Beyond anomalies, a file system cannot enforce rules. So we listed 15 business rules, on the right, and every one of them is enforced inside PostgreSQL: by constraints, triggers or views.`);
}

// ============================================================ 4. EER 1 (M1)
{
  const s = content("EER model (1/2): people, programs and sponsors", 1, "M1 · Problem & EER");
  image(s, "diagrams/eer_people.png", 1.4, 1.35, 10.55, 5.53);
  s.addNotes(`[M1 · ${TEAM[0]} · 1:50–2:40]
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
  s.addNotes(`[M1 · ${TEAM[0]} · 2:40–3:45]
The second view is the recruitment pipeline. STUDENT APPLIES_TO JOB_ROLE is many-to-many with attributes, status and applied_at.
The key modelling decision is AGGREGATION, the purple box. You do not interview a student in general; you interview an application, a student for a specific job. So the whole APPLIES_TO relationship is treated as an entity that participates in EVALUATED_IN with INTERVIEW_ROUND, and in RESULTS_IN with OFFER.
INTERVIEW_ROUND is a WEAK entity, 'round 2' means nothing without its job, so it is identified through the double-diamond HAS_ROUND, with round_no as its partial key.
JOB_ROLE has a DISJOINT, TOTAL specialization into internship and full-time: a stipend and a CTC are different attributes, and every job is exactly one of the two.
I now hand over to ${TEAM[1]}, who will turn this model into tables.`);
}

// ============================================================ 6. Mapping & keys (M2)
pres.addSection({ title: "M2 · Schema & normalization" });
{
  const s = content(`From EER to ${D.catalog.tables} relations, and their keys`, 2, "M2 · Schema & normalization");
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
  s.addNotes(`[M2 · ${TEAM[1]} · 3:45–4:45]
Thank you. We mapped the EER model with the standard Elmasri–Navathe steps, shown on the left. Strong entities became tables; the weak entity's primary key is its owner's key plus its partial key; many-to-many relationships became bridge tables; the multi-valued skills attribute became its own table; each subclass got its own table sharing the superclass key; and the union type got a surrogate sponsor_id.
The result is ${D.catalog.tables} tables.
On the right, keys. A super key is any identifying set. Candidate keys are the minimal ones — placement_cycle actually has three. We pick one as primary and keep natural keys as UNIQUE alternate keys, so introducing surrogate ids loses no rule. And we have ${D.catalog.constraints.f} foreign keys, including composite ones that enforce cross-table rules, which ${TEAM[2]} will show.`);
}

// ============================================================ 7. Normalization (M2)
{
  const s = content("Normalization: spreadsheet → BCNF", 2, "M2 · Schema & normalization");
  image(s, "diagrams/normalization.png", 1.35, 1.35, 10.6, 5.38);
  s.addNotes(`[M2 · ${TEAM[1]} · 4:45–6:15]
We started from the spreadsheet you saw, the UNF relation in red, and wrote down its functional dependencies. For example: roll_no determines name, email, program and CGPA; prog_code determines prog_name; company determines sector and city; a job, identified by company, cycle and title, determines its pay.
1NF: skills was a list, not atomic, so it moves to its own relation.
2NF: the key is roll_no, job and round. Many attributes depend on only part of it — student details on roll_no, company details on company — so we split those out.
3NF: two transitive dependencies remain. roll_no determines prog_code which determines prog_name, so PROGRAM separates. And min_cgpa really depends on the job and the program, not on the application, so ELIGIBILITY separates.
Every split is on a functional dependency whose left side becomes a key, so by Heath's theorem it is lossless, and every FD still lives inside one table, so it is dependency-preserving.`);
}

// ============================================================ 8. BCNF (M2)
{
  const s = content("Proving BCNF, and the trap we avoided", 2, "M2 · Schema & normalization");
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
  s.addNotes(`[M2 · ${TEAM[1]} · 6:15–7:30]
To prove BCNF we checked, for every relation, that every determinant is a super key. The interesting row is student: email determines roll_no and roll_no determines email. That looks suspicious, but both are candidate keys, so BCNF holds.
We also made deliberate decisions not to store redundant data, listed bottom-left. For example, the offer does not copy the CTC: offer determines job, job determines CTC, so copying it would create a transitive dependency.
On the right is the classic trap we discussed as a team. If each recruiter interviewed for only one job, a Panel relation would be in 3NF but not BCNF, and decomposing it would lose a dependency. We avoided it at the requirements level: the business does not need that rule.
Over to ${TEAM[2]} for the implementation.`);
}

// ============================================================ 9. DDL (M3)
pres.addSection({ title: "M3 · DDL, data & queries" });
{
  const s = content("Integrity lives in the schema", 3, "M3 · DDL, data & queries");
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
  s.addNotes(`[M3 · ${TEAM[2]} · 7:30–8:30]
Thank you. Our principle in the DDL was: if a rule can be declared, declare it. On the left are two examples.
First, the disjoint specialization. Each subtype table carries a role_type column fixed by a CHECK to its own type, and a composite foreign key to (job_id, role_type) in job_role. So a full-time job simply cannot get an internship row — the foreign key has nothing to match. No trigger, no application code.
Second, an EXCLUDE constraint with a GiST index: no two interview rows for the same student may have overlapping time ranges. A UNIQUE constraint cannot express 'overlapping', this can.
On the right are the totals straight from the system catalog: ${cons.c} CHECK constraints, ${cons.f} foreign keys, ${cons.u} unique alternate keys, and the ON DELETE action we chose for each relationship.`);
}

// ============================================================ 10. Data (M3)
{
  const s = content("A realistic, reproducible test bed", 3, "M3 · DDL, data & queries");
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
  s.addNotes(`[M3 · ${TEAM[2]} · 8:30–9:15]
To test the design we needed realistic data: ${counts.student} students, ${counts.company} companies, ${fmt(counts.application)} applications, ${fmt(counts.interview)} interview slots and ${counts.offer} offers.
Two points matter. First, it is seeded, so every rebuild produces exactly the same data and our query outputs are reproducible — our test suite even checks this with a fingerprint.
Second, we did not bypass our own rules: the triggers are installed before the data, and a simulation drives the whole recruitment process through them in one transaction. So the dataset itself is evidence that the rules are consistent.`);
}

// ============================================================ 11. Five queries (M3)
{
  const s = content("Five queries, five business questions", 3, "M3 · DDL, data & queries");
  const q4last = pgdbaFinal ? `${pgdbaFinal[5]}% of PGDBA placed by ${new Date(pgdbaFinal[0]).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  table(s, [
    ["#", "Business question", "SQL technique", "Answer from our data"],
    ["Q1", "Which recruiters are hardest to crack?", "Joins, outer join, GROUP BY, HAVING vs scalar subquery", `${Q[1].rows.length} companies; ${q1top[0]} offers to ${q1top[6]}%`],
    ["Q2", "Who holds EVERY skill a new job needs?", "Relational division: double NOT EXISTS", `${Q[2].rows.length} students, led by ${Q[2].rows[0][0]}`],
    ["Q3", "Top earners per program?", "DENSE_RANK, NTILE, AVG() OVER on a view", `Top CTC ₹${Q[3].rows[0][5]} LPA`],
    ["Q4", "How fast is each batch getting placed?", "CTEs, generate_series, running SUM() OVER", q4last],
    ["Q5", "Strong students lost in interviews?", "Correlated subquery + LATERAL join", `${Q[5].rows.length} students flagged for coaching`],
  ], 0.6, 1.5, 12.15, [0.55, 3.6, 4.2, 3.8], { fontSize: 13.5, rowH: 0.78 });
  s.addNotes(`[M3 · ${TEAM[2]} · 9:15–10:00]
Each query answers a real question the committee asks. Q1 finds the most selective recruiters using HAVING compared against a scalar subquery — ${q1top[0]} makes offers to only ${q1top[6]} percent of applicants. Q2 is relational division. Q3 and Q4 use window functions. Q5 uses a correlated subquery to find strong students who keep failing interviews, so the committee can coach them. Let me zoom into two of them.`);
}

// ============================================================ 12. Spotlight (M3)
{
  const s = content("Spotlight: relational division and window functions", 3, "M3 · DDL, data & queries");
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
  s.addNotes(`[M3 · ${TEAM[2]} · 10:00–11:15]
Q2 is relational division, which SQL has no operator for. We express 'holds every required skill' as a double negation: there is no required skill that the student does not have. The algebra is shown below the code. To be sure it is right, our tests compare it with the other classic formulation, division by counting, for all 25 jobs, and they agree.
On the right is Q4. A window function — SUM OVER partitioned by program and ordered by day — gives a running total without collapsing the rows, and generate_series builds a calendar so that days with zero placements still appear. This is the committee's daily progress chart.
Now ${TEAM[3]} will show how the rules are enforced, live.`);
}

// ============================================================ 13. Trigger flow (M4)
pres.addSection({ title: "M4 · Rules, transactions & performance" });
{
  const s = content("The one-offer policy, as a trigger", 4, "M4 · Rules, transactions & performance");
  image(s, "diagrams/trigger_flow.png", 1.85, 1.35, 9.6, 5.5);
  s.addNotes(`[M4 · ${TEAM[3]} · 11:15–12:00]
Thank you. Some rules span several tables, so a CHECK cannot express them. The most important is the one-offer policy.
A student accepts through the stored procedure sp_accept_offer. It first locks the student's row, then re-reads the offer to make sure it is still pending. The UPDATE fires two triggers. The BEFORE trigger is the guard: deadline not passed, no other accepted offer in this cycle. The AFTER trigger is the cascade, in green: it declines the student's other pending offers, withdraws their open applications, frees their interview slots and writes an audit log.
Crucially, all of this happens in one transaction: either every step commits, or none does.`);
}

// ============================================================ 14. Demo (M4)
{
  const s = content("Live demo: accept an offer, watch the cascade", 4, "M4 · Rules, transactions & performance");
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
  s.addNotes(`[M4 · ${TEAM[3]} · 12:00–13:15 · LIVE DEMO, about 75 seconds]
(Switch to the browser, http://127.0.0.1:8000. Press 'Reset demo data' beforehand.)
1. Jobs → Monsoon Foods (job 21) → 'Make offer' for PGP62-084. Dev now holds two pending offers.
2. Students → PGP62-084 → Accept on the DataSutra row → confirm.
3. Point at the toast: one offer auto-declined, one application withdrawn. Point at the table: Declined, Withdrawn. The final-placement card now says Placed — that status comes from the view.
4. In 'Apply for a job', choose job 25 → Apply: refused, 'already accepted an offer in this placement cycle'.
If anything fails, play the backup video, which shows exactly these steps.`);
}

// ============================================================ 15. Transactions (M4)
{
  const s = content("Transactions: ACID under concurrency", 4, "M4 · Rules, transactions & performance");
  const acid = [
    ["A", "Atomicity", "ROLLBACK undoes the whole cascade: offers, applications, interviews, log (TC-TXN-01)"],
    ["C", "Consistency", "Constraints + deferred totality check at COMMIT; a job without a subtype cannot commit (TC-TXN-04)"],
    ["I", "Isolation", "Row lock on the student serialises concurrent acceptances (TC-TXN-02/03)"],
    ["D", "Durability", "Once COMMIT returns, PostgreSQL's write-ahead log keeps it through a crash"],
  ];
  acid.forEach(([l, t, b], i) => {
    const x = 0.6 + (i % 2) * 3.35, y = 1.5 + Math.floor(i / 2) * 2.55;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 3.2, h: 2.4, rectRadius: 0.1, fill: { color: C.soft }, line: { color: C.line } });
    circleNum(s, x + 0.2, y + 0.2, l, C.indigo, 0.55, 18);
    s.addText(t, { x: x + 0.9, y: y + 0.22, w: 2.2, h: 0.5, fontSize: 16, bold: true, color: C.ink, margin: 0, isTextBox: true, valign: "middle" });
    s.addText(b, { x: x + 0.2, y: y + 0.95, w: 2.85, h: 1.35, fontSize: 13, color: C.body, margin: 0, isTextBox: true, valign: "top" });
  });
  // two-session timeline
  const lx = [7.75, 10.45];
  ["Session A", "Session B"].forEach((t, i) => {
    s.addText(t, { x: lx[i], y: 1.5, w: 2.3, h: 0.4, fontSize: 15, bold: true, color: i ? C.amber : C.indigo, align: "center", margin: 0, isTextBox: true });
    s.addShape(pres.shapes.LINE, { x: lx[i] + 1.15, y: 1.95, w: 0, h: 4.55, line: { color: C.slate, width: 1.5, dashType: "dash" } });
  });
  const ev = [
    [0, 2.05, "lock student row", C.indigoSoft, C.indigo], [1, 2.75, "lock student row → WAIT", C.amberSoft, C.amber],
    [0, 3.45, "accept + cascade (declines B's offer)", C.indigoSoft, C.indigo], [0, 4.25, "COMMIT", C.tealSoft, C.teal],
    [1, 5.0, "wakes, re-reads offer: DECLINED", C.amberSoft, C.amber], [1, 5.75, "error → ROLLBACK", C.redSoft, C.red],
  ];
  ev.forEach(([lane, y, t, f, l]) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: lx[lane], y, w: 2.3, h: 0.6, rectRadius: 0.08, fill: { color: f }, line: { color: l, width: 1.2 } });
    s.addText(t, { x: lx[lane] + 0.08, y, w: 2.14, h: 0.6, fontSize: 12, color: C.ink, align: "center", valign: "middle", margin: 0, isTextBox: true });
  });
  s.addText("Result: exactly one accepted offer. Locking the student first (not the offer) also rules out a deadlock.", { x: 7.75, y: 6.45, w: 5.0, h: 0.5, fontSize: 12.5, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 13:15–13:50]
Each ACID property is demonstrated, and tested, in our project. The interesting one is isolation. If two sessions accept two different offers for the same student at the same moment, both could pass the 'no other accepted offer' check before either commits. Our procedure locks the student row first, so session B waits; when A commits, B re-reads its offer, finds it already declined by A's trigger, and rolls back. We found during testing that locking the offer row first could deadlock, so lock order matters. Our automated test runs exactly this with two real connections.`);
}

// ============================================================ 16. Indexing (M4)
{
  const s = content("Indexing: measured, not assumed", 4, "M4 · Rules, transactions & performance");
  s.addChart(pres.charts.BAR, [{ name: "Execution time (ms)", labels: ["No index (seq scan)", "Composite (job_id, status)", "Partial (open rows only)"],
    values: [perf.seq_scan_ms, perf.composite_index_ms, perf.partial_index_ms] }], {
    x: 0.6, y: 1.45, w: 7.0, h: 4.9, barDir: "col", chartColors: [C.red, C.indigo, C.teal], valAxisLogScaleBase: 10,
    valAxisMinVal: 0.01, valAxisMaxVal: 100, valAxisCrossesAt: 0.01,   // bars grow up from the bottom of the log axis
    showTitle: true, title: "Same query on 600,000 rows, ms (log scale)", titleFontSize: 13, titleColor: C.ink, titleFontFace: "+mn-lt",
    showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 12, dataLabelColor: C.ink, dataLabelFontFace: "+mn-lt", dataLabelFormatCode: "0.000",
    showLegend: false, catAxisLabelColor: C.muted, valAxisLabelColor: C.muted, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
    catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", valGridLine: { color: "E5E7EB", size: 0.75 }, catGridLine: { style: "none" },
  });
  stat(s, 8.1, 1.45, 4.6, `${fmt(speedup)}× faster`, "composite B-tree index vs sequential scan", C.indigo, 36);
  stat(s, 8.1, 2.85, 4.6, `${shrink}× smaller`, `partial index (${perf.partial_index_kb} KB) vs full index (${fmt(perf.full_index_kb)} KB)`, C.teal, 36);
  stat(s, 8.1, 4.25, 4.6, `${perf.seek_blocks} vs ${fmt(perf.status_only_blocks)} blocks`, "leading-column rule: filter on status alone cannot seek the (job_id, status) index", C.amber, 30);
  s.addText("Measured with EXPLAIN (ANALYZE, BUFFERS) by tests TC-PRF-01 to 03.", { x: 8.1, y: 5.85, w: 4.6, h: 0.5, fontSize: 12, italic: true, color: C.muted, margin: 0, isTextBox: true });
  s.addNotes(`[M4 · ${TEAM[3]} · 13:50–14:15]
Our live tables are small, so we built a 600,000-row application archive to measure indexing honestly. Without an index, PostgreSQL scans the whole table: ${perf.seq_scan_ms.toFixed(1)} milliseconds. A composite B-tree on job_id and status: ${perf.composite_index_ms} milliseconds, about ${fmt(speedup)} times faster. A partial index that only covers open applications is ${shrink} times smaller and faster still.
One lesson surprised us: we expected PostgreSQL 18 to ignore the index for a filter on status alone. It actually used it, but by reading the entire index — ${fmt(perf.status_only_blocks)} blocks versus ${perf.seek_blocks}. The leading-column rule is about seeking, not about whether the index appears in the plan.`);
}

// ============================================================ 17. Security & testing (M4)
{
  const s = content("Security and testing", 4, "M4 · Rules, transactions & performance");
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 1.45, w: 5.9, h: 5.1, rectRadius: 0.1, fill: { color: C.soft }, line: { color: C.line } });
  s.addText("SQL injection, same input  x' OR '1'='1", { x: 0.85, y: 1.6, w: 5.5, h: 0.4, fontSize: 15, bold: true, color: C.ink, margin: 0, isTextBox: true });
  stat(s, 0.85, 2.15, 2.6, "180", "rows leaked: string concatenation", C.red, 48);
  stat(s, 3.6, 2.15, 2.6, "0", "rows: bound parameter ($1)", C.teal, 48);
  s.addText([
    { text: "Defence in depth: the unsafe path runs as role placeiq_readonly (GRANT SELECT on 2 tables) in a READ ONLY transaction", options: { bullet: true, breakLine: true } },
    { text: "DROP TABLE payload → SQLSTATE 25006; pg_read_file → 42501 (permission denied)", options: { bullet: true, breakLine: true } },
    { text: "Every other query in the app uses parameters", options: { bullet: true } },
  ], { x: 0.85, y: 3.6, w: 5.45, h: 2.8, fontSize: 13.5, color: C.body, valign: "top", paraSpaceAfter: 8, margin: 0, isTextBox: true });
  const mods = {};
  D.tests.tests.forEach((t) => { mods[t.module] = (mods[t.module] || 0) + 1; });
  const order = ["constraints", "triggers", "api", "schema", "queries", "data", "security", "transactions", "performance"];
  s.addText(`${T.passed} / ${T.total}`, { x: 6.9, y: 1.4, w: 2.6, h: 0.85, fontSize: 44, bold: true, color: C.teal, fontFace: HEAD, margin: 0, isTextBox: true });
  s.addText("automated tests passed (pytest, real database)", { x: 9.4, y: 1.55, w: 3.35, h: 0.7, fontSize: 13, color: C.muted, margin: 0, isTextBox: true, valign: "middle" });
  s.addChart(pres.charts.BAR, [{ name: "Tests", labels: order, values: order.map((m) => mods[m] || 0) }], {
    x: 6.9, y: 2.35, w: 5.85, h: 4.2, barDir: "bar", chartColors: [C.indigo], showValue: true, dataLabelPosition: "outEnd",
    dataLabelFontSize: 11, dataLabelColor: C.ink, dataLabelFontFace: "+mn-lt", showLegend: false,
    catAxisLabelColor: C.body, valAxisHidden: true, catAxisLabelFontSize: 11.5, catAxisLabelFontFace: "+mn-lt",
    valGridLine: { style: "none" }, catGridLine: { style: "none" }, catAxisOrientation: "maxMin",
  });
  s.addNotes(`[M4 · ${TEAM[3]} · 14:15–14:35]
Security. On the left, the same search written two ways. Pasting the input into the SQL string leaks all 180 students for the classic OR '1'='1' payload; passing it as a bound parameter returns zero rows. Even our deliberately vulnerable path is sandboxed: it runs as a least-privilege role with SELECT on just two tables, inside a read-only transaction, so a DROP TABLE attempt is refused.
On the right, testing. We wrote ${T.total} automated tests that run against the real database — constraints, triggers, queries, concurrency, performance, security and the API — and all ${T.passed} pass. Writing them also caught real issues, documented in our testing report.`);
}

// ============================================================ 18. Learnings & Q&A (all)
{
  const s = pres.addSlide({ masterName: "DARK", sectionTitle: "M4 · Rules, transactions & performance" });
  s.addText("What we learned", { x: 0.7, y: 0.45, w: 9, h: 0.8, fontSize: 32, bold: true, color: C.white, fontFace: HEAD, margin: 0, isTextBox: true });
  const learn = [
    "Modelling decides everything downstream: treating the application as an aggregation is what made interview and offer integrity enforceable.",
    "Normalization is a proof: writing every FD exposed the transitive dependency hiding in min_cgpa.",
    "Declare before you code: CHECK, composite FKs and EXCLUDE reject bad data even if the app is bypassed.",
    "Concurrency bugs stay invisible until tested: lock order turned a possible deadlock into a clean queue.",
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
Then: "Thank you. We are happy to take questions." Each member answers questions on their own section: M1 modelling, M2 normalization and keys, M3 DDL and queries, M4 triggers, transactions, indexing, security and testing.`);
}

const out = path.join(ROOT, "PlaceIQ_Presentation.pptx");
pres.writeFile({ fileName: out }).then(() => console.log("wrote", out));
