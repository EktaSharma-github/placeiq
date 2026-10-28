/* Builds deliverables/PlaceIQ_Demo_Runbook.docx: the live-demo script with fallbacks. */
const L = require("./doclib");
const { D, TEAM, P, H2, H3, bullets, numbered, table, tcap, callout, code, figure, cover, toc, build } = L;

const steps = D.demo_steps;
const say = {
  dashboard: "This is PlaceIQ running live on PostgreSQL. Every number here is computed by SQL views and window functions.",
  students: "Placement status isn't a column; it's derived by a view from the offers table, so it can never be wrong.",
  profile_before: "Dev Saxena holds a pending offer from DataSutra and is shortlisted for two December interviews.",
  second_offer: "Now a recruiter makes a second offer. A trigger moves the application to OFFERED.",
  accept_cascade: "Dev accepts DataSutra. One transaction: the other offer is declined, the open application withdrawn, the interview slots freed, and everything logged.",
  placed_rejected: "Now that Dev is placed, the eligibility trigger refuses any further application in this cycle.",
  cgpa_rejected: "A student below the cut-off is refused with the trigger's own message and SQLSTATE.",
  talent_apply: "The talent match is our relational-division query. Tanvi has every required skill, so her application goes through.",
  analytics: "Our five queries run live from the SQL file, read-only.",
  injection: "Same input: concatenation leaks all 180 students; a bound parameter returns zero.",
  injection_drop: "Even a DROP TABLE is refused: read-only transaction, least-privilege role.",
  audit_log: "Every row here was written by the trigger, not by application code.",
  reset: "And one click restores the original data for the next run.",
};
const action = {
  dashboard: "Open http://127.0.0.1:8000 (Dashboard). Point at the KPIs and the velocity chart.",
  students: "Click Students; type 'Saxena' in the search box.",
  profile_before: "Click the row for PGP62-084. Point at the offer row (Pending) and the Final Placements card.",
  second_offer: "Jobs → Monsoon Foods (job 21) → in Applicants, click 'Make offer' for PGP62-084.",
  accept_cascade: "Students → PGP62-084 → click Accept on the DataSutra row → OK in the dialog.",
  placed_rejected: "In 'Apply for a job', choose #25 Tidewater → Apply.",
  cgpa_rejected: "Open student PGP62-022 → choose #25 → Apply.",
  talent_apply: "Jobs → job 25 (Tidewater) → in Talent match, click Apply for Tanvi Jain (DBA12-039).",
  analytics: "SQL analytics → Run query on Q1 (or Q2).",
  injection: "Injection lab → click the preset x' OR '1'='1 → Run UNSAFE → Run SAFE.",
  injection_drop: "Click the DROP TABLE preset → Run UNSAFE.",
  audit_log: "Click Audit log.",
  reset: "Click 'Reset demo data' (bottom-left) → OK.",
};

const title = {
  dashboard: "Open the dashboard", students: "Search students", profile_before: "Dev Saxena before the demo",
  second_offer: "Recruiter makes a second offer", accept_cascade: "Accept: the one-offer cascade", placed_rejected: "Placed student tries to apply again",
  cgpa_rejected: "Below-cut-off student is refused", talent_apply: "Talent match → apply", analytics: "Run an analytical query",
  injection: "SQL injection: unsafe vs safe", injection_drop: "DROP TABLE attempt is contained", audit_log: "Audit log", reset: "Reset demo data",
};
// The runbook is a working document: sections flow on without forced page breaks.
const H1 = L.H1n;

const children = [
  ...cover({ kind: "Demo runbook", title: "PlaceIQ", subtitle: "Click-by-click script for the live demonstration, with timing, expected results and fallbacks" }),
  ...toc(),

  H1("1. Purpose and timing"),
  table(["Item", "Detail"], [
    ["Presenter", `M4 · ${TEAM[3]} (driving); M3 can operate the laptop`],
    ["When", "Slide 14, at about 12:00 into the talk"],
    ["Length", "75 seconds for the core demo (steps 4–6); the rest is optional for Q&A"],
    ["Goal", "Show the database enforcing the one-offer policy atomically, and refusing invalid actions with its own messages"],
    ["Backup", "PlaceIQ_Demo_Video.webm (same steps, captioned) and the psql script 06_demo.sql"],
  ], [1.6, 6]),

  H1("2. Checklists"),
  H2("2.1 The day before"),
  ...bullets([
    "Run the full test suite once: all tests must pass (see the Testing Report).",
    "Watch the backup video end to end on the presentation laptop, and copy it to a USB stick together with the PDF slides.",
    "Rehearse the 75-second core path twice with a timer.",
    "Check that PostgreSQL starts on the presentation laptop and that the password is known.",
  ]),
  H2("2.2 Thirty minutes before"),
  ...numbered([
    "Confirm PostgreSQL is running (Services → postgresql-x64-18, or the command below).",
    "Start the web app and open http://127.0.0.1:8000 in the browser; the bottom-left indicator must show a green dot and 'PostgreSQL 18.x · placeiq'.",
    "Click 'Reset demo data' so the seeded state is exact.",
    "Open a second browser tab on Students → PGP62-084 so it is one click away.",
    "Set browser zoom to 110–125% so the back row can read it; close notifications and other tabs.",
  ]),
  H2("2.3 Two minutes before slide 14"),
  ...bullets(["Browser on the Jobs page.", "Video file open in a paused player, in case of failure.", "Do not click anything else in the app after the reset."]),

  H1("3. Setup commands"),
  code(`# PostgreSQL service status (PowerShell)
Get-Service postgresql-x64-18

# Start the web app (from the Project folder)
app\\.venv\\Scripts\\python app\\main.py
#  -> open http://127.0.0.1:8000     API docs: http://127.0.0.1:8000/docs

# Rebuild the database without the UI
.\\run_all.ps1 -Password <postgres-password>`),

  H1("4. The core demo (75 seconds)"),
  P("Read the 'Say' column naturally; do not read the 'Do' column aloud."),
  table(["#", "Do", "Say", "You should see"], [
    ["1", action.second_offer, say.second_offer, "Green toast 'Offer made'; the row shows Offered / Pending"],
    ["2", action.accept_cascade, say.accept_cascade, "Toast: '1 application(s) withdrawn, 1 other offer(s) declined'; rows show Declined and Withdrawn; Final Placements card says Placed"],
    ["3", action.placed_rejected, say.placed_rejected, "Red toast 'Rejected by the database … already accepted an offer in this placement cycle' with SQLSTATE 23514"],
  ], [0.35, 2.4, 2.9, 2.2], { size: 16 }),
  L.spacer(80),   // keeps Word from merging the two adjacent tables
  callout("If something goes wrong", "Say 'Let me show you the recording of exactly this', switch to the paused video, and continue narrating. Never debug live.", { fill: L.COLOR.redSoft, color: L.COLOR.red }),

  H1("5. Full walkthrough, step by step"),
  P("All thirteen steps of the recorded demo, with the screen you should see. Steps 4–6 are the core demo; the others are useful during Q&A."),
  ...steps.flatMap((s) => [
    H2(`Step ${s.n}. ${title[s.name] || s.name}${[4, 5, 6].includes(s.n) ? "  (core demo)" : ""}`),
    table(["Do", "Say"], [[action[s.name] || "", say[s.name] || s.caption]], [3.4, 4.2], { size: 17, zebra: false }),
    ...figure(L.ROOT + "/screenshots/" + s.file, s.caption, 5.6),
  ]),

  H1("6. Fallback plans"),
  table(["Failure", "Fallback", "What to say"], [
    ["Web UI will not load or errors", "Play PlaceIQ_Demo_Video.webm", "\"Here is the recording of the same steps.\""],
    ["Video will not play either", "Open psql and run 06_demo.sql (it ends in ROLLBACK)", "\"Let me show it directly in SQL.\""],
    ["Laptop fails", "Present from the PDF slides on a USB stick; slide 14's screenshot shows the cascade", "\"The screenshot shows the result of the cascade.\""],
    ["Database data is not in the seeded state", "Click 'Reset demo data' (about 2 s)", "\"One second while I reset the demo data.\""],
  ], [2, 3, 2.6], { size: 17 }),

  H1("7. Troubleshooting"),
  table(["Symptom", "Likely cause", "Fix"], [
    ["Red dot / 'Database offline'", "PostgreSQL service stopped", "Start the service postgresql-x64-18, then refresh"],
    ["'Address already in use' when starting the app", "App already running in another terminal", "Use the running one at http://127.0.0.1:8000, or close the other terminal"],
    ["Accept says 'Offer … is DECLINED/ACCEPTED'", "The demo was already run", "Click 'Reset demo data'"],
    ["Accept says 'Offer … expired'", "Presenting after 15 Dec 2026 (seeded deadline)", "Reset still works; or skip to the video"],
    ["Make offer button missing on job 21", "PGP62-084 is no longer SHORTLISTED", "Reset demo data"],
    ["Reset fails", "psql not found or wrong password", "Run run_all.ps1 -Password <pw> in a terminal"],
  ], [2.4, 2.4, 2.8], { size: 17 }),

  H1("8. Extras for Q&A"),
  ...bullets([
    "**API documentation:** http://127.0.0.1:8000/docs shows every endpoint (Swagger), useful for questions about REST.",
    "**Any query live:** SQL analytics → Show SQL → Run query.",
    "**Concurrency:** the two-window psql exercise at the end of 06_demo.sql (it commits, so reset afterwards).",
    "**Indexing:** run part 4 of 06_demo.sql to show EXPLAIN ANALYZE before and after.",
  ]),
];

build("PlaceIQ_Demo_Runbook.docx", "Demo Runbook", children);
