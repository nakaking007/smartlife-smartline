require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const config = require('../config');

const WIDTH = 2500;
const HEIGHT = 843;
const OUTPUT = path.join(__dirname, '..', 'public', 'rich-menu.png');
const items = [
  { label: 'วันนี้', subtitle: 'ภาพรวมประจำวัน', icon: '01' },
  { label: 'นัดหมาย', subtitle: 'ตารางและ To-do', icon: '02' },
  { label: 'ภัยเตือน', subtitle: 'เหตุสำคัญล่าสุด', icon: '03' },
  { label: 'ช่วยเหลือ', subtitle: 'โทรฉุกเฉิน', icon: '04' },
  { label: 'คู่มือ', subtitle: 'คำสั่งทั้งหมด', icon: '05' }
];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function buildSvg() {
  const cellWidth = WIDTH / items.length;
  const cells = items.map((item, index) => {
    const x = index * cellWidth;
    const active = index === 0;
    return `<g>
      <rect x="${x}" y="0" width="${cellWidth}" height="${HEIGHT}" fill="${active ? '#087f5b' : '#ffffff'}"/>
      <rect x="${x + 1}" y="1" width="${cellWidth - 2}" height="${HEIGHT - 2}" fill="none" stroke="#dbe3df" stroke-width="2"/>
      <circle cx="${x + cellWidth / 2}" cy="260" r="92" fill="${active ? '#ffffff' : '#dff4eb'}"/>
      <text x="${x + cellWidth / 2}" y="285" text-anchor="middle" font-family="Arial,sans-serif" font-size="68" font-weight="700" fill="#087f5b">${item.icon}</text>
      <text x="${x + cellWidth / 2}" y="500" text-anchor="middle" font-family="Noto Sans Thai,Leelawadee UI,sans-serif" font-size="70" font-weight="700" fill="${active ? '#ffffff' : '#17201d'}">${escapeXml(item.label)}</text>
      <text x="${x + cellWidth / 2}" y="590" text-anchor="middle" font-family="Noto Sans Thai,Leelawadee UI,sans-serif" font-size="38" fill="${active ? '#dff4eb' : '#63706b'}">${escapeXml(item.subtitle)}</text>
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="100%" height="100%" fill="#ffffff"/>${cells}</svg>`;
}

async function generateImage() {
  await sharp(Buffer.from(buildSvg())).png({ compressionLevel: 9 }).toFile(OUTPUT);
  return OUTPUT;
}

async function setupRichMenu() {
  if (!config.lineAccessToken) throw new Error('LINE_ACCESS_TOKEN is not configured');
  if (!config.liffId) throw new Error('LIFF_ID is not configured');
  await generateImage();
  const headers = { Authorization: `Bearer ${config.lineAccessToken}`, 'Content-Type': 'application/json' };
  const cellWidth = WIDTH / items.length;
  const liffBase = `https://liff.line.me/${config.liffId}`;
  const richMenu = {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: 'SmartLife Main 2026',
    chatBarText: 'เมนู SmartLife',
    areas: items.map((item, index) => ({
      bounds: { x: Math.round(index * cellWidth), y: 0, width: Math.round(cellWidth), height: HEIGHT },
      action: { type: 'uri', label: item.label, uri: `${liffBase}?view=${['today', 'schedule', 'alerts', 'help', 'guide'][index]}` }
    }))
  };
  const created = await axios.post('https://api.line.me/v2/bot/richmenu', richMenu, { headers, timeout: 20000 });
  const richMenuId = created.data.richMenuId;
  await axios.post(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, fs.createReadStream(OUTPUT), {
    headers: { Authorization: `Bearer ${config.lineAccessToken}`, 'Content-Type': 'image/png' },
    maxBodyLength: Infinity,
    timeout: 30000
  });
  await axios.post(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, null, {
    headers: { Authorization: `Bearer ${config.lineAccessToken}` },
    timeout: 20000
  });
  console.log(JSON.stringify({ status: 'ok', richMenuId, image: OUTPUT }));
}

if (require.main === module) {
  setupRichMenu().catch(err => {
    console.error(err.response?.data || err.message);
    process.exit(1);
  });
}

module.exports = { buildSvg, generateImage, setupRichMenu };
