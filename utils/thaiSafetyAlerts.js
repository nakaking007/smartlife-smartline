const axios = require('axios');
const crypto = require('crypto');

const OFFICIAL_DOMAINS = ['disaster.go.th', 'prd.go.th', 'royalthaipolice.go.th', 'tmd.go.th'];
const QUERY = '(domain:disaster.go.th OR domain:prd.go.th OR domain:royalthaipolice.go.th OR domain:tmd.go.th) (น้ำท่วม OR พายุ OR ฝนตกหนัก OR จราจล OR เหตุความไม่สงบ OR อุบัติภัย OR อุบัติเหตุร้ายแรง OR ระเบิด OR ไฟไหม้)';

function classifyThaiSafetyTitle(title) {
  const text = String(title || '').toLowerCase();
  if (/น้ำท่วม|อุทกภัย|น้ำป่า|น้ำล้นตลิ่ง/.test(text)) return { type: 'flood', severity: 'warning' };
  if (/พายุ|ฝนตกหนัก|วาตภัย|ลมแรง/.test(text)) return { type: 'storm', severity: 'warning' };
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
    return OFFICIAL_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function articleToCandidate(article, now = new Date()) {
  const classification = classifyThaiSafetyTitle(article.title);
  if (!classification || !isOfficialUrl(article.url)) return null;
  const startsAt = parseGdeltDate(article.seendate) || now;
  if (now.getTime() - startsAt.getTime() > 30 * 60 * 60 * 1000) return null;
  const hash = crypto.createHash('sha256').update(String(article.url)).digest('hex').slice(0, 24);
  return {
    ...classification,
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

async function fetchThaiOfficialSafetyAlertCandidates(now = new Date()) {
  const response = await axios.get('https://api.gdeltproject.org/api/v2/doc/doc', {
    params: { query: QUERY, mode: 'ArtList', maxrecords: 50, format: 'json', timespan: '30h', sort: 'HybridRel' },
    timeout: 20000
  });
  const articles = Array.isArray(response.data?.articles) ? response.data.articles : [];
  const unique = new Map();
  articles.map(article => articleToCandidate(article, now)).filter(Boolean).forEach(item => unique.set(item.externalId, item));
  return [...unique.values()];
}

module.exports = {
  classifyThaiSafetyTitle,
  parseGdeltDate,
  isOfficialUrl,
  articleToCandidate,
  fetchThaiOfficialSafetyAlertCandidates
};
