require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const axios = require('axios');
const sharp = require('sharp');
const config = require('../config');

const WIDTH = 2500;
const HEIGHT = 1686;
const OUTPUT = path.join(__dirname, '..', 'public', 'rich-menu.png');
const STAGE_RECEIPT = path.join(__dirname, '..', 'rich-menu-stage.json');
const items = [
  { label: 'วันนี้', subtitle: 'อากาศและสิ่งที่ต้องทำ', view: 'today', color: '#65e3d3', shade: '#123c4a', icon: '<path d="M18 7v4M38 7v4M10 21h36M14 11h28a4 4 0 0 1 4 4v29a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z"/><path d="m21 34 5 5 10-11"/>' },
  { label: 'นัดหมาย', subtitle: 'ตารางและ To-do', view: 'schedule', color: '#80baff', shade: '#172d53', icon: '<circle cx="28" cy="28" r="20"/><path d="M28 15v14l9 6"/>' },
  { label: 'เตือนภัย', subtitle: 'เหตุสำคัญและข่าวติดตาม', view: 'alerts', color: '#ffc27b', shade: '#4b322f', icon: '<path d="M28 7 50 45H6Z"/><path d="M28 21v11M28 39v1"/>' },
  { label: 'คุยกับ AI', subtitle: 'ถามและคุยต่อในแชต', text: 'คุยกับ AI', color: '#b6a0ff', shade: '#302951', icon: '<path d="M12 10h32a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6H23L10 52V16a6 6 0 0 1 6-6Z"/><path d="M20 24h16M20 32h11"/><path d="m43 4 2 5 5 2-5 2-2 5-5-2 5-2Z"/>' },
  { label: 'ช่วยเหลือ', subtitle: 'ช่องทางฉุกเฉินที่ควรรู้', view: 'help', color: '#8be2aa', shade: '#193e3b', icon: '<path d="M15 8 8 14c-4 13 19 36 32 33l8-8-11-9-6 6c-7-3-12-8-15-15l6-5Z"/>' },
  { label: 'ตั้งค่า / คู่มือ', subtitle: 'เลือกพื้นที่และวิธีใช้', view: 'guide', color: '#a4d6e4', shade: '#203947', icon: '<path d="M8 16h40M8 28h40M8 40h40"/><circle cx="20" cy="16" r="5" fill="#142a3c"/><circle cx="37" cy="28" r="5" fill="#142a3c"/><circle cx="24" cy="40" r="5" fill="#142a3c"/>' }
];

function buildAreas(liffBase) {
  return items.map((item, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = Math.round(column * WIDTH / 3);
    const right = Math.round((column + 1) * WIDTH / 3);
    return {
      bounds: { x, y: row * HEIGHT / 2, width: right - x, height: HEIGHT / 2 },
      action: item.text ? { type: 'message', label: item.label, text: item.text }
        : { type: 'uri', label: item.label, uri: `${liffBase}?view=${item.view}` }
    };
  });
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function buildSvg() {
  const cells = items.map((item, index) => {
    const x = (index % 3) * WIDTH / 3;
    const y = Math.floor(index / 3) * HEIGHT / 2;
    const accent = item.color;
    return `<g transform="translate(${x},${y})">
      <rect x="23" y="23" width="787" height="797" rx="54" fill="url(#card${index})" stroke="${accent}" stroke-opacity=".24" stroke-width="3"/>
      <circle cx="730" cy="58" r="214" fill="${accent}" fill-opacity=".06"/>
      <circle cx="720" cy="70" r="150" fill="none" stroke="${accent}" stroke-opacity=".12" stroke-width="2"/>
      <rect x="67" y="65" width="166" height="56" rx="28" fill="${accent}" fill-opacity=".15"/>
      <text x="150" y="103" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="700" letter-spacing="3" fill="${accent}">0${index + 1} / 06</text>
      <rect x="67" y="171" width="220" height="220" rx="57" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".3" stroke-width="3"/>
      <g transform="translate(99,202) scale(2.75)" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${item.icon}</g>
      <text x="69" y="518" font-family="Leelawadee UI,Noto Sans Thai,sans-serif" font-size="78" font-weight="700" fill="#f8fcff">${escapeXml(item.label)}</text>
      <text x="71" y="587" font-family="Leelawadee UI,Noto Sans Thai,sans-serif" font-size="38" fill="#cad9e3">${escapeXml(item.subtitle)}</text>
      <path d="M69 647H759" stroke="#ffffff" stroke-opacity=".12" stroke-width="2"/>
      <rect x="69" y="687" width="194" height="73" rx="36" fill="${accent}"/>
      <text x="166" y="734" text-anchor="middle" font-family="Leelawadee UI,Noto Sans Thai,sans-serif" font-size="31" font-weight="700" fill="#10273a">เปิดดู</text>
      <path d="m715 712 14 12-14 12" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>${items.map((item, index) => `<linearGradient id="card${index}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${item.shade}"/><stop offset="1" stop-color="#10283b"/></linearGradient>`).join('')}</defs>
    <rect width="100%" height="100%" fill="#071827"/>${cells}</svg>`;
}

async function generateImage() {
  await sharp(Buffer.from(buildSvg())).png({ compressionLevel: 9 }).toFile(OUTPUT);
  return OUTPUT;
}

async function setupRichMenu({ activate = true } = {}) {
  if (!config.lineAccessToken) throw new Error('LINE_ACCESS_TOKEN is not configured');
  if (!config.liffId) throw new Error('LIFF_ID is not configured');
  await generateImage();
  const headers = { Authorization: `Bearer ${config.lineAccessToken}`, 'Content-Type': 'application/json' };
  const liffBase = `https://liff.line.me/${config.liffId}`;
  const richMenu = {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: activate ? 'SmartLife Focus 2026' : 'SmartLife Focus Preview 2026',
    chatBarText: 'เมนู SmartLife',
    areas: buildAreas(liffBase)
  };
  const created = await axios.post('https://api.line.me/v2/bot/richmenu', richMenu, { headers, timeout: 20000 });
  const richMenuId = created.data.richMenuId;
  await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, fs.createReadStream(OUTPUT), {
    headers: { Authorization: `Bearer ${config.lineAccessToken}`, 'Content-Type': 'image/png' },
    maxBodyLength: Infinity,
    timeout: 30000
  });
  const verified = await axios.get(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, { headers, timeout: 20000 });
  if (verified.data.size?.width !== WIDTH || verified.data.size?.height !== HEIGHT || verified.data.areas?.length !== items.length) {
    throw new Error('Uploaded rich menu did not pass verification');
  }
  if (activate) {
    await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, null, {
      headers: { Authorization: `Bearer ${config.lineAccessToken}` },
      timeout: 20000
    });
  } else {
    const image = await axios.get(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
      headers: { Authorization: `Bearer ${config.lineAccessToken}` }, responseType: 'arraybuffer', timeout: 20000
    });
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    const imageSha256 = hash(fs.readFileSync(OUTPUT));
    if (hash(Buffer.from(image.data)) !== imageSha256) throw new Error('Uploaded rich menu image does not match local preview');
    let previousDefaultRichMenuId = null;
    try {
      const previous = await axios.get('https://api.line.me/v2/bot/user/all/richmenu', { headers, timeout: 20000 });
      previousDefaultRichMenuId = previous.data.richMenuId || null;
    } catch (err) {
      if (err.response?.status !== 404) throw err;
    }
    const receipt = { richMenuId, createdAt: new Date().toISOString(), activated: false, size: verified.data.size,
      areas: verified.data.areas, previousDefaultRichMenuId, imageSha256, verifiedAt: new Date().toISOString() };
    fs.writeFileSync(STAGE_RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: 'ok', activated: activate, richMenuId, image: OUTPUT }));
  return richMenuId;
}

async function activateStagedRichMenu() {
  if (!config.lineAccessToken) throw new Error('LINE_ACCESS_TOKEN is not configured');
  const receipt = JSON.parse(fs.readFileSync(STAGE_RECEIPT, 'utf8'));
  if (!/^richmenu-[a-f0-9]{32}$/.test(receipt.richMenuId) || receipt.activated || receipt.areas?.length !== items.length ||
      crypto.createHash('sha256').update(fs.readFileSync(OUTPUT)).digest('hex') !== receipt.imageSha256) {
    throw new Error('No valid inactive staged rich menu');
  }
  const headers = { Authorization: `Bearer ${config.lineAccessToken}` };
  const verified = await axios.get(`https://api.line.me/v2/bot/richmenu/${receipt.richMenuId}`, { headers, timeout: 20000 });
  const expectedAreas = buildAreas(`https://liff.line.me/${config.liffId}`);
  if (verified.data.size?.width !== WIDTH || verified.data.size?.height !== HEIGHT ||
      !isDeepStrictEqual(verified.data.areas, expectedAreas)) {
    throw new Error('Staged rich menu areas do not match current app links');
  }
  await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${receipt.richMenuId}`, null, { headers, timeout: 20000 });
  receipt.activated = true;
  receipt.activatedAt = new Date().toISOString();
  fs.writeFileSync(STAGE_RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'ok', activated: true, richMenuId: receipt.richMenuId }));
  return receipt.richMenuId;
}

if (require.main === module) {
  const task = process.argv.includes('--preview') ? generateImage().then(output => console.log(output))
    : process.argv.includes('--activate-stage') ? activateStagedRichMenu()
      : setupRichMenu({ activate: !process.argv.includes('--stage') });
  task.catch(err => {
    console.error(err.response?.data || err.message);
    process.exit(1);
  });
}

module.exports = { buildSvg, buildAreas, generateImage, setupRichMenu, activateStagedRichMenu };
