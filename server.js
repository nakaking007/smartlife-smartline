// server.js
require('dotenv').config();

const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const config = require('./config');
const { configureMongoDns } = require('./utils/mongoDns');
const line = require('./utils/line');
const tasks = require('./utils/tasks');
const appointments = require('./utils/appointments');
const alerts = require('./utils/alerts');
const speech = require('./utils/speech');
const manual = require('./utils/manual');
const ai = require('./utils/ai');
const weather = require('./utils/weather');
const weatherQuestions = require('./utils/weatherQuestions');
const liveDisasters = require('./utils/liveDisasters');
const freeServices = require('./utils/freeServices');
const knowledge = require('./utils/knowledge');
const scamCheck = require('./utils/scamCheck');
const todos = require('./utils/todos');
const earthquakeWarnings = require('./utils/earthquakeWarnings');
const User = require('./models/User');
const { THAILAND_TIME_ZONE, formatBangkokDateTime, getBangkokDateKey, getBangkokDayRange } = require('./utils/time');
const { formatHours } = require('./utils/riskAssessment');
const userRoutes = require('./routes/userRoutes');
const appointmentRoutes = require('./routes/appointments');
const todoRoutes = require('./routes/todos');
const earthquakeWarningRoutes = require('./routes/earthquakeWarnings');
require('./cron');

const app = express();
const port = Number(process.env.PORT) || 3000;
const pendingAppointmentEdits = new Map();
const pendingAppointmentLists = new Map();
const pendingModes = new Map();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/generated', express.static(path.join(__dirname, 'public', 'generated')));
app.use('/users', userRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/todos', todoRoutes);
app.use('/earthquake-warnings', earthquakeWarningRoutes);

configureMongoDns();
mongoose.connect(config.mongoUri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000
})
  .then(() => console.log("SmartLife MongoDB connected..."))
  .catch(err => console.error("SmartLife MongoDB connection error:", err));

app.get('/', (req, res) => {
  res.type('html').send([
    '<!doctype html>',
    '<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SmartLife</title></head><body style="font-family:Segoe UI,Tahoma,sans-serif;padding:24px">',
    '<h1>SmartLife server is running</h1>',
    '<p><a href="/appointments-panel">เปิดแผงนัดหมาย</a></p>',
    '<p><a href="/health">ตรวจสถานะระบบ</a></p>',
    '</body></html>'
  ].join(''));
});

app.get('/health', (req, res) => {
  const mongoStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  const mongoReadyState = mongoose.connection.readyState;

  res.json({
    status: mongoReadyState === 1 ? 'ok' : 'degraded',
    timezone: THAILAND_TIME_ZONE,
    thailandTime: formatBangkokDateTime(new Date()),
    mongo: mongoStates[mongoReadyState] || 'unknown',
    ai: ai.getStatus()
  });
});

app.get('/ai/status', (req, res) => {
  res.json(ai.getStatus());
});

app.get('/appointments-panel', (req, res) => {
  res.type('html').send(renderAppointmentsPanelPage());
});

app.get('/forms', (req, res) => {
  res.type('html').send(renderFormsIndexPage());
});

app.get('/register-panel', (req, res) => {
  res.type('html').send(renderRegisterPanelPage());
});

app.get('/register-form', (req, res) => {
  res.type('html').send(renderRegisterPanelPage());
});

app.get('/appointment-form', (req, res) => {
  res.type('html').send(renderAppointmentFormPage());
});

app.get('/liff', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/liff/calendar', (req, res) => {
  res.type('html').send(renderLiffCalendarPage());
});

function formatBangkokDate(date) {
  return formatBangkokDateTime(date);
}

function getPublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const baseUrl = config.publicBaseUrl || `http://localhost:${port}`;
  return `${String(baseUrl).replace(/\/+$/, '')}${normalizedPath}`;
}

function hasPublicUrl() {
  return Boolean(config.publicBaseUrl);
}

function normalizeCommand(text) {
  return String(text || '').trim().replace(/^\/+/, '').trim();
}

function getPendingMode(userId) {
  if (!userId) {
    return null;
  }

  const mode = pendingModes.get(userId);
  if (!mode) {
    return null;
  }

  return typeof mode === 'string' ? { type: mode } : mode;
}

function renderAppointmentsPanelPage() {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartLife นัดหมาย</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --line: #d9dee8;
      --text: #17202a;
      --muted: #5f6b7a;
      --green: #12805c;
      --red: #b42318;
      --blue: #1f5fbf;
      --soft-blue: #eaf2ff;
      font-family: "Segoe UI", Tahoma, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 15px;
    }

    header {
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      padding: 16px 20px;
      position: sticky;
      top: 0;
      z-index: 2;
    }

    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 18px;
    }

    h1 {
      font-size: 22px;
      margin: 0 0 4px;
    }

    .sub {
      color: var(--muted);
      margin: 0;
    }

    .toolbar {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
      margin: 14px 0;
      flex-wrap: wrap;
    }

    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    button {
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--text);
      border-radius: 6px;
      padding: 8px 10px;
      cursor: pointer;
      font: inherit;
      min-height: 38px;
    }

    button.primary {
      background: var(--green);
      border-color: var(--green);
      color: #fff;
    }

    button.danger {
      color: var(--red);
      border-color: #f0b8b2;
    }

    input, select {
      width: 100%;
      min-height: 38px;
      padding: 8px 9px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      background: #fff;
    }

    .search {
      min-width: 250px;
      max-width: 360px;
    }

    .status {
      color: var(--muted);
      min-height: 22px;
    }

    .tableWrap {
      overflow-x: auto;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 980px;
    }

    th, td {
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }

    th {
      background: #f1f4f8;
      color: #344054;
      font-weight: 600;
      white-space: nowrap;
    }

    tr.editing {
      background: var(--soft-blue);
    }

    .id {
      font-size: 12px;
      color: var(--muted);
      word-break: break-all;
      max-width: 150px;
    }

    .displayTime {
      color: var(--blue);
      font-weight: 600;
      white-space: nowrap;
    }

    .actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      min-width: 185px;
    }

    .hidden { display: none; }

    @media (max-width: 720px) {
      header { position: static; }
      main { padding: 12px; }
      .search { min-width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <h1>แผงนัดหมาย SmartLife</h1>
    <p class="sub">ทุกเวลาถูกอ่านและบันทึกเป็นเวลาไทย Asia/Bangkok แบบ 24 ชั่วโมง</p>
  </header>
  <main>
    <div class="toolbar">
      <div class="filters">
        <button id="refreshBtn" type="button">รีเฟรช</button>
        <label>
          สถานะ
          <select id="statusFilter">
            <option value="active">ยังใช้งาน</option>
            <option value="all">ทั้งหมดรวม deleted</option>
            <option value="deleted">deleted</option>
          </select>
        </label>
        <input id="searchInput" class="search" placeholder="ค้นหาชื่อ สถานที่ ID">
      </div>
      <div id="statusText" class="status"></div>
    </div>
    <div class="tableWrap">
      <table>
        <thead>
          <tr>
            <th>นัดหมาย</th>
            <th>เวลาไทย</th>
            <th>สถานที่</th>
            <th>ชุด/เตรียมตัว</th>
            <th>สถานะ</th>
            <th>ID</th>
            <th>จัดการ</th>
          </tr>
        </thead>
        <tbody id="appointmentsBody"></tbody>
      </table>
    </div>
  </main>
  <script>
    const state = { items: [], editingId: null };
    const body = document.getElementById('appointmentsBody');
    const statusText = document.getElementById('statusText');
    const statusFilter = document.getElementById('statusFilter');
    const searchInput = document.getElementById('searchInput');

    function setStatus(text) {
      statusText.textContent = text || '';
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    }

    function bangkokParts(dateValue) {
      if (!dateValue) return null;
      const date = new Date(dateValue);
      if (Number.isNaN(date.getTime())) return null;
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = part.value;
        return acc;
      }, {});
      return parts;
    }

    function toDatetimeLocalValue(dateValue) {
      const parts = bangkokParts(dateValue);
      if (!parts) return '';
      return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
    }

    function formatBangkok(dateValue) {
      const parts = bangkokParts(dateValue);
      if (!parts) return '-';
      return parts.day + '/' + parts.month + '/' + parts.year + ' ' + parts.hour + '.' + parts.minute + ' น.';
    }

    function shouldShow(item) {
      const mode = statusFilter.value;
      if (mode === 'active' && item.status === 'deleted') return false;
      if (mode === 'deleted' && item.status !== 'deleted') return false;
      const query = searchInput.value.trim().toLowerCase();
      if (!query) return true;
      return [item.title, item.locationName, item.dressCode, item.preparation, item.status, item._id]
        .some(value => String(value || '').toLowerCase().includes(query));
    }

    function render() {
      const rows = state.items.filter(shouldShow);
      if (rows.length === 0) {
        body.innerHTML = '<tr><td colspan="7">ไม่พบนัดหมาย</td></tr>';
        return;
      }

      body.innerHTML = rows.map(item => {
        const editing = state.editingId === item._id;
        const disabled = item.status === 'deleted' ? 'disabled' : '';
        const editClass = editing ? 'editing' : '';
        return '<tr class="' + editClass + '" data-id="' + escapeHtml(item._id) + '">' +
          '<td>' + (editing
            ? '<input data-field="title" value="' + escapeHtml(item.title || '') + '">'
            : '<strong>' + escapeHtml(item.title || '-') + '</strong>') + '</td>' +
          '<td>' + (editing
            ? '<input data-field="startAt" type="datetime-local" value="' + escapeHtml(toDatetimeLocalValue(item.startAt)) + '"><div class="id">บันทึกเป็นเวลาไทย</div>'
            : '<span class="displayTime">' + escapeHtml(formatBangkok(item.startAt)) + '</span>') + '</td>' +
          '<td>' + (editing
            ? '<input data-field="locationName" value="' + escapeHtml(item.locationName || '') + '">'
            : escapeHtml(item.locationName || '-')) + '</td>' +
          '<td>' + (editing
            ? '<input data-field="dressCode" value="' + escapeHtml(item.dressCode || '') + '">'
            : escapeHtml(item.dressCode || item.preparation || '-')) + '</td>' +
          '<td>' + escapeHtml(item.status || '-') + '</td>' +
          '<td><div class="id">' + escapeHtml(item._id) + '</div></td>' +
          '<td><div class="actions">' + (editing
            ? '<button class="primary" data-action="save" ' + disabled + '>บันทึก</button><button data-action="cancel">ยกเลิก</button>'
            : '<button data-action="edit" ' + disabled + '>แก้ไข</button><button class="danger" data-action="delete" ' + disabled + '>ลบ</button>') +
          '</div></td>' +
        '</tr>';
      }).join('');
    }

    async function loadAppointments() {
      setStatus('กำลังโหลด...');
      const mode = statusFilter.value;
      const url = mode === 'deleted'
        ? '/appointments?status=deleted&limit=500'
        : mode === 'all'
          ? '/appointments?limit=500'
          : '/appointments?activeOnly=true&limit=500';
      const res = await fetch(url);
      if (!res.ok) throw new Error('โหลดนัดหมายไม่ได้');
      state.items = await res.json();
      state.editingId = null;
      setStatus('พบ ' + state.items.length + ' รายการ');
      render();
    }

    function getRowPayload(row) {
      const data = {};
      row.querySelectorAll('[data-field]').forEach(input => {
        data[input.dataset.field] = input.value;
      });
      return data;
    }

    async function saveRow(row) {
      const id = row.dataset.id;
      const payload = getRowPayload(row);
      setStatus('กำลังบันทึก...');
      const res = await fetch('/appointments/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'บันทึกไม่ได้');
      const index = state.items.findIndex(item => item._id === id);
      if (index >= 0) state.items[index] = result;
      state.editingId = null;
      setStatus('บันทึกแล้ว: ' + formatBangkok(result.startAt));
      render();
    }

    async function deleteRow(row) {
      const id = row.dataset.id;
      if (!confirm('ลบนัดหมายนี้หรือไม่? ระบบจะลบแบบ soft delete')) return;
      setStatus('กำลังลบ...');
      const res = await fetch('/appointments/' + encodeURIComponent(id), { method: 'DELETE' });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'ลบไม่ได้');
      const index = state.items.findIndex(item => item._id === id);
      if (index >= 0) state.items[index] = result;
      setStatus('ลบแล้ว');
      render();
    }

    body.addEventListener('click', async event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const row = event.target.closest('tr[data-id]');
      const action = button.dataset.action;
      try {
        if (action === 'edit') {
          state.editingId = row.dataset.id;
          render();
        } else if (action === 'cancel') {
          state.editingId = null;
          render();
        } else if (action === 'save') {
          await saveRow(row);
        } else if (action === 'delete') {
          await deleteRow(row);
        }
      } catch (err) {
        setStatus(err.message);
      }
    });

    document.getElementById('refreshBtn').addEventListener('click', () => loadAppointments().catch(err => setStatus(err.message)));
    statusFilter.addEventListener('change', () => loadAppointments().catch(err => setStatus(err.message)));
    searchInput.addEventListener('input', render);

    loadAppointments().catch(err => setStatus(err.message));
  </script>
</body>
</html>`;
}

function renderFormsIndexPage() {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartLife แบบฟอร์ม</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f8fb; color: #17202a; }
    main { max-width: 760px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { color: #5f6b7a; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 18px; }
    a { display: grid; gap: 8px; min-height: 120px; padding: 16px; border: 1px solid #d9dee8; border-radius: 8px; background: #fff; color: inherit; text-decoration: none; }
    strong { font-size: 18px; }
    span { color: #5f6b7a; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>แยกแบบฟอร์ม SmartLife</h1>
    <p>เลือกแบบฟอร์มตามงานที่ต้องการ ไม่ใช้ฟอร์มเดียวปนกัน</p>
    <div class="grid">
      <a href="/register-form">
        <strong>แบบฟอร์มสมัครสมาชิก</strong>
        <span>กรอกข้อมูลผู้ใช้ แพ็กเกจ และหมายเหตุการจ่าย</span>
      </a>
      <a href="/appointment-form">
        <strong>แบบฟอร์มนัดหมาย</strong>
        <span>บันทึกนัดหมาย เวลา สถานที่ ชุด และสิ่งที่ต้องเตรียม</span>
      </a>
      <a href="/appointments-panel">
        <strong>แผงแก้ไขนัดหมาย</strong>
        <span>ดูรายการทั้งหมด แก้ไข บันทึก หรือลบทีละรายการ</span>
      </a>
    </div>
  </main>
</body>
</html>`;
}

function renderLiffCalendarPage() {
  const liffId = config.liffId || '';

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SmartLife LIFF Calendar</title>
  <script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #090111;
      --panel: rgba(18, 7, 32, 0.9);
      --panel-strong: rgba(30, 9, 49, 0.96);
      --line: rgba(255, 77, 216, 0.38);
      --text: #fff7ff;
      --muted: #c9b6d6;
      --green: #ff4fd8;
      --blue: #6ee7ff;
      --red: #ff6b9a;
      --neon: #ff4fd8;
      --neon-soft: rgba(255, 79, 216, 0.22);
      font-family: "Segoe UI", Tahoma, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background:
        radial-gradient(circle at 50% 18%, rgba(255, 79, 216, 0.24), transparent 28%),
        radial-gradient(circle at 50% 85%, rgba(110, 231, 255, 0.15), transparent 30%),
        linear-gradient(180deg, #11041f 0%, var(--bg) 58%, #05000a 100%);
      color: var(--text);
      font-size: 15px;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(115deg, transparent 0 18%, rgba(255, 79, 216, 0.08) 18.2% 18.6%, transparent 18.8% 100%),
        linear-gradient(245deg, transparent 0 24%, rgba(110, 231, 255, 0.06) 24.2% 24.6%, transparent 24.8% 100%),
        linear-gradient(90deg, rgba(255, 79, 216, 0.05) 1px, transparent 1px),
        linear-gradient(0deg, rgba(110, 231, 255, 0.04) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 38px 38px, 38px 38px;
      opacity: 0.75;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 2;
      background: rgba(9, 1, 17, 0.92);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 0 28px var(--neon-soft);
      padding: 14px 16px;
      backdrop-filter: blur(10px);
    }
    main { position: relative; max-width: 860px; margin: 0 auto; padding: 14px; display: grid; gap: 12px; }
    h1 { margin: 0; font-size: 21px; text-shadow: 0 0 16px rgba(255, 79, 216, 0.58); }
    .sub { margin: 4px 0 0; color: var(--muted); }
    .toolbar, form, .item {
      background: linear-gradient(180deg, var(--panel-strong), var(--panel));
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 0 0 1px rgba(255, 79, 216, 0.08), 0 14px 36px rgba(0, 0, 0, 0.28), inset 0 0 22px rgba(255, 79, 216, 0.06);
      padding: 12px;
    }
    .toolbar { display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .seg { display: flex; gap: 6px; flex-wrap: wrap; }
    .sectionTitle { margin: 4px 0; font-size: 16px; }
    .hidden { display: none; }
    button {
      min-height: 38px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.04);
      color: var(--text);
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
      box-shadow: inset 0 0 14px rgba(255, 79, 216, 0.05);
    }
    button.active { border-color: var(--neon); color: #fff; font-weight: 700; box-shadow: 0 0 16px var(--neon-soft), inset 0 0 18px rgba(255, 79, 216, 0.12); }
    button.primary { background: linear-gradient(180deg, #ff66df, #9f2bff); border-color: #ff93e9; color: #fff; font-weight: 700; box-shadow: 0 0 20px rgba(255, 79, 216, 0.42); }
    button.danger { color: var(--red); border-color: rgba(255, 107, 154, 0.54); }
    button.done { color: #8df7ff; border-color: rgba(141, 247, 255, 0.52); }
    input, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 6px;
      color: var(--text);
      padding: 9px;
      font: inherit;
      background: rgba(6, 0, 12, 0.72);
      outline-color: var(--neon);
    }
    select { width: 100%; min-height: 40px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); padding: 9px; font: inherit; background: rgba(6, 0, 12, 0.72); }
    form { display: grid; gap: 10px; }
    label { display: grid; gap: 5px; font-weight: 650; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .status { min-height: 22px; color: var(--muted); }
    .list { display: grid; gap: 8px; }
    .item { display: grid; gap: 6px; }
    .itemHead { display: flex; justify-content: space-between; gap: 8px; align-items: start; }
    .title { font-weight: 750; }
    .time { color: var(--blue); font-weight: 700; white-space: nowrap; text-shadow: 0 0 12px rgba(110, 231, 255, 0.36); }
    .meta { color: var(--muted); line-height: 1.45; }
    .doneText { text-decoration: line-through; color: var(--muted); }
    .empty { color: var(--muted); padding: 18px; text-align: center; }
    .notice { background: rgba(255, 79, 216, 0.1); border: 1px solid var(--line); color: #ffe8fb; border-radius: 8px; padding: 10px; }
    @media (max-width: 680px) {
      .grid { grid-template-columns: 1fr; }
      .itemHead { display: grid; }
      .time { white-space: normal; }
    }
  </style>
</head>
<body>
  <header>
    <h1>SmartLife Calendar</h1>
    <p class="sub">To Do List และนัดหมายผ่าน LINE LIFF</p>
  </header>
  <main>
    <div id="liffNotice" class="notice hidden"></div>
    <div class="toolbar">
      <div class="seg">
        <button type="button" data-view="appointments">นัดหมาย</button>
        <button type="button" data-view="todos">To-do</button>
      </div>
      <div class="seg">
        <button type="button" data-filter="today">วันนี้</button>
        <button type="button" data-filter="week">7 วัน</button>
        <button type="button" data-filter="all">ทั้งหมด</button>
      </div>
      <button id="refreshBtn" type="button">รีเฟรช</button>
    </div>
    <form id="appointmentForm">
      <h2 class="sectionTitle">เพิ่มนัดหมาย</h2>
      <label>หัวข้อ
        <input name="title" required placeholder="เช่น ประชุมทีม">
      </label>
      <label>ประเภทนัดหมาย
        <select id="appointmentTypeSelect" name="appointmentType">
          <option value="single">วันเดียว</option>
          <option value="multi_day">หลายวัน</option>
          <option value="recurring">ประจำ</option>
        </select>
      </label>
      <div class="grid">
        <label><span id="startAtLabel">วันและเวลา</span>
          <input name="startAt" type="datetime-local" required>
        </label>
        <label id="endAtField" class="hidden">วันและเวลาสิ้นสุด
          <input id="endAtInput" name="endAt" type="datetime-local">
        </label>
        <label>สถานที่
          <input name="locationName" placeholder="เช่น ห้องประชุม / บ้าน / ออนไลน์">
        </label>
      </div>
      <div id="recurringFields" class="grid hidden">
        <label>ทำซ้ำ
          <select id="repeatSelect" name="repeat">
            <option value="daily">ทุกวัน</option>
            <option value="weekly">ทุกสัปดาห์</option>
            <option value="monthly">ทุกเดือน</option>
            <option value="monthly_first_weekend">เสาร์-อาทิตย์แรกของเดือน</option>
          </select>
        </label>
        <label>จำนวนครั้ง
          <input id="repeatCountInput" name="count" type="number" min="2" max="60" value="2">
        </label>
      </div>
      <label id="occurrenceDetailsField" class="hidden">เรื่อง/รายละเอียดแต่ละครั้ง (บรรทัดละ 1 ครั้ง)
        <textarea id="occurrenceDetailsInput" name="occurrenceDetails" rows="3" placeholder="ครั้งที่ 1: Greetings&#10;ครั้งที่ 2: Introductions"></textarea>
      </label>
      <div class="grid">
        <label>ผู้ประสานงาน
          <input name="contactName" placeholder="ชื่อผู้ประสานงาน">
        </label>
        <label>เบอร์โทรศัพท์
          <input name="contactPhone" type="tel" placeholder="เช่น 0812345678">
        </label>
        <label>LINE ID
          <input name="contactLineId" placeholder="LINE ID ผู้ประสานงาน">
        </label>
      </div>
      <label>รายละเอียด/เตรียมตัว
        <textarea name="preparation" rows="2" placeholder="สิ่งที่ต้องเตรียม"></textarea>
      </label>
      <input id="lineUserIdInput" name="lineUserId" type="hidden">
      <button class="primary" type="submit">เพิ่มนัดหมาย</button>
      <div id="statusText" class="status"></div>
    </form>
    <form id="todoForm" class="hidden">
      <h2 class="sectionTitle">เพิ่ม To-do</h2>
      <label>งานที่ต้องทำ
        <input name="title" required placeholder="เช่น ตรวจถ่านไฟฉาย">
      </label>
      <div class="grid">
        <label>กำหนดเวลา
          <input name="dueAt" type="datetime-local">
        </label>
        <label>ความสำคัญ
          <select name="priority">
            <option value="normal">ปกติ</option>
            <option value="high">สำคัญ</option>
            <option value="urgent">เร่งด่วน</option>
          </select>
        </label>
      </div>
      <label>หมายเหตุ
        <textarea name="notes" rows="2" placeholder="รายละเอียดเพิ่มเติม"></textarea>
      </label>
      <input id="todoLineUserIdInput" name="lineUserId" type="hidden">
      <button class="primary" type="submit">เพิ่ม To-do</button>
      <div id="todoStatusText" class="status"></div>
    </form>
    <section class="list" id="appointmentList"></section>
    <section class="list hidden" id="todoList"></section>
  </main>
  <script>
    window.SMARTLIFE_LIFF_ID = ${JSON.stringify(liffId)};
    const state = { appointments: [], todos: [], filter: 'today', view: 'appointments', profile: null };
    const appointmentList = document.getElementById('appointmentList');
    const todoList = document.getElementById('todoList');
    const appointmentForm = document.getElementById('appointmentForm');
    const todoForm = document.getElementById('todoForm');
    const statusText = document.getElementById('statusText');
    const todoStatusText = document.getElementById('todoStatusText');
    const notice = document.getElementById('liffNotice');
    const lineUserIdInput = document.getElementById('lineUserIdInput');
    const todoLineUserIdInput = document.getElementById('todoLineUserIdInput');
    const appointmentTypeSelect = document.getElementById('appointmentTypeSelect');
    const startAtLabel = document.getElementById('startAtLabel');
    const endAtField = document.getElementById('endAtField');
    const endAtInput = document.getElementById('endAtInput');
    const recurringFields = document.getElementById('recurringFields');
    const repeatSelect = document.getElementById('repeatSelect');
    const repeatCountInput = document.getElementById('repeatCountInput');
    const occurrenceDetailsField = document.getElementById('occurrenceDetailsField');
    const occurrenceDetailsInput = document.getElementById('occurrenceDetailsInput');

    function setStatus(text) { statusText.textContent = text || ''; }
    function setTodoStatus(text) { todoStatusText.textContent = text || ''; }
    function showNotice(text) {
      if (!text) { notice.classList.add('hidden'); notice.textContent = ''; return; }
      notice.textContent = text;
      notice.classList.remove('hidden');
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function formatBangkok(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '-';
      return new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23',
        numberingSystem: 'latn'
      }).format(date).replace(/(\\d{1,2}):(\\d{2})$/, '$1.$2 น.');
    }
    function toBangkokInputValue(value) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(new Date(value)).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
      return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
    }
    function bangkokDateKey(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(date);
    }
    function todayKey() { return bangkokDateKey(new Date()); }
    function syncAppointmentTypeFields() {
      const type = appointmentTypeSelect.value;
      const isMultiDay = type === 'multi_day';
      const isRecurring = type === 'recurring';
      startAtLabel.textContent = isMultiDay ? 'วันและเวลาเริ่มต้น' : 'วันและเวลา';
      endAtField.firstChild.textContent = isRecurring
        ? 'วันและเวลาสิ้นสุดของครั้งแรก (เว้นว่างได้)'
        : 'วันและเวลาสิ้นสุด';
      endAtField.classList.toggle('hidden', !isMultiDay && !isRecurring);
      recurringFields.classList.toggle('hidden', !isRecurring);
      occurrenceDetailsField.classList.toggle('hidden', !isRecurring);
      endAtInput.required = isMultiDay;
      endAtInput.disabled = !isMultiDay && !isRecurring;
      repeatSelect.required = isRecurring;
      repeatSelect.disabled = !isRecurring;
      repeatCountInput.required = isRecurring;
      repeatCountInput.disabled = !isRecurring;
      occurrenceDetailsInput.disabled = !isRecurring;
      if (!isMultiDay) endAtInput.value = '';
    }
    function syncActiveButtons() {
      document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
      document.querySelectorAll('[data-filter]').forEach(button => button.classList.toggle('active', button.dataset.filter === state.filter));
    }
    function shouldShowAppointment(item) {
      if (item.status === 'deleted') return false;
      if (state.filter === 'all') return true;
      const itemDate = new Date(item.startAt);
      if (Number.isNaN(itemDate.getTime())) return false;
      const startKey = bangkokDateKey(item.startAt);
      const endKey = bangkokDateKey(item.endAt || item.startAt);
      if (state.filter === 'today') return startKey <= todayKey() && endKey >= todayKey();
      if (state.filter === 'week') {
        const now = Date.now();
        const end = now + 7 * 24 * 60 * 60 * 1000;
        const itemEnd = new Date(item.endAt || item.startAt).getTime();
        return itemEnd >= now - 60 * 60 * 1000 && itemDate.getTime() <= end;
      }
      return true;
    }
    function shouldShowTodo(item) {
      if (item.status === 'deleted') return false;
      if (state.filter === 'all') return true;
      if (item.status === 'done') return false;
      if (!item.dueAt) return true;
      const dueKey = bangkokDateKey(item.dueAt);
      if (!dueKey) return true;
      if (state.filter === 'today') return dueKey <= todayKey();
      if (state.filter === 'week') return dueKey <= bangkokDateKey(Date.now() + 7 * 24 * 60 * 60 * 1000);
      return true;
    }
    function renderAppointments() {
      const rows = state.appointments.filter(shouldShowAppointment).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
      if (!rows.length) {
        appointmentList.innerHTML = '<div class="empty">ยังไม่มีนัดหมายในช่วงนี้</div>';
        return;
      }
      appointmentList.innerHTML = rows.map(item => '<article class="item">' +
        '<div class="itemHead"><div class="title">' + escapeHtml(item.title || '-') + '</div><div class="time">' +
          escapeHtml(item.endAt ? formatBangkok(item.startAt) + ' - ' + formatBangkok(item.endAt) : formatBangkok(item.startAt)) +
        '</div></div>' +
        '<div class="meta">' + escapeHtml(item.appointmentType === 'multi_day' ? 'หลายวัน' : item.appointmentType === 'recurring' ? 'ครั้งที่ ' + (item.repeatIndex || item.occurrenceNumber || '-') + '/' + (item.repeatCount || '-') + ' · ' + ({ daily: 'ทุกวัน', weekly: 'ทุกสัปดาห์', monthly: 'ทุกเดือน', monthly_first_weekend: 'เสาร์-อาทิตย์แรกของเดือน' }[item.repeat] || 'ประจำ') : 'วันเดียว') + '</div>' +
        '<div class="meta">' + escapeHtml([item.locationName ? 'สถานที่: ' + item.locationName : '', item.preparation ? 'เรื่อง/รายละเอียด: ' + item.preparation : '', item.contactName ? 'ผู้ประสานงาน: ' + item.contactName : '', item.contactPhone ? 'โทร: ' + item.contactPhone : '', item.contactLineId ? 'LINE: ' + item.contactLineId : ''].filter(Boolean).join(' | ') || '-') + '</div>' +
        '<div class="seg"><button type="button" data-appointment-edit="' + escapeHtml(item._id) + '">แก้ไขครั้งนี้</button><button type="button" data-appointment-delete="' + escapeHtml(item._id) + '" class="danger">ลบ</button></div>' +
      '</article>').join('');
    }
    function renderTodos() {
      const priorityLabel = { urgent: 'เร่งด่วน', high: 'สำคัญ', normal: 'ปกติ' };
      const rows = state.todos.filter(shouldShowTodo).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
        return new Date(a.dueAt || '9999-12-31') - new Date(b.dueAt || '9999-12-31');
      });
      if (!rows.length) {
        todoList.innerHTML = '<div class="empty">ยังไม่มี To-do ในช่วงนี้</div>';
        return;
      }
      todoList.innerHTML = rows.map(item => {
        const done = item.status === 'done';
        const titleClass = done ? 'title doneText' : 'title';
        const dueText = item.dueAt ? formatBangkok(item.dueAt) : 'ไม่กำหนดเวลา';
        const meta = [priorityLabel[item.priority] || item.priority || 'ปกติ', item.category, item.notes].filter(Boolean).join(' | ') || '-';
        const actionButton = done
          ? '<button type="button" data-todo-reopen="' + escapeHtml(item._id) + '">เปิดใหม่</button>'
          : '<button type="button" data-todo-complete="' + escapeHtml(item._id) + '" class="done">เสร็จแล้ว</button>';
        return '<article class="item">' +
          '<div class="itemHead"><div class="' + titleClass + '">' + escapeHtml(item.title || '-') + '</div><div class="time">' + escapeHtml(dueText) + '</div></div>' +
          '<div class="meta">' + escapeHtml(meta) + '</div>' +
          '<div class="seg">' + actionButton + '<button type="button" data-todo-delete="' + escapeHtml(item._id) + '" class="danger">ลบ</button></div>' +
        '</article>';
      }).join('');
    }
    function render() {
      syncActiveButtons();
      const isTodoView = state.view === 'todos';
      appointmentForm.classList.toggle('hidden', isTodoView);
      appointmentList.classList.toggle('hidden', isTodoView);
      todoForm.classList.toggle('hidden', !isTodoView);
      todoList.classList.toggle('hidden', !isTodoView);
      renderAppointments();
      renderTodos();
    }
    async function loadAll() {
      setStatus('กำลังโหลดนัดหมาย...');
      setTodoStatus('กำลังโหลด To-do...');
      const appointmentRes = await fetch('/appointments?activeOnly=true&limit=500');
      const todoRes = await fetch('/todos?activeOnly=true&limit=500');
      if (!appointmentRes.ok) throw new Error('โหลดนัดหมายไม่ได้');
      if (!todoRes.ok) throw new Error('โหลด To-do ไม่ได้');
      state.appointments = await appointmentRes.json();
      state.todos = await todoRes.json();
      setStatus('พบนัดหมาย ' + state.appointments.length + ' รายการ');
      setTodoStatus('พบ To-do ' + state.todos.length + ' รายการ');
      render();
    }
    async function initLiff() {
      if (!window.SMARTLIFE_LIFF_ID) {
        showNotice('ยังไม่ได้ตั้ง LIFF_ID หน้าเว็บนี้ใช้งานแบบ browser ได้ แต่ยังไม่ดึง LINE user อัตโนมัติ');
        return;
      }
      if (!window.liff) {
        showNotice('โหลด LIFF SDK ไม่สำเร็จ ใช้งานแบบ browser ต่อได้');
        return;
      }
      await liff.init({ liffId: window.SMARTLIFE_LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      state.profile = await liff.getProfile();
      lineUserIdInput.value = state.profile.userId || '';
      todoLineUserIdInput.value = state.profile.userId || '';
      showNotice('เชื่อมกับ LINE แล้ว: ' + (state.profile.displayName || 'ผู้ใช้ LINE'));
    }
    document.querySelectorAll('[data-view]').forEach(button => {
      button.addEventListener('click', () => {
        state.view = button.dataset.view;
        render();
      });
    });
    document.querySelectorAll('[data-filter]').forEach(button => {
      button.addEventListener('click', () => {
        state.filter = button.dataset.filter;
        render();
      });
    });
    document.getElementById('refreshBtn').addEventListener('click', () => loadAll().catch(err => {
      setStatus(err.message);
      setTodoStatus(err.message);
    }));
    appointmentTypeSelect.addEventListener('change', syncAppointmentTypeFields);
    appointmentForm.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submitButton = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form).entries());
      const expectedCount = payload.appointmentType === 'recurring' ? Number(payload.count || 1) : 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      submitButton.disabled = true;
      setStatus('กำลังบันทึก ' + expectedCount + ' รายการ กรุณารอสักครู่...');
      try {
        const res = await fetch('/appointments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(result.error || 'เพิ่มไม่สำเร็จ');
        form.reset();
        syncAppointmentTypeFields();
        if (state.profile && state.profile.userId) lineUserIdInput.value = state.profile.userId;
        await loadAll();
        const savedCount = Array.isArray(result) ? result.length : 1;
        setStatus('เพิ่มนัดหมายแล้ว ' + savedCount + ' รายการ');
      } catch (err) {
        setStatus(err.name === 'AbortError'
          ? 'ใช้เวลานานเกิน 60 วินาที กรุณากดรีเฟรชเพื่อตรวจรายการก่อนเพิ่มใหม่'
          : 'เพิ่มไม่สำเร็จ: ' + err.message);
      } finally {
        clearTimeout(timeout);
        submitButton.disabled = false;
      }
    });
    todoForm.addEventListener('submit', async event => {
      event.preventDefault();
      setTodoStatus('กำลังเพิ่ม...');
      const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
      const res = await fetch('/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setTodoStatus(result.error || 'เพิ่มไม่สำเร็จ'); return; }
      event.currentTarget.reset();
      if (state.profile && state.profile.userId) todoLineUserIdInput.value = state.profile.userId;
      await loadAll();
      setTodoStatus('เพิ่ม To-do แล้ว');
    });
    appointmentList.addEventListener('click', async event => {
      const editButton = event.target.closest('[data-appointment-edit]');
      if (editButton) {
        const item = state.appointments.find(row => row._id === editButton.dataset.appointmentEdit);
        if (!item) return;
        const startAt = prompt('วันที่และเวลา เช่น 2026-07-03T09:00', toBangkokInputValue(item.startAt));
        if (startAt === null) return;
        const locationName = prompt('สถานที่', item.locationName || '');
        if (locationName === null) return;
        const preparation = prompt('เรื่อง/รายละเอียดครั้งนี้', item.preparation || '');
        if (preparation === null) return;
        const contactName = prompt('ผู้ประสานงาน', item.contactName || '');
        if (contactName === null) return;
        const contactPhone = prompt('เบอร์โทรศัพท์', item.contactPhone || '');
        if (contactPhone === null) return;
        const contactLineId = prompt('LINE ID', item.contactLineId || '');
        if (contactLineId === null) return;
        const editRes = await fetch('/appointments/' + encodeURIComponent(item._id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startAt, locationName, preparation, contactName, contactPhone, contactLineId })
        });
        if (!editRes.ok) { setStatus('แก้ไขไม่สำเร็จ'); return; }
        await loadAll();
        setStatus('แก้ไขนัดหมายครั้งนี้แล้ว');
        return;
      }
      const button = event.target.closest('[data-appointment-delete]');
      if (!button || !confirm('ลบรายการนี้หรือไม่?')) return;
      const res = await fetch('/appointments/' + encodeURIComponent(button.dataset.appointmentDelete), { method: 'DELETE' });
      if (!res.ok) { setStatus('ลบไม่สำเร็จ'); return; }
      await loadAll();
      setStatus('ลบแล้ว');
    });
    todoList.addEventListener('click', async event => {
      const completeButton = event.target.closest('[data-todo-complete]');
      const reopenButton = event.target.closest('[data-todo-reopen]');
      const deleteButton = event.target.closest('[data-todo-delete]');
      if (completeButton) {
        const res = await fetch('/todos/' + encodeURIComponent(completeButton.dataset.todoComplete) + '/complete', { method: 'POST' });
        if (!res.ok) { setTodoStatus('บันทึกไม่สำเร็จ'); return; }
        await loadAll();
        setTodoStatus('ปิดงานแล้ว');
      }
      if (reopenButton) {
        const res = await fetch('/todos/' + encodeURIComponent(reopenButton.dataset.todoReopen) + '/reopen', { method: 'POST' });
        if (!res.ok) { setTodoStatus('เปิดงานไม่สำเร็จ'); return; }
        await loadAll();
        setTodoStatus('เปิดงานใหม่แล้ว');
      }
      if (deleteButton) {
        if (!confirm('ลบ To-do นี้หรือไม่?')) return;
        const res = await fetch('/todos/' + encodeURIComponent(deleteButton.dataset.todoDelete), { method: 'DELETE' });
        if (!res.ok) { setTodoStatus('ลบไม่สำเร็จ'); return; }
        await loadAll();
        setTodoStatus('ลบแล้ว');
      }
    });
    initLiff().catch(err => showNotice('LIFF error: ' + err.message));
    syncAppointmentTypeFields();
    render();
    loadAll().catch(err => {
      setStatus(err.message);
      setTodoStatus(err.message);
    });
  </script>
</body>
</html>`;
}

function renderSimpleFormPage({ title, subtitle, fields, submitLabel, action, successText, formKind, formNote }) {
  const fieldHtml = fields.map(field => `
      <label>
        <span>${field.label}</span>
        ${field.type === 'textarea'
          ? `<textarea name="${field.name}" ${field.required ? 'required' : ''} rows="3"></textarea>`
          : `<input name="${field.name}" type="${field.type || 'text'}" ${field.required ? 'required' : ''} ${field.placeholder ? `placeholder="${field.placeholder}"` : ''}>`}
      </label>`).join('');

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Tahoma, sans-serif; background: #f7f8fb; color: #17202a; }
    main { max-width: 640px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    p { color: #5f6b7a; }
    form { background: #fff; border: 1px solid #d9dee8; border-radius: 8px; padding: 18px; display: grid; gap: 14px; }
    label { display: grid; gap: 6px; font-weight: 600; }
    input, textarea { width: 100%; min-height: 40px; border: 1px solid #d9dee8; border-radius: 6px; padding: 9px; font: inherit; }
    button { min-height: 42px; border: 0; border-radius: 6px; background: #12805c; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
    nav { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
    nav a { color: #1f5fbf; text-decoration: none; font-weight: 600; }
    .badge { display: inline-block; margin: 10px 0 0; padding: 5px 9px; border-radius: 999px; background: #eaf3ff; color: #1f5fbf; font-size: 13px; font-weight: 700; }
    .note { background: #fff8e8; border: 1px solid #f1d28a; border-radius: 8px; padding: 10px; color: #614a00; }
    .status { min-height: 24px; color: #1f5fbf; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <div class="badge">${formKind || 'แบบฟอร์ม SmartLife'}</div>
    <p>${subtitle}</p>
    <nav>
      <a href="/forms">เลือกแบบฟอร์ม</a>
      <a href="/register-form">สมัครสมาชิก</a>
      <a href="/appointment-form">นัดหมาย</a>
      <a href="/appointments-panel">แก้ไขนัดหมาย</a>
    </nav>
    ${formNote ? `<div class="note">${formNote}</div>` : ''}
    <form id="smartlifeForm">
      ${fieldHtml}
      <button type="submit">${submitLabel}</button>
      <div id="status" class="status"></div>
    </form>
  </main>
  <script>
    const form = document.getElementById('smartlifeForm');
    const statusBox = document.getElementById('status');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      statusBox.textContent = 'กำลังบันทึก...';
      const payload = Object.fromEntries(new FormData(form).entries());
      const res = await fetch('${action}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusBox.textContent = result.error || result.message || 'บันทึกไม่สำเร็จ';
        return;
      }
      if (result.startAt) {
        const date = new Date(result.startAt);
        const formatted = new Intl.DateTimeFormat('th-TH', {
          timeZone: 'Asia/Bangkok',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          hourCycle: 'h23',
          numberingSystem: 'latn'
        }).format(date).replace(/(\\d{1,2}):(\\d{2})$/, '$1.$2 น.');
        statusBox.textContent = '${successText} เวลาไทย: ' + formatted;
      } else {
        statusBox.textContent = '${successText}';
      }
      form.reset();
    });
  </script>
</body>
</html>`;
}

function renderRegisterPanelPage() {
  return renderSimpleFormPage({
    title: 'สมัครสมาชิก SmartLife',
    subtitle: 'กรอกข้อมูลพื้นฐาน เลือกแพ็กเกจ และใส่หมายเหตุการโอนจ่ายถ้ามี',
    formKind: 'แบบฟอร์มสมัครสมาชิกเท่านั้น',
    formNote: 'ฟอร์มนี้ใช้สมัครสมาชิก ไม่ใช้บันทึกนัดหมาย หากต้องการเพิ่มนัดหมายให้เลือกแบบฟอร์มนัดหมาย',
    action: '/users/register',
    submitLabel: 'สมัครสมาชิก',
    successText: 'สมัครสมาชิกเรียบร้อยแล้ว',
    fields: [
      { name: 'username', label: 'ชื่อผู้ใช้', required: true },
      { name: 'email', label: 'อีเมล', type: 'email', required: true },
      { name: 'password', label: 'รหัสผ่าน', type: 'password', required: true },
      { name: 'phone', label: 'เบอร์โทร' },
      { name: 'lineUserId', label: 'LINE user id หรือ LINE id ถ้าทราบ' },
      { name: 'plan', label: 'แพ็กเกจที่ต้องการ เช่น free, plus, vip' },
      { name: 'paymentNote', label: 'หมายเหตุการจ่าย/เลขอ้างอิง/ข้อความถึงแอดมิน', type: 'textarea' }
    ]
  });
}

function renderAppointmentFormPage() {
  return renderLiffCalendarPage();
}

function getAppointmentIdFromData(data) {
  const params = new URLSearchParams(data);
  const fromParams = params.get('id') || params.get('eventId') || params.get('appointmentId') || params.get('taskId');

  if (fromParams) {
    return fromParams;
  }

  const match = String(data || '').match(/([a-f\d]{24})/i);
  return match ? match[1] : null;
}

function getPostbackAction(data) {
  const params = new URLSearchParams(data);
  const action = params.get('action');

  if (action) {
    return action;
  }

  if (String(data).includes('edit')) {
    return 'edit';
  }

  if (String(data).includes('delete')) {
    return 'delete';
  }

  return '';
}

function rememberAppointmentSelection(userId, items) {
  if (!userId) {
    return;
  }

  pendingAppointmentLists.set(userId, items.map(item => String(item._id)));
}

function getAppointmentIdFromSelection(userId, index) {
  if (!userId || !Number.isInteger(index) || index < 1) {
    return null;
  }

  const ids = pendingAppointmentLists.get(userId) || [];
  return ids[index - 1] || null;
}

function buildEditPrompt(appointment) {
  const currentLines = appointment
    ? [
        "",
        `รายการที่เลือก: ${appointment.title || '-'}`,
        `เวลาปัจจุบัน: ${formatBangkokDate(appointment.startAt)}`,
        appointment.locationName ? `สถานที่: ${appointment.locationName}` : null
      ].filter(Boolean)
    : [];

  return [
    "เรียน นายท่าน กรุณาส่งข้อมูลใหม่ตามรูปแบบเวลา 24 ชั่วโมงค่ะ",
    ...currentLines,
    "",
    "แก้เฉพาะเวลา: พิมพ์เวลาจริงที่ต้องการ เช่น 15.00 น.",
    "หรือแก้ทั้งหมดตามรูปแบบ: ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "ตัวอย่างรูปแบบ: ประชุมทีม | 2026-05-28 15.00 น. | ห้องประชุม | ชุดสุภาพ"
  ].join("\n");
}

function buildMainMenuMessage() {
  return {
    type: 'text',
    text: [
      "แผงหลัก SmartLife ค่ะ",
      "",
      "เลือกเมนูที่ต้องการได้เลยค่ะ",
      "1. สมัครสมาชิก",
      "2. บันทึกนัดหมาย",
      "3. แก้ไขนัดหมาย",
      "4. แปลภาษา",
      "5. ตอบคำถาม",
      "6. ดูนัดหมาย",
      "7. สร้างภาพ",
      "",
      "คำสั่งพิมพ์เร็ว:",
      "/สภาพอากาศ /นัดหมาย /ภัยพิบัติ /พรุ่งนี้ /สัปดาห์นี้ /เดือนนี้",
      "/ปฏิทิน /สร้างภาพ /คำถามอื่น /คำถาม /แปลภาษา /สมัคร /ปลดลอค /บริการฉุกเฉิน /ตรวจเช็ค"
    ].join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'สภาพอากาศ',
            text: '/สภาพอากาศ'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'สมัครสมาชิก',
            text: 'สมัครสมาชิก'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'บันทึกนัดหมาย',
            text: 'บันทึกนัดหมาย'
          }
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'แก้ไขนัดหมาย',
            data: 'action=list_appointments',
            displayText: 'แก้ไขนัดหมาย'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'แปลภาษา',
            text: 'แปลภาษา'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ตอบคำถาม',
            text: 'ตอบคำถาม'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ดูนัดหมาย',
            text: '/ปฏิทิน'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'สร้างภาพ',
            text: 'สร้างภาพ'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ภัยพิบัติ',
            text: '/ภัยพิบัติ'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ปลดล็อก',
            text: '/ปลดลอค'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ตรวจเช็ค',
            text: '/ตรวจเช็ค'
          }
        }
      ]
    }
  };
}

function buildTranslatePromptMessage() {
  const message = buildCommandOutputMessage({
    title: 'แปลภาษา',
    available: true,
    detail: [
      'พิมพ์คำว่า แปล ตามด้วยข้อความที่ต้องการแปล',
      '',
      'ตัวอย่าง:',
      'แปล วันนี้ฉันมีประชุมเวลา 15.00 น.'
    ].join("\n"),
    command: '/แปลภาษา',
    actionLabel: 'แปลภาษา'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ตัวอย่างแปล', text: 'แปล วันนี้ฉันมีประชุมเวลา 15.00 น.' }
      }
    ]
  };

  return message;
}

function buildChatPromptMessage(userId) {
  if (userId) {
    pendingModes.set(userId, 'chat');
  }

  const status = ai.getStatus();
  const message = buildCommandOutputMessage({
    title: 'ตอบคำถาม AI',
    available: status.textAiConfigured,
    detail: status.textAiConfigured
      ? 'พิมพ์คำถามมาได้เลย ระบบจะส่งต่อให้สมอง AI ฟรี/สำรองที่ตั้งค่าไว้ ถ้าจะกลับเมนูหลัก พิมพ์ เมนู'
      : 'ไม่มี provider ถามตอบที่พร้อมใช้',
    command: '/คำถามอื่น',
    actionLabel: 'ถามต่อ'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ถามตัวอย่าง', text: 'ช่วยแนะนำการเตรียมตัวเดินทางวันนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'เมนู', text: 'เมนู' }
      }
    ]
  };

  return message;
}

function buildImagePromptMessage(userId) {
  if (userId) {
    pendingModes.set(userId, { type: 'image_prompt', hasSourceImage: false });
  }

  const status = ai.getStatus();
  const message = buildCommandOutputMessage({
    title: 'สร้างภาพ',
    available: status.imageConfigured,
    detail: [
      'ต้องการสร้างภาพเกี่ยวกับอะไรคะ',
      'ส่งภาพต้นฉบับได้ แล้วพิมพ์รายละเอียดภาพต่อ',
      'ระบบจะเขียนพร้อมท์ภาษาไทยขนาด 1:1 ให้ตรวจ ก่อนสร้างจริง'
    ].join("\n"),
    command: '/สร้างภาพ',
    actionLabel: 'เริ่ม'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'เริ่มจากข้อความ', text: 'ภาพคนเมืองตรวจฝุ่นก่อนออกจากบ้าน สไตล์อินโฟกราฟิก' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'ยกเลิก', text: 'เมนู' }
      }
    ]
  };

  return message;
}

function hasThaiText(text) {
  return /[\u0E00-\u0E7F]/.test(String(text || ''));
}

function normalizeImageRequest(description) {
  return String(description || '')
    .trim()
    .replace(/พฃยานาค/g, 'พญานาค')
    .replace(/พยานาค/g, 'พญานาค');
}

function buildImageGlossary(request) {
  const lines = [];

  if (/พญานาค|นาคา|นาค/.test(request)) {
    lines.push('Important Thai cultural subject: พญานาค means Thai Naga serpent, a sacred mythological serpent from Thai/Lao Buddhist and Mekong culture.');
    lines.push('Depict a majestic serpent/dragon-like Naga with ornate scales, crest, and Thai temple/Mekong-inspired details if suitable.');
    lines.push('Do not depict Native American people, Indian chiefs, tribal headdresses, human warriors, or unrelated Indigenous American imagery.');
  }

  return lines;
}

function requestMentionsNonThaiPlace(request) {
  return /ญี่ปุ่น|จีน|เกาหลี|อินเดีย|อเมริกา|ยุโรป|อังกฤษ|ฝรั่งเศส|อิตาลี|ลาว|พม่า|เมียนมา|เขมร|กัมพูชา|เวียดนาม|มาเลเซีย|สิงคโปร์|อินโดนีเซีย|japan|china|korea|india|america|usa|europe|england|france|italy|laos|myanmar|cambodia|vietnam|malaysia|singapore|indonesia/i.test(request);
}

function buildThaiImageReviewPrompt({ originalRequest, userRequest, hasSourceImage }) {
  const lines = [
    'พร้อมท์ภาษาไทยสำหรับตรวจแก้',
    '',
    `สิ่งที่ต้องการสร้าง: ${userRequest || '-'}`,
    originalRequest !== userRequest ? `แก้คำผิดจาก: ${originalRequest}` : null,
    'ขนาดภาพ: 1:1',
    requestMentionsNonThaiPlace(userRequest)
      ? 'บริบทประเทศ/วัฒนธรรม: ตามที่ผู้ใช้ระบุในคำขอ'
      : 'บริบทประเทศ/วัฒนธรรม: ไทยเป็นค่าเริ่มต้น ใช้องค์ประกอบไทยก่อน เช่น แสง สี เครื่องแต่งกาย สถาปัตยกรรม ลายไทย ธรรมชาติ หรือวิถีชีวิตไทยตามความเหมาะสม',
    hasSourceImage ? 'ใช้ภาพต้นฉบับเป็นบริบท ถ้า provider รองรับภาพอ้างอิง' : null,
    /พญานาค|นาคา|นาค/.test(userRequest)
      ? 'หมายเหตุเฉพาะ: พญานาคคือพญานาค/นาคแบบไทย-ลาว ลุ่มน้ำโขง ไม่ใช่อินเดียนแดงหรือชนเผ่าอเมริกัน'
      : null,
    'ข้อกำกับ: สร้างให้ตรงคำขอ ไม่เปลี่ยนตัวแบบหลัก ไม่เพิ่มโลโก้ ตราราชการ ข้อความ หรือวัตถุที่ไม่ได้ขอ'
  ];

  return lines.filter(Boolean).join('\n');
}

async function buildImagePromptFromDescription(description, hasSourceImage = false) {
  const originalRequest = String(description || '').trim();
  const userRequest = normalizeImageRequest(originalRequest);
  let englishInterpretation = '';

  if (hasThaiText(userRequest)) {
    try {
      englishInterpretation = await ai.translateWithMyMemoryRaw(userRequest, 'th|en');
    } catch (err) {
      console.warn(`SmartLife image prompt translation skipped: ${err.message}`);
    }
  }

  const thaiDefault = requestMentionsNonThaiPlace(userRequest)
    ? 'Use the country or culture explicitly mentioned by the user.'
    : 'Default to Thailand and Thai visual culture unless the user explicitly specifies another country. Prefer Thai/Lao Mekong cultural context, Thai architecture, Thai clothing, Thai decorative motifs, Thai natural scenery, or Thai everyday life when suitable.';

  const generationPrompt = [
    'Create exactly one image that follows the user request faithfully.',
    `Original user request in Thai: ${originalRequest}`,
    originalRequest !== userRequest ? `Corrected Thai request: ${userRequest}` : null,
    englishInterpretation ? `English interpretation: ${englishInterpretation}` : null,
    thaiDefault,
    ...buildImageGlossary(userRequest),
    hasSourceImage ? 'Use the uploaded source image as visual reference if the image provider supports image reference.' : null,
    'Keep every requested subject, action, style, color, text, number, and setting.',
    'Do not replace the main subject, change the requested style, or add unrelated objects, logos, text, official badges, or warnings.',
    'Use a square 1:1 aspect ratio, clear composition, sharp details, and minimal clutter.'
  ].filter(Boolean).join('\n');

  return {
    reviewPrompt: buildThaiImageReviewPrompt({ originalRequest, userRequest, hasSourceImage }),
    generationPrompt
  };
}

function buildImagePromptReviewMessage(prompt) {
  const reviewPrompt = typeof prompt === 'string' ? prompt : prompt.reviewPrompt;

  return {
    type: 'text',
    text: [
      "ระบบเขียนพร้อมท์ให้แล้วค่ะ",
      "",
      reviewPrompt,
      "",
      "ถ้าพร้อมให้พิมพ์ /สร้างเลย",
      "ถ้าต้องการแก้ ให้พิมพ์ /แก้พร้อมท์ ตามด้วยรายละเอียดใหม่"
    ].join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: 'สร้างเลย', text: '/สร้างเลย' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'แก้ prompt', text: '/แก้พร้อมท์ ' }
        }
      ]
    }
  };
}

function buildImageResultMessages(imageMessage, prompt) {
  if (!imageMessage || imageMessage.type !== 'image' || !imageMessage.originalContentUrl) {
    return imageMessage;
  }

  const reviewPrompt = prompt && (typeof prompt === 'string' ? prompt : prompt.reviewPrompt);

  return [
    imageMessage,
    {
      type: 'text',
      text: [
        'สร้างภาพแล้วค่ะ',
        'ดาวน์โหลด/เปิดภาพจากลิงก์นี้ได้:',
        imageMessage.originalContentUrl,
        reviewPrompt ? '' : null,
        reviewPrompt ? 'Image prompt for editing:' : null,
        reviewPrompt ? reviewPrompt : null
      ].filter(Boolean).join("\n"),
      quickReply: {
        items: [
          {
            type: 'action',
            action: {
              type: 'uri',
              label: 'ดาวน์โหลด',
              uri: imageMessage.originalContentUrl
            }
          }
        ]
      }
    }
  ];
}

function buildAppointmentViewMenuMessage() {
  const message = buildCommandOutputMessage({
    title: 'ดูนัดหมาย',
    available: true,
    detail: 'เลือกช่วงเวลาที่ต้องการดู ระบบจะแสดงรายการตามเวลาไทย 24 ชั่วโมง',
    command: '/นัดหมาย',
    actionLabel: 'ดูทั้งหมด'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'วันนี้', text: 'นัดหมายวันนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'พรุ่งนี้', text: 'นัดหมายพรุ่งนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'สัปดาห์นี้', text: 'นัดหมายสัปดาห์นี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'เดือนนี้', text: 'นัดหมายเดือนนี้' }
      }
    ]
  };

  return message;
}

function buildLinkMessage(title, body, label, url) {
  if (!hasPublicUrl()) {
    return [
      title,
      "",
      body,
      "",
      "ตอนนี้ยังไม่มี PUBLIC_BASE_URL แบบ HTTPS สำหรับเปิดฟอร์มจากมือถือใน LINE",
      "ลิงก์นี้เปิดได้บนเครื่องที่รันระบบ:",
      url,
      "",
      "หากต้องการเปิดจากมือถือ ให้ตั้ง PUBLIC_BASE_URL หรือ APPOINTMENTS_PANEL_URL เป็น URL สาธารณะก่อนค่ะ"
    ].join("\n");
  }

  return {
    type: 'text',
    text: [title, "", body, "", url].join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'uri',
            label,
            uri: url
          }
        }
      ]
    }
  };
}

function hasPaymentOutputConfigured() {
  return Boolean(
    config.paymentPromptPay ||
    config.paymentBankAccount ||
    config.paymentQrUrl ||
    config.paymentInstructions
  );
}

function buildStatusBubble({ title, available = true, detail, command, uri }) {
  const statusText = available ? 'มี' : 'ไม่มี';
  const statusColor = available ? '#12805c' : '#b42318';
  const action = uri && hasPublicUrl()
    ? { type: 'uri', label: 'เปิด', uri }
    : { type: 'message', label: 'ใช้คำสั่ง', text: command || title };

  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, weight: 'bold', wrap: true, size: 'md' },
        { type: 'text', text: statusText, weight: 'bold', color: statusColor, size: 'xl' },
        { type: 'text', text: detail || '-', wrap: true, color: '#475467', size: 'sm' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: available ? 'primary' : 'secondary',
          color: available ? '#12805c' : '#667085',
          action
        }
      ]
    }
  };
}

function limitCardText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text || '-';
  }

  return `${text.slice(0, maxLength - 20).trim()}\n...ดูรายละเอียดต่อด้วยคำสั่งเดิม`;
}

function buildCommandOutputCard({ title, available = true, detail, command, actionLabel, uri }) {
  return {
    ...buildStatusBubble({
      title,
      available,
      detail: limitCardText(detail),
      command,
      uri
    }),
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: available ? 'primary' : 'secondary',
          color: available ? '#12805c' : '#667085',
          action: uri && hasPublicUrl()
            ? { type: 'uri', label: actionLabel || 'เปิด', uri }
            : { type: 'message', label: actionLabel || 'ใช้คำสั่ง', text: command || title }
        }
      ]
    }
  };
}

function buildCommandOutputMessage(options) {
  return {
    type: 'flex',
    altText: options.title || 'SmartLife',
    contents: buildCommandOutputCard(options)
  };
}

function buildStatusCarouselMessage(altText, cards) {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'carousel',
      contents: cards
    }
  };
}

function buildStatusCarouselMessages(altText, cards) {
  const groups = chunkItems(cards, 10);
  return groups.map((group, index) => buildStatusCarouselMessage(
    groups.length > 1 ? `${altText} ${index + 1}/${groups.length}` : altText,
    group
  ));
}

function buildFormSelectorMessage() {
  const cards = [
    buildStatusBubble({
      title: 'แบบฟอร์มสมัครสมาชิก',
      available: true,
      detail: hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้ผ่าน /register-form' : 'มีฟอร์มแล้ว แต่ยังไม่มี PUBLIC_BASE_URL สำหรับมือถือ',
      command: 'แบบฟอร์มสมัคร',
      uri: getPublicUrl('/register-form')
    }),
    buildStatusBubble({
      title: 'แบบฟอร์มนัดหมาย',
      available: true,
      detail: 'บันทึกนัดหมาย เวลาไทย 24 ชั่วโมง แยกจากฟอร์มสมัคร',
      command: 'แบบฟอร์มนัดหมาย',
      uri: getPublicUrl('/appointment-form')
    }),
    buildStatusBubble({
      title: 'แผงแก้ไขนัดหมาย',
      available: true,
      detail: 'ดู แก้ไข บันทึก หรือลบนัดหมายทั้งหมด',
      command: 'แผงนัดหมาย',
      uri: getPublicUrl('/appointments-panel')
    })
  ];

  return buildStatusCarouselMessage('การ์ดแบบฟอร์ม SmartLife', cards);
}

function buildRegisterFormLinkMessage() {
  return buildCommandOutputMessage({
    title: 'แบบฟอร์มสมัครสมาชิก',
    available: true,
    detail: [
      freeServices.buildRegisterPaymentText(),
      '',
      hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้' : 'ไม่มี PUBLIC_BASE_URL จึงยังเปิดฟอร์มจากมือถือ LINE ไม่ได้'
    ].join("\n"),
    command: 'แบบฟอร์มสมัคร',
    actionLabel: hasPublicUrl() ? 'เปิดฟอร์ม' : 'ดูฟอร์ม',
    uri: getPublicUrl('/register-form')
  });
}

function buildAppointmentFormLinkMessage() {
  const message = buildCommandOutputMessage({
    title: 'แบบฟอร์มนัดหมาย',
    available: true,
    detail: [
      'บันทึกนัดหมาย เวลาไทย 24 ชั่วโมง',
      'ถ้าเปิดฟอร์มไม่ได้ ให้พิมพ์ใน LINE ได้เลย:',
      'บันทึกนัดหมาย | ชื่อ | 28-05-2569 : 15.00 น. | สถานที่ | ชุด',
      '',
      hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้' : 'ไม่มี PUBLIC_BASE_URL จึงยังเปิดฟอร์มจากมือถือ LINE ไม่ได้'
    ].join("\n"),
    command: 'แบบฟอร์มนัดหมาย',
    actionLabel: hasPublicUrl() ? 'เปิดฟอร์ม' : 'ดูวิธีบันทึก',
    uri: getPublicUrl('/appointment-form')
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ตัวอย่างบันทึก', text: 'บันทึกนัดหมาย | ประชุม | 28-05-2569 : 15.00 น. | ห้องประชุม | ชุดสุภาพ' }
      }
    ]
  };

  return message;
}

function buildLineCommandChecklist() {
  const status = ai.getStatus();
  const lines = [
    `/สภาพอากาศ: มี`,
    `/นัดหมาย: มี`,
    `/แบบฟอร์ม: ${hasPublicUrl() ? 'มี' : 'ไม่มีลิงก์ HTTPS มือถือ'}`,
    `/คำถามอื่น: ${status.textAiConfigured ? 'มี' : 'ไม่มี provider แชต'}`,
    `/สร้างภาพ: ${status.imageConfigured ? 'มี' : 'ไม่มี provider สร้างภาพ'}`,
    `/แปลภาษา: มี`,
    `ช่องทางโอนจริง: ${hasPaymentOutputConfigured() ? 'มี' : 'ไม่มี'}`
  ];

  const message = buildCommandOutputMessage({
    title: 'ตรวจเช็ค SmartLife',
    available: status.textAiConfigured || status.imageConfigured || hasPublicUrl(),
    detail: [
      'สรุปสถานะคำสั่งหลักตามที่ขอ',
      '',
      ...lines,
      '',
      `AI: ${status.configuredProviders && status.configuredProviders.length ? status.configuredProviders.join(' > ') : 'ไม่มี'}`,
      `สร้างภาพ: ${status.configuredImageProviders && status.configuredImageProviders.length ? status.configuredImageProviders.join(' > ') : 'ไม่มี'}`
    ].join("\n"),
    command: '/ตรวจเช็ค',
    actionLabel: 'ตรวจอีก'
  });

  message.quickReply = {
    items: [
      { type: 'action', action: { type: 'message', label: 'ฟอร์ม', text: '/แบบฟอร์ม' } },
      { type: 'action', action: { type: 'message', label: 'ถาม AI', text: '/คำถามอื่น' } },
      { type: 'action', action: { type: 'message', label: 'สร้างภาพ', text: '/สร้างภาพ' } }
    ]
  };

  return message;
}

function buildAppointmentMenuMessage(items) {
  if (items.length === 0) {
    const message = buildCommandOutputMessage({
      title: 'นัดหมายทั้งหมด',
      available: false,
      detail: 'ไม่มีนัดหมายที่บันทึกไว้',
      command: 'บันทึกนัดหมาย',
      actionLabel: 'บันทึกนัด'
    });

    message.quickReply = {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: 'บันทึกนัดหมาย', text: 'บันทึกนัดหมาย' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'แผงหลัก', text: 'เมนูหลัก' }
        }
      ]
    };

    return message;
  }

  const lines = [
    "เมนูแก้ไขนัดหมายค่ะ",
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "วิธีแก้:",
    "แก้นัดหมาย <ID> | ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "หรือแก้เฉพาะเวลา: แก้เวลา <ID> <เวลาจริง>",
    "ตัวอย่างรูปแบบ: แก้เวลา <ID> 15.00 น.",
    "หรือพิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "",
    "วิธีลบ:",
    "ลบนัดหมาย <ID>",
    "หรือพิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ];

  const quickReplyItems = items.slice(0, 6).flatMap((appointment, index) => ([
    {
      type: 'action',
      action: {
        type: 'postback',
        label: `แก้ ${index + 1}`,
        data: `action=edit&id=${appointment._id}`,
        displayText: `แก้นัดหมาย ${index + 1}`
      }
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: `ลบ ${index + 1}`,
        data: `action=delete&id=${appointment._id}`,
        displayText: `ลบนัดหมาย ${index + 1}`
      }
    }
  ]));

  return {
    type: 'text',
    text: lines.join("\n"),
    quickReply: {
      items: quickReplyItems
    }
  };
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildAppointmentCarouselMessage(items, offset = 0) {
  return {
    type: 'flex',
    altText: 'รายการนัดหมายพร้อมปุ่มแก้ไขและลบ',
    contents: {
      type: 'carousel',
      contents: items.map((appointment, index) => {
        const number = offset + index + 1;
        return {
          type: 'bubble',
          size: 'mega',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'text', text: `รายการ ${number}`, size: 'xs', color: '#667085' },
              { type: 'text', text: appointment.title || '-', weight: 'bold', wrap: true },
              { type: 'text', text: `เวลา: ${formatBangkokDate(appointment.startAt)}`, size: 'sm', color: '#344054', wrap: true },
              { type: 'text', text: `สถานที่: ${appointment.locationName || '-'}`, size: 'sm', color: '#475467', wrap: true }
            ]
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#12805c',
                action: {
                  type: 'postback',
                  label: 'แก้ไข',
                  data: `action=edit&id=${appointment._id}`,
                  displayText: `แก้นัดหมาย ${number}`
                }
              },
              {
                type: 'button',
                style: 'secondary',
                color: '#b42318',
                action: {
                  type: 'postback',
                  label: 'ลบ',
                  data: `action=delete&id=${appointment._id}`,
                  displayText: `ลบนัดหมาย ${number}`
                }
              }
            ]
          }
        };
      })
    }
  };
}

function buildAppointmentMenuMessages(items) {
  if (items.length === 0) {
    return [buildAppointmentMenuMessage(items)];
  }

  const groups = chunkItems(items.slice(0, 40), 10);
  return [
    buildAppointmentMenuMessage(items),
    ...groups.slice(0, 4).map((group, groupIndex) => buildAppointmentCarouselMessage(group, groupIndex * 10))
  ];
}

function buildDuplicateMessage(groups) {
  if (groups.length === 0) {
    return "ยังไม่พบนัดหมายที่มีแนวโน้มซ้ำค่ะ";
  }

  const lines = ["พบนัดหมายที่อาจซ้ำกันค่ะ", ""];

  groups.slice(0, 5).forEach((group, groupIndex) => {
    lines.push(`ชุดที่ ${groupIndex + 1}`);
    group.forEach(appointment => {
      lines.push(`- ${appointment.title || '-'} | ${formatBangkokDate(appointment.startAt)} | ID: ${appointment._id}`);
    });
    lines.push("");
  });

  lines.push("ถ้าต้องการลบรายการซ้ำ ให้พิมพ์:");
  lines.push("ลบนัดหมาย <ID>");
  return lines.join("\n");
}

async function buildRequestedReport(userId) {
  const items = await appointments.getToday();
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return "เรียน นายท่าน วันนี้ยังไม่มีนัดหมายที่บันทึกไว้ค่ะ";
  }

  return [
    "เรียน นายท่าน ตารางนัดหมายวันนี้มีดังนี้ค่ะ",
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "หากต้องการแก้ไข พิมพ์:",
    "แก้นัดหมาย <ID> | ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "หรือแก้เฉพาะเวลา: แก้เวลา <ID> <เวลาจริง>",
    "ตัวอย่างรูปแบบ: แก้เวลา <ID> 15.00 น.",
    "หรือพิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "",
    "หากต้องการลบ พิมพ์:",
    "ลบนัดหมาย <ID>",
    "หรือพิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ].join("\n");
}

function formatWeatherValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'ยังไม่มีข้อมูล';
  }

  return `${value}${suffix}`;
}

async function buildWeatherAssessmentReport(location) {
  try {
    const report = await weather.getReport(location);

    return [
      'รายงานสภาพอากาศและคุณภาพชีวิต',
      `พื้นที่: ${report.locationName || 'Bangkok'} | เวลาไทย ${formatBangkokDate(report.observedAt)}`,
      '',
      `อุณหภูมิ: ${formatWeatherValue(report.temp, '°C')} | สูงสุด 24 ชม.: ${formatWeatherValue(report.tempMax, '°C')} (${report.tempAssessment.level})`,
      `ดัชนีความร้อน: ${formatWeatherValue(report.heatIndex, '°C')}${report.heatIndexAssessment ? ` (${report.heatIndexAssessment.level})` : ''}`,
      `ฝนล่าสุด 1 ชม.: ${formatWeatherValue(report.rainMm1h, ' มม.')} (${report.rainAmountAssessment.level})`,
      `โอกาสฝน 12 ชม.: ${formatWeatherValue(report.rainChance, '%')} (${report.rainChanceAssessment.level})`,
      `คาดฝนถัดไป: ${report.nextRainAt ? `${formatHours(report.nextRainInHours)} | โอกาส ${formatWeatherValue(report.nextRainChance, '%')} | ${formatWeatherValue(report.nextRainMm3h, ' มม. ในรอบ 3 ชม.')} (${report.nextRainAssessment.level})` : 'ยังไม่พบสัญญาณฝนในรอบคาดการณ์'}`,
      `ลม/พายุ: ${formatWeatherValue(report.windSpeedKph, ' กม./ชม.')} (${report.stormAssessment.level})`,
      `PM2.5: ${formatWeatherValue(report.pm25, ' µg/m³')} (${report.pm25Assessment.level})`,
      `หน้ากาก: ${report.pm25Assessment.maskAdvice}`,
      '',
      report.healthAdvice || 'ยังไม่มีคำแนะนำเพิ่มจากข้อมูลที่ได้รับ',
      '',
      `ที่มา: ${report.source || 'แหล่งข้อมูลอากาศ'}`
    ].join("\n");
  } catch (err) {
    return [
      'รายงานสภาพอากาศ',
      '',
      'ตอนนี้ระบบดึงข้อมูลอากาศจริงไม่ได้ค่ะ',
      `สาเหตุ: ${err.message}`,
      'ระบบจะไม่เดาค่าแทนข้อมูลจริง'
    ].join("\n");
  }
}

async function buildWeatherAssessmentMessage(location) {
  try {
    const report = await weather.getReport(location);

    return buildCommandOutputMessage({
      title: 'สภาพอากาศ',
      available: true,
      detail: [
        `พื้นที่: ${report.locationName || 'Bangkok'}`,
        `เวลาไทย: ${formatBangkokDate(report.observedAt)}`,
        `อุณหภูมิ: ${formatWeatherValue(report.temp, '°C')} | สูงสุด 24 ชม.: ${formatWeatherValue(report.tempMax, '°C')} (${report.tempAssessment.level})`,
        `ฝนล่าสุด 1 ชม.: ${formatWeatherValue(report.rainMm1h, ' มม.')} (${report.rainAmountAssessment.level})`,
        `โอกาสฝน 12 ชม.: ${formatWeatherValue(report.rainChance, '%')} (${report.rainChanceAssessment.level})`,
        `ลม/พายุ: ${formatWeatherValue(report.windSpeedKph, ' กม./ชม.')} (${report.stormAssessment.level})`,
        `PM2.5: ${formatWeatherValue(report.pm25, ' µg/m³')} (${report.pm25Assessment.level})`,
        `หน้ากาก: ${report.pm25Assessment.maskAdvice}`,
        `ที่มา: ${report.source || 'แหล่งข้อมูลอากาศ'}`
      ].join("\n"),
      command: '/สภาพอากาศ',
      actionLabel: 'รีเฟรช'
    });
  } catch (err) {
    return buildCommandOutputMessage({
      title: 'สภาพอากาศ',
      available: false,
      detail: `ไม่มีข้อมูลอากาศจริงตอนนี้\nสาเหตุ: ${err.message}\nระบบจะไม่เดาค่าแทนข้อมูลจริง`,
      command: '/สภาพอากาศ',
      actionLabel: 'ลองใหม่'
    });
  }
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getBangkokWeekdayIndex(baseDate = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: THAILAND_TIME_ZONE,
    weekday: 'short'
  }).format(baseDate);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

function getBangkokWeekRange(baseDate = new Date()) {
  const dateKey = getBangkokDateKey(baseDate);
  const currentMidnight = new Date(`${dateKey}T00:00:00.000+07:00`);
  const weekday = getBangkokWeekdayIndex(baseDate);
  const diffToMonday = ((weekday === -1 ? 1 : weekday) + 6) % 7;
  const start = addDays(currentMidnight, -diffToMonday);
  const end = addDays(start, 7);
  end.setMilliseconds(end.getMilliseconds() - 1);

  return { start, end };
}

function getBangkokMonthRange(baseDate = new Date()) {
  const [yearText, monthText] = getBangkokDateKey(baseDate).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const start = new Date(`${yearText}-${monthText}-01T00:00:00.000+07:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000+07:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);

  return { start, end };
}

async function buildAppointmentRangeReport(userId, mode) {
  let label = 'วันนี้';
  let range = getBangkokDayRange(new Date());

  if (mode === 'tomorrow') {
    label = 'พรุ่งนี้';
    range = getBangkokDayRange(addDays(new Date(), 1));
  } else if (mode === 'week') {
    label = 'สัปดาห์นี้';
    range = getBangkokWeekRange(new Date());
  } else if (mode === 'month') {
    label = 'เดือนนี้';
    range = getBangkokMonthRange(new Date());
  }

  const items = await appointments.listAppointments({
    activeOnly: true,
    startAtFrom: range.start,
    startAtTo: range.end,
    limit: ['week', 'month'].includes(mode) ? 200 : 50
  });
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return `ยังไม่มีนัดหมาย${label}ค่ะ`;
  }

  return [
    `นัดหมาย${label}ค่ะ`,
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "แก้ไข: พิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "ลบ: พิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ].join("\n");
}

async function buildAppointmentRangeMessages(userId, mode) {
  let label = 'วันนี้';
  let range = getBangkokDayRange(new Date());

  if (mode === 'tomorrow') {
    label = 'พรุ่งนี้';
    range = getBangkokDayRange(addDays(new Date(), 1));
  } else if (mode === 'week') {
    label = 'สัปดาห์นี้';
    range = getBangkokWeekRange(new Date());
  } else if (mode === 'month') {
    label = 'เดือนนี้';
    range = getBangkokMonthRange(new Date());
  }

  const items = await appointments.listAppointments({
    activeOnly: true,
    startAtFrom: range.start,
    startAtTo: range.end,
    limit: ['week', 'month'].includes(mode) ? 200 : 50
  });
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return [buildCommandOutputMessage({
      title: `นัดหมาย${label}`,
      available: false,
      detail: `ไม่มีนัดหมาย${label}`,
      command: mode === 'tomorrow' ? '/พรุ่งนี้' : mode === 'week' ? '/สัปดาห์นี้' : mode === 'month' ? '/เดือนนี้' : 'นัดหมายวันนี้',
      actionLabel: 'บันทึกนัด'
    })];
  }

  const summaryCard = buildCommandOutputMessage({
    title: `นัดหมาย${label}`,
    available: true,
    detail: [
      `มี ${items.length} รายการ`,
      'กดปุ่มแก้ไข/ลบในการ์ดแต่ละรายการ หรือพิมพ์ แก้นัดหมาย <เลขลำดับ>'
    ].join("\n"),
    command: '/นัดหมาย',
    actionLabel: 'ดูทั้งหมด'
  });
  const groups = chunkItems(items.slice(0, 30), 10);

  return [
    summaryCard,
    ...groups.slice(0, 4).map((group, groupIndex) => buildAppointmentCarouselMessage(group, groupIndex * 10))
  ].slice(0, 5);
}

async function buildUrgentAlertReport() {
  const urgentAlerts = await alerts.listActiveUrgentAlerts();

  if (urgentAlerts.length === 0) {
    return "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานภาวะฉุกเฉินหรือเร่งด่วนที่ยัง active ค่ะ";
  }

  return urgentAlerts.map(alert => alerts.formatAlert(alert)).join("\n\n---\n\n");
}

async function buildDisasterReport(types, emptyMessage) {
  const disasterAlerts = await alerts.listActiveAlertsByTypes(types);

  if (disasterAlerts.length === 0) {
    return emptyMessage;
  }

  return disasterAlerts.map(alert => alerts.formatAlert(alert)).join("\n\n---\n\n");
}

async function buildAsiaDisasterMessages() {
  try {
    const report = await liveDisasters.buildAsiaDisasterReport();
    const hasItems = !/ยังไม่พบรายการ|ยังไม่มีรายงาน|อ่านไม่ได้/.test(report);

    return [buildCommandOutputMessage({
      title: 'ภัยพิบัติเอเชีย',
      available: hasItems,
      detail: report,
      command: '/ภัยพิบัติ',
      actionLabel: 'รีเฟรช'
    })];
  } catch (err) {
    return [buildCommandOutputMessage({
      title: 'ภัยพิบัติเอเชีย',
      available: false,
      detail: `ไม่มีข้อมูลภัยพิบัติที่อ่านได้ตอนนี้\nสาเหตุ: ${err.message}`,
      command: '/ภัยพิบัติ',
      actionLabel: 'ลองใหม่'
    })];
  }
}

async function handleAdminUnlockCommand(text, userId) {
  const match = String(text || '').trim().match(/^\/?admin\s+ปลด(?:ล็อค|ลอค|ล็อก)\s+(\S+)\s+(free|plus|vip|ตลอดชีพ)(?:\s+(\d{1,4}))?$/i);

  if (!match) {
    return null;
  }

  if (!config.lineUserId || userId !== config.lineUserId) {
    return 'คำสั่งนี้ใช้ได้เฉพาะแอดมินที่ตรงกับ LINE_USER_ID ค่ะ';
  }

  const target = match[1];
  const rawPlan = match[2].toLowerCase();
  const plan = rawPlan === 'ตลอดชีพ' ? 'vip' : rawPlan;
  const days = match[3] ? Number(match[3]) : (plan === 'vip' ? null : 30);
  const user = await User.findOne({
    $or: [
      { email: target },
      { username: target },
      { lineUserId: target }
    ]
  });

  if (!user) {
    return `ยังไม่พบสมาชิก ${target} ค่ะ`;
  }

  user.plan = plan;
  user.paymentStatus = 'admin_unlocked';
  user.unlockedBy = userId;
  user.unlockedAt = new Date();
  user.unlockedUntil = plan === 'vip' ? null : addDays(new Date(), days);
  await user.save();

  return [
    'ปลดล็อกสมาชิกเรียบร้อยค่ะ',
    `ผู้ใช้: ${user.username || user.email}`,
    `แพ็กเกจ: ${user.plan}`,
    `ใช้ได้ถึง: ${user.unlockedUntil ? formatBangkokDate(user.unlockedUntil) : 'ตลอดชีพ'}`
  ].join("\n");
}

async function sendAppointmentMenu(replyToken, userId) {
  const items = await appointments.listAppointments({ activeOnly: true, limit: 50 });
  rememberAppointmentSelection(userId, items);
  return line.replyMessage(replyToken, buildAppointmentMenuMessages(items));
}

function formatTodoPriority(priority) {
  return {
    urgent: 'เร่งด่วน',
    high: 'สำคัญ',
    normal: 'ปกติ'
  }[priority] || priority || 'ปกติ';
}

function formatTodoDueAt(todo) {
  return todo.dueAt ? formatBangkokDate(todo.dueAt) : 'ไม่กำหนดเวลา';
}

function buildTodoListText(items, emptyText) {
  if (!items || items.length === 0) {
    return emptyText;
  }

  const lines = items.slice(0, 10).map((todo, index) => [
    `${index + 1}. ${todo.title || '-'}`,
    `กำหนด: ${formatTodoDueAt(todo)}`,
    todo.responsible ? `ผู้รับผิดชอบ: ${todo.responsible}` : null,
    `ความสำคัญ: ${formatTodoPriority(todo.priority)}`,
    `สถานะ: ${todo.status || 'open'}`,
    todo.notes ? `หมายเหตุ: ${todo.notes}` : null,
    `ID: ${todo._id}`
  ].filter(Boolean).join("\n"));

  if (items.length > 10) {
    lines.push(`ยังมีอีก ${items.length - 10} งาน เปิด /ปฏิทิน เพื่อดูทั้งหมด`);
  }

  return lines.join("\n\n");
}

function buildEarthquakeWarningListText(items) {
  if (!items || items.length === 0) {
    return 'ยังไม่มีประวัติประเมินแผ่นดินไหวล่าสุดค่ะ';
  }

  return items.slice(0, 5).map((item, index) => [
    `${index + 1}. ${item.title || 'แผ่นดินไหว'}`,
    `พื้นที่: ${item.areaText || '-'}`,
    `ระดับระบบ: ${item.riskLevel || item.severity || '-'}`,
    `ไกลจาก กทม.: ${item.distanceFromBangkokKm === undefined || item.distanceFromBangkokKm === null ? '-' : `${Math.round(item.distanceFromBangkokKm)} กม.`}`,
    `เวลา: ${item.startsAt ? formatBangkokDate(item.startsAt) : '-'}`,
    `ที่มา: ${item.source || '-'}`
  ].join("\n")).join("\n\n");
}

function buildWeatherLocationFromLineMessage(message = {}) {
  const title = String(message.title || '').trim();
  const address = String(message.address || '').trim();
  const name = [title, address].filter(Boolean).join(' - ') || 'ตำแหน่งที่ส่งมา';

  return {
    name,
    latitude: message.latitude,
    longitude: message.longitude
  };
}

async function handleLocationMessage(event) {
  const location = buildWeatherLocationFromLineMessage(event.message || {});
  const normalizedLocation = weather.normalizeLocation(location);

  if (normalizedLocation.isDefault) {
    await line.reply(event.replyToken, [
      'ระบบอ่านพิกัดจากโลเคชันนี้ไม่ได้ค่ะ',
      'กรุณาส่งโลเคชันจากปุ่มแชร์ตำแหน่งใน LINE อีกครั้ง ระบบจะรายงานอากาศจากพิกัดจริงเท่านั้น'
    ].join("\n"));
    return true;
  }

  await line.replyMessage(event.replyToken, await buildWeatherAssessmentMessage(normalizedLocation));
  return true;
}

async function handleTextMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source && event.source.userId;
  const command = normalizeCommand(text);

  if (text === '/' || command === '') {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.replyMessage(event.replyToken, buildMainMenuMessage());
    return true;
  }

  const adminUnlockResult = await handleAdminUnlockCommand(text, userId);
  if (adminUnlockResult) {
    await line.reply(event.replyToken, adminUnlockResult);
    return true;
  }

  if (['คู่มือ', 'วิธีใช้', 'help', 'Help'].includes(text) || ['คู่มือ', 'วิธีใช้', 'help'].includes(command)) {
    await line.reply(event.replyToken, manual.getManualText());
    return true;
  }

  if (['เมนูหลัก', 'แผงหลัก', 'เมนู', 'main menu'].includes(text) || ['เมนูหลัก', 'แผงหลัก', 'เมนู'].includes(command)) {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.replyMessage(event.replyToken, buildMainMenuMessage());
    return true;
  }

  if (['ตรวจเช็ค', 'ตรวจเช็คระบบ', 'ตรวจระบบ', 'สถานะคำสั่ง'].includes(command)) {
    await line.replyMessage(event.replyToken, buildLineCommandChecklist());
    return true;
  }

  if (['แบบฟอร์ม', 'ฟอร์ม', 'forms', 'แยกแบบฟอร์ม'].includes(command)) {
    await line.replyMessage(event.replyToken, buildFormSelectorMessage());
    return true;
  }

  if (['สภาพอากาศ', 'อากาศ', 'weather'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildWeatherAssessmentMessage());
    return true;
  }

  if (['นัดหมาย', 'แก้ไขนัดหมาย', 'แก้นัดหมาย'].includes(command)) {
    await sendAppointmentMenu(event.replyToken, userId);
    return true;
  }

  if (['ภัยพิบัติ', 'เตือนภัย'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAsiaDisasterMessages());
    return true;
  }

  if (['แผ่นดินไหวล่าสุด', 'รายงานแผ่นดินไหว', 'เตือนแผ่นดินไหว'].includes(command)) {
    const syncResult = await earthquakeWarnings.syncEarthquakeWarnings();
    const items = await earthquakeWarnings.listRecentWarnings(5);
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'ประเมินแผ่นดินไหว',
      available: true,
      detail: [
        buildEarthquakeWarningListText(items),
        '',
        `ประเมินล่าสุด: ${syncResult.evaluated} รายการ`,
        'หมายเหตุ: ระบบนี้เป็นการเตือนเสริม ไม่ใช่ประกาศทางการ'
      ].join("\n"),
      command: 'แผ่นดินไหวล่าสุด',
      actionLabel: 'ตรวจอีกครั้ง'
    }));
    return true;
  }

  if (['พรุ่งนี้', 'นัดหมายพรุ่งนี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'tomorrow'));
    return true;
  }

  if (['สัปดาห์นี้', 'อาทิตย์นี้', 'นัดหมายสัปดาห์นี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'week'));
    return true;
  }

  if (['เดือนนี้', 'นัดหมายเดือนนี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'month'));
    return true;
  }

  if (['คำถาม', 'คำถามอื่น', 'ตอบคำถาม', 'ถาม AI', 'ถามเอไอ', 'ถามอื่น', 'คุยกับ AI', 'คุยกับเอไอ'].includes(command)) {
    await line.reply(event.replyToken, buildChatPromptMessage(userId));
    return true;
  }

  if (['แปลภาษา', 'แปล'].includes(command)) {
    await line.reply(event.replyToken, buildTranslatePromptMessage());
    return true;
  }

  if (['ดูนัดหมาย', 'ดูตารางนัดหมาย'].includes(command)) {
    await line.replyMessage(event.replyToken, buildAppointmentViewMenuMessage());
    return true;
  }

  if (['งานวันนี้', 'todoวันนี้', 'to-doวันนี้'].includes(command)) {
    const items = await todos.getToday();
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do วันนี้',
      available: true,
      detail: buildTodoListText(items, 'วันนี้ยังไม่มี To-do ที่ครบกำหนดค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getPublicUrl('/liff/calendar')
    }));
    return true;
  }

  if (['งานค้าง', 'todoค้าง', 'to-doค้าง'].includes(command)) {
    const items = await todos.getOverdue();
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do ค้าง',
      available: true,
      detail: buildTodoListText(items, 'ยังไม่มี To-do ค้างค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getPublicUrl('/liff/calendar')
    }));
    return true;
  }

  if (['งานสัปดาห์นี้', 'todoสัปดาห์นี้', 'to-doสัปดาห์นี้'].includes(command)) {
    const items = await todos.getThisWeek();
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do สัปดาห์นี้',
      available: true,
      detail: buildTodoListText(items, 'สัปดาห์นี้ยังไม่มี To-do ค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getPublicUrl('/liff/calendar')
    }));
    return true;
  }

  if (['งานทั้งหมด', 'รายการงาน', 'to-do', 'todos'].includes(command)) {
    const items = await todos.listTodos({ openOnly: true, limit: 50 });
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do ทั้งหมด',
      available: true,
      detail: buildTodoListText(items, 'ยังไม่มี To-do ที่เปิดอยู่ค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getPublicUrl('/liff/calendar')
    }));
    return true;
  }

  if (['ปฏิทิน', 'calendar', 'liff', 'todo', 'to do'].includes(command)) {
    await line.replyMessage(
      event.replyToken,
      buildLinkMessage(
        'SmartLife Calendar',
        'เปิดหน้า To Do List Calendar สำหรับดู เพิ่ม และลบนัดหมายใน LINE',
        'เปิดปฏิทิน',
        getPublicUrl('/liff/calendar')
      )
    );
    return true;
  }

  if (['สร้างภาพ', 'วาดภาพ', 'ทำภาพ'].includes(command)) {
    await line.reply(event.replyToken, 'ปิดฟังก์ชันสร้างภาพแล้วค่ะ ระบบจะเก็บเครดิตไว้ใช้กับงานสำคัญ เช่น คำกล่าว นัดหมาย และ To-do');
    return true;
  }

  if (['ปลดลอค', 'ปลดล็อค', 'ปลดล็อก', 'แพ็กเกจ', 'แพคเกจ'].includes(command)) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'ปลดล็อก/แพ็กเกจ',
      available: true,
      detail: freeServices.buildUnlockPlanText(),
      command: '/ปลดลอค',
      actionLabel: 'ดูอีกครั้ง'
    }));
    return true;
  }

  if (['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(command)) {
    await line.replyMessage(event.replyToken, buildRegisterFormLinkMessage());
    return true;
  }

  if (['บันทึกนัดหมาย', 'เพิ่มนัดหมาย', 'สร้างนัดหมาย', 'นัดหมายใหม่', 'แบบฟอร์มนัดหมาย', 'ฟอร์มนัดหมาย', 'ฟอร์มนัด', 'ฟอร์มบันทึกนัดหมาย'].includes(command)) {
    await line.replyMessage(event.replyToken, buildAppointmentFormLinkMessage());
    return true;
  }

  if (['บริการฉุกเฉิน', 'บริการฟรี', 'เบอร์ฉุกเฉิน', 'ฉุกเฉิน', 'มูลนิธิ', 'กู้ภัย', 'สุขภาพ', 'สิทธิสุขภาพ', 'สุขภาพใจ', 'เดินทาง', 'จราจร', 'ร้องเรียน', 'ปลอดภัยออนไลน์'].includes(command)) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'บริการฉุกเฉิน',
      available: true,
      detail: freeServices.buildEmergencyServicesText(command),
      command: '/บริการฉุกเฉิน',
      actionLabel: 'ดูอีกครั้ง'
    }));
    return true;
  }

  const knowledgeCommandMatch = text.match(/^\/?(?:ความรู้|วิกิ|สารานุกรม)\s+([\s\S]+)$/i);
  if (knowledgeCommandMatch) {
    try {
      const answer = await knowledge.answerKnowledgeQuestion(knowledgeCommandMatch[1]);
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'ความรู้',
        available: true,
        detail: answer,
        command: `/ความรู้ ${knowledgeCommandMatch[1]}`,
        actionLabel: 'ค้นอีก'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'ความรู้',
        available: false,
        detail: `ยังค้นความรู้จากวิกิพีเดียไทยไม่ได้ค่ะ: ${err.message}`,
        command: '/ความรู้',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const scamCommandMatch = text.match(/^\/?(?:เช็คโกง|เช็กโกง|ตรวจโกง|กันโกง)\s*([\s\S]*)$/i);
  if (scamCommandMatch) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'เช็คโกง',
      available: true,
      detail: scamCheck.checkScam(scamCommandMatch[1]),
      command: '/เช็คโกง',
      actionLabel: 'ตรวจอีก'
    }));
    return true;
  }

  const completeTodoMatch = text.match(/^(?:งานเสร็จ|ปิดงาน|todo done|done)\s+([a-f\d]{24})$/i);
  if (completeTodoMatch) {
    try {
      const completed = await todos.completeTodo(completeTodoMatch[1]);
      await line.reply(event.replyToken, `บันทึกว่างานเสร็จแล้วค่ะ\n\nงาน: ${completed.title || '-'}\nID: ${completed._id}`);
    } catch (err) {
      await line.reply(event.replyToken, `ยังปิดงานไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const createTodoPayload = todos.parseCreateText(text);
  if (createTodoPayload) {
    try {
      const created = await todos.createTodo({
        ...createTodoPayload,
        lineUserId: userId
      });
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'เพิ่ม To-do',
        available: true,
        detail: [
          `${created.title || '-'}`,
          `กำหนด: ${formatTodoDueAt(created)}`,
          `ความสำคัญ: ${formatTodoPriority(created.priority)}`,
          created.notes ? `หมายเหตุ: ${created.notes}` : null,
          `ID: ${created._id}`
        ].filter(Boolean).join("\n"),
        command: 'งานวันนี้',
        actionLabel: 'ดูงานวันนี้'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'เพิ่ม To-do',
        available: false,
        detail: `ยังเพิ่ม To-do ไม่ได้ค่ะ: ${err.message}`,
        command: 'เพิ่มงาน',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const createAppointmentPayload = appointments.parseCreateText(text);
  if (createAppointmentPayload) {
    try {
      const createdItems = await appointments.createRecurringAppointments(createAppointmentPayload);
      const created = createdItems[0];
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'บันทึกนัดหมาย',
        available: true,
        detail: [
          createdItems.length > 1 ? `สร้างนัดหมายซ้ำ ${createdItems.length} ครั้งแล้วค่ะ` : `${created.title || '-'}`,
          `เวลา: ${formatBangkokDate(created.startAt)}`,
          `สถานที่: ${created.locationName || '-'}`,
          `ID: ${created._id}`
        ].join("\n"),
        command: '/นัดหมาย',
        actionLabel: 'ดูนัดหมาย'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'บันทึกนัดหมาย',
        available: false,
        detail: `ยังบันทึกนัดหมายไม่ได้ค่ะ: ${err.message}`,
        command: 'บันทึกนัดหมาย',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const copyAppointmentPayload = appointments.parseCopyText(text);
  if (copyAppointmentPayload) {
    try {
      const copied = await appointments.copyAppointment(copyAppointmentPayload.id, copyAppointmentPayload.changes);
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'คัดลอกนัดหมาย',
        available: true,
        detail: [
          `${copied.title || '-'}`,
          `เวลา: ${formatBangkokDate(copied.startAt)}`,
          `สถานที่: ${copied.locationName || '-'}`,
          `ID: ${copied._id}`
        ].join("\n"),
        command: '/นัดหมาย',
        actionLabel: 'ดูนัดหมาย'
      }));
    } catch (err) {
      await line.reply(event.replyToken, `ยังคัดลอกนัดหมายไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const pendingMode = getPendingMode(userId);
  if (pendingMode && ['image_prompt', 'image_review'].includes(pendingMode.type)) {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.reply(event.replyToken, 'ปิดฟังก์ชันสร้างภาพแล้วค่ะ ระบบจะเก็บเครดิตไว้ใช้กับงานสำคัญ เช่น คำกล่าว นัดหมาย และ To-do');
    return true;
  }

  if (pendingMode && ['disabled_image_prompt', 'disabled_image_review'].includes(pendingMode.type)) {
    const editPromptMatch = text.match(/^\/?แก้(?:ไข)?(?:พร้อมท์|prompt)\s+([\s\S]+)$/i);

    if (['สร้างเลย', 'สร้างภาพเลย', 'ตกลงสร้าง', 'ok'].includes(command)) {
      const generationPrompt = pendingMode.generationPrompt || pendingMode.prompt;

      if (!generationPrompt) {
        await line.reply(event.replyToken, 'ยังไม่มี prompt ค่ะ พิมพ์ /สร้างภาพ แล้วบอกภาพที่ต้องการก่อนนะคะ');
        return true;
      }

      const imageMessage = await ai.generateImage(generationPrompt, {
        size: '1024x1024'
      });
      pendingModes.delete(userId);
      await line.replyMessage(event.replyToken, buildImageResultMessages(imageMessage, pendingMode));
      return true;
    }

    if (editPromptMatch) {
      const prompt = await buildImagePromptFromDescription(editPromptMatch[1], pendingMode.hasSourceImage);
      pendingModes.set(userId, { ...pendingMode, type: 'image_review', ...prompt });
      await line.replyMessage(event.replyToken, buildImagePromptReviewMessage(prompt));
      return true;
    }

    if (pendingMode.type === 'image_prompt' || pendingMode.type === 'image_review') {
      const prompt = await buildImagePromptFromDescription(text, pendingMode.hasSourceImage);
      const imageMessage = await ai.generateImage(prompt.generationPrompt, {
        size: '1024x1024'
      });
      pendingModes.delete(userId);
      await line.replyMessage(event.replyToken, buildImageResultMessages(imageMessage, prompt));
      return true;
    }
  }

  if (['แบบฟอร์ม', 'ฟอร์ม', 'แยกแบบฟอร์ม'].includes(text)) {
    await line.replyMessage(event.replyToken, buildFormSelectorMessage());
    return true;
  }

  if (['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(text) || ['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(command)) {
    await line.replyMessage(event.replyToken, buildRegisterFormLinkMessage());
    return true;
  }

  if (['บันทึกนัดหมาย', 'เพิ่มนัดหมาย', 'สร้างนัดหมาย', 'นัดหมายใหม่', 'แบบฟอร์มนัดหมาย', 'ฟอร์มนัดหมาย', 'ฟอร์มนัด', 'ฟอร์มบันทึกนัดหมาย'].includes(text)) {
    await line.replyMessage(event.replyToken, buildAppointmentFormLinkMessage());
    return true;
  }

  if (['เมนูแก้ไข', 'แก้ไข', 'แก้ไขนัดหมาย', 'แก้นัดหมาย', 'แก้ไขนัดหมายทั้งหมด'].includes(text)) {
    await sendAppointmentMenu(event.replyToken, userId);
    return true;
  }

  if (['แผงนัดหมาย', 'ตารางนัดทั้งหมด', 'นัดหมายทั้งหมด'].includes(text)) {
    await line.replyMessage(
      event.replyToken,
      buildLinkMessage(
        'แผงตารางนัดหมายทั้งหมดค่ะ',
        'กดปุ่มด้านล่างเพื่อเปิดตารางนัดหมายทั้งหมด พร้อมแก้ไข บันทึก และลบ',
        'เปิดตาราง',
        getPublicUrl('/appointments-panel')
      )
    );
    return true;
  }

  if (['แปลภาษา', 'แปล'].includes(text)) {
    await line.reply(event.replyToken, buildTranslatePromptMessage());
    return true;
  }

  if (['คำถามอื่น', 'ตอบคำถาม', 'ถาม AI', 'ถามเอไอ', 'ถามอื่น', 'คุยกับ AI', 'คุยกับเอไอ'].includes(text)) {
    await line.reply(event.replyToken, buildChatPromptMessage(userId));
    return true;
  }

  if (['ดูนัดหมาย', 'ดูตารางนัดหมาย'].includes(text)) {
    await line.replyMessage(event.replyToken, buildAppointmentViewMenuMessage());
    return true;
  }

  if (['นัดหมายวันนี้', 'วันนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'today'));
    return true;
  }

  if (['นัดหมายพรุ่งนี้', 'พรุ่งนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'tomorrow'));
    return true;
  }

  if (['นัดหมายสัปดาห์นี้', 'สัปดาห์นี้', 'อาทิตย์นี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'week'));
    return true;
  }

  if (['นัดหมายเดือนนี้', 'เดือนนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'month'));
    return true;
  }

  if (['สร้างภาพ', 'วาดภาพ', 'ทำภาพ'].includes(text)) {
    await line.reply(event.replyToken, 'ปิดฟังก์ชันสร้างภาพแล้วค่ะ ระบบจะเก็บเครดิตไว้ใช้กับงานสำคัญ เช่น คำกล่าว นัดหมาย และ To-do');
    return true;
  }

  if (['สถานะ AI', 'สถานะเอไอ', 'สมอง', 'ai status'].includes(text)) {
    const status = ai.getStatus();
    await line.reply(
      event.replyToken,
      [
        "สถานะสมอง AI ค่ะ",
        `Provider: ${status.provider}`,
        `ลำดับสำรอง: ${status.providerOrder && status.providerOrder.length ? status.providerOrder.join(' > ') : '-'}`,
        `ตัวที่ตั้งค่าแล้ว: ${status.configuredProviders && status.configuredProviders.length ? status.configuredProviders.join(', ') : 'ยังไม่มี'}`,
        `แชต/แปล: ${status.textAiConfigured ? 'พร้อมใช้' : 'ยังไม่ตั้งค่า'}`,
        `สร้างภาพสำรอง: ${status.imageProviderOrder && status.imageProviderOrder.length ? status.imageProviderOrder.join(' > ') : '-'}`,
        `สร้างภาพ: ${status.imageConfigured ? 'พร้อมใช้' : 'ยังไม่พร้อม'}`
      ].join("\n")
    );
    return true;
  }

  if (['รายงาน', 'รายงานวันนี้', 'ดูรายงาน', 'ตารางวันนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildRequestedReport(userId));
    return true;
  }

  if (weatherQuestions.isWeatherQuestion(text) || (text.startsWith('/') && weatherQuestions.isWeatherQuestion(command))) {
    const answer = await weatherQuestions.answerWeatherQuestion(text.startsWith('/') ? command : text);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'คำถามอากาศ',
        available: true,
        detail: answer,
        command: '/สภาพอากาศ',
        actionLabel: 'ดูอากาศ'
      }));
    } else {
      await line.reply(event.replyToken, answer);
    }
    return true;
  }

  if (['ภาวะฉุกเฉิน', 'เร่งด่วน', 'รายงานฉุกเฉิน'].includes(text)) {
    await line.reply(event.replyToken, await buildUrgentAlertReport());
    return true;
  }

  if (['ภัยพิบัติ', 'เตือนภัย'].includes(text)) {
    await line.reply(event.replyToken, await buildUrgentAlertReport());
    return true;
  }

  if (['พายุ', 'เตือนพายุ'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['storm', 'thunderstorm', 'typhoon', 'cyclone', 'พายุ'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานพายุที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['แผ่นดินไหว', 'เตือนแผ่นดินไหว'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['earthquake', 'แผ่นดินไหว'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานแผ่นดินไหวที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['น้ำท่วม', 'เตือนน้ำท่วม'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['flood', 'flooding', 'flash_flood', 'น้ำท่วม'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานน้ำท่วมที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['สึนามิ', 'สึมามิ', 'เตือนสึนามิ', 'คลื่นสึนามิ'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['tsunami', 'tidal_wave', 'สึนามิ', 'สึมามิ', 'คลื่นสึนามิ'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานสึนามิที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (text === 'นัดหมายซ้ำ') {
    const duplicateGroups = await appointments.findPotentialDuplicates();
    await line.reply(event.replyToken, buildDuplicateMessage(duplicateGroups));
    return true;
  }

  const speechMatch = text.match(/^(?:คำกล่าว|เขียนคำกล่าว)\s+(.+)$/);
  if (speechMatch) {
    const draft = await speech.createSpeechDraft(speechMatch[1]);
    await line.reply(event.replyToken, draft);
    return true;
  }

  const translateMatch = text.match(/^\/?แปล(?:ภาษา)?\s+([\s\S]+)$/i);
  if (translateMatch) {
    try {
      const translated = await ai.translate(translateMatch[1], userId);
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'แปลภาษา',
        available: true,
        detail: translated,
        command: '/แปลภาษา',
        actionLabel: 'แปลอีก'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'แปลภาษา',
        available: false,
        detail: `ยังแปลไม่ได้ค่ะ: ${err.message}`,
        command: '/แปลภาษา',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const imageMatch = text.match(/^\/?(?:สร้างภาพ|วาดภาพ|ทำภาพ)\s+([\s\S]+)$/i);
  if (imageMatch) {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.reply(event.replyToken, 'ปิดฟังก์ชันสร้างภาพแล้วค่ะ ระบบจะเก็บเครดิตไว้ใช้กับงานสำคัญ เช่น คำกล่าว นัดหมาย และ To-do');
    return true;
  }

  const pendingId = userId && pendingAppointmentEdits.get(userId);
  const editPayload = appointments.parseEditText(text, pendingId);
  if (editPayload) {
    try {
      const updated = await appointments.updateAppointment(editPayload.id, editPayload.changes);

      if (pendingId) {
        pendingAppointmentEdits.delete(userId);
      }

      await line.reply(
        event.replyToken,
        `เรียน นายท่าน แก้ไขนัดหมายเรียบร้อยแล้วค่ะ\n\n${updated.title || '-'}\nเวลา: ${formatBangkokDate(updated.startAt)}\nสถานที่: ${updated.locationName || '-'}`
      );
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังแก้ไขนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const editTargetId = appointments.parseEditTargetText(text);
  if (editTargetId) {
    if (!userId) {
      await line.reply(event.replyToken, "เรียน นายท่าน ยังไม่พบข้อมูลผู้ใช้ จึงจำรายการที่ต้องแก้ไขไม่ได้ค่ะ");
      return true;
    }

    pendingAppointmentEdits.set(userId, editTargetId);
    const appointment = await appointments.getAppointment(editTargetId);
    await line.reply(event.replyToken, buildEditPrompt(appointment));
    return true;
  }

  const deleteId = appointments.parseDeleteText(text);
  if (deleteId) {
    try {
      await appointments.deleteAppointment(deleteId);
      await line.reply(event.replyToken, "เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ");
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const selectionCommand = appointments.parseSelectionCommand(text);
  if (selectionCommand) {
    const appointmentId = getAppointmentIdFromSelection(userId, selectionCommand.index);

    if (!appointmentId) {
      await line.reply(event.replyToken, "เรียน นายท่าน กรุณาพิมพ์ เมนูแก้ไข หรือ รายงานวันนี้ ก่อนเลือกเลขลำดับค่ะ");
      return true;
    }

    if (selectionCommand.action === 'edit') {
      pendingAppointmentEdits.set(userId, appointmentId);
      const appointment = await appointments.getAppointment(appointmentId);
      await line.reply(event.replyToken, buildEditPrompt(appointment));
      return true;
    }

    try {
      await appointments.deleteAppointment(appointmentId);
      await line.reply(event.replyToken, "เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ");
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  try {
    const aiText = await ai.chat(text, userId);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: command || 'AI',
        available: true,
        detail: aiText,
        command: '/คำถาม',
        actionLabel: 'ถามต่อ'
      }));
    } else {
      await line.reply(event.replyToken, aiText);
    }
    return true;
  } catch (err) {
    console.error("SmartLife AI error:", err);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: command || 'AI',
        available: false,
        detail: `ตอนนี้สมอง AI ยังตอบไม่ได้ค่ะ: ${err.message}`,
        command: '/คำถาม',
        actionLabel: 'ลองใหม่'
      }));
    } else {
      await line.reply(event.replyToken, `ตอนนี้สมอง AI ยังตอบไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }
}

async function handleImageMessage(event) {
  const userId = event.source && event.source.userId;
  const pendingMode = getPendingMode(userId);

  if (pendingMode && ['image_prompt', 'image_review'].includes(pendingMode.type)) {
    pendingModes.set(userId, {
      ...pendingMode,
      type: 'image_prompt',
      hasSourceImage: true
    });
    await line.reply(
      event.replyToken,
      [
        'ได้รับภาพต้นฉบับแล้วค่ะ',
        'ตอนนี้ระบบจะใช้เป็นบริบทในขั้นเขียนพร้อมท์ภาษาไทยก่อน หาก provider สร้างภาพรองรับภาพอ้างอิงจะต่อยอดได้',
        'กรุณาพิมพ์รายละเอียดภาพที่อยากให้สร้าง เช่น โทนภาพ ฉาก ข้อความบนภาพ หรือวัตถุประสงค์'
      ].join("\n")
    );
    return true;
  }

  await line.reply(event.replyToken, 'ได้รับรูปแล้วค่ะ หากต้องการสร้างภาพใหม่ ให้พิมพ์ /สร้างภาพ ก่อน แล้วส่งรูปหรือรายละเอียดภาพได้เลย');
  return true;
}

async function handleLineWebhook(req, res) {
  let event;

  try {
    event = req.body.events && req.body.events[0];
    if (!event) {
      return res.sendStatus(200);
    }

    if (event.type === 'message' && event.message && event.message.type === 'text') {
      await handleTextMessage(event);
      return res.sendStatus(200);
    }

    if (event.type === 'message' && event.message && event.message.type === 'location') {
      await handleLocationMessage(event);
      return res.sendStatus(200);
    }

    if (event.type === 'message' && event.message && event.message.type === 'image') {
      await handleImageMessage(event);
      return res.sendStatus(200);
    }

    if (event.type === 'postback') {
      const data = event.postback.data;
      const action = getPostbackAction(data);
      const appointmentId = getAppointmentIdFromData(data);
      const userId = event.source && event.source.userId;

      if (action === 'edit') {
        if (!appointmentId || !userId) {
          await line.reply(event.replyToken, "เรียน นายท่าน กรุณาเลือกนัดหมายจากเมนูแก้ไขก่อนค่ะ");
        } else {
          pendingAppointmentEdits.set(userId, appointmentId);
          const appointment = await appointments.getAppointment(appointmentId);
          await line.reply(event.replyToken, buildEditPrompt(appointment));
        }
      } else if (action === 'list_appointments') {
        await sendAppointmentMenu(event.replyToken, userId);
      } else if (action === 'delete') {
        if (!appointmentId) {
          await line.reply(event.replyToken, "เรียน นายท่าน กรุณาเลือกนัดหมายจากเมนูแก้ไขก่อนค่ะ");
        } else {
          try {
            await appointments.deleteAppointment(appointmentId);
            await line.reply(event.replyToken, "เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ");
          } catch (err) {
            await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("LINE webhook error:", err);

    const userId = event && event.source && event.source.userId;
    if (userId) {
      try {
        await line.pushMessageTo(userId, 'SmartLife received your message, but the reply card failed. Please type / again.');
      } catch (pushErr) {
        console.error("LINE webhook fallback push error:", pushErr);
      }
    }

    res.sendStatus(200);
  }
}

app.post('/webhook', handleLineWebhook);
app.post('/webhooks/line', handleLineWebhook);

if (require.main === module) {
  app.listen(port, () => console.log(`SmartLife server running on port ${port}...`));
}

module.exports = {
  app,
  buildImagePromptFromDescription,
  normalizeImageRequest
};
