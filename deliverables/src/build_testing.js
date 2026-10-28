/* Builds deliverables/PlaceIQ_Testing_Report.docx from tests/results/results.json (via data.json). */
const L = require("./doclib");
const { D, P, H1, H1n, H2, H3, bullets, numbered, table, tcap, callout, code, cover, toc, build } = L;

const R = D.tests, T = R.totals, perf = D.performance, env = R.environment;
const fmt = (n) => Number(n).toLocaleString("en-IN");
const MOD = {
  schema: ["Schema structure", "The catalog contains exactly the designed objects: tables, keys, indexes, views, triggers, routines."],
  constraints: ["Declarative constraints", "Each business rule enforced by the DDL rejects invalid data, and boundary values are accepted."],
  triggers: ["Triggers and procedures", "Multi-table rules: eligibility, offer rules, the one-offer cascade, deadlines, expiry."],
  queries: ["Views and queries", "The five analytical queries and both views return provably correct answers."],
  data: ["Data invariants", "The whole seeded dataset satisfies every rule and is reproducible."],
  transactions: ["Transactions & concurrency", "Atomicity, isolation under two real concurrent sessions, deferred consistency at COMMIT."],
  performance: ["Performance", "Index effectiveness measured with EXPLAIN ANALYZE on 600,000 rows."],
  security: ["Security", "Least-privilege role (DCL) and SQL-injection behaviour, sandboxing included."],
  api: ["REST API", "Endpoints return correct data and surface database rule violations clearly."],
};
const order = ["schema", "constraints", "triggers", "queries", "data", "transactions", "performance", "security", "api"];
const byMod = {};
R.tests.forEach((t) => (byMod[t.module] = byMod[t.module] || []).push(t));
const totalMs = R.tests.reduce((a, t) => a + t.duration_ms, 0);

// traceability: requirement -> test ids
const trace = {};
R.tests.forEach((t) => (trace[t.requirement] = trace[t.requirement] || []).push(t.id));
const brOrder = (k) => (k.startsWith("BR-") ? parseInt(k.slice(3), 10) : 100);
const traceRows = Object.entries(trace).sort((a, b) => brOrder(a[0]) - brOrder(b[0]) || a[0].localeCompare(b[0]))
  .map(([req, ids]) => [req, ids.join(", "), ids.length]);

const defects = [
  ["D-01", "Phase 2 smoke test", "Inserting rows with explicit ids left the IDENTITY sequences at 1; the next default insert collided with an existing key.", "Explicit ids do not advance a sequence.", "setval() for every identity column at the end of 04_data.sql; verified by TC-SCH-07.", "Fixed"],
  ["D-02", "Query review (Q4)", "Some offers were accepted on 29 Oct, after the dataset's 'as of' date of 28 Oct.", "Interview calendar started one day too late.", "Final-placement interview days shifted one day earlier.", "Fixed"],
  ["D-03", "Live demo dry run", "After a pre-placement offer was auto-declined, that job's scheduled interview stayed booked.", "Cascade only freed slots of WITHDRAWN applications, not of OFFERED ones whose offer was declined.", "Cascade now deletes every SCHEDULED interview for the student's other jobs in the cycle; TC-TRG-10.", "Fixed"],
  ["D-04", "Design review of concurrency", "Two sessions accepting offers for the same student could deadlock.", "Procedure locked the offer row before the student row.", "sp_accept_offer locks the student row first (single lock order); TC-TXN-02/03.", "Fixed"],
  ["D-05", "UI visual check", "Dashboard panels in the same row were vertically misaligned.", "A sibling-margin CSS rule applied inside grids.", "Spacing applied only between top-level blocks.", "Fixed"],
  ["D-06", "UI visual check (mobile)", "Page overflowed horizontally at phone width.", "CSS grid items default to min-width:auto.", "minmax(0, 1fr) and min-width:0 on layout children.", "Fixed"],
  ["D-07", "First test run, TC-PRF-03", "PostgreSQL 18 used the (job_id, status) index for a status-only filter, contradicting the demo script.", "The textbook rule is about seeking; PG 18 can read the whole index.", "Test now compares blocks read (3 vs 4,383); demo wording corrected.", "Fixed (documentation)"],
  ["D-08", "First test run, TC-DAT-01", "A row created by one test persisted into later tests.", "psycopg's conn.transaction() on an idle connection COMMITs; it is a savepoint only inside an open transaction.", "The db fixture opens the outer transaction immediately.", "Fixed (test harness)"],
  ["D-09", "First test run, TC-SCH-03/04", "Expected 34 foreign keys (actual 30); composite FKs reported as unindexed although a UNIQUE index on their leading column covers them.", "Wrong expectations in the tests.", "Expected count corrected; coverage rule accepts a unique leading-column index.", "Fixed (test)"],
];

const children = [
  ...cover({ kind: "Testing report", title: "PlaceIQ", subtitle: `Verification of the database, business rules, queries and web API: ${T.passed} of ${T.total} automated tests passing` }),
  ...toc(),

  H1("1. Introduction"),
  P("This report describes how PlaceIQ was verified: what was tested, how, in which environment, and with what result. All results were produced by the automated test suite in tests/, executed with pytest against a real PostgreSQL 18 database rebuilt from the project scripts. Every table of results in this document is generated from the suite's own output file (tests/results/results.json), not typed by hand."),
  H2("1.1 Objectives"),
  ...bullets([
    "Show that every business rule (BR-1 to BR-15) is enforced by the database, including when the application is bypassed.",
    "Show that the analytical queries and views return correct answers, using independent cross-checks.",
    "Show ACID behaviour, including correct isolation under real concurrency.",
    "Measure, rather than assume, the effect of indexes.",
    "Show that SQL injection is prevented and that the demonstration path is safely sandboxed.",
    "Record honestly every defect found during development and testing.",
  ]),

  H1("2. Test strategy"),
  H2("2.1 Test levels"),
  table(["Level", "What is checked", "Tests"], order.map((m) => [MOD[m][0], MOD[m][1], byMod[m].length]), [2, 5, 0.8], { size: 17 }),
  H2("2.2 Approach"),
  ...bullets([
    "**Known starting state.** The session begins by rebuilding the database from 02_ddl.sql, 03_logic.sql and 04_data.sql. The seed is deterministic (setseed), so expected values such as '8 students match job 25' are stable.",
    "**Isolation between tests.** Each test receives a connection whose outer transaction is rolled back afterwards; nothing a test does persists.",
    "**Many violations per test.** Expected failures run inside a SAVEPOINT (helper expect_error) and assert the exact SQLSTATE and message, so one test can check several violations and continue.",
    "**Committing tests.** Tests that must commit (two-session concurrency, API writes) use a fixture that rebuilds the seed afterwards.",
    "**Independent oracles.** Query results are verified by a different formulation (for example relational division by double NOT EXISTS versus by counting) or by recomputing the expected value directly.",
    "**Negative and positive cases.** Each constraint test also checks that a legal boundary value is accepted (for example CGPA exactly 10, back-to-back interview slots).",
  ]),
  H2("2.3 Expected error codes"),
  table(["SQLSTATE", "Meaning", "Raised by"], [
    ["23514", "check_violation", "CHECK constraints; trigger RAISE … USING ERRCODE = 'check_violation'"],
    ["23503", "foreign_key_violation", "Foreign keys (including the composite ones)"],
    ["23505", "unique_violation", "UNIQUE / alternate keys"],
    ["23P01", "exclusion_violation", "The interview double-booking EXCLUDE constraint"],
    ["23001", "restrict_violation", "ON DELETE RESTRICT"],
    ["23000", "integrity_constraint_violation", "Deferred totality trigger"],
    ["25006", "read_only_sql_transaction", "Write attempted inside READ ONLY (injection lab)"],
    ["42501", "insufficient_privilege", "placeiq_readonly role"],
    ["55P03", "lock_not_available", "lock_timeout while waiting for the student row lock"],
  ], [1.1, 2.5, 4.2], { size: 17 }),

  H1("3. Test environment"),
  table(["Component", "Version / detail"], [
    ["Database", env.postgres.split(",")[0]], ["Python", env.python], ["pytest", env.pytest], ["psycopg", env.psycopg],
    ["Operating system", env.os], ["Database name / schema", "placeiq / placeiq"],
    ["Run started (UTC)", R.started_utc.replace("T", " ").slice(0, 19)], ["Command", "app\\.venv\\Scripts\\python -m pytest tests -v"],
  ], [2, 5]),

  H1("4. Results summary"),
  callout("Result", `${T.passed} of ${T.total} tests passed, ${T.failed} failed, ${T.skipped} skipped. Total test time ${(totalMs / 1000).toFixed(1)} s (excluding database rebuilds). The suite was run twice consecutively with identical results.`, { fill: L.COLOR.tealSoft, color: L.COLOR.teal }),
  tcap("Results by module"),
  table(["Module", "Tests", "Passed", "Failed", "Time (ms)"], order.map((m) => {
    const ts = byMod[m];
    return [MOD[m][0], ts.length, ts.filter((t) => t.outcome === "passed").length, ts.filter((t) => t.outcome === "failed").length, fmt(Math.round(ts.reduce((a, t) => a + t.duration_ms, 0)))];
  }), [3, 1, 1, 1, 1.3]),
  H2("4.1 First run"),
  P("The first execution of the suite reported 87 passed and 4 failed. All four were analysed before anything was changed: three were defects in the tests themselves (D-08, D-09) and one revealed that a claim in the demo script was inaccurate on PostgreSQL 18 (D-07). None was a defect in the schema or the business logic. After the corrections the suite passed 91 of 91, and passed again on an immediate re-run."),

  H1("5. Requirements traceability"),
  P("Every business rule is covered by at least one test; most by several (a negative case at the constraint level and a data-wide invariant)."),
  tcap("Requirement → test cases"),
  table(["Requirement", "Test cases", "Count"], traceRows, [1.6, 5.4, 0.8], { size: 17 }),

  H1("6. Detailed test cases"),
  ...order.flatMap((m) => [
    H2(`6.${order.indexOf(m) + 1} ${MOD[m][0]}`),
    P(MOD[m][1]),
    table(["ID", "Req.", "Test case", "Result", "ms"], byMod[m].map((t) => [t.id, t.requirement, t.detail ? `${t.title}\n${t.detail}` : t.title, t.outcome === "passed" ? "PASS" : "FAIL", t.duration_ms]), [1.15, 1.0, 5.0, 0.7, 0.6], { size: 16 }),
  ]),

  H1("7. Focus areas"),
  H2("7.1 Concurrency (TC-TXN-02, TC-TXN-03)"),
  P("These tests open two real database connections. A second pending offer is committed for student PGP62-084, then:"),
  ...numbered([
    "Session A calls sp_accept_offer for the first offer and does not commit. It holds the student row lock.",
    "Session B sets lock_timeout = 700 ms and calls sp_accept_offer for the second offer. It fails with SQLSTATE 55P03 (lock not available): B was blocked by A (TC-TXN-02).",
    "In TC-TXN-03, B runs in a thread with no timeout. The test checks that B is still blocked after 0.6 s, then commits A.",
    "B wakes, re-reads its offer under the lock, finds it DECLINED by A's cascade, and fails with 'only a PENDING offer can be accepted'.",
    "Final check from a third connection: the student has exactly one accepted offer.",
  ]),
  H2("7.2 Performance (TC-PRF-01 to 03)"),
  tcap("Measured on a 600,000-row archive, best of three EXPLAIN ANALYZE runs"),
  table(["Measurement", "Value"], [
    ["Sequential scan", `${perf.seq_scan_ms} ms`], ["Composite B-tree (job_id, status)", `${perf.composite_index_ms} ms (${fmt(Math.round(perf.seq_scan_ms / perf.composite_index_ms))}× faster)`],
    ["Partial index (open rows only)", `${perf.partial_index_ms} ms`], ["Full composite index size", `${fmt(perf.full_index_kb)} KB`],
    ["Partial index size", `${perf.partial_index_kb} KB (${Math.round(perf.full_index_kb / perf.partial_index_kb)}× smaller)`],
    ["Blocks read: seek on job_id", perf.seek_blocks], ["Blocks read: status-only filter", fmt(perf.status_only_blocks)],
  ], [3.5, 3.5]),
  P("Assertions are relative (at least 10× faster, at least 10× smaller, at least 50× more blocks) so that the tests are robust to machine speed."),
  H2("7.3 Security (TC-SEC-01 to 09)"),
  P("The least-privilege role can read only student and person; it is denied other tables, all writes, DROP, and pg_read_file. Through the API, the unsafe search returns all 180 students for x' OR '1'='1 and 180 phone numbers for a UNION payload, while the parameterised search returns 0 rows for the same input. A DROP TABLE payload is refused with SQLSTATE 25006 and the table is verified intact. Passing an injection string to fn_apply_for_job is treated as a literal roll number."),
  H2("7.4 Query correctness"),
  P("Q2 (relational division) is compared with the division-by-counting formulation for all 25 jobs; the sets are identical. Q1's rows are re-checked against an independently computed campus-wide offer rate; Q3's above_avg_by is recomputed; Q4's running total must be non-decreasing and end at the number of final placements per program; each Q5 row must be unplaced, out-score the selected students' average CGPA and show a failed or missed round."),

  H1("8. Defect and issue log"),
  P("All issues found during development and testing, including those in the tests themselves."),
  table(["ID", "Found by", "Symptom", "Root cause", "Resolution", "Status"], defects, [0.6, 1.2, 2.2, 1.8, 2.2, 0.9], { size: 15 }),

  H1("9. Running the tests"),
  code(`# from the Project folder, with PostgreSQL running and the app venv created
app\\.venv\\Scripts\\pip install pytest httpx
app\\.venv\\Scripts\\python -m pytest tests -v                       # human-readable
app\\.venv\\Scripts\\python -m pytest tests --junitxml=tests\\results\\junit.xml

# connection settings: PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
# psql location (for the rebuild fixture): PLACEIQ_PSQL`),
  P("Outputs: tests/results/results.json (every test with id, requirement, outcome and duration), tests/results/junit.xml (for CI tools) and tests/results/performance.json (timings)."),

  H1("10. Conclusion and limitations"),
  P(`All ${T.total} tests pass, covering every business rule, the correctness of all five queries, ACID behaviour under real concurrency, measured index performance and SQL-injection defence. Development testing found nine issues, all resolved and recorded above.`),
  H2("Not covered"),
  ...bullets([
    "Automated browser tests of the UI: the UI was verified through the API tests, visual checks at desktop and mobile widths, and the scripted demo recording.",
    "Load and stress testing beyond the 600,000-row indexing experiment.",
    "Crash-recovery (durability) testing, which is a guarantee of the PostgreSQL engine rather than of this schema.",
  ]),
];

build("PlaceIQ_Testing_Report.docx", "Testing Report", children);
