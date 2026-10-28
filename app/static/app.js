'use strict';

/* PlaceIQ single-page UI. Talks only to the REST API in main.py. */

const view = document.getElementById('view');

const state = {
  cycle: 2,              // dashboard + students: Final placements by default
  cycles: null,
  programs: null,
  studentFilters: { q: '', program: '', status: '' },
  jobsCycle: '',
  queries: null,
};

const PROGRAM_COLORS = { PGDBA: '#4f46e5', PGP: '#0ea5e9', PGPEX: '#f59e0b' };

const PLACEMENT_STATUS = {
  PLACED:        { label: 'Placed',        tone: 'green',  color: '#10b981' },
  OFFER_PENDING: { label: 'Offer pending', tone: 'amber',  color: '#f59e0b' },
  IN_PROCESS:    { label: 'In process',    tone: 'blue',   color: '#3b82f6' },
  UNPLACED:      { label: 'Unplaced',      tone: 'red',    color: '#f87171' },
  NOT_APPLIED:   { label: 'Not applied',   tone: '',       color: '#cbd2dd' },
  OPTED_OUT:     { label: 'Opted out',     tone: 'dark',   color: '#6b7280' },
};

const TONES = {
  APPLIED: 'blue', SHORTLISTED: 'indigo', OFFERED: 'green', REJECTED: 'red', WITHDRAWN: '',
  PENDING: 'amber', ACCEPTED: 'green', DECLINED: '', EXPIRED: 'red', REVOKED: 'red',
  SCHEDULED: 'blue', CLEARED: 'green', NOT_CLEARED: 'red', ABSENT: 'dark',
  OFFER_ACCEPTED: 'green', AUTO_WITHDRAWN: '', AUTO_DECLINED: 'amber', OFFER_EXPIRED: 'red',
  INTERNSHIP: 'indigo', FULLTIME: 'blue',
};

/* ---------------------------------------------------------------- helpers */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const ACRONYMS = { hr: 'HR', gd: 'GD', bfsi: 'BFSI', fmcg: 'FMCG', ppo: 'PPO' };

function titleCase(code) {
  return String(code ?? '').toLowerCase().replace(/_/g, ' ')
    .replace(/\b[a-z]+\b/g, w => ACRONYMS[w] || w)
    .replace(/^\w/, c => c.toUpperCase());
}

function pill(status, label) {
  const info = PLACEMENT_STATUS[status];
  const tone = info ? info.tone : (TONES[status] ?? '');
  return `<span class="pill ${tone}">${esc(label ?? (info ? info.label : titleCase(status)))}</span>`;
}

const fmtNum = n => (n == null ? '—' : Number(n).toLocaleString('en-IN'));
const lpa = v => (v == null ? '—' : `₹${Number(v).toFixed(2)} LPA`);
const stipend = v => (v == null ? '—' : `₹${(Number(v) / 1000).toFixed(0)}k/mo`);
const pay = r => (r.ctc_lpa != null ? lpa(r.ctc_lpa) : r.stipend_monthly != null ? stipend(r.stipend_monthly) : '—');

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function initials(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function dots(level, max = 5) {
  let html = '<span class="dots">';
  for (let i = 1; i <= max; i += 1) html += `<i class="${i <= level ? 'on' : ''}"></i>`;
  return `${html}</span>`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

/* ---------------------------------------------------------------- API */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const detail = body && (body.error || (typeof body.detail === 'string' ? body.detail : null));
    const err = new Error(detail || `${res.status} ${res.statusText}`);
    err.info = body || {};
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ---------------------------------------------------------------- toasts */

function toast(kind, title, bodyHtml = '', metaHtml = '', ms = 7000) {
  const box = document.createElement('div');
  box.className = `toast ${kind}`;
  box.innerHTML = `<div class="toast-title">${esc(title)}</div>`
    + (bodyHtml ? `<div class="toast-body">${bodyHtml}</div>` : '')
    + (metaHtml ? `<div class="toast-meta">${metaHtml}</div>` : '');
  document.getElementById('toasts').appendChild(box);
  setTimeout(() => box.remove(), ms);
  box.addEventListener('click', () => box.remove());
}

function showError(err) {
  const info = err.info || {};
  const meta = [
    info.sqlstate && `SQLSTATE ${esc(info.sqlstate)}`,
    info.constraint && `constraint ${esc(info.constraint)}`,
    info.raised_by && `raised by ${esc(info.raised_by)}()`,
  ].filter(Boolean).join(' · ');
  const title = info.sqlstate ? 'Rejected by the database' : 'Request failed';
  const body = esc(err.message) + (info.detail ? `<br><span class="muted">${esc(info.detail)}</span>` : '');
  toast('error', title, body, meta, 9000);
}

/* ---------------------------------------------------------------- SQL highlighting */

const SQL_KEYWORDS = new Set(('SELECT FROM WHERE JOIN LEFT RIGHT INNER OUTER CROSS LATERAL ON AND OR NOT EXISTS '
  + 'GROUP BY ORDER HAVING WITH AS IN IS NULL CASE WHEN THEN ELSE END DISTINCT OVER PARTITION WINDOW '
  + 'LIMIT UNION ALL DESC ASC FILTER TRUE FALSE INTERVAL DATE BETWEEN LIKE ILIKE NULLS LAST FIRST USING').split(' '));
const SQL_FUNCS = new Set(('count sum avg min max round coalesce concat_ws generate_series dense_rank ntile '
  + 'rank percent_rank percentile_cont lag lead row_number').split(' '));

function highlightSql(sql) {
  return String(sql).split('\n').map(line => {
    const at = line.indexOf('--');
    const code = at >= 0 ? line.slice(0, at) : line;
    const comment = at >= 0 ? line.slice(at) : '';
    const coded = esc(code).replace(/(&#39;.*?&#39;)|\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m, str, word) => {
      if (str) return `<span class="str">${str}</span>`;
      if (SQL_KEYWORDS.has(word)) return `<span class="kw">${word}</span>`;
      if (SQL_FUNCS.has(word.toLowerCase())) return `<span class="fn">${word}</span>`;
      return word;
    });
    return coded + (comment ? `<span class="cm">${esc(comment)}</span>` : '');
  }).join('\n');
}

/* ---------------------------------------------------------------- generic table */

function dataTable(columns, rows, { rowAttrs } = {}) {
  if (!rows.length) return '<div class="empty">No rows.</div>';
  const head = columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
  const body = rows.map(r => {
    const attrs = rowAttrs ? rowAttrs(r) : '';
    const cells = columns.map(c => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('');
    return `<tr ${attrs}>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function rawTable(columns, rows) {
  if (!rows.length) return '<div class="empty">The query returned no rows.</div>';
  const isNum = v => typeof v === 'number';
  const head = columns.map(c => `<th>${esc(c)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map(v => `<td class="${isNum(v) ? 'num' : ''}">${
    v === null ? '<span class="muted">NULL</span>'
      : typeof v === 'boolean' ? (v ? 'true' : 'false')
        : esc(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? fmtDateTime(v) : v)
  }</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap scroll-y"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function pageHead(title, subtitle = '', actions = '', crumb = '') {
  return `<div class="page-head"><div>${crumb}<h1>${esc(title)}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions}</div>`;
}

/* ---------------------------------------------------------------- charts */

function lineChart(series, { yLabel = '%' } = {}) {
  const days = [...new Set(series.flatMap(s => s.points.map(p => p.day)))].sort();
  if (days.length < 2) return '<div class="empty">Not enough data points yet.</div>';
  const W = 640; const H = 250; const L = 40; const R = 16; const T = 14; const B = 32;
  // "Nice" axis: about 5 ticks on a 1/2/5/10/20/25/50 step, so labels are round numbers.
  const peak = Math.max(1, ...series.flatMap(s => s.points.map(p => p.y)));
  const tickStep = [1, 2, 5, 10, 20, 25, 50].find(st => peak / st <= 5) || 100;
  const ticks = Math.max(1, Math.ceil(peak / tickStep));
  const maxY = tickStep * ticks;
  const x = i => L + (i * (W - L - R)) / (days.length - 1);
  const y = v => T + (H - T - B) * (1 - v / maxY);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative placement chart">`;
  for (let k = 0; k <= ticks; k += 1) {
    const v = tickStep * k;
    svg += `<line class="grid-line" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>`
      + `<text class="axis-label" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(0)}${yLabel}</text>`;
  }
  const step = Math.ceil(days.length / 8);
  days.forEach((d, i) => {
    if (i % step === 0 || i === days.length - 1) {
      const label = new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      svg += `<text class="axis-label" x="${x(i)}" y="${H - 10}" text-anchor="middle">${label}</text>`;
    }
  });
  series.forEach(s => {
    const byDay = Object.fromEntries(s.points.map(p => [p.day, p]));
    const pts = days.map((d, i) => (byDay[d] ? [x(i), y(byDay[d].y), byDay[d]] : null)).filter(Boolean);
    svg += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`;
    pts.forEach(([px, py, p]) => {
      svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${esc(s.name)} · ${esc(p.day)} · ${p.y}% placed (${p.n} cumulative)</title></circle>`;
    });
  });
  svg += '</svg>';
  const legend = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
  return `<div class="chart">${svg}</div><div class="legend">${legend}</div>`;
}

function stackedBars(programRows) {
  const byProgram = {};
  programRows.forEach(r => {
    byProgram[r.program_code] = byProgram[r.program_code] || {};
    byProgram[r.program_code][r.placement_status] = r.n;
  });
  const rows = Object.entries(byProgram).map(([program, counts]) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const segments = Object.entries(PLACEMENT_STATUS)
      .filter(([key]) => counts[key])
      .map(([key, info]) => `<span style="width:${(100 * counts[key]) / total}%;background:${info.color}" title="${esc(info.label)}: ${counts[key]}"></span>`)
      .join('');
    return `<div class="stack-row"><div class="stack-label">${esc(program)}</div><div class="stack-bar">${segments}</div><div class="stack-total">${total}</div></div>`;
  }).join('');
  const legend = Object.values(PLACEMENT_STATUS).map(i => `<span><i style="background:${i.color}"></i>${i.label}</span>`).join('');
  return rows ? `${rows}<div class="legend">${legend}</div>` : '<div class="empty">No students in this cycle.</div>';
}

/* ---------------------------------------------------------------- dashboard */

async function renderDashboard() {
  if (!state.cycles) state.cycles = await api('/api/cycles');
  const c = state.cycle;
  const [sum, vel, log] = await Promise.all([
    api(`/api/summary?cycle_id=${c}`),
    api(`/api/velocity?cycle_id=${c}`),
    api('/api/log?limit=6'),
  ]);
  const cy = sum.cycle;
  const isSummer = cy.cycle_type === 'SUMMER';
  const pct = cy.participants ? ((100 * cy.placed) / cy.participants).toFixed(1) : '0.0';
  const offers = Object.fromEntries(sum.offers.map(o => [o.status, o.n]));
  const totalOffers = sum.offers.reduce((a, o) => a + o.n, 0);

  const seg = state.cycles.map(x => `<button class="${x.cycle_id === c ? 'on' : ''}" data-action="set-cycle" data-cycle="${x.cycle_id}">${esc(x.cycle_name.replace(' Placements', ''))}</button>`).join('');

  const kpis = `
    <div class="cards">
      <div class="panel kpi accent"><div class="kpi-label">Placed</div><div class="kpi-value">${pct}%</div><div class="kpi-sub">${cy.placed} of ${cy.participants} participating students</div></div>
      <div class="panel kpi"><div class="kpi-label">Offers made</div><div class="kpi-value">${fmtNum(totalOffers)}</div><div class="kpi-sub">${offers.ACCEPTED || 0} accepted · ${offers.DECLINED || 0} declined · ${offers.EXPIRED || 0} expired</div></div>
      <div class="panel kpi"><div class="kpi-label">Offer pending</div><div class="kpi-value">${fmtNum(cy.offer_pending)}</div><div class="kpi-sub">students yet to respond</div></div>
      <div class="panel kpi"><div class="kpi-label">Still interviewing</div><div class="kpi-value">${fmtNum(cy.in_process)}</div><div class="kpi-sub">open applications in play</div></div>
      <div class="panel kpi"><div class="kpi-label">${isSummer ? 'Highest stipend' : 'Highest CTC'}</div><div class="kpi-value">${isSummer ? stipend(cy.max_stipend) : lpa(cy.max_ctc)}</div><div class="kpi-sub">accepted offers</div></div>
      <div class="panel kpi"><div class="kpi-label">${isSummer ? 'Average stipend' : 'Median CTC'}</div><div class="kpi-value">${isSummer ? stipend(cy.avg_stipend) : lpa(cy.median_ctc)}</div><div class="kpi-sub">${isSummer ? 'accepted internships' : `average ${lpa(cy.avg_ctc)}`}</div></div>
    </div>`;

  const series = Object.entries(vel.reduce((acc, r) => {
    (acc[r.program_code] = acc[r.program_code] || []).push({ day: r.day, y: Number(r.pct_placed), n: r.placed_cumulative });
    return acc;
  }, {})).map(([name, points]) => ({ name, points, color: PROGRAM_COLORS[name] || '#64748b' }));

  const maxOffers = Math.max(1, ...sum.sectors.map(s => s.offers));
  const sectors = sum.sectors.length ? sum.sectors.map(s => `
      <div class="hbar">
        <div><div class="cell-title">${esc(titleCase(s.sector))}</div><div class="cell-sub">${isSummer ? `avg ${stipend(s.avg_stipend)}` : `avg ${lpa(s.avg_ctc)}`}</div></div>
        <div class="hbar-track"><span style="width:${(100 * s.offers) / maxOffers}%"></span></div>
        <div class="num small">${s.offers} offers · ${s.accepted} acc.</div>
      </div>`).join('') : '<div class="empty">No offers in this cycle yet.</div>';

  const feed = log.length ? `<ul class="feed">${log.map(l => `
      <li><div>${pill(l.action, titleCase(l.action))}</div>
          <div><div><a href="#/student/${encodeURIComponent(l.roll_no || '')}">${esc(l.roll_no || '—')}</a> · ${esc(l.company_name || '')}</div>
          <div class="when">${fmtDateTime(l.logged_at)}</div></div></li>`).join('')}</ul>` : '<div class="empty">No activity yet.</div>';

  view.innerHTML = `
    ${pageHead('Placement dashboard', `${esc(cy.cycle_name)} · ${fmtNum(sum.totals.students)} students, ${fmtNum(sum.totals.companies)} companies, ${fmtNum(sum.totals.jobs)} jobs, ${fmtNum(sum.totals.applications)} applications`, `<div class="seg">${seg}</div>`)}
    ${kpis}
    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-head"><div><h2>Placement velocity</h2><p>Cumulative share of each batch placed, by day (window function SUM() OVER)</p></div></div>
        <div class="panel-body">${lineChart(series)}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Status by program</h2><p>Derived from offers by the view v_placement_status</p></div></div>
        <div class="panel-body">${stackedBars(sum.programs)}</div>
      </div>
    </div>
    <div class="grid grid-even">
      <div class="panel">
        <div class="panel-head"><div><h2>Offers by sector</h2><p>GROUP BY sector over offer ⋈ v_job_details</p></div></div>
        <div class="panel-body">${sectors}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><div><h2>Latest trigger activity</h2><p>Written to placement_log by the one-offer trigger</p></div><a href="#/activity" class="small">View all</a></div>
        <div class="panel-body">${feed}</div>
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- students */

async function renderStudents() {
  if (!state.programs) state.programs = await api('/api/programs');
  if (!state.cycles) state.cycles = await api('/api/cycles');
  const f = state.studentFilters;
  const programOptions = state.programs.map(p => `<option value="${esc(p.program_code)}" ${f.program === p.program_code ? 'selected' : ''}>${esc(p.program_code)}</option>`).join('');
  const statusOptions = Object.entries(PLACEMENT_STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v.label}</option>`).join('');
  const cycleOptions = state.cycles.map(x => `<option value="${x.cycle_id}" ${x.cycle_id === state.cycle ? 'selected' : ''}>${esc(x.cycle_name)}</option>`).join('');

  view.innerHTML = `
    ${pageHead('Students', 'Placement status is never stored: it is computed from offers by the view <code>v_placement_status</code>. Click a student to open their profile.')}
    <div class="panel">
      <div class="panel-head">
        <div class="filters">
          <input type="search" id="f-q" placeholder="Search name or roll number…" value="${esc(f.q)}">
          <select id="f-program"><option value="">All programs</option>${programOptions}</select>
          <select id="f-status"><option value="">All statuses</option>${statusOptions}</select>
          <select id="f-cycle">${cycleOptions}</select>
        </div>
        <span class="muted small" id="f-count"></span>
      </div>
      <div class="panel-body flush" id="student-rows"><div class="loading">Loading…</div></div>
    </div>`;

  const load = async () => {
    const params = new URLSearchParams({ cycle_id: state.cycle, q: f.q, program: f.program, status: f.status });
    const rows = await api(`/api/students?${params}`);
    document.getElementById('f-count').textContent = `${rows.length} students`;
    document.getElementById('student-rows').innerHTML = dataTable([
      { label: 'Roll no', render: r => `<span class="mono">${esc(r.roll_no)}</span>` },
      { label: 'Name', render: r => `<span class="cell-title">${esc(r.student_name)}</span>` },
      { label: 'Program', key: 'program_code' },
      { label: 'CGPA', num: true, render: r => Number(r.cgpa).toFixed(2) },
      { label: 'Status', render: r => pill(r.placement_status) },
      { label: 'Placed with', render: r => (r.placed_with ? `${esc(r.placed_with)}<div class="cell-sub">${esc(r.placed_role)}</div>` : '<span class="muted">—</span>') },
      { label: 'Pay', num: true, render: r => (r.placed_with ? pay(r) : '<span class="muted">—</span>') },
      { label: 'Apps', num: true, key: 'applications' },
      { label: 'Offers', num: true, key: 'offers_received' },
    ], rows, { rowAttrs: r => `class="clickable" data-href="#/student/${encodeURIComponent(r.roll_no)}"` });
  };

  const reload = () => load().catch(showError);
  document.getElementById('f-q').addEventListener('input', debounce(e => { f.q = e.target.value; reload(); }, 250));
  document.getElementById('f-program').addEventListener('change', e => { f.program = e.target.value; reload(); });
  document.getElementById('f-status').addEventListener('change', e => { f.status = e.target.value; reload(); });
  document.getElementById('f-cycle').addEventListener('change', e => { state.cycle = Number(e.target.value); reload(); });
  await load();
}

async function renderStudent(roll) {
  const d = await api(`/api/students/${encodeURIComponent(roll)}`);
  const s = d.student;
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ');

  const cycles = d.statuses.map(c => `
    <div class="cycle-card"><small>${esc(c.cycle_name)}</small>${pill(c.placement_status)}
      ${c.placed_with ? `<div class="small" style="margin-top:6px"><b>${esc(c.placed_with)}</b> · ${esc(c.placed_role)} · ${pay(c)}</div>` : ''}
    </div>`).join('');

  const apps = dataTable([
    { label: 'Job', render: a => `<a class="cell-title" href="#/job/${a.job_id}">${esc(a.company_name)}</a><div class="cell-sub">${esc(a.title)}</div>` },
    { label: 'Cycle', render: a => `<span class="small nowrap">${esc(a.cycle_name.replace(' Placements', ''))}</span>` },
    { label: 'Pay', num: true, render: a => pay(a) },
    { label: 'Application', render: a => pill(a.status) },
    { label: 'Offer', render: a => (a.offer_id ? `${pill(a.offer_status)}${a.offer_status === 'PENDING' ? `<div class="cell-sub">reply by ${fmtDate(a.response_deadline)}</div>` : ''}` : '<span class="muted">—</span>') },
    { label: '', render: a => (a.offer_status === 'PENDING' ? `
        <div class="btn-row"><button class="btn btn-success btn-sm" data-action="accept" data-offer="${a.offer_id}">Accept</button>
        <button class="btn btn-outline btn-sm" data-action="decline" data-offer="${a.offer_id}">Decline</button></div>` : '') },
  ], d.applications);

  const open = d.available_jobs.filter(j => j.is_open);
  const closed = d.available_jobs.filter(j => !j.is_open);
  const opt = j => `<option value="${j.job_id}">#${j.job_id} ${esc(j.company_name)} · ${esc(j.title)}</option>`;
  const applyBox = d.available_jobs.length ? `
    <div class="apply-box">
      <select id="apply-job">
        ${open.length ? `<optgroup label="Open for applications">${open.map(opt).join('')}</optgroup>` : ''}
        ${closed.length ? `<optgroup label="Deadline passed (trigger will reject)">${closed.map(opt).join('')}</optgroup>` : ''}
      </select>
      <button class="btn" data-action="apply" data-roll="${esc(s.roll_no)}">Apply</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">Calls <code>fn_apply_for_job()</code>. The BEFORE INSERT trigger checks opt-out, deadline, program eligibility, CGPA cut-off, backlogs and whether the student is already placed in that cycle.</p>`
    : '<div class="empty">Already applied to every job.</div>';

  const skills = d.skills.length
    ? `<div class="chips">${d.skills.map(k => `<span class="chip"><b>${esc(k.skill_name)}</b>${dots(k.proficiency)}</span>`).join('')}</div>`
    : '<div class="empty">No skills recorded.</div>';

  const interviews = dataTable([
    { label: 'When', render: i => `<span class="nowrap">${fmtDateTime(i.slot_start)}</span>` },
    { label: 'Company', render: i => `<a href="#/job/${i.job_id}">${esc(i.company_name)}</a>` },
    { label: 'Round', render: i => `${i.round_no} · ${esc(titleCase(i.round_type))}` },
    { label: 'Venue', key: 'venue' },
    { label: 'Result', render: i => pill(i.result) },
    { label: 'Score', num: true, render: i => (i.score == null ? '—' : Number(i.score).toFixed(1)) },
  ], d.interviews);

  const log = d.log.length ? `<ul class="feed">${d.log.map(l => `
      <li><div>${pill(l.action, titleCase(l.action))}</div><div><div class="small">${esc(l.details)}</div><div class="when">${fmtDateTime(l.logged_at)}</div></div></li>`).join('')}</ul>`
    : '<div class="empty">No trigger activity for this student.</div>';

  view.innerHTML = `
    <a class="crumb" href="#/students">← All students</a>
    <div class="panel"><div class="panel-body">
      <div class="profile">
        <div class="avatar">${esc(initials(name))}</div>
        <div style="flex:1">
          <h1>${esc(name)}</h1>
          <div class="profile-meta"><span class="mono">${esc(s.roll_no)}</span><span>${esc(s.program_name)}</span><span>${esc(s.email)}</span>
            ${s.cc_role ? `<span class="tag">Placement committee · ${esc(titleCase(s.cc_role))}</span>` : ''}
            ${s.opted_out ? pill('OPTED_OUT') : ''}</div>
        </div>
      </div>
      <div class="facts" style="margin-top:16px">
        <div class="fact"><small>CGPA</small><b>${Number(s.cgpa).toFixed(2)}</b></div>
        <div class="fact"><small>Active backlogs</small><b>${s.active_backlogs}</b></div>
        <div class="fact"><small>Graduating</small><b>${s.batch_year}</b></div>
        <div class="fact"><small>Applications</small><b>${d.applications.length}</b></div>
        <div class="fact"><small>Offers</small><b>${d.applications.filter(a => a.offer_id).length}</b></div>
      </div>
      <div class="cycle-status" style="margin-top:16px">${cycles}</div>
    </div></div>

    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-head"><div><h2>Applications & offers</h2><p>Accepting runs <code>CALL sp_accept_offer()</code>; the one-offer trigger then cascades within the same transaction</p></div></div>
        <div class="panel-body flush">${apps}</div>
      </div>
      <div class="stack">
        <div class="panel"><div class="panel-head"><h2>Apply for a job</h2></div><div class="panel-body">${applyBox}</div></div>
        <div class="panel"><div class="panel-head"><div><h2>Skills</h2><p>Multi-valued attribute → student_skill</p></div></div><div class="panel-body">${skills}</div></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="panel"><div class="panel-head"><div><h2>Interviews</h2><p>Aggregation: an application is evaluated in rounds. No two slots may overlap (EXCLUDE constraint)</p></div></div><div class="panel-body flush">${interviews}</div></div>
      <div class="panel"><div class="panel-head"><h2>Audit trail</h2></div><div class="panel-body">${log}</div></div>
    </div>`;
}

/* ---------------------------------------------------------------- jobs */

async function renderJobs() {
  if (!state.cycles) state.cycles = await api('/api/cycles');
  const rows = await api(`/api/jobs${state.jobsCycle ? `?cycle_id=${state.jobsCycle}` : ''}`);
  const seg = [{ cycle_id: '', cycle_name: 'All' }, ...state.cycles.filter(c => c.cycle_type !== 'LATERAL')]
    .map(c => `<button class="${String(state.jobsCycle) === String(c.cycle_id) ? 'on' : ''}" data-action="jobs-cycle" data-cycle="${c.cycle_id}">${esc(c.cycle_name.replace(' Placements', ''))}</button>`).join('');

  view.innerHTML = `
    ${pageHead('Jobs', 'Each job is either an internship or a full-time role (disjoint, total specialization), enforced by composite foreign keys plus a deferred constraint trigger.', `<div class="seg">${seg}</div>`)}
    <div class="panel"><div class="panel-body flush">${dataTable([
      { label: '#', num: true, key: 'job_id' },
      { label: 'Company & role', render: j => `<span class="cell-title">${esc(j.company_name)}</span><div class="cell-sub">${esc(j.title)} · ${esc(j.location)}</div>` },
      { label: 'Sector', render: j => `<span class="small">${esc(titleCase(j.sector))}</span>` },
      { label: 'Type', render: j => pill(j.role_type, j.role_type === 'FULLTIME' ? 'Full-time' : 'Internship') },
      { label: 'Pay', num: true, render: j => pay(j) },
      { label: 'Openings', num: true, key: 'openings' },
      { label: 'Applicants', num: true, key: 'applicants' },
      { label: 'Offers', num: true, render: j => `${j.offers}<span class="muted"> / ${j.accepted} acc.</span>` },
      { label: 'Deadline', render: j => (j.is_open ? `${pill('APPLIED', 'Open')}<div class="cell-sub">${fmtDate(j.application_deadline)}</div>` : `<span class="small muted">${fmtDate(j.application_deadline)}</span>`) },
    ], rows, { rowAttrs: j => `class="clickable" data-href="#/job/${j.job_id}"` })}</div></div>`;
}

async function renderJob(jobId) {
  const d = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
  const j = d.job;
  const f = d.funnel;
  const maxF = Math.max(1, f.applied);
  const funnel = [['Applied', f.applied], ['Interviewed', f.interviewed], ['Offered', f.offered], ['Accepted', f.accepted]]
    .map(([label, n]) => `<div class="funnel-row"><span class="small">${label}</span><div class="funnel-track"><span style="width:${(100 * n) / maxF}%"></span></div><b class="num">${n}</b></div>`).join('');

  // Each arrow travels with the round it points to, so wrapping never strands one.
  const rounds = d.rounds.map((r, i) => `<span class="rounds">${i ? '<span class="round-arrow">→</span>' : ''}
    <div class="round"><strong>Round ${r.round_no} · ${esc(titleCase(r.round_type))}</strong>
      <small>${r.is_elimination ? 'Elimination' : 'Non-elimination'} · ${r.candidates} sat${r.scheduled ? ` · ${r.scheduled} scheduled` : ` · ${r.cleared} cleared`}</small></div></span>`).join('');

  const applicants = dataTable([
    { label: 'Student', render: a => `<a class="cell-title" href="#/student/${encodeURIComponent(a.roll_no)}">${esc(a.student_name)}</a><div class="cell-sub mono">${esc(a.roll_no)}</div>` },
    { label: 'Program', key: 'program_code' },
    { label: 'CGPA', num: true, render: a => Number(a.cgpa).toFixed(2) },
    { label: 'Avg score', num: true, render: a => (a.avg_score == null ? '—' : Number(a.avg_score).toFixed(1)) },
    { label: 'Application', render: a => pill(a.status) },
    { label: 'Offer', render: a => (a.offer_id ? pill(a.offer_status) : '') },
    { label: '', render: a => (a.status === 'SHORTLISTED' && !a.offer_id ? `<button class="btn btn-outline btn-sm" data-action="make-offer" data-roll="${esc(a.roll_no)}" data-job="${j.job_id}">Make offer</button>` : '') },
  ], d.applicants);

  const talent = d.talent_match.length ? dataTable([
    { label: 'Student', render: t => `<a class="cell-title" href="#/student/${encodeURIComponent(t.roll_no)}">${esc(t.student_name)}</a><div class="cell-sub mono">${esc(t.roll_no)} · ${esc(t.program_code)}</div>` },
    { label: 'CGPA', num: true, render: t => Number(t.cgpa).toFixed(2) },
    { label: '', render: t => (t.applied ? pill('APPLIED', 'Applied') : j.is_open ? `<button class="btn btn-sm" data-action="apply-direct" data-roll="${esc(t.roll_no)}" data-job="${j.job_id}">Apply</button>` : '<span class="small muted">closed</span>') },
  ], d.talent_match) : '<div class="empty">Nobody meets every requirement.</div>';

  view.innerHTML = `
    <a class="crumb" href="#/jobs">← All jobs</a>
    ${pageHead(`${j.company_name} · ${j.title}`, `${esc(j.cycle_name)} · ${esc(j.location)} · ${esc(titleCase(j.sector))} · posted by ${esc(j.posted_by_name || '—')}${j.designation ? `, ${esc(j.designation)}` : ''}`,
      `<div class="btn-row">${pill(j.role_type, j.role_type === 'FULLTIME' ? 'Full-time' : 'Internship')} ${j.is_open ? pill('APPLIED', 'Applications open') : pill('WITHDRAWN', 'Applications closed')}</div>`)}
    <div class="cards">
      <div class="panel kpi accent"><div class="kpi-label">${j.role_type === 'FULLTIME' ? 'CTC' : 'Stipend'}</div><div class="kpi-value">${pay(j)}</div><div class="kpi-sub">${j.role_type === 'FULLTIME' ? `fixed ${lpa(j.fixed_lpa)} · bonus ₹${fmtNum(j.joining_bonus)}` : `${j.duration_weeks} weeks · PPO ${j.ppo_possible ? 'possible' : 'not offered'}`}</div></div>
      <div class="panel kpi"><div class="kpi-label">Openings</div><div class="kpi-value">${j.openings}</div><div class="kpi-sub">positions</div></div>
      <div class="panel kpi"><div class="kpi-label">Deadline</div><div class="kpi-value" style="font-size:19px">${fmtDate(j.application_deadline)}</div><div class="kpi-sub">checked by trigger on apply</div></div>
      <div class="panel kpi"><div class="kpi-label">Eligible programs</div><div class="kpi-value" style="font-size:19px">${d.eligibility.map(e => esc(e.program_code)).join(' · ') || '—'}</div><div class="kpi-sub">${d.eligibility.map(e => `${esc(e.program_code)} ≥ ${Number(e.min_cgpa).toFixed(1)}`).join(', ')}</div></div>
    </div>
    <div class="grid grid-even">
      <div class="panel"><div class="panel-head"><div><h2>Hiring funnel</h2><p>Scalar subqueries over application, interview, offer</p></div></div><div class="panel-body"><div class="funnel">${funnel}</div></div></div>
      <div class="panel"><div class="panel-head"><div><h2>Requirements</h2><p>Weak entity interview_round, keyed by (job_id, round_no)</p></div></div>
        <div class="panel-body"><h3>Required skills</h3><div class="chips" style="margin:8px 0 16px">${d.skills.map(k => `<span class="chip"><b>${esc(k.skill_name)}</b>${dots(k.min_proficiency)}</span>`).join('') || '<span class="muted">None</span>'}</div>
        <h3>Interview rounds</h3><div class="rounds" style="margin-top:8px">${rounds}</div></div></div>
    </div>
    <div class="grid grid-2">
      <div class="panel"><div class="panel-head"><div><h2>Applicants</h2><p>“Make offer” is the recruiter's action; a trigger rejects offers on dead applications</p></div><span class="muted small">${d.applicants.length}</span></div><div class="panel-body flush scroll-y">${applicants}</div></div>
      <div class="panel"><div class="panel-head"><div><h2>Talent match</h2><p>Query 2: relational division. Eligible, not placed, and holding <b>every</b> required skill</p></div><span class="muted small">${d.talent_match.length}</span></div><div class="panel-body flush scroll-y">${talent}</div></div>
    </div>`;
}

/* ---------------------------------------------------------------- analytics */

async function renderAnalytics() {
  if (!state.queries) state.queries = await api('/api/queries');
  const cards = state.queries.map(q => `
    <div class="panel query-card">
      <div class="panel-head">
        <div class="query-title"><span class="query-num">Q${q.id}</span><div><h2>${esc(q.title)}</h2></div></div>
        <button class="btn" data-action="run-query" data-query="${q.id}">Run query</button>
      </div>
      <div class="panel-body">
        <div><h3>Business question</h3><p style="margin:4px 0 0">${esc(q.question)}</p></div>
        <div><h3>FDS concepts</h3><p class="muted" style="margin:4px 0 0">${esc(q.concepts)}</p></div>
        ${q.algebra ? `<div><h3>Relational algebra</h3><pre class="algebra" style="margin-top:6px">${esc(q.algebra)}</pre></div>` : ''}
        ${q.note ? `<div class="callout small"><b>Q&amp;A note.</b> ${esc(q.note)}</div>` : ''}
        <details class="sql"><summary>Show SQL</summary><pre class="code">${highlightSql(q.sql)}</pre></details>
        <div id="q-result-${q.id}"></div>
      </div>
    </div>`).join('');
  view.innerHTML = `${pageHead('SQL analytics', 'The five showcase queries, read live from <code>05_queries.sql</code> and executed in a read-only transaction.')}<div class="stack">${cards}</div>`;
}

async function runQuery(id, btn) {
  const out = document.getElementById(`q-result-${id}`);
  btn.disabled = true;
  out.innerHTML = '<div class="loading">Running…</div>';
  try {
    const r = await api(`/api/queries/${id}/run`, { method: 'POST' });
    out.innerHTML = `<div class="result-meta">${r.row_count} row${r.row_count === 1 ? '' : 's'} · ${r.elapsed_ms} ms</div><div class="panel" style="margin-top:8px;box-shadow:none">${rawTable(r.columns, r.rows)}</div>`;
  } catch (e) {
    out.innerHTML = '';
    showError(e);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------------------------------------------------------- injection lab */

const SEARCH_BASE_LEN = "SELECT s.roll_no, concat_ws(' ', p.first_name, p.last_name) AS student_name, p.email FROM student s JOIN person p ON p.person_id = s.person_id WHERE p.last_name = ".length;

const PRESETS = [
  { label: 'Sen', value: 'Sen' },
  { label: "x' OR '1'='1", value: "x' OR '1'='1" },
  { label: 'UNION: leak phone numbers', value: "x' UNION SELECT roll_no, cgpa::text, phone FROM student JOIN person USING (person_id) --" },
  { label: "'; DROP TABLE student; --", value: "x'; DROP TABLE student; --" },
];

function renderSecurity() {
  view.innerHTML = `
    ${pageHead('SQL injection lab', 'The same student search, implemented two ways. Try a normal name, then an attack string, and compare what reaches the database.')}
    <div class="panel"><div class="panel-body">
      <div class="lab-input">
        <input type="text" id="inj-input" value="Sen" spellcheck="false" aria-label="Last name to search">
        <button class="btn btn-danger" data-action="inj" data-mode="unsafe">Run UNSAFE</button>
        <button class="btn btn-success" data-action="inj" data-mode="safe">Run SAFE</button>
      </div>
      <div class="chips" style="margin-top:12px">${PRESETS.map(p => `<button class="preset" data-action="preset" data-value="${esc(p.value)}">${esc(p.label)}</button>`).join('')}</div>
    </div></div>
    <div class="grid grid-even">
      <div class="panel lab-col unsafe">
        <div class="panel-head"><div><h2>Unsafe: string concatenation</h2><p><code>"... WHERE last_name = '" + input + "'"</code></p></div></div>
        <div class="panel-body" id="inj-unsafe"><div class="empty">Not run yet.</div></div>
      </div>
      <div class="panel lab-col safe">
        <div class="panel-head"><div><h2>Safe: bound parameter</h2><p><code>"... WHERE last_name = $1"</code>, with the input sent separately</p></div></div>
        <div class="panel-body" id="inj-safe"><div class="empty">Not run yet.</div></div>
      </div>
    </div>
    <div class="panel"><div class="panel-body callout warn">
      <b>Why the DROP attempt still fails on the unsafe side: defense in depth.</b>
      <ul>
        <li>The query runs as <code>placeiq_readonly</code>, a role that only has <code>SELECT</code> on <code>student</code> and <code>person</code> (DCL: <code>GRANT</code>).</li>
        <li>It runs inside a <code>READ ONLY</code> transaction with a 2-second timeout, and is always rolled back.</li>
        <li>The real fix is still the right-hand side: parameters are never parsed as SQL.</li>
      </ul>
    </div></div>`;
}

async function runInjection(mode) {
  const input = document.getElementById('inj-input').value;
  const out = document.getElementById(`inj-${mode}`);
  out.innerHTML = '<div class="loading">Running…</div>';
  try {
    const r = await api(`/api/security/search?${new URLSearchParams({ name: input, mode })}`);
    const prefix = highlightSql(r.sql_sent.slice(0, SEARCH_BASE_LEN));
    const tail = r.sql_sent.slice(SEARCH_BASE_LEN);
    const sentHtml = mode === 'unsafe'
      ? `${prefix}<span class="inj">${esc(tail)}</span>`
      : `${prefix}<span class="param">${esc(tail)}</span>\n<span class="cm">-- $1 = ${esc(JSON.stringify(r.parameters[0]))}</span>`;
    out.innerHTML = `
      <h3>SQL sent to PostgreSQL</h3>
      <pre class="code" style="margin:6px 0 14px;white-space:pre-wrap">${sentHtml}</pre>
      <div class="big-count">${r.row_count}</div><div class="muted small" style="margin-bottom:10px">row${r.row_count === 1 ? '' : 's'} returned</div>
      ${r.rows.length ? `<div class="panel" style="box-shadow:none">${dataTable([
        { label: 'roll_no', render: x => `<span class="mono">${esc(x.roll_no)}</span>` },
        { label: 'student_name', key: 'student_name' },
        { label: 'email', render: x => `<span class="small">${esc(x.email)}</span>` },
      ], r.rows.slice(0, 50))}</div>${r.rows.length > 50 ? `<p class="small muted">…and ${r.rows.length - 50} more</p>` : ''}` : ''}`;
  } catch (e) {
    const info = e.info || {};
    out.innerHTML = `<div class="error-panel"><b>PostgreSQL refused the statement</b><br>${esc(e.message)}${info.sqlstate ? `<br><code>SQLSTATE ${esc(info.sqlstate)}</code>` : ''}</div>`;
  }
}

/* ---------------------------------------------------------------- activity */

async function renderActivity() {
  const rows = await api('/api/log?limit=300');
  view.innerHTML = `
    ${pageHead('Audit log', 'Every row here was written by the one-offer-policy trigger (or the expiry procedure), never by application code.')}
    <div class="panel"><div class="panel-body flush">${dataTable([
      { label: 'When', render: l => `<span class="nowrap">${fmtDateTime(l.logged_at)}</span>` },
      { label: 'Action', render: l => pill(l.action, titleCase(l.action)) },
      { label: 'Student', render: l => (l.roll_no ? `<a class="mono" href="#/student/${encodeURIComponent(l.roll_no)}">${esc(l.roll_no)}</a>` : '—') },
      { label: 'Job', render: l => (l.job_id ? `<a href="#/job/${l.job_id}">${esc(l.company_name)}</a><div class="cell-sub">${esc(l.title)}</div>` : '—') },
      { label: 'Details', render: l => `<span class="small">${esc(l.details)}</span>` },
    ], rows)}</div></div>`;
}

/* ---------------------------------------------------------------- actions */

function cascadeHtml(cascade) {
  if (!cascade || !cascade.length) return '';
  return `<ul>${cascade.map(c => `<li><b>${esc(titleCase(c.action))}</b> · ${esc(c.company_name || `job ${c.job_id}`)}</li>`).join('')}</ul>`;
}

async function withButton(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { showError(e); } finally { if (btn && btn.isConnected) btn.disabled = false; }
}

const actions = {
  'set-cycle': btn => { state.cycle = Number(btn.dataset.cycle); router(false); },
  'jobs-cycle': btn => { state.jobsCycle = btn.dataset.cycle; router(false); },

  accept: btn => withButton(btn, async () => {
    const id = btn.dataset.offer;
    if (!window.confirm(`Accept offer #${id}?\n\nThe one-offer trigger will decline this student's other pending offers and withdraw their open applications in this cycle.`)) return;
    const r = await api(`/api/offers/${id}/accept`, { method: 'POST' });
    toast('success', 'Offer accepted', esc(r.message) + cascadeHtml(r.cascade.filter(c => c.action !== 'OFFER_ACCEPTED')), 'CALL sp_accept_offer() → trg_offer_accept_cascade', 10000);
    await router(false);
  }),

  decline: btn => withButton(btn, async () => {
    const r = await api(`/api/offers/${btn.dataset.offer}/decline`, { method: 'POST' });
    toast('success', 'Offer declined', esc(r.message));
    await router(false);
  }),

  apply: btn => withButton(btn, async () => {
    const jobId = Number(document.getElementById('apply-job').value);
    const r = await api('/api/applications', { method: 'POST', body: JSON.stringify({ roll_no: btn.dataset.roll, job_id: jobId }) });
    toast('success', 'Application accepted', `${esc(r.message)} (application #${r.application_id})`, 'passed trg_application_eligibility');
    await router(false);
  }),

  'apply-direct': btn => withButton(btn, async () => {
    const r = await api('/api/applications', { method: 'POST', body: JSON.stringify({ roll_no: btn.dataset.roll, job_id: Number(btn.dataset.job) }) });
    toast('success', 'Application accepted', esc(r.message), 'passed trg_application_eligibility');
    await router(false);
  }),

  'make-offer': btn => withButton(btn, async () => {
    const r = await api('/api/offers', { method: 'POST', body: JSON.stringify({ roll_no: btn.dataset.roll, job_id: Number(btn.dataset.job), response_days: 7 }) });
    toast('success', 'Offer made', `${esc(r.message)}. It is valid for 7 days.`, 'trg_offer_marks_app_offered → application OFFERED');
    await router(false);
  }),

  'run-query': btn => runQuery(btn.dataset.query, btn),

  inj: btn => runInjection(btn.dataset.mode),

  preset: btn => { document.getElementById('inj-input').value = btn.dataset.value; },

  reset: btn => withButton(btn, async () => {
    if (!window.confirm('Rebuild the database from 02_ddl.sql, 03_logic.sql and 04_data.sql?\nAll changes made in the UI will be lost.')) return;
    btn.textContent = 'Resetting…';
    try {
      const r = await api('/api/admin/reset', { method: 'POST' });
      toast('success', 'Demo data restored', `Rebuilt in ${r.elapsed_s} s.`);
      state.queries = null;
      await router(false);
    } finally {
      btn.textContent = 'Reset demo data';
    }
  }),
};

document.addEventListener('click', e => {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    e.preventDefault();
    const fn = actions[actionEl.dataset.action];
    if (fn) fn(actionEl);
    return;
  }
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a, button')) location.hash = row.dataset.href;
});

/* ---------------------------------------------------------------- router */

const routes = {
  dashboard: renderDashboard,
  students: renderStudents,
  student: renderStudent,
  jobs: renderJobs,
  job: renderJob,
  analytics: renderAnalytics,
  security: renderSecurity,
  activity: renderActivity,
};
const NAV_FOR = { student: 'students', job: 'jobs' };

async function router(isNavigation = true) {
  const [, rawName, ...rest] = (location.hash || '#/dashboard').split('/');
  const name = routes[rawName] ? rawName : 'dashboard';
  const param = rest.length ? decodeURIComponent(rest.join('/')) : undefined;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === (NAV_FOR[name] || name)));
  if (isNavigation) {
    view.innerHTML = '<div class="loading">Loading…</div>';
    window.scrollTo(0, 0);
  }
  try {
    await routes[name](param);
  } catch (e) {
    view.innerHTML = `<div class="error-panel"><b>Could not load this page.</b><br>${esc(e.message)}${e.info && e.info.detail ? `<br><code>${esc(e.info.detail)}</code>` : ''}</div>`;
  }
}

async function checkHealth() {
  const box = document.getElementById('db-status');
  try {
    const h = await api('/api/health');
    box.className = 'db-status ok';
    box.innerHTML = `<span class="dot"></span><span>PostgreSQL ${esc(h.postgres_version)} · ${esc(h.database)}</span>`;
  } catch (e) {
    box.className = 'db-status down';
    box.innerHTML = '<span class="dot"></span><span>Database offline</span>';
  }
}

window.addEventListener('hashchange', () => router(true));
router(true);
checkHealth();
