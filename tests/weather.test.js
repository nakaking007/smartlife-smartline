const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assessment = require('../utils/riskAssessment');

const fixedNow = Date.parse('2026-10-17T11:00:00Z');
function meteo() {
  const times = Array.from({ length: 25 }, (_, i) => new Date(fixedNow + i * 3600000).toISOString());
  return {
    current: { time: times[0], temperature_2m: 30, relative_humidity_2m: 70, rain: 0.1, wind_speed_10m: 10 },
    hourly: { time: times, temperature_2m: times.map(() => 31), rain: times.map(() => 1),
      precipitation_probability: times.map(() => 60), wind_speed_10m: times.map(() => 10) },
  };
}
function met() {
  return { properties: { timeseries: [{ time: new Date(fixedNow).toISOString(), data: {
    instant: { details: { air_temperature: 29, relative_humidity: 70, wind_speed: 2 } },
    next_12_hours: { details: { probability_of_precipitation: 65 } },
  } }] } };
}
function loadService(handler, weatherApiKey, responseHeaders = {}) {
  const calls = [];
  let clock = fixedNow;
  class Clock extends Date {
    constructor(value) { super(value === undefined ? clock : value); }
    static now() { return clock; }
  }
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../utils/weather.js'), 'utf8');
  vm.runInNewContext(source, {
    module: mod, exports: mod.exports, URLSearchParams, AbortSignal, Date: Clock,
    console: { warn() {} },
    require(name) {
      if (name === 'axios') return { get: async (url, options) => {
        calls.push({ url, options });
        return { data: await handler(url, options), headers: responseHeaders };
      } };
      if (name === '../config') return { weatherApiKey };
      if (name === './riskAssessment') return assessment;
      throw new Error('Unexpected dependency');
    },
  });
  return { service: mod.exports, calls, advance: ms => { clock += ms; } };
}
function unavailable() { throw Object.assign(new Error('DO_NOT_LOG_API_KEY'), { code: 'ECONNRESET' }); }

test('Open-Meteo returns real numeric fields and sums three forecast hours correctly', async () => {
  const { service } = loadService(url => url.includes('air-quality') ? { current: { pm2_5: 12 } } : meteo());
  const report = await service.getReport();
  assert.equal(report.temp, 30);
  assert.equal(report.pm25, 12);
  assert.equal(report.nextRainMm3h, 3);
  assert.equal(report.rainMm1h, 1);
  assert.equal(report.dataKind, 'forecast_model');
});

test('weather remains available when air quality alone is unavailable', async () => {
  const { service } = loadService(url => url.includes('air-quality') ? unavailable() : meteo());
  const report = await service.getReport();
  assert.equal(report.temp, 30);
  assert.equal(report.pm25, null);
  assert.equal(report.pm25Assessment, null);
});

test('MET Norway is used when the first two providers fail', async () => {
  const { service, calls } = loadService(url => url.includes('api.met.no') ? met() : unavailable(), 'TEST_KEY');
  const report = await service.getReport({ latitude: 13.1234567, longitude: 100.7654321 });
  assert.equal(report.temp, 29);
  assert.equal(report.windSpeedKph, 7.2);
  assert.equal(report.pm25, null);
  assert.equal(report.rainMm1h, null);
  assert.equal(report.rainAmountAssessment, null);
  assert.ok(report.source.includes('MET Norway'));
  const request = calls.find(call => call.url.includes('api.met.no'));
  assert.ok(request.options.headers['User-Agent'].includes('SmartLife'));
  assert.ok(request.url.includes('lat=13.1235&lon=100.7654'));
  assert.equal(report.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
});

test('missing probability, pollution and humidity stay unknown instead of zero', async () => {
  const payload = meteo();
  payload.current.relative_humidity_2m = null;
  payload.hourly.precipitation_probability.fill(null);
  const { service } = loadService(url => url.includes('air-quality') ? { current: { pm2_5: null } } : payload);
  const report = await service.getReport();
  assert.equal(report.rainChance, null);
  assert.equal(report.pm25, null);
  assert.equal(report.humidity, null);
  assert.equal(report.heatIndex, null);
});

test('same coordinates share an in-flight request and cached data without sharing location names', async () => {
  const { service, calls } = loadService(url => url.includes('air-quality') ? { current: { pm2_5: 12 } } : meteo());
  const [a, b] = await Promise.all([
    service.getReport({ latitude: 13, longitude: 100, name: 'TEST LOCATION A' }),
    service.getReport({ latitude: 13, longitude: 100, name: 'TEST LOCATION B' }),
  ]);
  const c = await service.getReport({ latitude: 13, longitude: 100, name: 'TEST LOCATION C' });
  assert.equal(calls.length, 2);
  assert.equal(a.locationName, 'TEST LOCATION A');
  assert.equal(b.locationName, 'TEST LOCATION B');
  assert.equal(c.locationName, 'TEST LOCATION C');
});

test('expired cache is refreshed and is not served silently after total source failure', async () => {
  let failed = false;
  const { service, advance } = loadService(url => {
    if (failed) return unavailable();
    return url.includes('air-quality') ? { current: { pm2_5: 12 } } : meteo();
  });
  await service.getReport();
  advance(10 * 60 * 1000 + 1);
  failed = true;
  await assert.rejects(service.getReport(), error => error.code === 'WEATHER_UNAVAILABLE');
});

test('all-source failure exposes only safe source codes and no key-bearing errors', async () => {
  const { service } = loadService(unavailable, 'TEST_SECRET_KEY');
  await assert.rejects(service.getReport(), error => {
    assert.equal(error.code, 'WEATHER_UNAVAILABLE');
    assert.equal(error.attempts.length, 3);
    assert.ok(!JSON.stringify(error).includes('TEST_SECRET_KEY'));
    assert.ok(!error.message.includes('DO_NOT_LOG'));
    return true;
  });
});

test('invalid forecast bodies do not become fabricated observations', async () => {
  const { service } = loadService(() => ({ current: { temperature_2m: null } }));
  await assert.rejects(service.getReport(), error => error.code === 'WEATHER_UNAVAILABLE');
});

test('MET Norway Expires is respected instead of polling before the allowed time', async () => {
  const { service, advance, calls } = loadService(url => url.includes('api.met.no') ? met() : unavailable(), undefined,
    { expires: new Date(fixedNow + 3600000).toUTCString() });
  await service.getReport();
  const count = calls.length;
  advance(11 * 60 * 1000);
  await service.getReport();
  assert.equal(calls.length, count);
});
