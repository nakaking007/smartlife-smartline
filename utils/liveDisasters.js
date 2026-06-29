const axios = require('axios');
const { formatBangkokDateTime } = require('./time');
const {
  assessEarthquakeMagnitude,
  assessStormWind,
  assessTsunamiWave,
  describeAsiaRegion
} = require('./riskAssessment');

const BANGKOK_COORDINATES = { latitude: 13.7563, longitude: 100.5018 };
const ASIA_BOUNDS = {
  minLatitude: -11,
  maxLatitude: 56,
  minLongitude: 26,
  maxLongitude: 146
};
const ASEAN_BOUNDS = {
  minLatitude: -11,
  maxLatitude: 29,
  minLongitude: 92,
  maxLongitude: 142
};
const LIVE_ALERT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const THAI_INTEGER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', {
  maximumFractionDigits: 0
});

const THAI_NUMBER_FORMAT = new Intl.NumberFormat('th-TH-u-nu-latn', {
  maximumFractionDigits: 1
});

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

function isInBounds(latitude, longitude, bounds) {
  return latitude >= bounds.minLatitude &&
    latitude <= bounds.maxLatitude &&
    longitude >= bounds.minLongitude &&
    longitude <= bounds.maxLongitude;
}

function isInAsiaBounds(latitude, longitude) {
  return isInBounds(latitude, longitude, ASIA_BOUNDS);
}

function isInAseanBounds(latitude, longitude) {
  return isInBounds(latitude, longitude, ASEAN_BOUNDS);
}

function getDistanceLine(latitude, longitude) {
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);

  if (lat === null || lon === null) {
    return 'ห่างจากไทย (กทม.): ยังไม่มีพิกัดสำหรับคำนวณ';
  }

  const distanceKm = calculateDistanceKm(BANGKOK_COORDINATES, { latitude: lat, longitude: lon });
  return `ห่างจากไทย (กทม.): ประมาณ ${THAI_INTEGER_FORMAT.format(distanceKm)} กม.`;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function stripHtml(value) {
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractXmlTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function parseGdacsDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseGdacsItems(xml) {
  const rawItems = String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [];

  return rawItems.map(item => {
    const title = stripHtml(extractXmlTag(item, 'title'));
    const description = stripHtml(extractXmlTag(item, 'description'));
    const subject = stripHtml(extractXmlTag(item, 'dc:subject'));
    const link = stripHtml(extractXmlTag(item, 'link'));
    const latitude = toNumber(extractXmlTag(item, 'geo:lat'));
    const longitude = toNumber(extractXmlTag(item, 'geo:long'));
    const publishedAt = parseGdacsDate(extractXmlTag(item, 'pubDate'));

    return {
      title,
      description,
      subject,
      link,
      latitude,
      longitude,
      publishedAt
    };
  });
}

function getGdacsType(item) {
  const text = `${item.subject || ''} ${item.title || ''} ${item.description || ''}`.toLowerCase();

  if (/earthquake|\beq\d*\b|แผ่นดินไหว/.test(text)) return 'earthquake';
  if (/tsunami|\bts\d*\b|สึนามิ|สึมามิ/.test(text)) return 'tsunami';
  if (/tropical cyclone|cyclone|typhoon|storm|\btc\d*\b|พายุ/.test(text)) return 'storm';
  return 'other';
}

function getGdacsLevel(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  const colorMatch = text.match(/\b(Green|Orange|Red)\b/i);
  if (!colorMatch) {
    return 'ยังไม่มีระดับสีจาก GDACS';
  }

  const color = colorMatch[1].toLowerCase();
  if (color === 'green') return 'เขียว/ผลกระทบโดยรวมต่ำ';
  if (color === 'orange') return 'ส้ม/ผลกระทบปานกลางถึงสูง';
  if (color === 'red') return 'แดง/ผลกระทบสูง';
  return colorMatch[1];
}

function getGdacsColor(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  const colorMatch = text.match(/\b(Green|Orange|Red)\b/i);
  return colorMatch ? colorMatch[1].toLowerCase() : null;
}

function extractWindKph(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  const kphMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:km\/h|kph|กม\.?\/ชม\.?)/i);
  if (kphMatch) {
    return toNumber(kphMatch[1]);
  }

  const knotsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:kt|knots)/i);
  const knots = knotsMatch ? toNumber(knotsMatch[1]) : null;
  return knots === null ? null : Math.round(knots * 1.852 * 10) / 10;
}

function extractWaveMeters(item) {
  const text = `${item.title || ''} ${item.description || ''}`;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:m|meter|metre|เมตร)/i);
  return match ? toNumber(match[1]) : null;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function isRecent(date, now = new Date()) {
  return date && now.getTime() - date.getTime() <= LIVE_ALERT_LOOKBACK_MS;
}

function getEarthquakeSeverity(magnitude, tsunamiFlag) {
  if (tsunamiFlag) return 'warning';
  if (magnitude >= 7) return 'critical';
  if (magnitude >= 6) return 'warning';
  if (magnitude >= 5) return 'watch';
  return 'info';
}

function getGdacsSeverity(item) {
  const color = getGdacsColor(item);
  if (color === 'red') return 'critical';
  if (color === 'orange') return 'warning';
  if (color === 'green') return 'watch';
  return 'watch';
}

function buildUsgsAlertCandidate(feature, now = new Date()) {
  const properties = feature.properties || {};
  const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [];
  const longitude = toNumber(coordinates[0]);
  const latitude = toNumber(coordinates[1]);
  const magnitude = toNumber(properties.mag);
  const eventAt = properties.time ? new Date(properties.time) : null;
  const tsunamiFlag = Number(properties.tsunami || 0) > 0;

  if (latitude === null || longitude === null || magnitude === null || !isInAsiaBounds(latitude, longitude)) {
    return null;
  }

  if (magnitude < 4.5 && !tsunamiFlag) {
    return null;
  }

  if (!isRecent(eventAt, now)) {
    return null;
  }

  const id = feature.id || properties.code || `${properties.time || ''}:${properties.place || ''}`;
  const expiresAt = addHours(eventAt, tsunamiFlag || magnitude >= 6 ? 24 : 12);

  return {
    type: 'earthquake',
    severity: getEarthquakeSeverity(magnitude, tsunamiFlag),
    title: `แผ่นดินไหว M${THAI_NUMBER_FORMAT.format(magnitude)}`,
    areaText: properties.place || '-',
    latitude,
    longitude,
    magnitude,
    source: 'USGS',
    sourceUrl: properties.url,
    externalId: `eq:usgs:${id}`,
    startsAt: eventAt,
    expiresAt,
    active: true
  };
}

function buildGdacsAlertCandidate(item, now = new Date()) {
  const type = getGdacsType(item);
  const color = getGdacsColor(item);
  const eventAt = item.publishedAt || now;

  if (!['storm', 'tsunami'].includes(type) || !isInAseanBounds(item.latitude, item.longitude)) {
    return null;
  }

  if (!['orange', 'red'].includes(color)) {
    return null;
  }

  if (!isRecent(eventAt, now)) {
    return null;
  }

  const windSpeedKph = type === 'storm' ? extractWindKph(item) : null;
  const waveHeightMeters = type === 'tsunami' ? extractWaveMeters(item) : null;
  const expiresAt = addHours(eventAt, color === 'red' ? 24 : 18);

  return {
    type,
    severity: getGdacsSeverity(item),
    title: item.title || (type === 'storm' ? 'พายุจาก GDACS' : 'สึนามิจาก GDACS'),
    areaText: item.title || item.description || '-',
    latitude: item.latitude,
    longitude: item.longitude,
    category: getGdacsLevel(item),
    windSpeedKph,
    waveHeightMeters,
    source: 'GDACS',
    sourceUrl: item.link,
    externalId: `gdacs:${item.link || `${type}:${item.title}:${eventAt.toISOString()}`}`,
    startsAt: eventAt,
    expiresAt,
    active: true
  };
}

function formatUsgsEarthquake(feature) {
  const properties = feature.properties || {};
  const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
    ? feature.geometry.coordinates
    : [];
  const longitude = toNumber(coordinates[0]);
  const latitude = toNumber(coordinates[1]);
  const magnitude = toNumber(properties.mag);
  const assessment = assessEarthquakeMagnitude(magnitude);
  const when = properties.time ? new Date(properties.time) : null;

  return [
    `แผ่นดินไหว: ${properties.place || '-'}`,
    `ขนาด: ${magnitude === null ? 'ยังไม่มีข้อมูล' : `${THAI_NUMBER_FORMAT.format(magnitude)} ริกเตอร์`} (${assessment.level})`,
    `อาการที่รับรู้ได้: ${assessment.description}`,
    `ส่วนของเอเชีย: ${describeAsiaRegion({ place: properties.place, latitude, longitude })}`,
    getDistanceLine(latitude, longitude),
    `เวลา: ${when ? formatBangkokDateTime(when) : 'ยังไม่มีเวลา'}`,
    'ที่มา: USGS'
  ].join("\n");
}

function formatGdacsEvent(item) {
  const type = getGdacsType(item);
  const typeLabel = type === 'storm' ? 'พายุ'
    : type === 'tsunami' ? 'สึนามิ'
      : type === 'earthquake' ? 'แผ่นดินไหว'
        : 'ภัยพิบัติ';
  const lines = [
    `${typeLabel}: ${item.title || '-'}`,
    `ระดับความรุนแรง: ${getGdacsLevel(item)}`,
    `ส่วนของเอเชีย: ${describeAsiaRegion({ title: item.title, latitude: item.latitude, longitude: item.longitude })}`,
    getDistanceLine(item.latitude, item.longitude)
  ];

  if (type === 'storm') {
    const windKph = extractWindKph(item);
    const windAssessment = assessStormWind(windKph);
    lines.push(`ค่าพายุ/ลม: ${windKph === null ? 'ยังไม่มีค่าลมใน RSS' : `${THAI_NUMBER_FORMAT.format(windKph)} กม./ชม.`} (${windAssessment.level})`);
  }

  if (type === 'tsunami') {
    const waveMeters = extractWaveMeters(item);
    const waveAssessment = assessTsunamiWave(waveMeters);
    lines.push(`ค่าสึนามิ/คลื่น: ${waveMeters === null ? 'ยังไม่มีความสูงคลื่นใน RSS' : `${THAI_NUMBER_FORMAT.format(waveMeters)} เมตร`} (${waveAssessment.level})`);
  }

  if (item.publishedAt) {
    lines.push(`เวลา: ${formatBangkokDateTime(item.publishedAt)}`);
  }

  lines.push('ที่มา: GDACS');

  return lines.join("\n");
}

async function fetchAsiaEarthquakes(limit = 5) {
  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: 'geojson',
    starttime: start,
    minmagnitude: '4.5',
    minlatitude: String(ASIA_BOUNDS.minLatitude),
    maxlatitude: String(ASIA_BOUNDS.maxLatitude),
    minlongitude: String(ASIA_BOUNDS.minLongitude),
    maxlongitude: String(ASIA_BOUNDS.maxLongitude),
    orderby: 'time',
    limit: String(limit)
  });
  const res = await axios.get(`https://earthquake.usgs.gov/fdsnws/event/1/query?${params.toString()}`, {
    timeout: 15000
  });

  return Array.isArray(res.data && res.data.features) ? res.data.features : [];
}

async function fetchGdacsAsiaEvents(limit = 6) {
  const res = await axios.get('https://www.gdacs.org/xml/rss.xml', {
    timeout: 15000,
    responseType: 'text'
  });
  const items = parseGdacsItems(res.data)
    .filter(item => item.latitude !== null && item.longitude !== null)
    .filter(item => isInAsiaBounds(item.latitude, item.longitude))
    .filter(item => ['earthquake', 'storm', 'tsunami'].includes(getGdacsType(item)));

  return items.slice(0, limit);
}

async function buildAsiaDisasterReport() {
  const results = await Promise.allSettled([
    fetchAsiaEarthquakes(5),
    fetchGdacsAsiaEvents(6)
  ]);

  const earthquakeResult = results[0];
  const gdacsResult = results[1];
  const sections = [];
  const notes = [];

  if (earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length) {
    sections.push(...earthquakeResult.value.map(formatUsgsEarthquake));
  } else if (earthquakeResult.status === 'rejected') {
    notes.push(`USGS: ${earthquakeResult.reason.message}`);
  }

  if (gdacsResult.status === 'fulfilled' && gdacsResult.value.length) {
    const nonEarthquakeItems = gdacsResult.value.filter(item => getGdacsType(item) !== 'earthquake');
    sections.push(...nonEarthquakeItems.map(formatGdacsEvent));
  } else if (gdacsResult.status === 'rejected') {
    notes.push(`GDACS: ${gdacsResult.reason.message}`);
  }

  if (!sections.length) {
    sections.push('ยังไม่พบรายการแผ่นดินไหว พายุ หรือสึนามิในเอเชียจากแหล่งข้อมูลสาธารณะที่อ่านได้ตอนนี้ค่ะ');
  }

  return [
    'รายงานภัยพิบัติในทวีปเอเชีย',
    `ข้อมูล ณ เวลาไทย ${formatBangkokDateTime(new Date())}`,
    '',
    sections.slice(0, 8).join("\n\n---\n\n"),
    '',
    notes.length ? `หมายเหตุแหล่งข้อมูลบางส่วนอ่านไม่ได้: ${notes.join(' | ')}` : 'แหล่งข้อมูล: USGS Earthquake API และ GDACS RSS',
    'รายงานนี้สรุปสถานการณ์และตัวเลขจากแหล่งข้อมูลจริง โดยไม่เติมคำสั่งปฏิบัติการฉุกเฉินเอง'
  ].join("\n");
}

async function fetchLiveDisasterAlertCandidates(now = new Date()) {
  const results = await Promise.allSettled([
    fetchAsiaEarthquakes(20),
    fetchGdacsAsiaEvents(20)
  ]);
  const candidates = [];

  if (results[0].status === 'fulfilled') {
    candidates.push(...results[0].value.map(feature => buildUsgsAlertCandidate(feature, now)).filter(Boolean));
  }

  if (results[1].status === 'fulfilled') {
    candidates.push(...results[1].value.map(item => buildGdacsAlertCandidate(item, now)).filter(Boolean));
  }

  return candidates;
}

module.exports = {
  buildAsiaDisasterReport,
  fetchLiveDisasterAlertCandidates,
  fetchAsiaEarthquakes,
  fetchGdacsAsiaEvents,
  parseGdacsItems,
  formatUsgsEarthquake,
  formatGdacsEvent
};
