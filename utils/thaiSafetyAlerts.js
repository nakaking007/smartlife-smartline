const axios = require('axios');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const xmlParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: false });
const TMD_CAP_FEED = 'https://www.tmd.go.th/api/xml/CAP';
const AIR4THAI_URL = 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php';

const OFFICIAL_DOMAINS = ['disaster.go.th', 'prd.go.th', 'royalthaipolice.go.th', 'tmd.go.th', 'pcd.go.th'];
const QUERY = '(domain:disaster.go.th OR domain:prd.go.th OR domain:royalthaipolice.go.th OR domain:tmd.go.th) (น้ำท่วม OR พายุ OR ฝนตกหนัก OR จราจล OR เหตุความไม่สงบ OR อุบัติภัย OR อุบัติเหตุร้ายแรง OR ระเบิด OR ไฟไหม้)';

function classifyThaiSafetyTitle(title) {
  const text = String(title || '').toLowerCase();
  if (/สึนามิ|tsunami/.test(text)) return { type: 'tsunami', severity: 'warning' };
  if (/แผ่นดินไหว|earthquake/.test(text)) return { type: 'earthquake', severity: 'watch' };
  if (/pm\s*2[.,]5|ฝุ่น|มลพิษอากาศ/.test(text)) return { type: 'air_quality', severity: 'watch' };
  if (/น้ำท่วม|อุทกภัย|น้ำป่า|น้ำล้นตลิ่ง/.test(text)) return { type: 'flood', severity: 'warning' };
  if (/พายุ|ฝนตกหนัก|วาตภัย|ลมแรง|ฝนฟ้าคะนอง|heavy rain|storm/.test(text)) return { type: 'storm', severity: 'warning' };
  if (/จราจล|ชุมนุม|เหตุความไม่สงบ|ก่อการร้าย/.test(text)) return { type: 'public_safety', severity: 'watch' };
  if (/อุบัติภัย|อุบัติเหตุ.*(?:ร้ายแรง|หมู่)|ระเบิด|สารเคมี|ไฟไหม้|เพลิงไหม้/.test(text)) {
    return { type: 'severe_accident', severity: 'warning' };
  }
  return null;
}

function parseGdeltDate(value) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})/);
  if (!match) return null;
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z`);
}

function isOfficialUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ['https:', 'http:'].includes(new URL(value).protocol) && OFFICIAL_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function articleToCandidate(article, now = new Date()) {
  const classification = classifyThaiSafetyTitle(article.title);
  if (!classification || !isOfficialUrl(article.url)) return null;
  const startsAt = parseGdeltDate(article.seendate);
  if (!startsAt || !Number.isFinite(startsAt.getTime()) || startsAt > now || now.getTime() - startsAt.getTime() >= 24 * 60 * 60 * 1000) return null;
  const hash = crypto.createHash('sha256').update(String(article.url)).digest('hex').slice(0, 24);
  return {
    ...classification,
    severity: 'watch',
    message: 'ข่าวเฝ้าระวังจากดัชนีข่าว เวลาเป็นเวลาที่ดัชนีพบข่าว โปรดตรวจประกาศต้นทางก่อนใช้ตัดสินใจ',
    title: String(article.title || 'ข่าวเฝ้าระวังจากหน่วยงานราชการ').slice(0, 300),
    areaText: 'ประเทศไทย โปรดตรวจพื้นที่ตามประกาศต้นทาง',
    category: 'ข่าวเฝ้าระวังจากเว็บไซต์หน่วยงานราชการ',
    source: article.domain || new URL(article.url).hostname,
    sourceUrl: article.url,
    externalId: `thai-official:${hash}`,
    startsAt,
    expiresAt: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
    active: true
  };
}

async function fetchIndexedOfficialNews(now = new Date()) {
  const response = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
    params: { query: QUERY, mode: 'ArtList', maxrecords: 50, format: 'json', timespan: '30h', sort: 'HybridRel' },
    timeout: 20000
  });
  const articles = Array.isArray(response.data?.articles) ? response.data.articles : [];
  const unique = new Map();
  articles.map(article => articleToCandidate(article, now)).filter(Boolean).forEach(item => unique.set(item.externalId, item));
  return [...unique.values()];
}

function asArray(value) { return value ? (Array.isArray(value) ? value : [value]) : []; }
function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function capToCandidates(xml, sourceUrl, now = new Date()) {
  if (!isOfficialUrl(sourceUrl) || new URL(sourceUrl).hostname !== 'www.tmd.go.th') return [];
  const alert = xmlParser.parse(xml)?.alert;
  if (!alert || alert.status !== 'Actual' || alert.scope !== 'Public' || !alert.identifier) return [];
  // Updates and cancellations refer to earlier CAP identifiers.
  const references = String(alert.references || '').trim().split(/\s+/).filter(Boolean);
  const retired = ['Update', 'Cancel'].includes(alert.msgType) ? references.map(ref => ref.split(',')[1]).filter(Boolean).map(id => ({
    externalId: `tmd-cap:${id}`, active: false, expiresAt: now
  })) : [];
  if (alert.msgType === 'Cancel') return retired;
  if (!['Alert', 'Update'].includes(alert.msgType)) return [];
  const infos = asArray(alert.info);
  const info = infos.find(item => /^th/i.test(item.language || '')) || infos[0];
  if (!info) return retired;
  const issuedAt = validDate(alert.sent);
  const effectiveAt = validDate(info.effective) || issuedAt;
  const expiresAt = validDate(info.expires);
  if (!issuedAt || issuedAt > now || !effectiveAt || !expiresAt || expiresAt <= now) return retired;
  const classification = classifyThaiSafetyTitle(`${info.event} ${info.headline}`);
  if (!classification) return retired;
  return [...retired, {
    ...classification,
    severity: ['Extreme', 'Severe'].includes(info.severity) ? 'warning' : 'watch',
    title: String(info.headline || info.event).slice(0, 300),
    message: String(info.description || '').slice(0, 1400),
    instruction: String(info.instruction || '').slice(0, 700),
    areaText: asArray(info.area).map(area => area.areaDesc).filter(Boolean).join(' · ') || 'ประเทศไทย โปรดตรวจพื้นที่จากประกาศต้นทาง',
    areaVerified: Boolean(asArray(info.area).some(area => area.areaDesc)),
    source: 'กรมอุตุนิยมวิทยา (CAP)', sourceUrl,
    externalId: `tmd-cap:${alert.identifier}`,
    issuedAt, startsAt: issuedAt, effectiveAt, expiresAt, active: true
  }];
}

async function fetchTmdCapCandidates(now = new Date()) {
  const response = await axios.get(TMD_CAP_FEED, { timeout: 15000, maxContentLength: 2 * 1024 * 1024 });
  const items = asArray(xmlParser.parse(response.data)?.rss?.channel?.item);
  // Read bounded recent documents including cancellation/update messages.
  const links = [...new Set(items.map(item => String(item.link || '')).filter(link => {
    try { const url = new URL(link); return url.protocol === 'https:' && url.hostname === 'www.tmd.go.th' && url.pathname.startsWith('/uploads/CAP/'); }
    catch { return false; }
  }))].slice(0, 12);
  const results = await Promise.allSettled(links.map(async link => {
    const document = await axios.get(link, { timeout: 15000, maxContentLength: 2 * 1024 * 1024 });
    return capToCandidates(document.data, link, now);
  }));
  results.filter(item => item.status === 'rejected').forEach(item => console.warn('TMD CAP document unavailable:', item.reason.code || 'fetch failed'));
  // Apply retirements last so an older document cannot reactivate a cancelled alert.
  const candidates = results.flatMap(item => item.status === 'fulfilled' ? item.value : []);
  return [...candidates.filter(item => item.active), ...candidates.filter(item => !item.active)];
}

function airStationToCandidate(station, now = new Date()) {
  const latest = station.AQILast;
  const reading = latest?.PM25;
  const aqi = Number(reading?.aqi);
  const value = Number(reading?.value);
  const startsAt = validDate(latest?.date && latest?.time ? `${latest.date}T${latest.time.length === 5 ? latest.time + ':00' : latest.time}+07:00` : null);
  if (!station.stationID || !startsAt || startsAt > now || now - startsAt >= 6 * 60 * 60 * 1000 || !Number.isFinite(aqi) || !Number.isFinite(value) || value < 0 || aqi <= 100) return null;
  return {
    type: 'air_quality', severity: aqi > 200 ? 'warning' : 'watch',
    title: `ฝุ่น PM2.5 สถานี ${station.nameTH || station.stationID}`,
    message: `PM2.5: ${value} µg/m³ · AQI ของ PM2.5: ${aqi} ตามข้อมูลกรมควบคุมมลพิษ`,
    areaText: String(station.areaTH || station.nameTH || 'ประเทศไทย'), areaVerified: Boolean(station.areaTH),
    source: 'กรมควบคุมมลพิษ (Air4Thai)', sourceUrl: 'https://air4thai.pcd.go.th/',
    externalId: `air4thai:${station.stationID}:${startsAt.toISOString()}`,
    startsAt, expiresAt: new Date(startsAt.getTime() + 6 * 60 * 60 * 1000), active: true
  };
}

async function fetchAirQualityCandidates(now = new Date()) {
  const response = await axios.get(AIR4THAI_URL, { timeout: 15000, maxContentLength: 2 * 1024 * 1024 });
  if (!Array.isArray(response.data?.stations)) throw new Error('Air4Thai returned an unexpected format');
  return response.data.stations.map(station => airStationToCandidate(station, now)).filter(Boolean);
}

async function fetchThaiOfficialSafetyAlertCandidates(now = new Date()) {
  const results = await Promise.allSettled([fetchTmdCapCandidates(now), fetchAirQualityCandidates(now), fetchIndexedOfficialNews(now)]);
  results.forEach((result, index) => { if (result.status === 'rejected') console.warn(`Official safety source ${['TMD CAP', 'Air4Thai', 'indexed news'][index]} unavailable:`, result.reason.code || 'fetch failed'); });
  if (results.every(result => result.status === 'rejected')) throw new Error('All official safety sources are unavailable');
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

module.exports = {
  classifyThaiSafetyTitle,
  parseGdeltDate,
  isOfficialUrl,
  articleToCandidate,
  capToCandidates,
  airStationToCandidate,
  fetchTmdCapCandidates,
  fetchAirQualityCandidates,
  fetchThaiOfficialSafetyAlertCandidates
};
