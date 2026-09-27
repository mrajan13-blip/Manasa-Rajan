import { ageInMonths, percentileFor, formatPercentile, METRICS, MAX_CHART_MONTHS } from './growth.js';
import { growthChartSvg } from './charts.js';

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const modal = $('#modal');
const modalForm = $('#modal-form');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* private mode */ } },
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    // The server requires a JSON content type on every write (CSRF protection).
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2400);
}

const ICONS = {
  sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  feed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4M9 5h6l-1 3H10z"/><path d="M8 8h8v11a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3z"/><path d="M8 13h3M8 17h3"/></svg>',
  diaper: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18v4a9 9 0 0 1-18 0z"/><path d="M7 10a5 5 0 0 0 10 0"/></svg>',
  growth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 7v4M10 7v3M14 7v4M18 7v3"/></svg>',
  pump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-3 4-6 7-6 11a6 6 0 0 0 12 0c0-4-3-7-6-11z"/></svg>',
  medical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  solid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"/></svg>',
  milestone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
  family: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M15 20a4.5 4.5 0 0 1 6.5-4"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// ---------- time & units ----------
const pad = (n) => String(n).padStart(2, '0');
function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const toLocalDate = (iso) => toLocalInput(iso).slice(0, 10);
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
const fmtDate = (iso) => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });

function fmtDuration(ms, { seconds = false } = {}) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (seconds) return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtAge(birthDate) {
  const days = Math.floor((startOfDay(new Date()) - new Date(`${birthDate}T00:00`)) / 86400000);
  if (days < 0) return 'Not born yet';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} old`;
  if (days < 7 * 13) return `${Math.floor(days / 7)} weeks old`;
  const months = Math.floor(ageInMonths(birthDate, new Date()));
  if (months < 24) return `${months} months old`;
  const y = Math.floor(months / 12);
  return `${y} yr${months % 12 ? ` ${months % 12} mo` : ''} old`;
}

const ML_PER_OZ = 29.5735;
const LB_PER_KG = 2.20462;
const CM_PER_IN = 2.54;
const imperial = () => state.me?.user.units === 'imperial';

function fmtVolume(ml) {
  return imperial() ? `${+(ml / ML_PER_OZ).toFixed(1)} oz` : `${Math.round(ml)} ml`;
}
function fmtWeight(kg) {
  if (!imperial()) return `${+kg.toFixed(2)} kg`;
  const totalOz = kg * LB_PER_KG * 16;
  let lb = Math.floor(totalOz / 16);
  let oz = Math.round((totalOz - lb * 16) * 10) / 10;
  if (oz >= 16) { lb += 1; oz = 0; }
  return `${lb} lb ${oz} oz`;
}
function fmtTemp(value, unit) {
  const f = unit === 'C' ? value * 9 / 5 + 32 : value;
  return imperial() ? `${f.toFixed(1)}°F` : `${((f - 32) * 5 / 9).toFixed(1)}°C`;
}
function fmtLength(cm) {
  return imperial() ? `${+(cm / CM_PER_IN).toFixed(1)} in` : `${+cm.toFixed(1)} cm`;
}

// ---------- state ----------
const state = {
  me: null,
  tab: store.get('bt_tab') || 'today',
  childId: store.get('bt_child'),
  recent: [],
  logDay: startOfDay(new Date()),
  logEvents: [],
  growth: [],
  growthMetric: store.get('bt_metric') || 'weight',
  authMode: 'signin',
  invite: null,
};

const child = () => state.me?.children.find((c) => c.id === state.childId);

// ---------- data loading ----------
async function loadMe() {
  state.me = await api('GET', '/api/me');
  if (!state.me.children.some((c) => c.id === state.childId)) {
    state.childId = state.me.children[0]?.id ?? null;
    store.set('bt_child', state.childId);
  }
}

async function loadTabData() {
  const c = child();
  if (!c) return;
  const base = `/api/children/${c.id}/events`;
  if (state.tab === 'today') {
    const from = addDays(startOfDay(new Date()), -3).toISOString();
    state.recent = (await api('GET', `${base}?from=${encodeURIComponent(from)}`)).events;
  } else if (state.tab === 'log') {
    const from = state.logDay.toISOString();
    const to = addDays(state.logDay, 1).toISOString();
    state.logEvents = (await api('GET', `${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).events;
  } else if (state.tab === 'growth') {
    state.growth = (await api('GET', `${base}?type=growth`)).events;
  }
}

async function refresh() {
  try {
    await loadMe();
    await loadTabData();
    render();
  } catch (err) {
    if (err.status === 401) { state.me = null; render(); } else toast(err.message);
  }
}

// ---------- event descriptions ----------
function describe(e) {
  const d = e.data;
  if (e.type === 'sleep') {
    return {
      title: e.endAt ? `Slept ${fmtDuration(new Date(e.endAt) - new Date(e.startAt))}` : 'Sleeping now',
      meta: e.endAt ? `${fmtTime(e.startAt)} – ${fmtTime(e.endAt)}` : `since ${fmtTime(e.startAt)}`,
    };
  }
  if (e.type === 'feed') {
    if (d.method === 'bottle') {
      const what = { breast_milk: 'breast milk', formula: 'formula', mixed: 'breast milk + formula' }[d.contents];
      const split = d.breastMilkMl != null && d.formulaMl != null ? ` (${fmtVolume(d.breastMilkMl)} + ${fmtVolume(d.formulaMl)})` : '';
      return { title: `Bottle · ${fmtVolume(d.amountMl)}`, meta: [what + split, d.formulaName].filter(Boolean).join(' · ') };
    }
    const parts = [];
    if (d.leftSeconds) parts.push(`L ${fmtDuration(d.leftSeconds * 1000)}`);
    if (d.rightSeconds) parts.push(`R ${fmtDuration(d.rightSeconds * 1000)}`);
    const total = (d.leftSeconds || 0) + (d.rightSeconds || 0);
    return {
      title: `Breastfed${total ? ` · ${fmtDuration(total * 1000)}` : ''}`,
      meta: [parts.join(' · '), d.lastSide ? `ended on ${d.lastSide}` : ''].filter(Boolean).join(' — '),
    };
  }
  if (e.type === 'diaper') {
    const extra = [d.color, d.texture, d.blowout && 'blowout', d.rash && 'rash'].filter(Boolean).join(' · ');
    return { title: { wet: 'Wet diaper', dirty: 'Dirty diaper', both: 'Wet + dirty diaper', dry: 'Dry diaper' }[d.kind], meta: extra };
  }
  if (e.type === 'pump') {
    const total = d.totalMl ?? ((d.leftMl || 0) + (d.rightMl || 0));
    const sides = [d.leftMl != null && `L ${fmtVolume(d.leftMl)}`, d.rightMl != null && `R ${fmtVolume(d.rightMl)}`].filter(Boolean).join(' · ');
    const dur = e.endAt && new Date(e.endAt) > new Date(e.startAt) ? fmtDuration(new Date(e.endAt) - new Date(e.startAt)) : '';
    return { title: `Pumped${total ? ` · ${fmtVolume(total)}` : ''}`, meta: [sides, dur].filter(Boolean).join(' — ') };
  }
  if (e.type === 'medical') {
    const temp = d.temperature != null ? fmtTemp(d.temperature, d.tempUnit) : '';
    return { title: d.medication ? d.medication : temp ? `Temperature ${temp}` : 'Health note', meta: d.medication && temp ? `Temperature ${temp}` : '' };
  }
  if (e.type === 'solid') {
    return { title: d.foods ? `Ate ${d.foods}` : 'Solid food', meta: d.meal ? d.meal[0].toUpperCase() + d.meal.slice(1) : '' };
  }
  if (e.type === 'milestone') {
    return { title: d.title, meta: d.kind === 'first' ? 'Baby first' : 'Milestone' };
  }
  const parts = [];
  if (d.weightKg) parts.push(fmtWeight(d.weightKg));
  if (d.lengthCm) parts.push(fmtLength(d.lengthCm));
  if (d.headCm) parts.push(`head ${fmtLength(d.headCm)}`);
  return { title: 'Growth', meta: parts.join(' · ') };
}

function timelineHtml(events, { showDate = false } = {}) {
  if (!events.length) return '<p class="empty">Nothing logged yet.</p>';
  return `<ul class="timeline">${events.map((e) => {
    const { title, meta } = describe(e);
    const note = e.data.note ? ` — ${esc(e.data.note)}` : '';
    const by = e.createdBy && state.me.members.length > 1 ? ` · by ${esc(e.createdBy)}` : '';
    return `<li>
      <button class="row" data-edit="${e.id}" aria-label="Edit ${esc(title)}">
        <span class="badge c-${e.type}">${ICONS[e.type]}</span>
        <span><span class="title">${esc(title)}</span><span class="meta">${esc(meta)}${note}${by}</span></span>
        <span class="time">${showDate ? `${fmtDate(e.startAt)}<br>` : ''}${e.type === 'growth' ? '' : fmtTime(e.startAt)}</span>
      </button>
    </li>`;
  }).join('')}</ul>`;
}

// ---------- views ----------
function render() {
  if (!state.me) return renderAuth();
  if (!state.me.children.length) return renderFirstChild();
  const c = child();
  const tabs = [['today', 'Today', ICONS.today], ['log', 'History', ICONS.log], ['growth', 'Growth', ICONS.chart], ['family', 'Family', ICONS.family]];
  const body = { today: viewToday, log: viewLog, growth: viewGrowth, family: viewFamily }[state.tab]();
  app.innerHTML = `
    <div class="shell">
      <header class="topbar">
        <div class="child-switch">
          ${state.me.children.length > 1
            ? `<select id="child-select" aria-label="Choose child">${state.me.children.map((k) => `<option value="${k.id}" ${k.id === c.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select>`
            : `<h1>${esc(c.name)}</h1>`}
          <span class="age">${fmtAge(c.birthDate)}</span>
        </div>
      </header>
      ${body}
    </div>
    <div class="tabbar"><nav>${tabs.map(([id, label, icon]) =>
      `<button data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ''}>${icon}<span>${label}</span></button>`).join('')}</nav></div>`;
  tick();
}

function viewToday() {
  const now = new Date();
  const dayStart = startOfDay(now);
  const events = state.recent;
  const ongoing = events.find((e) => e.type === 'sleep' && !e.endAt);
  const lastOf = (type) => events.find((e) => e.type === type);
  const lastFeed = lastOf('feed');
  const lastDiaper = lastOf('diaper');
  const lastSleep = events.find((e) => e.type === 'sleep' && e.endAt);

  const today = events.filter((e) => new Date(e.startAt) >= dayStart);
  let sleepMs = 0;
  for (const e of events.filter((ev) => ev.type === 'sleep')) {
    const s = Math.max(new Date(e.startAt), dayStart);
    const en = e.endAt ? new Date(e.endAt) : now;
    if (en > s) sleepMs += en - s;
  }
  const feeds = today.filter((e) => e.type === 'feed');
  const bottleMl = feeds.reduce((sum, e) => sum + (e.data.amountMl || 0), 0);
  const diapers = today.filter((e) => e.type === 'diaper');
  const wet = diapers.filter((e) => e.data.kind === 'wet' || e.data.kind === 'both').length;
  const dirty = diapers.filter((e) => e.data.kind === 'dirty' || e.data.kind === 'both').length;
  const feedTimer = store.get(feedTimerKey());

  const since = (e, fallback = '—') => (e ? `<span data-since="${e.endAt || e.startAt}"></span> ago` : fallback);

  return `
    ${ongoing ? `
      <section class="card sleep-live section">
        <div><div class="muted small">Asleep since ${fmtTime(ongoing.startAt)}</div><div class="timer" data-elapsed="${ongoing.startAt}"></div></div>
        <button class="btn primary" data-action="wake" data-id="${ongoing.id}">Woke up</button>
      </section>` : ''}
    ${feedTimer ? `
      <section class="card sleep-live section" style="border-left-color: var(--feed)">
        <div><div class="muted small">Breastfeeding in progress</div><div class="timer" data-feed-total></div></div>
        <button class="btn primary" data-quick="feed">Open</button>
      </section>` : ''}
    <section class="section quick" aria-label="Log something">
      <button data-quick="sleep"><span class="dot c-sleep">${ICONS.sleep}</span>${ongoing ? 'Wake up' : 'Sleep'}</button>
      <button data-quick="feed"><span class="dot c-feed">${ICONS.feed}</span>Feed</button>
      <button data-quick="diaper"><span class="dot c-diaper">${ICONS.diaper}</span>Diaper</button>
      <button data-quick="growth"><span class="dot c-growth">${ICONS.growth}</span>Growth</button>
    </section>
    <section class="more" aria-label="Log more">
      <button data-quick="pump"><span class="mini c-pump">${ICONS.pump}</span>Pump</button>
      <button data-quick="medical"><span class="mini c-medical">${ICONS.medical}</span>Medicine / temp</button>
      <button data-quick="solid"><span class="mini c-solid">${ICONS.solid}</span>Solids</button>
      <button data-quick="milestone"><span class="mini c-milestone">${ICONS.milestone}</span>Milestone</button>
    </section>
    <section class="section">
      <div class="section-head"><h2>Since last</h2></div>
      <div class="stats">
        <div class="card stat"><div class="label">Feed</div><div class="value">${lastFeed ? `<span data-since="${lastFeed.startAt}"></span>` : '—'}</div><div class="sub">${lastFeed ? `ago · ${esc(describe(lastFeed).title)}` : 'none in 3 days'}</div></div>
        <div class="card stat"><div class="label">Diaper</div><div class="value">${lastDiaper ? `<span data-since="${lastDiaper.startAt}"></span>` : '—'}</div><div class="sub">${lastDiaper ? `ago · ${lastDiaper.data.kind}` : 'none in 3 days'}</div></div>
        <div class="card stat"><div class="label">${ongoing ? 'Asleep' : 'Awake'}</div><div class="value">${ongoing ? `<span data-since="${ongoing.startAt}"></span>` : lastSleep ? `<span data-since="${lastSleep.endAt}"></span>` : '—'}</div><div class="sub">${ongoing ? 'so far' : lastSleep ? `since ${fmtTime(lastSleep.endAt)}` : 'no sleep logged'}</div></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Today</h2></div>
      <div class="stats">
        <div class="card stat"><div class="label">Sleep</div><div class="value">${fmtDuration(sleepMs)}</div><div class="sub">${events.filter((e) => e.type === 'sleep' && new Date(e.startAt) >= dayStart).length} sleeps</div></div>
        <div class="card stat"><div class="label">Feeds</div><div class="value">${feeds.length}</div><div class="sub">${bottleMl ? `${fmtVolume(bottleMl)} bottle` : '&nbsp;'}</div></div>
        <div class="card stat"><div class="label">Diapers</div><div class="value">${diapers.length}</div><div class="sub">${wet} wet · ${dirty} dirty</div></div>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>Recent</h2><button class="link-btn" data-tab="log">See all</button></div>
      <div class="card">${timelineHtml(events.slice(0, 12))}</div>
    </section>`;
}

function viewLog() {
  const day = state.logDay;
  const isToday = +day === +startOfDay(new Date());
  const counts = ['sleep', 'feed', 'diaper'].map((t) => state.logEvents.filter((e) => e.type === t).length);
  return `
    <section class="section card day-nav">
      <button class="icon-btn" data-day="-1" aria-label="Previous day">${ICONS.left}</button>
      <div style="text-align:center"><h2>${isToday ? 'Today' : fmtDay(day)}</h2>
        <input type="date" id="log-date" aria-label="Jump to date" value="${toLocalDate(day.toISOString())}" max="${toLocalDate()}" />
        <div class="muted small">${counts[0]} sleeps · ${counts[1]} feeds · ${counts[2]} diapers</div></div>
      <button class="icon-btn" data-day="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>${ICONS.right}</button>
    </section>
    <section class="section card">${timelineHtml(state.logEvents)}</section>`;
}

function viewGrowth() {
  const c = child();
  const metric = state.growthMetric;
  const field = { weight: 'weightKg', length: 'lengthCm', head: 'headCm' }[metric];
  const ordered = [...state.growth].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const fmt = { weight: fmtWeight, length: fmtLength, head: fmtLength }[metric];
  const toDisplay = metric === 'weight'
    ? (kg) => (imperial() ? kg * LB_PER_KG : kg)
    : (cm) => (imperial() ? cm / CM_PER_IN : cm);
  const unitLabel = metric === 'weight' ? (imperial() ? 'lb' : 'kg') : (imperial() ? 'in' : 'cm');
  const points = ordered.filter((e) => e.data[field]).map((e) => {
    const months = ageInMonths(c.birthDate, e.startAt);
    return { months, value: e.data[field], label: `${fmtDate(e.startAt)}: ${fmt(e.data[field])}` };
  }).filter((p) => p.months >= 0);
  const tooOld = ageInMonths(c.birthDate, new Date()) > MAX_CHART_MONTHS;
  const latest = [...points].reverse().find((p) => p.months <= MAX_CHART_MONTHS);
  const latestPct = latest ? percentileFor(metric, c.sex, latest.months, latest.value) : null;

  return `
    <section class="section">
      <div class="section-head"><h2>Growth</h2><button class="btn primary" data-quick="growth">Add measurement</button></div>
      <div class="seg" role="group" aria-label="Measurement">
        ${Object.entries(METRICS).map(([id, m]) => `<button type="button" data-metric="${id}" aria-pressed="${id === metric}">${id === 'length' ? 'Length' : id === 'head' ? 'Head' : m.label}</button>`).join('')}
      </div>
    </section>
    <section class="section card">
      <div class="section-head">
        <div><h3>${METRICS[metric].label}-for-age · ${c.sex === 'female' ? 'girls' : 'boys'}</h3>
          <div class="muted small">WHO Child Growth Standards, 0–36 months</div></div>
        ${latest ? `<div style="text-align:right"><div class="value" style="font-weight:700">${formatPercentile(latestPct)}</div><div class="muted small">percentile</div></div>` : ''}
      </div>
      <div class="chart-wrap">${growthChartSvg({ metric, sex: c.sex, points, toDisplay, unitLabel, title: `${METRICS[metric].label} chart for ${c.name}` })}</div>
      <div class="legend"><span>3rd · 15th · 50th · 85th · 97th percentiles</span><span class="you">${esc(c.name)}</span></div>
      ${tooOld ? '<p class="muted small">These charts cover birth to 3 years; later measurements are listed below but not plotted.</p>' : ''}
      ${!points.length ? '<p class="muted small">Add a measurement to see where your child falls on the chart.</p>' : ''}
    </section>
    <section class="section card">
      <h3 style="margin-bottom:8px">Measurements</h3>
      ${ordered.length ? `<div class="table-scroll"><table class="data">
        <thead><tr><th>Date</th><th>Age</th><th>Weight</th><th>Length</th><th>Head</th></tr></thead>
        <tbody>${[...ordered].reverse().map((e) => {
          const m = ageInMonths(c.birthDate, e.startAt);
          const cell = (key, f, fmtFn) => (e.data[f] ? `${fmtFn(e.data[f])}<br><span class="muted small">${formatPercentile(percentileFor(key, c.sex, m, e.data[f]))}</span>` : '—');
          return `<tr data-edit="${e.id}" style="cursor:pointer">
            <td>${fmtDate(e.startAt)}</td><td>${m < 1 ? `${Math.round(m * 30.4)}d` : `${m.toFixed(1)}mo`}</td>
            <td>${cell('weight', 'weightKg', fmtWeight)}</td><td>${cell('length', 'lengthCm', fmtLength)}</td><td>${cell('head', 'headCm', fmtLength)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="empty">No measurements yet.</p>'}
      <p class="muted small" style="margin-top:12px">Percentiles are informational. Your pediatrician looks at the trend over time, not a single number.</p>
    </section>`;
}

function viewFamily() {
  const { user, members, children } = state.me;
  return `
    <section class="section card">
      <div class="section-head"><h2>Children</h2><button class="btn" data-action="add-child">Add child</button></div>
      <ul class="list-plain">${children.map((k) => `
        <li><div><strong>${esc(k.name)}</strong><div class="muted small">Born ${fmtDate(`${k.birthDate}T00:00`)} · ${k.sex === 'female' ? 'Girl' : 'Boy'}</div></div>
        <button class="btn ghost" data-edit-child="${k.id}">Edit</button></li>`).join('')}</ul>
    </section>
    <section class="section card">
      <h2>Import from Nara Baby</h2>
      <p class="muted small">Bring over your history: sleep, feeds, diapers and growth. In Nara, tap your child's avatar on the Activity screen, then <strong>Export Data</strong>, and upload that CSV here. Anything already imported is skipped, so it's safe to run again.</p>
      <button class="btn" data-action="import-nara">Import Nara CSV</button>
    </section>
    <section class="section card">
      <div class="section-head"><h2>Caregivers</h2><button class="btn primary" data-action="invite">Invite partner</button></div>
      <ul class="list-plain">${members.map((m) => `<li><div><strong>${esc(m.name)}</strong>${m.id === user.id ? ' <span class="muted small">(you)</span>' : ''}<div class="muted small">${esc(m.email)}</div></div>${m.id === user.id ? '' : `<button class="btn ghost danger" data-remove-member="${m.id}" data-name="${esc(m.name)}">Remove</button>`}</li>`).join('')}</ul>
      <p class="muted small">Everyone here sees and logs for all children in real time.</p>
      <details style="margin-top:8px" ${state.invite ? 'open' : ''}><summary class="link-btn">Have an invite code?</summary>
        <form id="join-form" style="margin-top:10px">
          <div class="field"><label for="join-code">Invite code</label><input id="join-code" name="code" autocomplete="off" placeholder="ABCD-EFGH" value="${esc(state.invite || '')}" required /></div>
          <p class="error" id="join-error"></p>
          <button class="btn" type="submit">Join family</button>
        </form>
      </details>
    </section>
    <section class="section card">
      <h2 style="margin-bottom:12px">Settings</h2>
      <div class="field"><span class="label">Units</span>
        <div class="seg" role="group" aria-label="Units">
          <button type="button" data-units="imperial" aria-pressed="${user.units === 'imperial'}">lb · oz · in</button>
          <button type="button" data-units="metric" aria-pressed="${user.units === 'metric'}">kg · ml · cm</button>
        </div></div>
      <p class="muted small">Signed in as ${esc(user.email)}</p>
      <button class="btn danger" data-action="logout">Sign out</button>
    </section>`;
}

function renderAuth() {
  const signup = state.authMode === 'signup';
  app.innerHTML = `
    <main class="auth">
      <div class="brand"><img src="/icon.svg" alt="" /><div><h1>Baby Tracker</h1><div class="muted">Sleep, feeds, diapers & growth — shared with your partner.</div></div></div>
      <form id="auth-form" class="card">
        <h2 style="margin-bottom:14px">${signup ? 'Create your account' : 'Sign in'}</h2>
        ${signup ? '<div class="field"><label for="a-name">Your name</label><input id="a-name" name="name" autocomplete="name" required /></div>' : ''}
        <div class="field"><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" required /></div>
        <div class="field"><label for="a-pass">Password</label><input id="a-pass" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="${signup ? 8 : 1}" required /></div>
        ${signup ? `<div class="field"><label for="a-invite">Invite code <span class="muted">(optional — to join your partner)</span></label><input id="a-invite" name="inviteCode" autocomplete="off" placeholder="ABCD-EFGH" value="${esc(state.invite || '')}" /></div>` : ''}
        <p class="error" id="auth-error"></p>
        <button class="btn primary block" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      </form>
      <p style="text-align:center">${signup ? 'Already have an account?' : 'New here?'} <button class="link-btn" data-action="toggle-auth">${signup ? 'Sign in' : 'Create an account'}</button></p>
    </main>`;
}

function renderFirstChild() {
  app.innerHTML = `
    <main class="auth">
      <div class="brand"><img src="/icon.svg" alt="" /><div><h1>Welcome, ${esc(state.me.user.name)}</h1><div class="muted">Add your baby to get started.</div></div></div>
      <form id="first-child" class="card">${childFields()}<p class="error" id="child-error"></p>
        <button class="btn primary block" type="submit">Add child</button></form>
      <div class="card" style="margin-top:16px">
        <h3>Joining your partner instead?</h3>
        <p class="muted small">Enter the invite code they shared from the Family tab.</p>
        <form id="join-form"><div class="field"><input name="code" aria-label="Invite code" placeholder="ABCD-EFGH" autocomplete="off" value="${esc(state.invite || '')}" required /></div>
          <p class="error" id="join-error"></p><button class="btn block" type="submit">Join family</button></form>
      </div>
      <p style="text-align:center"><button class="link-btn" data-action="logout">Sign out</button></p>
    </main>`;
}

function childFields(k = {}) {
  return `
    <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" value="${esc(k.name || '')}" required /></div>
    <div class="field"><label for="c-birth">Date of birth</label><input id="c-birth" name="birthDate" type="date" value="${esc(k.birthDate || '')}" max="${toLocalDate()}" required /></div>
    <div class="field"><span class="label">Sex <span class="muted">(used for the WHO growth charts)</span></span>
      <div class="seg" role="group"><button type="button" data-sex="female" aria-pressed="${k.sex === 'female'}">Girl</button><button type="button" data-sex="male" aria-pressed="${k.sex === 'male'}">Boy</button></div>
      <input type="hidden" name="sex" value="${esc(k.sex || '')}" /></div>`;
}

// ---------- live timers ----------
function tick() {
  const now = Date.now();
  document.querySelectorAll('[data-since]').forEach((el) => { el.textContent = fmtDuration(now - new Date(el.dataset.since)); });
  document.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = fmtDuration(now - new Date(el.dataset.elapsed), { seconds: true }); });
  const timer = store.get(feedTimerKey());
  if (timer) {
    const secs = { left: sideSeconds(timer, 'left'), right: sideSeconds(timer, 'right') };
    document.querySelectorAll('[data-feed-total]').forEach((el) => { el.textContent = fmtDuration((secs.left + secs.right) * 1000, { seconds: true }); });
    for (const side of ['left', 'right']) {
      const el = modalForm.querySelector(`[data-side="${side}"]`);
      if (!el) continue;
      el.classList.toggle('running', !!timer[side].since);
      el.querySelector('.t').textContent = fmtDuration(secs[side] * 1000, { seconds: true });
      el.querySelector('.s').textContent = timer[side].since ? 'Tap to pause' : 'Tap to start';
      const input = modalForm.elements[`${side}Min`];
      if (input && document.activeElement !== input) input.value = Math.round(secs[side] / 6) / 10 || '';
    }
  }
}
setInterval(tick, 1000);

// ---------- breastfeeding timer (per device, survives reloads) ----------
const feedTimerKey = () => `bt_feed_timer_${state.childId}`;
function sideSeconds(timer, side) {
  const s = timer[side];
  return s.acc + (s.since ? (Date.now() - s.since) / 1000 : 0);
}
function toggleSide(side) {
  const timer = store.get(feedTimerKey()) || { startedAt: Date.now(), left: { acc: 0, since: null }, right: { acc: 0, since: null } };
  const other = side === 'left' ? 'right' : 'left';
  if (timer[other].since) { timer[other].acc = sideSeconds(timer, other); timer[other].since = null; }
  if (timer[side].since) {
    timer[side].acc = sideSeconds(timer, side);
    timer[side].since = null;
  } else {
    timer[side].since = Date.now();
    timer.lastSide = side;
  }
  store.set(feedTimerKey(), timer);
  tick();
}

// ---------- modals ----------
let modalHandler = null;

function openModal(title, inner, onSubmit, { onDelete, confirmDelete = 'Delete this entry?' } = {}) {
  modalForm.innerHTML = `
    <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
    ${inner}
    <p class="error" id="modal-error"></p>
    <div class="modal-actions">
      ${onDelete ? '<button type="button" class="btn danger" data-delete>Delete</button>' : ''}
      <div class="right"><button type="button" class="btn" data-close>Cancel</button><button type="submit" class="btn primary">Save</button></div>
    </div>`;
  modalHandler = { onSubmit, onDelete, confirmDelete };
  modal.showModal();
  tick();
}

modalForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = modalForm.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    await modalHandler.onSubmit(new FormData(modalForm));
    modal.close();
    await refresh();
  } catch (err) {
    $('#modal-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

modalForm.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-close')) modal.close();
  if (t.hasAttribute('data-delete') && confirm(modalHandler.confirmDelete)) {
    try {
      await modalHandler.onDelete();
      modal.close();
      await refresh();
    } catch (err) { $('#modal-error').textContent = err.message; }
  }
  if (t.dataset.side) toggleSide(t.dataset.side);
  if (t.dataset.sex) {
    modalForm.elements.sex.value = t.dataset.sex;
    t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === t));
  }
  if (t.dataset.pick) {
    const [name, value] = t.dataset.pick.split(':');
    modalForm.elements[name].value = value;
    t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === t));
    if (name === 'method') {
      modalForm.querySelectorAll('[data-method]').forEach((el) => { el.hidden = el.dataset.method !== value; });
    }
  }
});

const noteField = (e) => `<div class="field"><label for="m-note">Note</label><textarea id="m-note" name="note" maxlength="1000">${esc(e?.data.note || '')}</textarea></div>`;

async function saveEvent(existing, payload) {
  if (existing) return api('PATCH', `/api/events/${existing.id}`, payload);
  return api('POST', `/api/children/${state.childId}/events`, payload);
}
const deleteEvent = (e) => () => api('DELETE', `/api/events/${e.id}`);

function sleepModal(e) {
  const ongoing = !e && state.recent.find((x) => x.type === 'sleep' && !x.endAt);
  if (ongoing) return sleepModal(ongoing);
  openModal(e ? 'Edit sleep' : 'Sleep', `
    ${!e ? '<button type="button" class="btn primary block" data-action="start-sleep" style="margin-bottom:16px">Start sleep timer now</button><p class="muted small" style="text-align:center;margin-top:-6px">or add a past sleep</p>' : ''}
    <div class="row2">
      <div class="field"><label for="m-start">Fell asleep</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt)}" required /></div>
      <div class="field"><label for="m-end">Woke up</label><input id="m-end" name="end" type="datetime-local" value="${e ? (e.endAt ? toLocalInput(e.endAt) : '') : toLocalInput()}" /></div>
    </div>
    ${e && !e.endAt ? '<p class="muted small">Leave "Woke up" empty while the baby is still asleep.</p>' : ''}
    ${noteField(e)}`,
  (fd) => saveEvent(e, { type: 'sleep', startAt: fromLocalInput(fd.get('start')), endAt: fromLocalInput(fd.get('end')), data: { note: fd.get('note') } }),
  { onDelete: e && deleteEvent(e) });
}

function feedModal(e) {
  const method = e?.data.method || store.get('bt_last_feed_method') || 'breast';
  const d = e?.data || {};
  const timer = !e && store.get(feedTimerKey());
  const bottleAmount = d.amountMl ? (imperial() ? +(d.amountMl / ML_PER_OZ).toFixed(1) : Math.round(d.amountMl)) : '';
  openModal(e ? 'Edit feed' : 'Feed', `
    <input type="hidden" name="method" value="${method}" />
    <div class="seg" role="group" aria-label="Feeding method" style="margin-bottom:16px">
      <button type="button" data-pick="method:breast" aria-pressed="${method === 'breast'}">Breast</button>
      <button type="button" data-pick="method:bottle" aria-pressed="${method === 'bottle'}">Bottle</button>
    </div>
    <div data-method="breast" ${method !== 'breast' ? 'hidden' : ''}>
      ${!e ? `<div class="sides">
        <button type="button" class="side" data-side="left"><span class="muted small">Left</span><span class="t">0:00</span><span class="s muted small">Tap to start</span></button>
        <button type="button" class="side" data-side="right"><span class="muted small">Right</span><span class="t">0:00</span><span class="s muted small">Tap to start</span></button>
      </div>` : ''}
      <div class="row2">
        <div class="field"><label for="m-left">Left (minutes)</label><input id="m-left" name="leftMin" type="number" inputmode="decimal" min="0" step="0.1" value="${d.leftSeconds ? +(d.leftSeconds / 60).toFixed(1) : ''}" /></div>
        <div class="field"><label for="m-right">Right (minutes)</label><input id="m-right" name="rightMin" type="number" inputmode="decimal" min="0" step="0.1" value="${d.rightSeconds ? +(d.rightSeconds / 60).toFixed(1) : ''}" /></div>
      </div>
    </div>
    <div data-method="bottle" ${method !== 'bottle' ? 'hidden' : ''}>
      <div class="field"><label for="m-amount">Amount (${imperial() ? 'oz' : 'ml'})</label><input id="m-amount" name="amount" type="number" inputmode="decimal" min="0" step="${imperial() ? 0.5 : 5}" value="${bottleAmount}" /></div>
      <input type="hidden" name="contents" value="${d.contents || 'formula'}" />
      <div class="seg" role="group" aria-label="Contents" style="margin-bottom:14px">
        ${[['breast_milk', 'Breast milk'], ['formula', 'Formula'], ['mixed', 'Mixed']].map(([v, l]) => `<button type="button" data-pick="contents:${v}" aria-pressed="${(d.contents || 'formula') === v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="field"><label for="m-start">Started</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt || (timer ? new Date(timer.startedAt).toISOString() : undefined))}" required /></div>
    ${noteField(e)}`,
  async (fd) => {
    const m = fd.get('method');
    const startAt = fromLocalInput(fd.get('start'));
    let payload;
    if (m === 'breast') {
      const left = Math.round(Number(fd.get('leftMin') || 0) * 60);
      const right = Math.round(Number(fd.get('rightMin') || 0) * 60);
      const t = store.get(feedTimerKey());
      const lastSide = e ? d.lastSide : t?.lastSide || (left && !right ? 'left' : right && !left ? 'right' : undefined);
      const endAt = new Date(new Date(startAt).getTime() + (left + right) * 1000).toISOString();
      payload = { type: 'feed', startAt, endAt, data: { method: 'breast', leftSeconds: left, rightSeconds: right, lastSide, note: fd.get('note') } };
    } else {
      const amount = Number(fd.get('amount'));
      if (!amount) throw new Error('Enter the amount');
      const amountMl = imperial() ? amount * ML_PER_OZ : amount;
      payload = { type: 'feed', startAt, endAt: null, data: { method: 'bottle', amountMl: Math.round(amountMl * 10) / 10, contents: fd.get('contents'), note: fd.get('note') } };
    }
    if (e) {
      // Switching methods: drop the other method's fields rather than merging them.
      payload.data = { leftSeconds: null, rightSeconds: null, lastSide: null, amountMl: null, contents: null, breastMilkMl: null, formulaMl: null, ...payload.data };
    }
    await saveEvent(e, payload);
    store.set('bt_last_feed_method', m);
    if (!e && m === 'breast') store.remove(feedTimerKey());
  },
  { onDelete: e && deleteEvent(e) });
}

function diaperModal(e) {
  const kind = e?.data.kind || '';
  openModal(e ? 'Edit diaper' : 'Diaper change', `
    <input type="hidden" name="kind" value="${kind}" />
    <div class="choice" role="group" aria-label="Diaper type">
      ${[['wet', 'Wet'], ['dirty', 'Dirty'], ['both', 'Both'], ['dry', 'Dry']].map(([v, l]) => `<button type="button" data-pick="kind:${v}" aria-pressed="${kind === v}">${l}</button>`).join('')}
    </div>
    <div class="field"><label for="m-start">Time</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt)}" required /></div>
    ${noteField(e)}`,
  (fd) => {
    if (!fd.get('kind')) throw new Error('Choose wet, dirty, both or dry');
    return saveEvent(e, { type: 'diaper', startAt: fromLocalInput(fd.get('start')), data: { kind: fd.get('kind'), note: fd.get('note') } });
  },
  { onDelete: e && deleteEvent(e) });
}

function growthModal(e) {
  const d = e?.data || {};
  let weightFields;
  if (imperial()) {
    const totalOz = d.weightKg ? d.weightKg * LB_PER_KG * 16 : null;
    const lb = totalOz != null ? Math.floor(totalOz / 16) : '';
    const oz = totalOz != null ? +(totalOz - lb * 16).toFixed(1) : '';
    weightFields = `<div class="row2"><div class="field"><label for="m-lb">Weight (lb)</label><input id="m-lb" name="lb" type="number" inputmode="numeric" min="0" step="1" value="${lb}" /></div>
      <div class="field"><label for="m-oz">(oz)</label><input id="m-oz" name="oz" type="number" inputmode="decimal" min="0" max="15.9" step="0.1" value="${oz}" /></div></div>`;
  } else {
    weightFields = `<div class="field"><label for="m-kg">Weight (kg)</label><input id="m-kg" name="kg" type="number" inputmode="decimal" min="0" step="0.01" value="${d.weightKg ?? ''}" /></div>`;
  }
  const lenUnit = imperial() ? 'in' : 'cm';
  const showLen = (cm) => (cm ? (imperial() ? +(cm / CM_PER_IN).toFixed(2) : cm) : '');
  openModal(e ? 'Edit measurement' : 'Growth measurement', `
    <div class="field"><label for="m-date">Date</label><input id="m-date" name="date" type="date" value="${toLocalDate(e?.startAt)}" max="${toLocalDate()}" required /></div>
    ${weightFields}
    <div class="row2">
      <div class="field"><label for="m-len">Length (${lenUnit})</label><input id="m-len" name="length" type="number" inputmode="decimal" min="0" step="0.1" value="${showLen(d.lengthCm)}" /></div>
      <div class="field"><label for="m-head">Head (${lenUnit})</label><input id="m-head" name="head" type="number" inputmode="decimal" min="0" step="0.1" value="${showLen(d.headCm)}" /></div>
    </div>
    <p class="muted small">Fill in whatever was measured — each one is optional.</p>
    ${noteField(e)}`,
  (fd) => {
    const n = (k) => (fd.get(k) === '' || fd.get(k) == null ? null : Number(fd.get(k)));
    let weightKg;
    if (imperial()) {
      const lb = n('lb'); const oz = n('oz');
      weightKg = lb == null && oz == null ? null : ((lb || 0) * 16 + (oz || 0)) / 16 / LB_PER_KG;
    } else weightKg = n('kg');
    const toCm = (v) => (v == null ? null : imperial() ? v * CM_PER_IN : v);
    const round = (v, p) => (v == null ? null : Math.round(v * 10 ** p) / 10 ** p);
    // Store at noon local time so the date never shifts across time zones.
    const startAt = new Date(`${fd.get('date')}T12:00`).toISOString();
    return saveEvent(e, { type: 'growth', startAt, data: { weightKg: round(weightKg, 3), lengthCm: round(toCm(n('length')), 1), headCm: round(toCm(n('head')), 1), note: fd.get('note') } });
  },
  { onDelete: e && deleteEvent(e) });
}

function volumeInput(name, label, ml) {
  const v = ml == null ? '' : imperial() ? +(ml / ML_PER_OZ).toFixed(2) : Math.round(ml * 10) / 10;
  return `<div class="field"><label for="m-${name}">${label} (${imperial() ? 'oz' : 'ml'})</label><input id="m-${name}" name="${name}" type="number" inputmode="decimal" min="0" step="any" value="${v}" /></div>`;
}
const volumeFrom = (fd, name) => {
  const v = fd.get(name);
  if (v === '' || v == null) return null;
  return Math.round((imperial() ? Number(v) * ML_PER_OZ : Number(v)) * 10) / 10;
};

function pumpModal(e) {
  const d = e?.data || {};
  const mins = e?.endAt ? Math.round((new Date(e.endAt) - new Date(e.startAt)) / 60000) : '';
  openModal(e ? 'Edit pumping' : 'Pumping', `
    <div class="row2">
      <div class="field"><label for="m-start">Started</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt)}" required /></div>
      <div class="field"><label for="m-mins">Minutes</label><input id="m-mins" name="mins" type="number" inputmode="numeric" min="0" step="1" value="${mins}" /></div>
    </div>
    <div class="row2">${volumeInput('left', 'Left', d.leftMl)}${volumeInput('right', 'Right', d.rightMl)}</div>
    ${d.totalMl != null ? volumeInput('total', 'Total', d.totalMl) : ''}
    ${noteField(e)}`,
  (fd) => {
    const startAt = fromLocalInput(fd.get('start'));
    const mins = Number(fd.get('mins') || 0);
    const endAt = mins ? new Date(new Date(startAt).getTime() + mins * 60000).toISOString() : null;
    return saveEvent(e, { type: 'pump', startAt, endAt, data: { leftMl: volumeFrom(fd, 'left'), rightMl: volumeFrom(fd, 'right'), totalMl: volumeFrom(fd, 'total'), note: fd.get('note') } });
  },
  { onDelete: e && deleteEvent(e) });
}

function medicalModal(e) {
  const d = e?.data || {};
  const unit = imperial() ? 'F' : 'C';
  let temp = '';
  if (d.temperature != null) {
    const f = d.tempUnit === 'C' ? d.temperature * 9 / 5 + 32 : d.temperature;
    temp = unit === 'F' ? +f.toFixed(1) : +((f - 32) * 5 / 9).toFixed(1);
  }
  openModal(e ? 'Edit medicine / temperature' : 'Medicine / temperature', `
    <div class="field"><label for="m-start">Time</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt)}" required /></div>
    <div class="field"><label for="m-med">Medicine and dose</label><input id="m-med" name="medication" maxlength="200" placeholder="e.g. Children's Tylenol, 3.75 ml" value="${esc(d.medication || '')}" /></div>
    <div class="field"><label for="m-temp">Temperature (°${unit})</label><input id="m-temp" name="temperature" type="number" inputmode="decimal" step="0.1" value="${temp}" /></div>
    ${noteField(e)}`,
  (fd) => saveEvent(e, { type: 'medical', startAt: fromLocalInput(fd.get('start')), data: {
    medication: fd.get('medication'), temperature: fd.get('temperature') === '' ? null : Number(fd.get('temperature')),
    tempUnit: fd.get('temperature') === '' ? null : unit, note: fd.get('note'),
  } }),
  { onDelete: e && deleteEvent(e) });
}

function solidModal(e) {
  const d = e?.data || {};
  openModal(e ? 'Edit solid food' : 'Solid food', `
    <input type="hidden" name="meal" value="${d.meal || ''}" />
    <div class="seg" role="group" aria-label="Meal" style="margin-bottom:14px">
      ${['breakfast', 'lunch', 'dinner', 'snack'].map((m) => `<button type="button" data-pick="meal:${m}" aria-pressed="${d.meal === m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
    </div>
    <div class="field"><label for="m-foods">Foods</label><input id="m-foods" name="foods" maxlength="500" placeholder="e.g. Avocado, oatmeal" value="${esc(d.foods || '')}" /></div>
    <div class="field"><label for="m-start">Time</label><input id="m-start" name="start" type="datetime-local" value="${toLocalInput(e?.startAt)}" required /></div>
    ${noteField(e)}`,
  (fd) => saveEvent(e, { type: 'solid', startAt: fromLocalInput(fd.get('start')), data: { foods: fd.get('foods'), meal: fd.get('meal') || null, note: fd.get('note') } }),
  { onDelete: e && deleteEvent(e) });
}

function milestoneModal(e) {
  const d = e?.data || {};
  const kind = d.kind || 'first';
  openModal(e ? 'Edit milestone' : 'Milestone', `
    <input type="hidden" name="kind" value="${kind}" />
    <div class="seg" role="group" aria-label="Kind" style="margin-bottom:14px">
      <button type="button" data-pick="kind:first" aria-pressed="${kind === 'first'}">Baby first</button>
      <button type="button" data-pick="kind:milestone" aria-pressed="${kind === 'milestone'}">Milestone</button>
    </div>
    <div class="field"><label for="m-title">What happened?</label><input id="m-title" name="title" maxlength="300" placeholder="e.g. First steps!" value="${esc(d.title || '')}" required /></div>
    <div class="field"><label for="m-date">Date</label><input id="m-date" name="date" type="date" value="${toLocalDate(e?.startAt)}" max="${toLocalDate()}" required /></div>
    ${noteField(e)}`,
  (fd) => {
    const keepTime = e && toLocalDate(e.startAt) === fd.get('date');
    const startAt = keepTime ? e.startAt : new Date(`${fd.get('date')}T12:00`).toISOString();
    return saveEvent(e, { type: 'milestone', startAt, data: { title: fd.get('title'), kind: fd.get('kind'), note: fd.get('note') } });
  },
  { onDelete: e && deleteEvent(e) });
}

function childModal(k) {
  openModal(k ? `Edit ${k.name}` : 'Add child', childFields(k || {}),
    async (fd) => {
      const body = { name: fd.get('name'), birthDate: fd.get('birthDate'), sex: fd.get('sex') };
      if (!body.sex) throw new Error('Choose girl or boy');
      const saved = k ? await api('PATCH', `/api/children/${k.id}`, body) : await api('POST', '/api/children', body);
      state.childId = saved.id;
      store.set('bt_child', saved.id);
    },
    {
      onDelete: k && (() => api('DELETE', `/api/children/${k.id}`)),
      confirmDelete: k && `Delete ${k.name} and ALL of their logs? This cannot be undone.`,
    });
}

function inviteModal(invite) {
  const link = `${location.origin}/?invite=${encodeURIComponent(invite.code)}`;
  modalForm.innerHTML = `
    <div class="modal-head"><h2>Invite your partner</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
    <p>Share this code or link. When they create an account with it, you'll both see and log the same children.</p>
    <div class="code">${esc(invite.code)}</div>
    <p class="muted small">Expires ${fmtDate(invite.expiresAt)} · works once.</p>
    <div class="modal-actions"><div class="right">
      <button type="button" class="btn" id="copy-link">Copy link</button>
      ${navigator.share ? '<button type="button" class="btn primary" id="share-link">Share</button>' : ''}
    </div></div>`;
  modal.showModal();
  $('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { prompt('Copy this link', link); }
  };
  const share = $('#share-link');
  if (share) share.onclick = () => navigator.share({ title: 'Join me on Baby Tracker', text: `Use invite code ${invite.code}`, url: link }).catch(() => {});
}

function naraModal() {
  const kids = state.me.children;
  modalForm.innerHTML = `
    <div class="modal-head"><h2>Import from Nara Baby</h2><button type="button" class="icon-btn" data-close aria-label="Close">${ICONS.close}</button></div>
    <div class="field"><label for="n-file">Nara export (.csv)</label><input id="n-file" type="file" accept=".csv,text/csv" /></div>
    <div class="field"><label for="n-child">Import into</label><select id="n-child">${kids.map((k) => `<option value="${k.id}" ${k.id === state.childId ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>
    <p class="muted small">Nara exports one child per file. Nothing is saved until you confirm.</p>
    <div id="n-preview"></div>
    <p class="error" id="modal-error"></p>
    <div class="modal-actions"><div class="right">
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="button" class="btn primary" id="n-go" disabled>Preview</button>
    </div></div>`;
  modal.showModal();
  const fileEl = $('#n-file');
  const childEl = $('#n-child');
  const go = $('#n-go');
  const out = $('#n-preview');
  const err = $('#modal-error');
  let csv = null;
  let previewed = false;
  const reset = () => { previewed = false; go.textContent = 'Preview'; out.innerHTML = ''; err.textContent = ''; go.disabled = !csv; };
  fileEl.onchange = async () => { csv = fileEl.files[0] ? await fileEl.files[0].text() : null; reset(); };
  childEl.onchange = reset;
  go.onclick = async () => {
    const childId = Number(childEl.value);
    go.disabled = true;
    err.textContent = '';
    try {
      const r = await api('POST', `/api/children/${childId}/import/nara`, { csv, commit: previewed });
      if (r.committed) {
        modal.close();
        toast(`Imported ${r.imported} entries`);
        state.childId = childId;
        store.set('bt_child', childId);
        await refresh();
        return;
      }
      const skipped = Object.entries(r.skipped).map(([t, n]) => `${esc(t)} (${n})`).join(', ');
      const warn = r.warnings.map((w) => `<p class="error">${esc(w)}</p>`).join('');
      const people = r.caregivers.map((c) => `<li><span>${esc(c.name)}</span><span class="muted">${c.matched ? `→ ${esc(c.matched)}` : '→ you (no matching family member)'}</span></li>`).join('');
      out.innerHTML = `${warn}<div class="card" style="margin-bottom:12px">
        <h3>${r.toImport ? `Ready to import ${r.toImport.toLocaleString()} entries` : 'Nothing new to import'}</h3>
        ${r.first ? `<p class="muted small">${fmtDate(r.first)} – ${fmtDate(r.last)}</p>` : ''}
        <ul class="list-plain small">
          <li><span>Sleep</span><strong>${r.counts.sleep}</strong></li>
          <li><span>Feeds</span><strong>${r.counts.feed}</strong></li>
          <li><span>Diapers</span><strong>${r.counts.diaper}</strong></li>
          <li><span>Growth</span><strong>${r.counts.growth}</strong></li>
          <li><span>Pumping</span><strong>${r.counts.pump}</strong></li>
          <li><span>Medicine / temperature</span><strong>${r.counts.medical}</strong></li>
          <li><span>Solid foods</span><strong>${r.counts.solid}</strong></li>
          <li><span>Milestones &amp; firsts</span><strong>${r.counts.milestone}</strong></li>
          ${r.duplicates ? `<li><span>Already imported (skipped)</span><strong>${r.duplicates}</strong></li>` : ''}
        </ul>
        ${people ? `<p class="muted small" style="margin:12px 0 0">Logged by</p><ul class="list-plain small">${people}</ul>` : ''}
        ${skipped ? `<p class="muted small">Not supported yet, left out: ${skipped}</p>` : ''}
        ${r.problemCount ? `<details><summary class="small">${r.problemCount} row(s) couldn't be read and will be left out</summary>
          <ul class="small">${r.problems.map((p) => `<li>${p.line ? `Line ${p.line} ` : ''}${esc(p.type)}: ${esc(p.reason)}</li>`).join('')}</ul></details>` : ''}
      </div>`;
      previewed = true;
      go.textContent = `Import ${r.toImport.toLocaleString()}`;
      go.disabled = !r.toImport;
    } catch (e) {
      err.textContent = e.message;
      go.disabled = false;
    }
  };
}

function findEvent(id) {
  return [...state.recent, ...state.logEvents, ...state.growth].find((e) => e.id === id);
}
function editEvent(e) {
  ({ sleep: sleepModal, feed: feedModal, diaper: diaperModal, growth: growthModal, pump: pumpModal, medical: medicalModal, solid: solidModal, milestone: milestoneModal })[e.type](e);
}

// ---------- event wiring ----------
app.addEventListener('click', async (ev) => {
  const t = ev.target.closest('button, tr[data-edit]');
  if (!t) return;
  try {
    if (t.dataset.tab) {
      state.tab = t.dataset.tab;
      store.set('bt_tab', state.tab);
      await loadTabData();
      render();
      window.scrollTo(0, 0);
    } else if (t.dataset.quick) {
      ({ sleep: sleepModal, feed: feedModal, diaper: diaperModal, growth: growthModal, pump: pumpModal, medical: medicalModal, solid: solidModal, milestone: milestoneModal })[t.dataset.quick]();
    } else if (t.dataset.edit) {
      const e = findEvent(Number(t.dataset.edit));
      if (e) editEvent(e);
    } else if (t.dataset.day) {
      state.logDay = addDays(state.logDay, Number(t.dataset.day));
      await loadTabData();
      render();
    } else if (t.dataset.metric) {
      state.growthMetric = t.dataset.metric;
      store.set('bt_metric', state.growthMetric);
      render();
    } else if (t.dataset.units) {
      state.me = await api('PATCH', '/api/me', { units: t.dataset.units });
      render();
    } else if (t.dataset.removeMember) {
      if (confirm(`Remove ${t.dataset.name}? They'll be signed out and lose access to all children and logs.`)) {
        state.me = await api('DELETE', `/api/members/${t.dataset.removeMember}`);
        toast(`${t.dataset.name} removed`);
        render();
      }
    } else if (t.dataset.editChild) {
      childModal(state.me.children.find((k) => k.id === Number(t.dataset.editChild)));
    } else if (t.dataset.sex) {
      t.form.elements.sex.value = t.dataset.sex;
      t.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === t));
    } else if (t.dataset.action === 'wake') {
      await api('PATCH', `/api/events/${t.dataset.id}`, { endAt: new Date().toISOString() });
      toast('Sleep saved');
      await refresh();
    } else if (t.dataset.action === 'import-nara') {
      naraModal();
    } else if (t.dataset.action === 'add-child') {
      childModal();
    } else if (t.dataset.action === 'invite') {
      inviteModal(await api('POST', '/api/invites'));
    } else if (t.dataset.action === 'logout') {
      await api('POST', '/api/logout');
      state.me = null;
      render();
    } else if (t.dataset.action === 'toggle-auth') {
      state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
      render();
    }
  } catch (err) {
    toast(err.message);
  }
});

// "Start sleep timer now" lives inside the sleep modal.
modalForm.addEventListener('click', async (ev) => {
  if (!ev.target.closest('[data-action="start-sleep"]')) return;
  try {
    await api('POST', `/api/children/${state.childId}/events`, { type: 'sleep', startAt: new Date().toISOString() });
    modal.close();
    toast('Sleep timer started');
    await refresh();
  } catch (err) { $('#modal-error').textContent = err.message; }
});

app.addEventListener('change', async (ev) => {
  if (ev.target.id === 'log-date' && ev.target.value) {
    const [y, m, d] = ev.target.value.split('-').map(Number);
    state.logDay = new Date(y, m - 1, d);
    await loadTabData();
    render();
  } else if (ev.target.id === 'child-select') {
    state.childId = Number(ev.target.value);
    store.set('bt_child', state.childId);
    await refresh();
  }
});

app.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const fd = Object.fromEntries(new FormData(form));
  try {
    if (form.id === 'auth-form') {
      state.me = await api('POST', state.authMode === 'signup' ? '/api/signup' : '/api/login', fd);
      if (fd.inviteCode) clearInvite();
      await refresh();
    } else if (form.id === 'first-child') {
      if (!fd.sex) throw new Error('Choose girl or boy');
      const saved = await api('POST', '/api/children', fd);
      state.childId = saved.id;
      store.set('bt_child', saved.id);
      state.tab = 'today';
      await refresh();
    } else if (form.id === 'join-form') {
      state.me = await api('POST', '/api/invites/accept', { code: fd.code });
      clearInvite();
      toast('You joined the family');
      await refresh();
    }
  } catch (err) {
    const el = form.querySelector('.error');
    if (el) el.textContent = err.message; else toast(err.message);
  }
});

function clearInvite() {
  state.invite = null;
  history.replaceState(null, '', location.pathname);
}

// Keep partners in sync: poll while visible, refresh when returning to the app.
setInterval(() => {
  if (document.visibilityState === 'visible' && state.me && !modal.open) refresh();
}, 20000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.me && !modal.open) refresh();
});

// ---------- boot ----------
state.invite = new URLSearchParams(location.search).get('invite');
if (state.invite) { state.authMode = 'signup'; state.tab = 'family'; }
refresh();
