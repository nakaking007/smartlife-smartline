require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const config = require('../config');

const WIDTH = 2500;
const HEIGHT = 1686;
const OUTPUT = path.join(__dirname, '..', 'public', 'rich-menu.png');
const items = [
  { label: 'วันนี้', subtitle: 'ภาพรวมของคุณ', view: 'today', icon: '<path d="M18 7v4M38 7v4M10 21h36M14 11h28a4 4 0 0 1 4 4v29a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V15a4 4 0 0 1 4-4Z"/><path d="m21 34 5 5 10-11"/>' },
  { label: 'นัดหมาย', subtitle: 'ตารางและสิ่งที่ต้องทำ', view: 'schedule', icon: '<circle cx="28" cy="28" r="20"/><path d="M28 15v14l9 6"/>' },
  { label: 'เตือนภัย', subtitle: 'ประกาศและข่าวเฝ้าระวัง', view: 'alerts', icon: '<path d="M28 7 50 45H6Z"/><path d="M28 21v11M28 39v1"/>' },
  { label: 'คุยกับ AI', subtitle: 'ถามได้ คุยต่อได้', text: 'คุยกับ AI', icon: '<path d="M12 10h32a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6H23L10 52V16a6 6 0 0 1 6-6Z"/><path d="M20 24h16M20 32h11"/><path d="m43 4 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/>' },
  { label: 'ช่วยเหลือ', subtitle: 'ติดต่อบริการฉุกเฉิน', view: 'help', icon: '<path d="M15 8 8 14c-4 13 19 36 32 33l8-8-11-9-6 6c-7-3-12-8-15-15l6-5Z"/>' },
  { label: 'ตั้งค่า / คู่มือ', subtitle: 'พื้นที่รับเตือนและวิธีใช้', view: 'guide', icon: '<path d="M8 16h40M8 28h40M8 40h40"/><circle cx="20" cy="16" r="5" fill="#133d52"/><circle cx="37" cy="28" r="5" fill="#133d52"/><circle cx="24" cy="40" r="5" fill="#133d52"/>' }
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
    const accent = index === 2 ? '#ffd19b' : index === 3 ? '#b7a6ff' : '#80e9ce';
    const fill = index === 3 ? '#262c4f' : '#12394c';
    return `<g transform="translate(${x},${y})">
      <rect x="25" y="25" width="783" height="793" rx="52" fill="${fill}" stroke="#315464" stroke-width="2"/>
      <rect x="68" y="68" width="102" height="8" rx="4" fill="${accent}"/>
      <circle cx="416" cy="276" r="112" fill="${accent}" fill-opacity=".09"/>
      <g transform="translate(339,199) scale(2.75)" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${item.icon}</g>
      <text x="416" y="501" text-anchor="middle" font-family="Leelawadee UI,Noto Sans Thai,sans-serif" font-size="76" font-weight="700" fill="#f6fbff">${escapeXml(item.label)}</text>
      <text x="416" y="579" text-anchor="middle" font-family="Leelawadee UI,Noto Sans Thai,sans-serif" font-size="39" fill="#bed0dc">${escapeXml(item.subtitle)}</text>
      <text x="78" y="751" font-family="Arial,sans-serif" font-size="26" letter-spacing="4" fill="#a0bccb">SMARTLIFE</text>
      <circle cx="727" cy="738" r="27" fill="${accent}" fill-opacity=".12"/>
      <path d="m717 729 10 9-10 9" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <rect width="100%" height="100%" fill="#081f30"/>${cells}</svg>`;
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
    selected: activate,
    name: activate ? 'SmartLife Main 2026' : 'SmartLife Preview 2026',
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
    const receipt = { richMenuId, createdAt: new Date().toISOString(), activated: false, size: verified.data.size, areas: verified.data.areas };
    fs.writeFileSync(path.join(__dirname, '..', 'rich-menu-stage.json'), JSON.stringify(receipt, null, 2) + '\n');
  }
  console.log(JSON.stringify({ status: 'ok', activated: activate, richMenuId, image: OUTPUT }));
  return richMenuId;
}

if (require.main === module) {
  const task = process.argv.includes('--preview') ? generateImage().then(output => console.log(output)) : setupRichMenu({ activate: !process.argv.includes('--stage') });
  task.catch(err => {
    console.error(err.response?.data || err.message);
    process.exit(1);
  });
}

module.exports = { buildSvg, buildAreas, generateImage, setupRichMenu };
