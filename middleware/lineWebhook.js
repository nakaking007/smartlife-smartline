const { validateSignature } = require('@line/bot-sdk');

function isValidLineSignature(rawBody, signature, channelSecret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !channelSecret) return false;
  return validateSignature(rawBody, channelSecret, String(signature));
}

module.exports = { isValidLineSignature };
