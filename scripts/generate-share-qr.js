require('dotenv').config();

const path = require('path');
const QRCode = require('qrcode');
const config = require('../config');

const OUTPUT = path.join(__dirname, '..', 'public', 'smartlife-share-qr.png');

function getAddFriendUrl() {
  return `https://line.me/R/ti/p/${encodeURIComponent(config.lineOfficialAccountId)}`;
}

async function generateShareQr() {
  await QRCode.toFile(OUTPUT, getAddFriendUrl(), {
    errorCorrectionLevel: 'H',
    type: 'png',
    width: 1024,
    margin: 4,
    color: { dark: '#087f5b', light: '#ffffff' }
  });
  return OUTPUT;
}

if (require.main === module) {
  generateShareQr().then(console.log).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { getAddFriendUrl, generateShareQr };
