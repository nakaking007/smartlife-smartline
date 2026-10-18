const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { selectEssentialAlerts } = require('../utils/essentialAlerts');

// Synthetic test inputs stay in this process; no database or LINE calls.
const now = new Date('2026-10-18T08:30:00Z');
const record = { news_id: 123, news_type_name: 'ภัยทางถนน', news_title: 'TEST INCIDENT',
  news_date: '2026-10-18 12:00:00', province_name: 'ชุมพร', is_publish: 1, is_deleted: 0 };
const response = records => ({ data: { status: 'success', data: { data: { data: records } } } });
function loadService(handler) {
  const calls = [];
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../utils/thaiSafetyAlerts.js'), 'utf8'), {
    module: mod, exports: mod.exports, Date, URL, Map, Set, console: { warn() {} },
    require(name) {
      if (name === 'axios') return { get: async (url, options) => {
        calls.push({ url, options });
        return handler(url, options);
      } };
      return require(name);
    },
  });
  return { service: mod.exports, calls };
}

test('DDPM uses its stable news id, Bangkok event time and province without copying personal details', () => {
  const { service } = loadService();
  const item = service.ddpmRecordToCandidate({ ...record, id: 46, news_detail: 'TEST PRIVATE DETAILS' }, now);
  assert.equal(item.externalId, 'ddpm-news:123');
  assert.equal(item.sourceUrl, 'https://dpmreporter.disaster.go.th/portal/disaster-news/123');
  assert.equal(item.startsAt.toISOString(), '2026-10-18T05:00:00.000Z');
  assert.equal(item.timeKind, 'reported_event');
  assert.equal(item.areaVerified, true);
  assert.equal(item.areaText, 'ชุมพร');
  assert.equal(item.severity, 'watch');
  assert.ok(!JSON.stringify(item).includes('TEST PRIVATE DETAILS'));
});

test('DDPM rejects stale, future, invalid-date, unpublished, deleted and unsafe-id records', () => {
  const { service } = loadService();
  for (const change of [{ news_date: '2026-10-17 15:30:00' }, { news_date: '2026-10-18 16:00:00' },
    { news_date: '2026-02-30 10:00:00' }, { news_date: 'invalid' }, { is_publish: 0 },
    { is_deleted: 1 }, { is_deleted: undefined }, { news_id: '../bad' }, { news_id: 0 }]) {
    assert.equal(service.ddpmRecordToCandidate({ ...record, ...change }, now), null);
  }
});

test('official categories filter unrelated news and training without promoting headlines to warnings', () => {
  const { service } = loadService();
  for (const change of [{ news_type_name: 'ข่าวประชาสัมพันธ์' }, { news_title: 'ฝึกซ้อมแผนอัคคีภัย' },
    { news_title: 'ประชุมป้องกันอุบัติภัย' }, { news_title: '' }]) {
    assert.equal(service.ddpmRecordToCandidate({ ...record, ...change }, now), null);
  }
  const item = service.ddpmRecordToCandidate({ ...record, news_type_name: 'อัคคีภัย', news_title: 'TEST ไฟไหม้ร้ายแรง' }, now);
  assert.equal(item.severity, 'watch');
  // Even a wrongly elevated news row must not become an essential morning warning.
  assert.equal(selectEssentialAlerts([{ ...item, severity: 'warning' }]).length, 0);
});

test('primary source succeeds, deduplicates and coalesces requests without calling GDELT', async () => {
  const { service, calls } = loadService(() => response([record, record]));
  const [first, second] = await Promise.all([service.fetchOfficialNewsCandidates(now), service.fetchOfficialNewsCandidates(now)]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  await service.fetchOfficialNewsCandidates(new Date(now.getTime() + 60000));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.params.page_size, 20);
  const status = service.getOfficialNewsStatus(now).find(x => x.id === 'ddpm');
  assert.equal(status.state, 'available');
  assert.equal(status.checkedAt, now.toISOString());
});

test('successful empty primary list is available and does not trigger unnecessary fallback', async () => {
  const { service, calls } = loadService(() => response([]));
  assert.equal((await service.fetchOfficialNewsCandidates(now)).length, 0);
  assert.equal(calls.length, 1);
  assert.equal(service.getOfficialNewsStatus(now).find(x => x.id === 'ddpm').state, 'available');
});

test('invalid primary format uses official-only indexed fallback and reports source failure safely', async () => {
  const { service, calls } = loadService(url => url.includes('gdelt') ? { data: { articles: [
    { title: 'TEST ไฟไหม้', url: 'https://www.prd.go.th/test', seendate: '20261018T080000Z' },
    { title: 'TEST ไฟไหม้', url: 'https://evil.example/test', seendate: '20261018T080000Z' },
  ] } } : { data: '<html>Unexpected response with TEST_SECRET</html>' });
  const items = await service.fetchOfficialNewsCandidates(now);
  assert.equal(items.length, 1);
  assert.equal(items[0].timeKind, 'indexed_at');
  assert.equal(items[0].severity, 'watch');
  assert.equal(calls.length, 2);
  const status = service.getOfficialNewsStatus(now);
  assert.equal(status.find(x => x.id === 'ddpm').code, 'INVALID_NEWS_FORMAT');
  assert.equal(status.find(x => x.id === 'gdelt').state, 'available');
  assert.ok(!JSON.stringify(status).includes('TEST_SECRET'));
});

test('HTTP 429 honors Retry-After and does not retry primary during the cooldown', async () => {
  const { service, calls } = loadService(url => {
    if (url.includes('gdelt')) return { data: { articles: [] } };
    throw { response: { status: 429, headers: { 'retry-after': '3600' } } };
  });
  await service.fetchOfficialNewsCandidates(now);
  await service.fetchOfficialNewsCandidates(new Date(now.getTime() + 20 * 60000));
  assert.equal(calls.filter(x => x.url.includes('dpmreporter')).length, 1);
  const status = service.getOfficialNewsStatus(now).find(x => x.id === 'ddpm');
  assert.equal(status.code, 'RATE_LIMITED');
  assert.equal(status.nextAttemptAt, new Date(now.getTime() + 3600000).toISOString());
  await service.fetchOfficialNewsCandidates(new Date(now.getTime() + 3600000));
  assert.equal(calls.filter(x => x.url.includes('dpmreporter')).length, 2);
});

test('expired cache and failed refresh never return stale incidents or false success', async () => {
  let offline = false;
  const { service } = loadService(() => {
    if (offline) throw new Error('TEST_SECRET');
    return response([record]);
  });
  await service.fetchOfficialNewsCandidates(now);
  const later = new Date(now.getTime() + 16 * 60000);
  assert.equal(service.getOfficialNewsStatus(later).find(x => x.id === 'ddpm').state, 'stale');
  offline = true;
  await assert.rejects(service.fetchOfficialNewsCandidates(later), { code: 'FETCH_FAILED' });
  assert.equal(service.getOfficialNewsStatus(later).find(x => x.id === 'ddpm').state, 'unavailable');
});

test('New Year poll includes previous year once to retain incidents in the last 24 hours', async () => {
  const { service, calls } = loadService(() => response([]));
  await service.fetchOfficialNewsCandidates(new Date('2027-01-01T00:00:00+07:00'));
  assert.deepEqual(calls.map(x => x.options.params.date_start), ['2027', '2026']);
});

test('invalid indexed-news responses and impossible dates cannot look like successful coverage', async () => {
  const { service } = loadService(() => ({ data: 'Rate limit exceeded' }));
  await assert.rejects(service.fetchOfficialNewsCandidates(now), { code: 'INVALID_NEWS_FORMAT' });
  assert.equal(service.getOfficialNewsStatus(now).every(x => x.state === 'unavailable'), true);
  assert.equal(service.parseGdeltDate('20260230T080000Z'), null);
  assert.equal(service.parseGdeltDate('20261018T080000Zgarbage'), null);
});
