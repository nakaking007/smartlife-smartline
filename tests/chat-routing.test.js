const test = require('node:test');
const assert = require('node:assert/strict');
const weatherQuestions = require('../utils/weatherQuestions');
const ai = require('../utils/ai');
const config = require('../config');
const axios = require('axios');

test('Thai and English weather phrasing reaches the weather path', () => {
  for (const question of ['อากาศวันนี้เป็นอย่างไร', 'พยากรณ์อากาศ', 'weather today']) {
    assert.equal(weatherQuestions.isWeatherQuestion(question), true);
  }
  assert.equal(weatherQuestions.isWeatherQuestion('ช่วยเขียนจดหมาย'), false);
});

test('missing rain and pollution fields remain unknown and still produce a response', async () => {
  const report = {
    temp: 29, tempMax: 33, rainMm1h: null, rainChance: null, pm25: null,
    source: 'TEST WEATHER', observedAt: new Date('2026-10-20T00:00:00Z')
  };
  const response = await weatherQuestions.answerWeatherQuestion('อากาศวันนี้ ฝน ฝุ่น ร้อน หนาว', async () => report);
  assert.match(response, /TEST WEATHER/);
  assert.match(response, /ยังไม่มีข้อมูลปริมาณฝน/);
  assert.match(response, /ยังไม่มีข้อมูล/);
  assert.doesNotMatch(response, /ฝนล่าสุด: ยังไม่พบฝน/);
  assert.doesNotMatch(response, /undefined|null/);
});

test('weather errors do not expose provider diagnostics to LINE', async () => {
  const response = await weatherQuestions.answerWeatherQuestion('อากาศ', async () => { throw new Error('SECRET_KEY'); });
  assert.match(response, /ยังดึงข้อมูลอากาศจริงไม่ได้/);
  assert.doesNotMatch(response, /SECRET_KEY/);
});

test('general chat uses configured AI and does not claim an unauthenticated fallback', () => {
  const original = { aiProvider: config.aiProvider, geminiApiKey: config.geminiApiKey, pollinationsApiKey: config.pollinationsApiKey };
  try {
    config.aiProvider = 'auto';
    config.geminiApiKey = 'TEST_KEY';
    config.pollinationsApiKey = '';
    assert.equal(ai.isTextAiConfigured(), true);
    assert.deepEqual(ai.getConfiguredProviderOrder(), ['gemini']);
    config.geminiApiKey = '';
    assert.equal(ai.isTextAiConfigured(), false);
  } finally {
    Object.assign(config, original);
  }
});

test('Google grounding is opt-in for current facts and includes returned source links', async () => {
  const original = {
    aiProvider: config.aiProvider,
    geminiApiKey: config.geminiApiKey,
    geminiGoogleSearchEnabled: config.geminiGoogleSearchEnabled,
    post: axios.post
  };
  const requests = [];
  try {
    config.aiProvider = 'gemini';
    config.geminiApiKey = 'TEST_KEY';
    axios.post = async (_url, body) => {
      requests.push(body);
      return { data: { candidates: [{
        content: { parts: [{ text: 'คำตอบทดสอบ' }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source', title: 'แหล่งทดสอบ' } }] }
      }] } };
    };
    config.geminiGoogleSearchEnabled = false;
    assert.equal(await ai.generateText('ข่าวล่าสุด'), 'คำตอบทดสอบ');
    assert.equal(requests[0].tools, undefined);
    config.geminiGoogleSearchEnabled = true;
    const grounded = await ai.generateText('ข่าวล่าสุด');
    assert.deepEqual(requests[1].tools, [{ google_search: {} }]);
    assert.match(grounded, /https:\/\/example\.com\/source/);
    await ai.generateText('ช่วยเขียนกลอน');
    assert.equal(requests[2].tools, undefined);
  } finally {
    config.aiProvider = original.aiProvider;
    config.geminiApiKey = original.geminiApiKey;
    config.geminiGoogleSearchEnabled = original.geminiGoogleSearchEnabled;
    axios.post = original.post;
  }
});
