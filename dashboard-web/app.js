// Home Dashboard — thin client for OpenClaw.
//
// This page holds no business logic: it fetches state from OpenClaw's REST
// API, renders it, and posts back simple mutations (checkbox toggles, added
// items). Every fetch carries the shared LAN token as an Authorization
// header. If OpenClaw is unreachable, the page falls back to the mock data
// below so the layout is still visible/demoable — the kiosk wrapper app
// handles the actual reconnect-and-reload cycle when the Mac Mini drops off
// the network.

const params = new URLSearchParams(location.search);
const TOKEN = params.get('token') || '';
const API_BASE = params.get('api') || ''; // same-origin by default

const REFRESH_MS = {
  goals: 60_000,
  tasks: 60_000,
  health: 5 * 60_000,
  financials: 60_000,
  grocery: 60_000,
  calendar: 5 * 60_000,
};

const MOCK = {
  goals: [
    { id: 'clean', label: 'Clean', done: true },
    { id: 'spanish', label: 'Spanish', done: false },
    { id: 'guitar', label: 'Guitar', done: false },
    { id: 'golf', label: 'Golf', done: true },
    { id: 'run', label: 'Run', done: false },
    { id: 'goal6', label: '(6th goal)', done: false },
  ],
  tasks: {
    accenture: [
      { id: 'a1', text: 'Finish sprint status doc', done: false },
      { id: 'a2', text: 'Review PR #482', done: true },
      { id: 'a3', text: 'Stakeholder sync notes', done: false },
    ],
    personal: [
      { id: 'p1', text: 'Renew car registration', done: false },
      { id: 'p2', text: 'Book dentist appointment', done: false },
    ],
    'market-lou': [
      { id: 'm1', text: 'Send invoice to client', done: false },
      { id: 'm2', text: 'Update portfolio site', done: true },
    ],
  },
  health: {
    calories: { current: 3200, target: 4000, unit: '' },
    protein: { current: 110, target: 180, unit: 'g' },
    water: { current: 1800, target: 3000, unit: 'ml' },
    workout: { current: 30, target: 45, unit: 'min' },
  },
  financials: { spent_today: 47.32, currency: 'USD' },
  grocery: [
    { id: 'g1', text: 'Chicken breast', done: false },
    { id: 'g2', text: 'Spinach', done: false },
    { id: 'g3', text: 'Greek yogurt', done: true },
  ],
  calendar: {
    events: [
      { id: 'e1', title: 'Standup', start: '09:00', end: '09:15' },
      { id: 'e2', title: 'Design review', start: '11:00', end: '12:00' },
      { id: 'e3', title: 'Gym', start: '17:30', end: '18:30' },
    ],
  },
};

let usingMock = false;

function setOffline(offline) {
  usingMock = offline;
  document.getElementById('offlineBadge').classList.toggle('visible', offline);
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function load(path, mockValue) {
  try {
    const data = await api(path);
    setOffline(false);
    return data;
  } catch (err) {
    setOffline(true);
    return mockValue;
  }
}

// ---------- Goals ----------

function renderGoals(goals) {
  const list = document.getElementById('goalsList');
  list.innerHTML = '';
  goals.forEach((goal) => {
    const chip = document.createElement('div');
    chip.className = `goal-chip${goal.done ? ' done' : ''}`;
    chip.innerHTML = `<span class="dot"></span><span class="label">${escapeHtml(goal.label)}</span>`;
    chip.addEventListener('click', async () => {
      const nextDone = !goal.done;
      chip.classList.toggle('done', nextDone);
      try {
        await api(`/api/goals/${goal.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: nextDone }),
        });
      } catch (err) {
        /* offline: optimistic UI stands, will reconcile on next successful poll */
      }
    });
    list.appendChild(chip);
  });
}

// ---------- Task columns ----------

function renderTasks(board, items) {
  const list = document.getElementById(`tasks-${board}`);
  list.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = `task-item${item.done ? ' done' : ''}`;
    li.innerHTML = `<span class="box"></span><span class="text">${escapeHtml(item.text)}</span>`;
    li.addEventListener('click', async () => {
      const nextDone = !item.done;
      li.classList.toggle('done', nextDone);
      try {
        await api(`/api/tasks/${board}/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: nextDone }),
        });
      } catch (err) { /* optimistic */ }
    });
    list.appendChild(li);
  });
}

function wireAddRow(formEl, onAdd) {
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = formEl.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await onAdd(text);
  });
}

// ---------- Health meters ----------

const METER_COLORS = {
  calories: 'var(--slot-blue)',
  protein: 'var(--slot-green)',
  water: 'var(--slot-magenta)',
  workout: 'var(--slot-yellow)',
};

function renderHealth(health) {
  const container = document.getElementById('healthMeters');
  container.innerHTML = '';
  Object.entries(health).forEach(([key, m]) => {
    const pct = Math.max(0, Math.min(100, (m.current / m.target) * 100));
    const color = METER_COLORS[key] || 'var(--slot-blue)';
    const row = document.createElement('div');
    row.className = 'meter-row';
    row.innerHTML = `
      <div class="meter-labels">
        <span class="meter-name">${capitalize(key)}</span>
        <span class="meter-value">${formatNum(m.current)}${m.unit} / ${formatNum(m.target)}${m.unit}</span>
      </div>
      <div class="meter-track" style="--meter-track-color: color-mix(in srgb, ${color} 18%, var(--surface))">
        <div class="meter-fill" style="width:${pct}%; --meter-fill-color: ${color}"></div>
      </div>`;
    container.appendChild(row);
  });
}

// ---------- Financials ----------

function renderFinancials(fin) {
  const el = document.getElementById('spentToday');
  const symbol = fin.currency === 'USD' ? '$' : '';
  el.textContent = `${symbol}${fin.spent_today.toFixed(2)}`;
}

// ---------- Grocery ----------

function renderGrocery(items) {
  const list = document.getElementById('groceryList');
  list.innerHTML = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = `task-item${item.done ? ' done' : ''}`;
    li.innerHTML = `<span class="box"></span><span class="text">${escapeHtml(item.text)}</span>`;
    li.addEventListener('click', async () => {
      const nextDone = !item.done;
      li.classList.toggle('done', nextDone);
      try {
        await api(`/api/grocery/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ done: nextDone }),
        });
      } catch (err) { /* optimistic */ }
    });
    list.appendChild(li);
  });
}

// ---------- Calendar ----------

const CAL_START_HOUR = 7;
const CAL_END_HOUR = 22;
const HOUR_HEIGHT = 48;

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function renderCalendar(events) {
  const track = document.getElementById('calendarTrack');
  track.innerHTML = '';

  for (let hour = CAL_START_HOUR; hour <= CAL_END_HOUR; hour++) {
    const row = document.createElement('div');
    row.className = 'hour-row';
    const label = document.createElement('div');
    label.className = 'hour-label';
    label.textContent = formatHour(hour);
    row.appendChild(label);
    track.appendChild(row);
  }
  track.style.height = `${(CAL_END_HOUR - CAL_START_HOUR) * HOUR_HEIGHT}px`;

  const startMin = CAL_START_HOUR * 60;
  events.forEach((ev) => {
    const top = ((timeToMinutes(ev.start) - startMin) / 60) * HOUR_HEIGHT;
    const height = Math.max(20, ((timeToMinutes(ev.end) - timeToMinutes(ev.start)) / 60) * HOUR_HEIGHT);
    const block = document.createElement('div');
    block.className = 'calendar-event';
    block.style.top = `${top}px`;
    block.style.height = `${height}px`;
    block.innerHTML = `<span class="time">${ev.start}–${ev.end}</span>${escapeHtml(ev.title)}`;
    track.appendChild(block);
  });

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin >= startMin && nowMin <= CAL_END_HOUR * 60) {
    const nowLine = document.createElement('div');
    nowLine.className = 'now-line';
    nowLine.style.top = `${((nowMin - startMin) / 60) * HOUR_HEIGHT}px`;
    track.appendChild(nowLine);

    requestAnimationFrame(() => {
      const scroller = document.getElementById('calendarScroll');
      scroller.scrollTop = Math.max(0, nowLine.offsetTop - scroller.clientHeight / 2);
    });
  }
}

// ---------- Helpers ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function formatNum(n) { return n.toLocaleString(); }
function formatHour(h) {
  const period = h < 12 || h === 24 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

// ---------- Boot + refresh loops ----------

async function refreshGoals() {
  renderGoals(await load('/api/goals', MOCK.goals).then((d) => d.goals || d));
}
async function refreshTasks() {
  for (const board of ['accenture', 'personal', 'market-lou']) {
    const data = await load(`/api/tasks/${board}`, { items: MOCK.tasks[board] });
    renderTasks(board, data.items || data);
  }
}
async function refreshHealth() {
  renderHealth(await load('/api/health', MOCK.health));
}
async function refreshFinancials() {
  renderFinancials(await load('/api/financials', MOCK.financials));
}
async function refreshGrocery() {
  const data = await load('/api/grocery', { items: MOCK.grocery });
  renderGrocery(data.items || data);
}
async function refreshCalendar() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await load(`/api/calendar?date=${today}`, MOCK.calendar);
  renderCalendar(data.events || []);
}

function loop(fn, intervalMs) {
  fn();
  setInterval(fn, intervalMs);
}

function init() {
  wireAddRow(document.getElementById('groceryAddRow'), async (text) => {
    try {
      await api('/api/grocery', { method: 'POST', body: JSON.stringify({ text }) });
    } finally {
      refreshGrocery();
    }
  });
  document.querySelectorAll('.add-row[data-board]').forEach((form) => {
    const board = form.dataset.board;
    wireAddRow(form, async (text) => {
      try {
        await api(`/api/tasks/${board}`, { method: 'POST', body: JSON.stringify({ text }) });
      } finally {
        refreshTasks();
      }
    });
  });

  loop(refreshGoals, REFRESH_MS.goals);
  loop(refreshTasks, REFRESH_MS.tasks);
  loop(refreshHealth, REFRESH_MS.health);
  loop(refreshFinancials, REFRESH_MS.financials);
  loop(refreshGrocery, REFRESH_MS.grocery);
  loop(refreshCalendar, REFRESH_MS.calendar);
}

init();
