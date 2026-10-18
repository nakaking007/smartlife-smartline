const axios = require('axios');
const crypto = require('crypto');
const { XMLParser } = require('fast-xml-parser');
const xmlParser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: false });
const TMD_CAP_FEED = 'https://www.tmd.go.th/api/xml/CAP';
const AIR4THAI_URL = 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php';
const DDPM_BASE = 'https://dpmreporter.disaster.go.th/portal';
const NEWS_TTL_MS = 15 * 60 * 1000;
const NEWS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const newsFeeds = new Map();

// Cache public news separately from CAP warnings. A failed refresh never returns stale news.
function newsFeed(id, label, sourceUrl, load) {
  const feed = { id, label, sourceUrl, state: 'not_checked', checkedAt: null,
    lastSuccessAt: null, nextAttemptAt: 0, failures: 0, items: [], pending: null };
  newsFeeds.set(id, feed);
  return async function poll(now = new Date()) {
    if (feed.pending) return feed.pending;
    if (now.getTime() < feed.nextAttemptAt) {
      if (feed.state === 'available') return feed.items.filter(item => item.expiresAt > now);
      throw Object.assign(new Error('News source is in backoff'), { code: feed.code });
    }
    feed.pending = (async () => {
      feed.checkedAt = now.toISOString();
      try {
        const items = await load(now);
        feed.items = items;
        feed.state = 'available';
        feed.code = null;
        feed.lastSuccessAt = now.toISOString();
        feed.failures = 0;
        feed.nextAttemptAt = now.getTime() + NEWS_TTL_MS;
        return items;
      } catch (err) {
        feed.items = [];
        feed.state = 'unavailable';
        feed.failures += 1;
        const status = Number(err.response?.status);
        feed.code = status === 429 ? 'RATE_LIMITED' : status ? 'HTTP_ERROR' :
          err.code === 'INVALID_NEWS_FORMAT' ? 'INVALID_NEWS_FORMAT' : 'FETCH_FAILED';
        const retry = err.response?.headers?.['retry-after'];
        const retryMs = /^\d+$/.test(String(retry)) ? Number(retry) * 1000 : Date.parse(retry) - now.getTime();
        const backoff = Math.min(6 * 60 * 60 * 1000, NEWS_TTL_MS * 2 ** Math.min(feed.failures - 1, 5));
        feed.nextAttemptAt = now.getTime() + Math.max(backoff, Number.isFinite(retryMs) ? retryMs : 0);
        throw Object.assign(new Error('News source unavailable'), { code: feed.code });
      } finally { feed.pending = null; }
    })();
    return feed.pending;
  };
}

function getOfficialNewsStatus(now = new Date()) {
  return [...newsFeeds.values()].map(feed => ({
    id: feed.id, label: feed.label, sourceUrl: feed.sourceUrl,
    state: feed.state === 'available' && now.getTime() >= feed.nextAttemptAt ? 'stale' : feed.state,
    code: feed.code || null, checkedAt: feed.checkedAt, lastSuccessAt: feed.lastSuccessAt,
    nextAttemptAt: feed.nextAttemptAt ? new Date(feed.nextAttemptAt).toISOString() : null,
  }));
}

function invalidNewsFormat() {
  return Object.assign(new Error('Unexpected news format'), { code: 'INVALID_NEWS_FORMAT' });
}

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
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && date.toISOString() === iso ? date : null;
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
  if (!article || typeof article !== 'object') return null;
  const classification = classifyThaiSafetyTitle(article.title);
  if (!classification || !isOfficialUrl(article.url)) return null;
  const startsAt = parseGdeltDate(article.seendate);
  if (!startsAt || !Number.isFinite(startsAt.getTime()) || startsAt > now || now.getTime() - startsAt.getTime() >= 24 * 60 * 60 * 1000) return null;
  const hash = crypto.createHash('sha256').update(String(article.url)).digest('hex').slice(0, 24);
  return {
    ...classification,
    severity: 'watch',
    recordKind: 'news_report', timeKind: 'indexed_at',
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

const fetchIndexedOfficialNews = newsFeed('gdelt', 'ดัชนีข่าวราชการ GDELT (สำรอง)',
  'https://www.gdeltproject.org/', async (now) => {
  const response = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
    params: { query: QUERY, mode: 'ArtList', maxrecords: 50, format: 'json', timespan: '30h', sort: 'HybridRel' },
    timeout: 15000, maxContentLength: 2 * 1024 * 1024
  });
  if (!Array.isArray(response.data?.articles)) throw invalidNewsFormat();
  const articles = response.data.articles;
  const unique = new Map();
  articles.map(article => articleToCandidate(article, now)).filter(Boolean).forEach(item => unique.set(item.externalId, item));
  return [...unique.values()];
});

function parseDdpmDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return null;
  const date = new Date(text.replace(' ', 'T') + '+07:00');
  // Reject normalized invalid dates (e.g. February 30), not just invalid timestamps.
  if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 19) !== text.replace(' ', 'T')) return null;
  return date;
}

function ddpmRecordToCandidate(record, now = new Date()) {
  if (!record || Number(record.is_publish) !== 1 || Number(record.is_deleted) !== 0 ||
      !/^\d+$/.test(String(record.news_id)) || Number(record.news_id) <= 0) return null;
  const startsAt = parseDdpmDate(record.news_date);
  if (!startsAt || startsAt > now || now - startsAt >= NEWS_MAX_AGE_MS) return null;
  const category = String(record.news_type_name || '');
  // Use the agency's category, never infer an emergency severity from headline keywords.
  if (!/^(ภัยทางถนน|อัคคีภัย|ภัยจากสารเคมีและวัตถุอันตราย|สารเคมีและวัตถุอันตราย|อุบัติภัย)$/.test(category)) return null;
  const title = String(record.news_title || '').trim();
  if (!title || /ฝึกซ้อม|ซ้อมแผน|โครงการอบรม|ประชุม|รณรงค์/.test(title)) return null;
  const province = String(record.province_name || record.news_province || '').trim();
  return {
    type: 'severe_accident', severity: 'watch', recordKind: 'news_report', timeKind: 'reported_event',
    title: title.slice(0, 300),
    message: 'ข่าวสถานการณ์จาก ปภ. เวลาเกิดเหตุตามรายงาน ไม่ใช่ประกาศยืนยันว่าอันตรายยังดำเนินอยู่ โปรดเปิดต้นทางเพื่อตรวจรายละเอียดล่าสุด',
    category: `ข่าวเฝ้าระวัง · ${category}`,
    areaText: province || 'ประเทศไทย โปรดตรวจพื้นที่จากต้นทาง', areaVerified: Boolean(province),
    source: 'กรมป้องกันและบรรเทาสาธารณภัย (DPM Reporter)',
    sourceUrl: `${DDPM_BASE}/disaster-news/${record.news_id}`,
    externalId: `ddpm-news:${record.news_id}`,
    startsAt, expiresAt: new Date(startsAt.getTime() + NEWS_MAX_AGE_MS), active: true,
  };
}

const fetchDdpmCandidates = newsFeed('ddpm', 'ข่าวอุบัติภัย ปภ.', `${DDPM_BASE}/disaster-news`, async (now) => {
  const thaiNow = new Date(now.getTime() + 7 * 3600000);
  const years = [thaiNow.getUTCFullYear()];
  if (thaiNow.getUTCMonth() === 0 && thaiNow.getUTCDate() === 1) years.push(years[0] - 1);
  const unique = new Map();
  for (const year of years) {
    // This is the public GET used by the agency's disaster-news page; bounded to 20 latest records/year.
    const response = await axios.get(`${DDPM_BASE}/services/disaster_news/get_news_list.php`, {
      params: { type: '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17', type_date: 3,
        date_start: String(year), date_end: String(year), province: 0, page_size: 20, page_number: 1 },
      timeout: 15000, maxContentLength: 2 * 1024 * 1024,
    });
    const records = response.data?.data?.data?.data;
    if (response.data?.status !== 'success' || !Array.isArray(records)) throw invalidNewsFormat();
    for (const record of records) {
      const item = ddpmRecordToCandidate(record, now);
      if (item) unique.set(item.externalId, item);
    }
  }
  return [...unique.values()];
});

async function fetchOfficialNewsCandidates(now = new Date()) {
  try { return await fetchDdpmCandidates(now); }
  catch { return fetchIndexedOfficialNews(now); }
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
  const results = await Promise.allSettled([fetchTmdCapCandidates(now), fetchAirQualityCandidates(now), fetchOfficialNewsCandidates(now)]);
  results.forEach((result, index) => { if (result.status === 'rejected') console.warn(`Official safety source ${['TMD CAP', 'Air4Thai', 'indexed news'][index]} unavailable:`, result.reason.code || 'fetch failed'); });
  if (results.every(result => result.status === 'rejected')) throw new Error('All official safety sources are unavailable');
  return results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
}

module.exports = {
  classifyThaiSafetyTitle,
  parseGdeltDate,
  isOfficialUrl,
  articleToCandidate,
  parseDdpmDate,
  ddpmRecordToCandidate,
  fetchDdpmCandidates,
  fetchOfficialNewsCandidates,
  getOfficialNewsStatus,
  capToCandidates,
  airStationToCandidate,
  fetchTmdCapCandidates,
  fetchAirQualityCandidates,
  fetchThaiOfficialSafetyAlertCandidates
};
