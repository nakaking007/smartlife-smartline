const mongoose = require('mongoose');
const config = require('../config');

function isValidLineUserId(userId) {
  return /^U[0-9a-f]{32}$/i.test(String(userId || '').trim());
}

function normalizeLineUserId(userId) {
  return isValidLineUserId(userId) ? String(userId).trim() : null;
}

async function rememberLineRecipient(userId, profile = {}) {
  const normalizedUserId = normalizeLineUserId(userId);
  if (!normalizedUserId || mongoose.connection.readyState !== 1) {
    return false;
  }

  await mongoose.connection.collection('line_recipients').updateOne(
    { userId: normalizedUserId },
    {
      $set: {
        userId: normalizedUserId,
        active: true,
        lastSeenAt: new Date(),
        ...(profile.displayName ? { displayName: String(profile.displayName).slice(0, 120) } : {}),
        ...(profile.pictureUrl ? { pictureUrl: String(profile.pictureUrl).slice(0, 1000) } : {})
      },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return true;
}

async function deactivateLineRecipient(userId) {
  const normalizedUserId = normalizeLineUserId(userId);
  if (!normalizedUserId || mongoose.connection.readyState !== 1) return false;
  await mongoose.connection.collection('line_recipients').updateOne(
    { userId: normalizedUserId },
    { $set: { active: false, unfollowedAt: new Date() } }
  );
  return true;
}

async function getLineRecipient(userId) {
  const normalizedUserId = normalizeLineUserId(userId);
  if (!normalizedUserId || mongoose.connection.readyState !== 1) return null;
  return mongoose.connection.collection('line_recipients').findOne(
    { userId: normalizedUserId },
    { projection: { _id: 0, userId: 1, displayName: 1, pictureUrl: 1, active: 1, province: 1, alertPreferences: 1, morningReport: 1 } }
  );
}

async function updateLineRecipient(userId, changes = {}) {
  const normalizedUserId = normalizeLineUserId(userId);
  if (!normalizedUserId || mongoose.connection.readyState !== 1) return null;
  const allowed = {};
  if (changes.province !== undefined) allowed.province = String(changes.province || '').trim().slice(0, 80);
  if (changes.morningReport !== undefined) allowed.morningReport = Boolean(changes.morningReport);
  if (changes.alertPreferences && typeof changes.alertPreferences === 'object') {
    allowed.alertPreferences = {
      disaster: changes.alertPreferences.disaster !== false,
      severeWeather: changes.alertPreferences.severeWeather !== false,
      publicSafety: changes.alertPreferences.publicSafety !== false,
      severeAccident: changes.alertPreferences.severeAccident !== false
    };
  }
  await mongoose.connection.collection('line_recipients').updateOne(
    { userId: normalizedUserId },
    { $set: { ...allowed, updatedAt: new Date() }, $setOnInsert: { userId: normalizedUserId, active: true, createdAt: new Date() } },
    { upsert: true }
  );
  return getLineRecipient(normalizedUserId);
}

async function recoverLineRecipient() {
  const configuredUserId = normalizeLineUserId(config.lineUserId);
  if (configuredUserId || mongoose.connection.readyState !== 1) {
    return configuredUserId;
  }

  const saved = await mongoose.connection.collection('line_recipients')
    .findOne({ active: true }, { sort: { lastSeenAt: -1 } });
  let userId = normalizeLineUserId(saved && saved.userId);

  if (!userId) {
    const previousAlert = await mongoose.connection.collection('alerts')
      .findOne({ 'sentTo.0': { $exists: true } }, { sort: { updatedAt: -1 } });
    userId = previousAlert && Array.isArray(previousAlert.sentTo)
      ? previousAlert.sentTo.map(normalizeLineUserId).find(Boolean)
      : null;
  }

  if (userId) {
    await rememberLineRecipient(userId);
  }

  return userId || null;
}

async function listActiveLineRecipients(options = {}) {
  const recipients = new Set();
  const configuredUserId = normalizeLineUserId(config.lineUserId);

  if (configuredUserId) {
    recipients.add(configuredUserId);
  }

  if (mongoose.connection.readyState !== 1) {
    return [...recipients];
  }

  const recipientQuery = { active: true, userId: { $type: 'string', $ne: '' } };
  if (options.morningReportOnly) recipientQuery.morningReport = { $ne: false };
  const saved = await mongoose.connection.collection('line_recipients')
    .find(recipientQuery)
    .sort({ lastSeenAt: -1 })
    .limit(500)
    .toArray();

  saved
    .map(item => normalizeLineUserId(item.userId))
    .filter(Boolean)
    .forEach(userId => recipients.add(userId));

  const registeredUsers = await mongoose.connection.collection('users')
    .find({ lineUserId: { $type: 'string', $ne: '' } })
    .project({ lineUserId: 1 })
    .limit(500)
    .toArray();

  registeredUsers
    .map(user => normalizeLineUserId(user.lineUserId))
    .filter(Boolean)
    .forEach(userId => recipients.add(userId));

  const candidateIds = [...recipients];
  if (!candidateIds.length) return [];

  const blockedConditions = [{ active: false }];
  if (options.morningReportOnly) blockedConditions.push({ morningReport: false });
  const blocked = await mongoose.connection.collection('line_recipients')
    .find({ userId: { $in: candidateIds }, $or: blockedConditions })
    .project({ userId: 1 })
    .toArray();
  const blockedIds = new Set(blocked.map(item => normalizeLineUserId(item.userId)).filter(Boolean));

  return candidateIds.filter(userId => !blockedIds.has(userId));
}

async function shouldReceiveAlert(userId, alert = {}) {
  const saved = await getLineRecipient(userId);
  const preferences = saved?.alertPreferences || {};
  const type = String(alert.type || '').toLowerCase();
  if (/storm|typhoon|cyclone|thunder|rain|weather|พายุ|ฝน/.test(type)) return preferences.severeWeather !== false;
  if (/riot|civil_unrest|public_safety|security|จราจล/.test(type)) return preferences.publicSafety !== false;
  if (/accident|industrial|fire|hazmat|อุบัติภัย|อุบัติเหตุ/.test(type)) return preferences.severeAccident !== false;
  return preferences.disaster !== false;
}

module.exports = {
  isValidLineUserId,
  rememberLineRecipient,
  deactivateLineRecipient,
  getLineRecipient,
  updateLineRecipient,
  recoverLineRecipient,
  listActiveLineRecipients,
  shouldReceiveAlert
};
