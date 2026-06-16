const assert = require('assert');
const Appointment = require('../models/Appointment');
const time = require('../utils/time');
const appointments = require('../utils/appointments');
const todos = require('../utils/todos');
const alerts = require('../utils/alerts');
const ai = require('../utils/ai');
const manual = require('../utils/manual');
const riskAssessment = require('../utils/riskAssessment');
const liveDisasters = require('../utils/liveDisasters');
const freeServices = require('../utils/freeServices');
const knowledge = require('../utils/knowledge');
const scamCheck = require('../utils/scamCheck');
const weather = require('../utils/weather');
const line = require('../utils/line');
const earthquakeWarnings = require('../utils/earthquakeWarnings');
const axios = require('axios');

function assertIncludes(value, expected) {
  assert(
    String(value).includes(expected),
    `Expected "${value}" to include "${expected}"`
  );
}

function assertNoPanicWords(message) {
  assert.strictEqual(
    /หลบภัย|อพยพ|หนี|ตื่นตระหนก|ระมัดระวัง/.test(message),
    false,
    `Alert should not contain panic/action words:\n${message}`
  );
}

async function testThailandTime() {
  const nineAm = time.parseBangkokDate('2026-05-28 09.00 น.');
  assert.strictEqual(nineAm.toISOString(), '2026-05-28T02:00:00.000Z');
  assertIncludes(time.formatBangkokDateTime(nineAm), '09.00 น.');

  const isoWithZ = time.parseBangkokDate('2026-05-28T09:00:00Z');
  assert.strictEqual(isoWithZ.toISOString(), '2026-05-28T02:00:00.000Z');

  const midnight = time.parseBangkokDate('28/05/2569 : 24.00 น.');
  assert.strictEqual(time.formatBangkokTime(midnight), '00.00 น.');
  assertIncludes(time.formatBangkokDateTime(midnight), '29 พ.ค. 2569');
}

function testAppointmentParsingAndDuplicateKey() {
  const id = '6a0fe46ad16ce9833c650bd0';
  assert.strictEqual(appointments.parseDeleteText(`ลบนัดหมาย ${id}`), id);
  assert.deepStrictEqual(appointments.parseSelectionCommand('ลบนัดหมาย 1'), { action: 'delete', index: 1 });
  assert.deepStrictEqual(appointments.parseSelectionCommand('แก้นัดหมาย 2'), { action: 'edit', index: 2 });
  assert.deepStrictEqual(appointments.parseCreateText('บันทึกนัดหมาย | ประชุมทีม | 28-05-2569 : 15.00 น. | ห้องประชุม | ชุดสุภาพ'), {
    title: 'ประชุมทีม',
    startAt: '28-05-2569 : 15.00 น.',
    locationName: 'ห้องประชุม',
    dressCode: 'ชุดสุภาพ',
    preparation: ''
  });

  const firstKey = appointments.getDuplicateKey({
    title: 'ประชุม ทีม',
    startAt: time.parseBangkokDate('2026-05-28 09.00 น.')
  });
  const secondKey = appointments.getDuplicateKey({
    title: 'ประชุม   ทีม',
    startAt: time.parseBangkokDate('2026-05-28T09:00:00Z')
  });
  assert.strictEqual(firstKey, secondKey);
}

async function testReminderSelectionDoesNotSpam() {
  const originalFind = Appointment.find;
  const now = time.parseBangkokDate('2026-05-28 09.40 น.');
  const appointment = {
    _id: '6a0fe46ad16ce9833c650bd0',
    title: 'ประชุมทีม',
    startAt: time.parseBangkokDate('2026-05-28 10.00 น.'),
    reminders: [],
    status: 'scheduled'
  };

  Appointment.find = () => ({
    sort: () => ({
      limit: async () => [appointment]
    })
  });

  try {
    const due = await appointments.findDueReminders(now);
    assert.strictEqual(due.length, 1);
    assert.strictEqual(due[0].reminders.length, 1);
    assert.strictEqual(due[0].reminders[0].minutesBefore, 60);

    assert.deepStrictEqual(
      appointment.reminders.map(reminder => reminder.minutesBefore).sort((a, b) => b - a),
      [1440, 180, 60]
    );

    const staleReminders = appointment.reminders.filter(reminder => reminder.minutesBefore !== 60);
    assert(staleReminders.length > 0, 'Expected stale reminders to be present');
    staleReminders.forEach(reminder => {
      assert.strictEqual(reminder.sentAt, now);
    });
  } finally {
    Appointment.find = originalFind;
  }
}

async function testDuplicateUpdateRejected() {
  const originalFindById = Appointment.findById;
  const originalFind = Appointment.find;
  const id = '6a0fe46ad16ce9833c650bd0';
  const appointment = {
    _id: id,
    title: 'นัดเดิม',
    startAt: time.parseBangkokDate('2026-05-28 08.00 น.'),
    reminders: [],
    status: 'scheduled',
    save: async () => appointment
  };
  const duplicate = {
    _id: '6a0fe46ad16ce9833c650bd1',
    title: 'ประชุม ทีม',
    startAt: time.parseBangkokDate('2026-05-28 09.00 น.'),
    status: 'scheduled'
  };

  Appointment.findById = async () => appointment;
  Appointment.find = () => ({
    limit: async () => [duplicate]
  });

  try {
    await assert.rejects(
      () => appointments.updateAppointment(id, {
        title: 'ประชุม   ทีม',
        startAt: '2026-05-28 09.00 น.'
      }),
      /Duplicate appointment/
    );
  } finally {
    Appointment.findById = originalFindById;
    Appointment.find = originalFind;
  }
}

async function testTimeOnlyEditUsesBangkokTime() {
  const originalFindById = Appointment.findById;
  const originalFind = Appointment.find;
  const id = '6a0fe46ad16ce9833c650bd0';
  const appointment = {
    _id: id,
    title: 'นัดเดิม',
    startAt: time.parseBangkokDate('2026-05-28 22.00 น.'),
    reminders: [],
    status: 'scheduled',
    save: async () => appointment
  };

  Appointment.findById = async () => appointment;
  Appointment.find = () => ({
    limit: async () => []
  });

  try {
    const payload = appointments.parseEditText('15.00 น.', id);
    assert.deepStrictEqual(payload, { id, changes: { startTime: '15.00 น.' } });

    const updated = await appointments.updateAppointment(id, payload.changes);
    assert.strictEqual(time.formatBangkokTime(updated.startAt), '15.00 น.');
    assert.strictEqual(updated.startAt.toISOString(), '2026-05-28T08:00:00.000Z');
  } finally {
    Appointment.findById = originalFindById;
    Appointment.find = originalFind;
  }
}

function testAlertFormatting() {
  const earthquake = alerts.formatAlert({
    type: 'earthquake',
    title: 'Myanmar region',
    magnitude: 5.4,
    latitude: 19.7,
    longitude: 96.1,
    startsAt: new Date('2026-05-29T01:00:00Z'),
    source: 'test'
  });

  assertIncludes(earthquake, 'รายงานแผ่นดินไหว');
  assertIncludes(earthquake, '5.4 ริกเตอร์');
  assertIncludes(earthquake, 'ระดับความรุนแรง:');
  assertIncludes(earthquake, 'ส่วนของเอเชีย:');
  assertIncludes(earthquake, 'ไกลจาก กทม.');
  assertIncludes(earthquake, 'ข้อมูล ณ:');
  assertNoPanicWords(earthquake);

  const tsunami = alerts.formatAlert({
    type: 'tsunami',
    areaText: 'Indonesia Sumatra coast',
    waveHeightMeters: 0.4,
    latitude: -3.3,
    longitude: 100.5,
    startsAt: new Date('2026-05-29T01:00:00Z')
  });

  assertIncludes(tsunami, 'รายงานสึนามิ');
  assertIncludes(tsunami, 'ระดับความรุนแรง:');
  assertIncludes(tsunami, 'ส่วนของเอเชีย:');
  assertIncludes(tsunami, 'ไกลจาก กทม.');
  assertNoPanicWords(tsunami);
}

function testRiskAssessment() {
  assert.strictEqual(riskAssessment.assessTemperature(38).level, 'ร้อนมาก');
  assert.strictEqual(riskAssessment.assessRainChance(5).level, 'แทบไม่ตก');
  assert.strictEqual(riskAssessment.assessRainChance(75).level, 'โอกาสมาก');
  assert.strictEqual(riskAssessment.assessRainAmount(12, 'ทดสอบ').level, 'ฝนหนัก');
  assert.strictEqual(riskAssessment.assessPm25(80).level, 'สูงมาก/อันตราย');
  assert.strictEqual(riskAssessment.assessEarthquakeMagnitude(6.2).level, 'รุนแรง');
  assert.strictEqual(riskAssessment.assessStormWind(100).level, 'พายุโซนร้อนกำลังแรง');
  assert.strictEqual(riskAssessment.assessTsunamiWave(1.2).level, 'สูง/รุนแรง');
  assert.strictEqual(riskAssessment.describeAsiaRegion({ title: 'Myanmar region' }), 'เอเชียตะวันออกเฉียงใต้');
}

function testWeatherLocationNormalization() {
  const defaultLocation = weather.normalizeLocation();
  assert.strictEqual(defaultLocation.name, 'Bangkok');
  assert.strictEqual(defaultLocation.latitude, 13.7563);
  assert.strictEqual(defaultLocation.longitude, 100.5018);
  assert.strictEqual(defaultLocation.isDefault, true);

  const lineLocation = weather.normalizeLocation({
    name: 'โลเคชันทดสอบ',
    latitude: '14.125',
    longitude: '100.625'
  });
  assert.strictEqual(lineLocation.name, 'โลเคชันทดสอบ');
  assert.strictEqual(lineLocation.latitude, 14.125);
  assert.strictEqual(lineLocation.longitude, 100.625);
  assert.strictEqual(lineLocation.isDefault, false);

  const brokenLocation = weather.normalizeLocation({
    name: 'พิกัดเสีย',
    latitude: 'not-a-number',
    longitude: '100.625'
  });
  assert.strictEqual(brokenLocation.name, 'Bangkok');
  assert.strictEqual(brokenLocation.isDefault, true);
}

function testAiStatusIsInspectable() {
  const status = ai.getStatus();
  assert.strictEqual(typeof status.provider, 'string');
  assert(Array.isArray(status.providerOrder));
  assert(Array.isArray(status.configuredProviders));
  assert(Array.isArray(status.imageProviderOrder));
  assert(Array.isArray(status.configuredImageProviders));
  assert.strictEqual(typeof status.textAiConfigured, 'boolean');
  assert.strictEqual(typeof status.imageConfigured, 'boolean');
  assert.strictEqual(status.translationFallback, 'MyMemory public translation');
  assert.strictEqual(typeof status.historyUsers, 'number');
  assert.strictEqual(typeof ai.isTextAiConfigured(), 'boolean');
  assert.strictEqual(typeof ai.isImageGenerationConfigured(), 'boolean');
  assert.strictEqual(ai.isImageGenerationConfigured(), true);
  assert.deepStrictEqual(ai.normalizeProviderList('gemini, groq, gemini, openrouter'), ['gemini', 'groq', 'openrouter']);
  assert(Array.isArray(ai.getRequestedProviderOrder()));
  assert(Array.isArray(ai.getConfiguredProviderOrder()));
  assert(Array.isArray(ai.getRequestedImageProviderOrder()));
  assert(Array.isArray(ai.getConfiguredImageProviderOrder()));

  const imagePayload = ai.createImageGenerationPayload('ภาพทดสอบ');
  assert.strictEqual(imagePayload.prompt, 'ภาพทดสอบ');
  assert.strictEqual(imagePayload.size, '1024x1024');

  const portraitPayload = ai.createImageGenerationPayload('ภาพทดสอบ', { size: '1024x1536' });
  assert.strictEqual(portraitPayload.size, '1024x1536');

  if (!/^dall-e-/i.test(imagePayload.model)) {
    assert.strictEqual(imagePayload.response_format, undefined);
  }
}

async function testTranslationCommandPrefersDirectTranslation() {
  const originalGet = axios.get;
  let capturedParams;

  axios.get = async (url, options = {}) => {
    capturedParams = options.params;
    return {
      data: {
        responseData: {
          translatedText: 'I have a meeting today'
        }
      }
    };
  };

  try {
    assert.strictEqual(ai.detectTranslationPair('ฉันรักเธอ'), 'th|en');
    assert.strictEqual(ai.detectTranslationPair('I love you'), 'en|th');

    const answer = await ai.translate('ฉันรักเธอ');
    assertIncludes(answer, 'I love you');

    const directAnswer = await ai.translate('วันนี้ฉันมีประชุม');
    assertIncludes(directAnswer, 'I have a meeting today');
    assert.strictEqual(capturedParams.q, 'วันนี้ฉันมีประชุม');
    assert.strictEqual(capturedParams.langpair, 'th|en');
  } finally {
    axios.get = originalGet;
  }
}

function testLiveDisasterParsing() {
  const xml = `
    <rss><channel><item>
      <title>Green earthquake (Magnitude 5.7M) in Japan</title>
      <description>Depth 11km</description>
      <dc:subject>EQ1</dc:subject>
      <geo:lat>36.1</geo:lat>
      <geo:long>140.1</geo:long>
      <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
    </item></channel></rss>
  `;
  const items = liveDisasters.parseGdacsItems(xml);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].latitude, 36.1);
  assertIncludes(liveDisasters.formatGdacsEvent(items[0]), 'ส่วนของเอเชีย:');
  assertIncludes(liveDisasters.formatGdacsEvent(items[0]), 'ห่างจากไทย');
}

function testFreeServicesText() {
  const text = freeServices.buildFreeServicesText();
  assertIncludes(text, 'บริการฉุกเฉิน');
  assertIncludes(text, '191');
  assertIncludes(text, '1669');
  assertIncludes(text, '199');
  assertIncludes(text, '1784');
  assertIncludes(text, '1418');
  assertIncludes(text, '1300');
  assertIncludes(freeServices.buildUnlockPlanText(), '/admin ปลดล็อค');
  assertIncludes(freeServices.buildRegisterPaymentText(), 'ช่องทางจ่ายเงิน');
}

function testTodoHelpers() {
  assert.deepStrictEqual(todos.parseCreateText('เพิ่มงาน | ซื้อถ่านไฟฉาย | 16-06-2569 : 09.00 น. | high | เตรียมรับมือฉุกเฉิน'), {
    title: 'ซื้อถ่านไฟฉาย',
    dueAt: '16-06-2569 : 09.00 น.',
    priority: 'high',
    notes: 'เตรียมรับมือฉุกเฉิน'
  });
  assert.strictEqual(todos.normalizeStatus('เสร็จแล้ว'), 'done');
  assert.strictEqual(todos.normalizeStatus('ลบ'), 'deleted');
  assert.strictEqual(todos.normalizeStatus(''), 'open');
  const morningText = line.buildTodoMorningText({
    overdue: [{ title: 'ตรวจกระเป๋าฉุกเฉิน', priority: 'urgent' }],
    today: [{ title: 'ซื้อถ่านไฟฉาย', priority: 'high' }]
  });
  assertIncludes(morningText, 'To-do');
  assertIncludes(morningText, 'ค้าง: ตรวจกระเป๋าฉุกเฉิน');
  assertIncludes(morningText, 'วันนี้: ซื้อถ่านไฟฉาย');
}

function testEarthquakeWarningEvaluation() {
  const evaluation = earthquakeWarnings.featureToEvaluation({
    id: 'test-quake',
    properties: {
      mag: 6.3,
      place: 'Myanmar',
      time: Date.UTC(2026, 5, 15, 0, 0, 0),
      url: 'https://earthquake.usgs.gov/example'
    },
    geometry: {
      coordinates: [96.1, 20.1, 10]
    }
  }, new Date(Date.UTC(2026, 5, 15, 1, 0, 0)));

  assert.strictEqual(evaluation.type, 'earthquake');
  assertIncludes(evaluation.externalId, 'eq:usgs');
  assertIncludes(evaluation.message, 'ที่มา: USGS');
  assertIncludes(evaluation.message, 'ระบบนี้เป็นการเตือนเสริม');
  assertNoPanicWords(evaluation.message);
}

function testManualIncludesCoreSlashCommands() {
  const text = manual.getManualText();
  [
    '/แบบฟอร์ม',
    '/สภาพอากาศ',
    '/บันทึกนัดหมาย',
    '/นัดหมาย',
    '/ปฏิทิน',
    'งานวันนี้',
    'งานค้าง',
    'งานทั้งหมด',
    '/ภัยพิบัติ',
    'แผ่นดินไหวล่าสุด',
    '/พรุ่งนี้',
    '/สัปดาห์นี้',
    '/เดือนนี้',
    '/สร้างภาพ',
    '/คำถาม',
    '/คำถามอื่น',
    '/แปลภาษา',
    '/สมัคร',
    '/ปลดลอค',
    '/บริการฉุกเฉิน',
    '/ตรวจเช็ค'
  ].forEach(command => assertIncludes(text, command));
}

function testKnowledgeHelpers() {
  assert.strictEqual(typeof knowledge.answerKnowledgeQuestion, 'function');
}

function testScamCheck() {
  const report = scamCheck.checkScam('คุณได้รับเงินคืน กรุณากด https://bad.example แล้วส่ง OTP เพื่อยืนยัน');
  assertIncludes(report, 'เสี่ยง');
  assertIncludes(report, 'OTP');
  assertIncludes(report, 'ลิงก์');
}

async function run() {
  await testThailandTime();
  testAppointmentParsingAndDuplicateKey();
  await testReminderSelectionDoesNotSpam();
  await testDuplicateUpdateRejected();
  await testTimeOnlyEditUsesBangkokTime();
  testAlertFormatting();
  testRiskAssessment();
  testWeatherLocationNormalization();
  testAiStatusIsInspectable();
  await testTranslationCommandPrefersDirectTranslation();
  testLiveDisasterParsing();
  testFreeServicesText();
  testTodoHelpers();
  testEarthquakeWarningEvaluation();
  testManualIncludesCoreSlashCommands();
  testKnowledgeHelpers();
  testScamCheck();
  console.log('SmartLife smoke tests passed');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
