const mongoose = require('mongoose');
const config = require('../config');

function isValidLineUserId(userId) {
  return /^U[0-9a-f]{32}$/i.test(String(userId || '').trim());
}

function normalizeLineUserId(userId) {
  return isValidLineUserId(userId) ? String(userId).trim() : null;
}

async function rememberLineRecipient(userId) {
  const normalizedUserId = normalizeLineUserId(userId);
  if (!normalizedUserId || mongoose.connection.readyState !== 1) {
    return false;
  }

  await mongoose.connection.collection('line_recipients').updateOne(
    { userId: normalizedUserId },
    {
      $set: { userId: normalizedUserId, active: true, lastSeenAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return true;
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

async function listActiveLineRecipients() {
  const recipients = new Set();
  const configuredUserId = normalizeLineUserId(config.lineUserId);

  if (configuredUserId) {
    recipients.add(configuredUserId);
  }

  if (mongoose.connection.readyState !== 1) {
    return [...recipients];
  }

  const saved = await mongoose.connection.collection('line_recipients')
    .find({ active: true, userId: { $type: 'string', $ne: '' } })
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

  return [...recipients];
}

module.exports = {
  isValidLineUserId,
  rememberLineRecipient,
  recoverLineRecipient,
  listActiveLineRecipients
};
