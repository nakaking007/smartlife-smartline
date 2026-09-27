require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config');
const { configureMongoDns } = require('../utils/mongoDns');
const { isValidLineUserId } = require('../utils/lineRecipient');

const missingOwner = {
  $or: [
    { lineUserId: { $exists: false } },
    { lineUserId: null },
    { lineUserId: '' }
  ]
};

async function migrateLegacyOwner() {
  const owner = process.env.LEGACY_OWNER_LINE_USER_ID || config.lineUserId;
  if (!isValidLineUserId(owner)) throw new Error('LEGACY_OWNER_LINE_USER_ID or LINE_USER_ID is invalid');
  configureMongoDns();
  await mongoose.connect(config.mongoUri);
  const collections = ['appointments', 'todos'];
  const snapshot = { exportedAt: new Date().toISOString(), collections: {} };
  for (const name of collections) {
    snapshot.collections[name] = await mongoose.connection.collection(name).find(missingOwner).toArray();
  }
  const backupDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `legacy-owner-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), { flag: 'wx' });
  const results = {};
  for (const name of collections) {
    results[name] = await mongoose.connection.collection(name).updateMany(missingOwner, {
      $set: { lineUserId: owner, ownerMigratedAt: new Date() }
    });
  }
  console.log(JSON.stringify({
    backupPath,
    appointments: results.appointments.modifiedCount,
    todos: results.todos.modifiedCount
  }));
  await mongoose.disconnect();
}

if (require.main === module) {
  migrateLegacyOwner().catch(async err => {
    console.error(err.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  });
}

module.exports = { migrateLegacyOwner };
