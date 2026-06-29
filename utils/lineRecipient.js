const mongoose = require('mongoose');
const config = require('../config');

async function rememberLineRecipient(userId) {
  if (!userId || mongoose.connection.readyState !== 1) {
    return false;
  }

  config.lineUserId = userId;
  await mongoose.connection.collection('line_recipients').updateOne(
    { userId },
    {
      $set: { userId, active: true, lastSeenAt: new Date() },
      $setOnInsert: { createdAt: new Date() }
    },
    { upsert: true }
  );
  return true;
}

async function recoverLineRecipient() {
  if (config.lineUserId || mongoose.connection.readyState !== 1) {
    return config.lineUserId || null;
  }

  const saved = await mongoose.connection.collection('line_recipients')
    .findOne({ active: true }, { sort: { lastSeenAt: -1 } });
  let userId = saved && saved.userId;

  if (!userId) {
    const previousAlert = await mongoose.connection.collection('alerts')
      .findOne({ 'sentTo.0': { $exists: true } }, { sort: { updatedAt: -1 } });
    userId = previousAlert && Array.isArray(previousAlert.sentTo)
      ? previousAlert.sentTo[0]
      : null;
  }

  if (userId) {
    await rememberLineRecipient(userId);
  }

  return userId || null;
}

module.exports = {
  rememberLineRecipient,
  recoverLineRecipient
};
