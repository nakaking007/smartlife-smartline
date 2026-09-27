const axios = require('axios');
const config = require('../config');
const lineRecipient = require('../utils/lineRecipient');

const tokenCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function verifyLineIdToken(idToken, client = axios) {
  if (!idToken) throw new Error('LINE ID token is required');
  if (!config.lineLoginChannelId) throw new Error('LINE_LOGIN_CHANNEL_ID is not configured');

  const cached = tokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  const form = new URLSearchParams({
    id_token: idToken,
    client_id: String(config.lineLoginChannelId)
  });
  const response = await client.post('https://api.line.me/oauth2/v2.1/verify', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000
  });
  const profile = response.data || {};
  if (!/^U[0-9a-f]{32}$/i.test(String(profile.sub || ''))) {
    throw new Error('LINE ID token has no valid user');
  }

  const expiresInMs = Math.max(30000, Math.min(CACHE_TTL_MS, Number(profile.exp || 0) * 1000 - Date.now()));
  tokenCache.set(idToken, { profile, expiresAt: Date.now() + expiresInMs });
  return profile;
}

async function requireLineUser(req, res, next) {
  try {
    const profile = await verifyLineIdToken(getBearerToken(req));
    req.lineUserId = profile.sub;
    req.lineProfile = {
      userId: profile.sub,
      displayName: profile.name || '',
      pictureUrl: profile.picture || ''
    };
    await lineRecipient.rememberLineRecipient(profile.sub, req.lineProfile);
    next();
  } catch (err) {
    const notConfigured = /not configured/.test(err.message);
    res.status(notConfigured ? 503 : 401).json({ error: notConfigured ? err.message : 'LINE authentication required' });
  }
}

module.exports = { getBearerToken, verifyLineIdToken, requireLineUser };
