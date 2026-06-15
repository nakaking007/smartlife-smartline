const Alert = require('../models/Alert');
const WarningHistory = require('../models/WarningHistory');
const liveDisasters = require('./liveDisasters');
const { formatBangkokDateTime } = require('./time');
const { assessEarthquakeMagnitude, describeAsiaRegion } = require('./riskAssessment');

const BANGKOK_COORDINATES = { latitude: 13.7563, longitude: 100.5018 };
const THAI_NUMBER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', { maximumFractionDigits: 1 });
const THAI_INTEGER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', { maximumFractionDigits: 0 });
const RECENT_MS = 24 * 60 * 60 * 1000;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function calculateDistanceKm(from, to) {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const latitude1 = toRadians(from.latitude);
  const latitude2 = toRadians(to.latitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getSeverity({ magnitude, tsunamiFlag, distanceFromBangkokKm }) {
  if (tsunamiFlag) return 'warning';
  if (magnitude >= 7) return distanceFromBangkokKm <= 2500 ? 'critical' : 'warning';
  if (magnitude >= 6) return distanceFromBangkokKm <= 1600 ? 'warning' : 'watch';
  if (magnitude >= 5) return distanceFromBangkokKm <= 900 ? 'watch' : 'info';
  return 'info';
}

function getRiskLevel(severity) {
  return {
    critical: 'สูงมาก',
    warning: 'สูง',
    watch: 'เฝ้าระวัง',
    info: 'ข้อมูล'
  }[severity] || 'ข้อมูล';
}

function getConfidence(source) {
  return source === 'USGS' ? 'สูงจากแหล่งข้อมูลสาธารณะสากล' : 'ปานกลาง';
}

function shouldCreatePublicAlert({ magnitude, severity, distanceFromBangkokKm, tsunamiFlag }) {
  if (tsunamiFlag) return true;
  if (['critical', 'warning'].includes(severity)) return true;
  return magnitude >= 5 && distanceFromBangkokKm <= 1600;
}

function getPublicAdvice(severity) {
  const suffix = 'ระบบนี้เป็นการเตือนเสริม ไม่ใช่ประกาศทางการหรือคำสั่งปฏิบัติการฉุกเฉิน';

  if (severity === 'critical') {
    return `ตรวจสอบข้อมูลซ้ำจากหน่วยงานทางการและเตรียมช่องทางติดต่อฉุกเฉิน ${suffix}`;
  }

  if (severity === 'warning') {
    return `ติดตามประกาศจากหน่วยงานทางการและสังเกตความผิดปกติของอาคารหรือพื้นที่ใกล้ตัว ${suffix}`;
  }

  if (severity === 'watch') {
    return `รับทราบเหตุการณ์และติดตามข้อมูลเพิ่มเติม หากรู้สึกสั่นไหวให้ตรวจสอบสภาพแวดล้อมรอบตัว ${suffix}`;
  }

  return `บันทึกเป็นข้อมูลเฝ้าระวัง ยังไม่เข้าเกณฑ์แจ้งเตือนสูง ${suffix}`;
}

function featureToEvaluation(feature, now = new Date()) {
  const properties = feature.properties || {};
  const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [];
  const longitude = toNumber(coordinates[0]);
  const latitude = toNumber(coordinates[1]);
  const depthKm = toNumber(coordinates[2]);
  const magnitude = toNumber(properties.mag);
  const startsAt = properties.time ? new Date(properties.time) : null;
  const tsunamiFlag = Number(properties.tsunami || 0) > 0;

  if (
    latitude === null ||
    longitude === null ||
    magnitude === null ||
    !startsAt ||
    Number.isNaN(startsAt.getTime()) ||
    now.getTime() - startsAt.getTime() > RECENT_MS
  ) {
    return null;
  }

  const distanceFromBangkokKm = calculateDistanceKm(BANGKOK_COORDINATES, { latitude, longitude });
  const severity = getSeverity({ magnitude, tsunamiFlag, distanceFromBangkokKm });
  const assessment = assessEarthquakeMagnitude(magnitude);
  const riskLevel = getRiskLevel(severity);
  const source = 'USGS';
  const id = feature.id || properties.code || `${properties.time || ''}:${properties.place || ''}`;
  const expiresAt = addHours(startsAt, ['critical', 'warning'].includes(severity) ? 24 : 12);
  const publicAdvice = getPublicAdvice(severity);

  return {
    type: 'earthquake',
    externalId: `eq:${source.toLowerCase()}:${id}`,
    source,
    sourceUrl: properties.url,
    title: `แผ่นดินไหว M${THAI_NUMBER_FORMAT.format(magnitude)}`,
    areaText: properties.place || '-',
    latitude,
    longitude,
    magnitude,
    depthKm,
    distanceFromBangkokKm,
    severity,
    riskLevel,
    confidence: getConfidence(source),
    message: [
      `แผ่นดินไหว: ${properties.place || '-'}`,
      `ขนาด: ${THAI_NUMBER_FORMAT.format(magnitude)} ริกเตอร์ (${assessment.level})`,
      `ไกลจาก กทม.: ประมาณ ${THAI_INTEGER_FORMAT.format(distanceFromBangkokKm)} กม.`,
      `ส่วนของเอเชีย: ${describeAsiaRegion({ place: properties.place, latitude, longitude })}`,
      `ระดับระบบ: ${riskLevel}`,
      `ข้อมูล ณ: ${formatBangkokDateTime(startsAt)}`,
      `ที่มา: ${source}${properties.url ? ` ${properties.url}` : ''}`,
      `หมายเหตุ: ${publicAdvice}`
    ].join('\n'),
    publicAdvice,
    startsAt,
    expiresAt,
    active: true,
    shouldAlert: shouldCreatePublicAlert({ magnitude, severity, distanceFromBangkokKm, tsunamiFlag })
  };
}

async function fetchRecentEvaluations(now = new Date(), limit = 30) {
  const features = await liveDisasters.fetchAsiaEarthquakes(limit);
  return features
    .map(feature => featureToEvaluation(feature, now))
    .filter(Boolean)
    .sort((a, b) => b.startsAt - a.startsAt);
}

function toAlertPayload(evaluation) {
  return {
    type: 'earthquake',
    severity: evaluation.severity,
    title: evaluation.title,
    message: evaluation.message,
    areaText: evaluation.areaText,
    latitude: evaluation.latitude,
    longitude: evaluation.longitude,
    magnitude: evaluation.magnitude,
    depthKm: evaluation.depthKm,
    riskLevel: evaluation.riskLevel,
    confidence: evaluation.confidence,
    publicAdvice: evaluation.publicAdvice,
    source: evaluation.source,
    sourceUrl: evaluation.sourceUrl,
    externalId: evaluation.externalId,
    startsAt: evaluation.startsAt,
    expiresAt: evaluation.expiresAt,
    active: evaluation.active
  };
}

async function syncEarthquakeWarnings({ now = new Date(), force = false } = {}) {
  const evaluations = await fetchRecentEvaluations(now, 30);
  let historyUpserted = 0;
  let alertsUpserted = 0;

  for (const evaluation of evaluations) {
    const { shouldAlert, externalId, ...historyFields } = evaluation;
    const historyResult = await WarningHistory.updateOne(
      { externalId },
      {
        $set: historyFields,
        $setOnInsert: { externalId }
      },
      { upsert: true }
    );

    if (historyResult.upsertedCount > 0) {
      historyUpserted += 1;
    }

    if (!shouldAlert && !force) {
      continue;
    }

    const alertPayload = toAlertPayload(evaluation);
    const { externalId: alertExternalId, ...alertFields } = alertPayload;
    const alertResult = await Alert.updateOne(
      { externalId: alertExternalId },
      {
        $set: alertFields,
        $setOnInsert: { externalId: alertExternalId, sentTo: [] }
      },
      { upsert: true }
    );

    if (alertResult.upsertedCount > 0) {
      alertsUpserted += 1;
    }
  }

  return {
    evaluated: evaluations.length,
    historyUpserted,
    alertsUpserted
  };
}

async function listRecentWarnings(limit = 10) {
  return WarningHistory.find({ type: 'earthquake' })
    .sort({ startsAt: -1 })
    .limit(limit);
}

module.exports = {
  calculateDistanceKm,
  featureToEvaluation,
  fetchRecentEvaluations,
  syncEarthquakeWarnings,
  listRecentWarnings,
  getSeverity,
  getRiskLevel
};
