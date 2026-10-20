const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const budget = require('../utils/morningBudget');
const { buildMorningDigestText } = require('../utils/line');
const { selectEssentialAlerts } = require('../utils/essentialAlerts');

const ids = ['U' + '1'.repeat(32), 'U' + '2'.repeat(32)];
const midMonth = new Date('2026-10-17T06:00:00+07:00');

test('two recipients fit the free quota when sending only a daily digest', () => {
  const plan = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 0 }, ids, new Date('2026-10-01T06:00:00+07:00'));
  assert.equal(plan.status, 'ready');
  assert.equal(plan.recipients.length, 2);
  assert.equal(plan.daysRemaining, 31);
});

test('an exhausted quota produces no push recipients', () => {
  const plan = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 300 }, ids, midMonth);
  assert.equal(plan.status, 'quota_exhausted');
  assert.equal(plan.remaining, 0);
  assert.deepEqual(plan.recipients, []);
});

test('low quota is paced and recipient rotation follows consumption', () => {
  const paced = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 290 }, ids, midMonth);
  assert.equal(paced.status, 'paced');
  const next = new Date('2026-10-18T06:00:00+07:00');
  const first = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 290 }, ids, next);
  const second = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 291 }, ids, next);
  assert.equal(first.recipients.length, 1);
  assert.equal(second.recipients.length, 1);
  assert.notEqual(first.recipients[0], second.recipients[0]);
});

test('limits use the lower of the live quota and 300, including unbounded accounts', () => {
  assert.equal(budget.planMorningMessages({ type: 'limited', value: 15000 }, { totalUsage: 0 }, ids, midMonth).limit, 300);
  assert.equal(budget.planMorningMessages({ type: 'none' }, { totalUsage: 0 }, ids, midMonth).limit, 300);
  assert.equal(budget.planMorningMessages({ type: 'limited', value: 200 }, { totalUsage: 200 }, ids, midMonth).status, 'quota_exhausted');
});

test('Bangkok date controls leap-month and month rollover', () => {
  const feb = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 0 }, ids, new Date('2028-02-28T23:00:00Z'));
  assert.equal(feb.daysRemaining, 1);
  const march = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: 0 }, ids, new Date('2028-02-29T23:00:00Z'));
  assert.equal(march.daysRemaining, 31);
});

test('selection never exceeds the remaining balance or repeats a recipient', () => {
  for (let used = 0; used <= 320; used += 7) {
    for (let day = 1; day <= 31; day += 5) {
      const plan = budget.planMorningMessages({ type: 'limited', value: 300 }, { totalUsage: used }, [...ids, ids[0]], new Date(`2026-10-${String(day).padStart(2, '0')}T06:00:00+07:00`));
      assert.ok(plan.recipients.length <= Math.max(0, 300 - used));
      assert.ok(plan.recipients.length <= ids.length);
      assert.equal(new Set(plan.recipients).size, plan.recipients.length);
    }
  }
});

test('unknown or invalid quota data fails closed without returning credentials', async () => {
  for (const data of [null, {}, { totalUsage: -1 }, { totalUsage: '3' }]) {
    const result = await budget.checkMorningBudget(ids, midMonth, {
      accessToken: 'TEST_TOKEN_DO_NOT_LOG',
      client: { get: async url => ({ data: url.endsWith('consumption') ? data : { type: 'limited', value: 300 } }) },
    });
    assert.equal(result.status, 'quota_unavailable');
    assert.deepEqual(result.recipients, []);
    assert.ok(!JSON.stringify(result).includes('TEST_TOKEN'));
  }
  const result = await budget.checkMorningBudget(ids, midMonth, {
    accessToken: 'TEST_TOKEN_DO_NOT_LOG', client: { get: async () => { throw new Error('PRIVATE_HEADER'); } },
  });
  assert.equal(result.status, 'quota_unavailable');
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});

test('quota check uses read-only LINE endpoints and bounded timeouts', async () => {
  const calls = [];
  const result = await budget.checkMorningBudget(ids, midMonth, {
    accessToken: 'TEST_ONLY',
    client: { get: async (url, settings) => {
      calls.push({ url, timeout: settings.timeout });
      return { data: url.endsWith('consumption') ? { totalUsage: 0 } : { type: 'limited', value: 300 } };
    } },
  });
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.timeout === 10000 && call.url.startsWith('https://api.line.me/')));
});

test('a no-recipient run avoids external quota calls entirely', async () => {
  let calls = 0;
  const result = await budget.checkMorningBudget([], midMonth, { client: { get: () => { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(result.status, 'no_recipients');
});

test('deferred runs check the next Bangkok day or back off for 15 minutes', () => {
  assert.equal(budget.nextBudgetCheck('quota_exhausted', midMonth).toISOString(), '2026-10-17T17:00:00.000Z');
  assert.equal(budget.nextBudgetCheck('quota_unavailable', midMonth).getTime() - midMonth.getTime(), 900000);
});

test('compact digest contains essentials, prioritizes important tasks and stays one text', () => {
  const events = Array.from({ length: 7 }, (_, i) => ({ start: '09.00', summary: `นัด ${i + 1}` }));
  const text = buildMorningDigestText({ tempMax: 32, rainChance: 60, pm25: 20, source: 'TEST WEATHER', observedAt: midMonth }, events, {
    today: [{ title: 'งานทั่วไป' }, { title: 'งานสำคัญ', priority: 'high' }],
  }, midMonth);
  assert.ok(text.includes('SmartLife เช้า 2026-10-17'));
  assert.ok(text.includes('สูงสุด 32°C'));
  assert.ok(text.includes('อีก 4 นัดหมาย'));
  assert.ok(text.indexOf('งานสำคัญ') < text.indexOf('งานทั่วไป'));
  assert.ok(text.includes('ต้องทำ:'));
  assert.ok(!text.includes('จะลงบันทึก'));
  assert.ok(text.length < 4500);
  assert.ok(!text.includes('ดัชนีความร้อน'));
});

test('compact digest does not invent missing weather or appointments', () => {
  const text = buildMorningDigestText({ source: 'fallback' }, [], {}, midMonth);
  assert.ok(text.includes('ยังดึงข้อมูลไม่ได้'));
  assert.ok(!text.includes('ต้องทำ:'));
  assert.ok(!text.includes('เตือนภัยสำคัญ:'));
  assert.ok(!text.includes('0°C'));
  assert.ok(!text.includes('ที่มา: fallback'));
  const unknownDate = buildMorningDigestText({ tempMax: 30, source: 'TEST SOURCE', observedAt: null }, [], {}, midMonth);
  assert.ok(!unknownDate.includes('2513'));
  assert.ok(!unknownDate.includes('1970'));
});

test('compact greeting makes exactly one push containing one text and no cards', async () => {
  const axios = require('axios');
  const config = require('../config');
  const line = require('../utils/line');
  const originalPost = axios.post;
  const originalToken = config.lineAccessToken;
  const calls = [];
  config.lineAccessToken = 'TEST_ONLY';
  axios.post = async (url, payload) => { calls.push({ url, payload }); return { status: 200 }; };
  try {
    await line.sendMorningGreeting({}, [], {}, ids[0], {
      compact: true, includeAppointmentCards: true, reportDate: midMonth,
      retryKey: line.createRetryKey('morning-report', '2026-10-17', ids[0]),
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.messages.length, 1);
    assert.equal(calls[0].payload.messages[0].type, 'text');
  } finally {
    axios.post = originalPost;
    config.lineAccessToken = originalToken;
  }
});

// Isolated cron harness: no real timers, MongoDB, LINE pushes or weather requests.
function loadCron(mode = 'morning-only', plan = { status: 'ready', recipients: ids }, options = {}) {
  const filename = path.resolve(__dirname, '../cron.js');
  const localRequire = createRequire(filename);
  const state = { jobs: [], timers: [], sends: [], budgetCalls: 0, claims: [], run: null };
  const collection = {
    findOne: async () => state.run?.status === 'success' ? state.run : null,
    findOneAndUpdate: async (query, update) => {
      state.claims.push(query);
      const time = update.$set.updatedAt;
      if (state.run?.nextAttemptAt > time || state.run?.status === 'running') throw Object.assign(new Error('Duplicate'), { code: 11000 });
      state.run = { _id: query._id, ...update.$set };
      return state.run;
    },
    updateOne: async (_query, update) => { Object.assign(state.run, update.$set); },
  };
  const overrides = {
    dotenv: { config() {} },
    'node-cron': { schedule: (expression, callback, options) => state.jobs.push({ expression, callback, options }) },
    mongoose: { connection: { readyState: 1, collection: () => collection } },
    './config': { notificationMode: mode },
    './utils/morningBudget': { ...budget, checkMorningBudget: async () => { state.budgetCalls++; return plan; } },
    './utils/lineRecipient': { listActiveLineRecipients: async () => ids,
      getLineRecipient: async () => ({}), matchesAlertPreferences: () => true },
    './utils/line': {
      createRetryKey: (...parts) => parts.join(':'),
      sendMorningGreeting: async (...args) => state.sends.push(args),
      pushMessage: async () => { throw new Error('Unexpected extra push'); },
    },
    './utils/weather': { getReport: async () => { if(options.weatherError)throw options.weatherError;return { tempMax: 30, pm25: null, rainChance: null, temp: null }; } },
    './utils/appointments': { getToday: async () => [] },
    './utils/todos': {
      getToday: async date => { state.todoTodayQueryDate = date; return options.todayTodos || []; },
      getOverdue: async () => options.overdueTodos || [],
    },
    './utils/alerts': { listActiveUrgentAlerts: async () => [],
      listUnsentUrgentAlerts: async () => { throw new Error('Unexpected alert push'); } },
    './utils/liveDisasters': { fetchLiveDisasterAlertCandidates: async () => [] },
    './utils/thaiSafetyAlerts': { fetchThaiOfficialSafetyAlertCandidates: async () => [] },
    './utils/earthquakeWarnings': { syncEarthquakeWarnings: async () => [] },
  };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: name => Object.hasOwn(overrides, name) ? overrides[name] : localRequire(name),
    module: mod, exports: mod.exports, Date, console,
    setTimeout: (callback, delay) => state.timers.push({ callback, delay }),
  }, { filename });
  return { cron: mod.exports, state };
}

test('morning-only registers 06:00, catch-up and data refresh without bedtime pushes', () => {
  const { state } = loadCron();
  assert.deepEqual(state.jobs.map(j => j.expression), ['0 6 * * *', '* * * * *']);
  assert.ok(state.jobs.every(j => j.options.timezone === 'Asia/Bangkok'));
  assert.deepEqual(state.timers.map(t => t.delay), [15000, 5000]);
});

test('all mode preserves the opt-in legacy scheduler registrations', () => {
  const { state } = loadCron('all');
  assert.ok(state.jobs.some(j => j.expression === '30 21 * * *'));
  assert.ok(state.timers.some(t => t.delay === 5000));
});

test('successful digest goes only to budget-selected recipients once per day', async () => {
  const { cron, state } = loadCron('morning-only', { status: 'reduced', recipients: [ids[1]] });
  assert.equal(await cron.sendDailyMorningReport(midMonth), true);
  assert.equal(await cron.sendDailyMorningReport(midMonth), false);
  assert.equal(state.sends.length, 1);
  assert.equal(state.sends[0][3], ids[1]);
  assert.equal(state.sends[0][4].compact, true);
  assert.equal(state.todoTodayQueryDate.toISOString(), '2026-10-16T17:00:00.000Z');
  assert.equal(state.run.status, 'success');
});

test('morning digest includes overdue work without extra pushes', async () => {
  const { cron, state } = loadCron('morning-only', { status: 'ready', recipients: [ids[0]] }, {
    overdueTodos: [{ title: 'งานค้างสำคัญ', priority: 'high' }],
  });
  assert.equal(await cron.sendDailyMorningReport(midMonth), true);
  assert.equal(state.sends.length, 1);
  const text = buildMorningDigestText({}, [], state.sends[0][2], midMonth);
  assert.ok(text.includes('งานค้าง: งานค้างสำคัญ'));
});

test('quota exhaustion defers instead of sending or retrying every minute', async () => {
  const { cron, state } = loadCron('morning-only', { status: 'quota_exhausted', recipients: [] });
  assert.equal(await cron.sendDailyMorningReport(midMonth), false);
  assert.equal(state.run.status, 'deferred');
  assert.equal(state.run.reasonCode, 'quota_exhausted');
  assert.equal(await cron.sendDailyMorningReport(new Date(midMonth.getTime() + 60000)), false);
  assert.equal(state.budgetCalls, 1);
  assert.equal(state.sends.length, 0);
  assert.ok(JSON.stringify(state.claims[0]).includes('nextAttemptAt'));
});

test('unavailable quota is retried after backoff without a push', async () => {
  const { cron, state } = loadCron('morning-only', { status: 'quota_unavailable', recipients: [] });
  await cron.sendDailyMorningReport(midMonth);
  await cron.sendDailyMorningReport(new Date(midMonth.getTime() + 60000));
  assert.equal(state.budgetCalls, 1);
  await cron.sendDailyMorningReport(new Date(midMonth.getTime() + 900000));
  assert.equal(state.budgetCalls, 2);
  assert.equal(state.sends.length, 0);
});

test('extra automatic push entry points are disabled in morning-only mode', async () => {
  const { cron, state } = loadCron();
  await cron.sendBedtimeTodoPrompt(midMonth);
  await cron.sendMorningActiveAlerts(ids);
  await cron.sendDueAppointmentReminders();
  await cron.sendDueTodoReminders();
  await cron.sendUrgentAlerts();
  assert.equal(state.sends.length, 0);
  assert.equal(state.run, null);
});

test('catch-up refuses times before 06:01 and from noon onward', async () => {
  const { cron, state } = loadCron();
  for (const clock of ['05:59', '06:00', '12:00', '20:00']) {
    assert.equal(await cron.sendMissedMorningReportIfNeeded(new Date(`2026-10-17T${clock}:00+07:00`)), false);
  }
  assert.equal(state.sends.length, 0);
  assert.equal(await cron.sendMissedMorningReportIfNeeded(new Date('2026-10-17T06:01:00+07:00')), true);
});

test('essential alerts exclude watch, inactive, unrelated and opted-out records', () => {
  const selected = selectEssentialAlerts([
    { type: 'earthquake', severity: 'watch', title: 'watch' },
    { type: 'storm', severity: 'warning', active: false, title: 'expired' },
    { type: 'air_quality', severity: 'warning', title: 'other type' },
    { type: 'storm', severity: 'warning', title: 'opted out' },
    { type: 'severe_accident', severity: 'warning', title: 'TEST NEWS', category: 'ข่าวเฝ้าระวังจากเว็บไซต์หน่วยงานราชการ' },
    { type: 'earthquake', severity: 'critical', title: 'TEST IMPORTANT' },
  ], alert => alert.title !== 'opted out');
  assert.deepEqual(selected.map(item => item.title), ['TEST IMPORTANT', 'TEST NEWS']);
  assert.equal(selected[1].isIndexedNews, true);
  const text = buildMorningDigestText({}, [], {}, midMonth, selected);
  assert.ok(text.includes('แผ่นดินไหว: TEST IMPORTANT'));
  assert.ok(text.includes('ข่าวเฝ้าระวัง: TEST NEWS'));
});

test('essential alert summary is limited to three and remains in a single compact text', () => {
  const selected = selectEssentialAlerts(Array.from({ length: 8 }, (_, i) => ({
    type: 'storm', severity: 'warning', title: `TEST NOTICE ${i}`, source: 'TEST SOURCE',
  })));
  assert.equal(selected.length, 3);
  const text = buildMorningDigestText({}, [], {}, midMonth, selected);
  assert.ok(text.includes('เตือนภัยสำคัญ:'));
  assert.ok(text.includes('พายุ/ฝนรุนแรง:'));
  assert.ok(!text.includes('TEST NOTICE 3'));
  assert.ok(text.length < 4500);
});

test('background data refresh does not send notifications in morning-only mode', async () => {
  const { state } = loadCron();
  await state.timers.find(timer => timer.delay === 5000).callback();
  assert.equal(state.sends.length, 0);
});

test('morning weather failure preserves unknown rain and observation time', async () => {
  const { cron, state } = loadCron('morning-only', { status: 'ready', recipients: [ids[0]] },
    { weatherError: Object.assign(new Error('TEST_SECRET'), { code: 'WEATHER_UNAVAILABLE' }) });
  await cron.sendDailyMorningReport(midMonth);
  const weather = state.sends[0][0];
  assert.equal(weather.tempMax, null);
  assert.equal(weather.rainMm1h, null);
  assert.equal(weather.observedAt, null);
  assert.match(weather.healthAdvice, /ยังไม่มีข้อมูลอากาศเพียงพอ/);
  assert.ok(!JSON.stringify(weather).includes('TEST_SECRET'));
});
