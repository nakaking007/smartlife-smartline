const axios = require('axios');

function cleanTitle(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

async function searchThaiWikipedia(query) {
  const res = await axios.get('https://th.wikipedia.org/w/api.php', {
    params: {
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: 1,
      format: 'json',
      origin: '*'
    },
    headers: {
      'User-Agent': 'SmartLifeScheduler/1.0 (LINE bot; local user project)'
    },
    timeout: 15000
  });
  const first = res.data &&
    res.data.query &&
    Array.isArray(res.data.query.search) &&
    res.data.query.search[0];

  return first ? cleanTitle(first.title) : '';
}

async function fetchThaiWikipediaSummary(title) {
  const res = await axios.get(`https://th.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
    headers: {
      'User-Agent': 'SmartLifeScheduler/1.0 (LINE bot; local user project)'
    },
    timeout: 15000
  });

  return res.data || {};
}

async function answerKnowledgeQuestion(query) {
  const normalizedQuery = cleanTitle(query);
  if (!normalizedQuery) {
    return 'พิมพ์ /ความรู้ ตามด้วยเรื่องที่อยากรู้ เช่น /ความรู้ โรคเบาหวาน';
  }

  const title = await searchThaiWikipedia(normalizedQuery) || normalizedQuery;
  const summary = await fetchThaiWikipediaSummary(title);
  const extract = cleanTitle(summary.extract);

  if (!extract) {
    return [
      `ยังไม่พบสรุปความรู้เรื่อง "${normalizedQuery}" จากวิกิพีเดียไทยค่ะ`,
      'ลองใช้คำที่กว้างขึ้น หรือใช้ชื่อบุคคล/สถานที่/โรค/สิ่งของที่เป็นทางการ'
    ].join('\n');
  }

  return [
    `ความรู้: ${summary.title || title}`,
    '',
    extract.length > 1200 ? `${extract.slice(0, 1200)}...` : extract,
    '',
    summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page
      ? `อ่านต่อ: ${summary.content_urls.desktop.page}`
      : 'ที่มา: Wikipedia ภาษาไทย',
    '',
    'หมายเหตุ: เป็นสารานุกรมสาธารณะ ไม่ใช่คำวินิจฉัยแพทย์/กฎหมาย/การเงิน'
  ].join('\n');
}

module.exports = {
  answerKnowledgeQuestion,
  searchThaiWikipedia,
  fetchThaiWikipediaSummary
};
