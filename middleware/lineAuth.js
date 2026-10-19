const axios = require('axios');
const config = require('../config');
const lineRecipient = require('../utils/lineRecipient');

const tokenCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function authError(code) {
  return Object.assign(new Error(code), { code });
}

function getBearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function verifyLineIdToken(idToken, client = axios) {
  if (!idToken) throw authError('LINE_AUTH_REQUIRED');
  if (!config.lineLoginChannelId) throw authError('LINE_LOGIN_NOT_CONFIGURED');

  const cached = tokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;
  tokenCache.delete(idToken);

  const form = new URLSearchParams({
    id_token: idToken,
    client_id: String(config.lineLoginChannelId)
  });
  let response;
  try {
    response = await client.post('https://api.line.me/oauth2/v2.1/verify', form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000
    });
  } catch (err) {
    throw authError([400, 401].includes(err.response?.status) ? 'LINE_AUTH_REQUIRED' : 'LINE_AUTH_UNAVAILABLE');
  }
  const profile = response.data || {};
  if (!/^U[0-9a-f]{32}$/i.test(String(profile.sub || ''))) {
    throw authError('LINE_AUTH_REQUIRED');
  }

  const expiresAt = Number(profile.exp) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw authError('LINE_AUTH_REQUIRED');
  for (const [key, entry] of tokenCache) if (entry.expiresAt <= Date.now()) tokenCache.delete(key);
  if (tokenCache.size >= 1000) tokenCache.delete(tokenCache.keys().next().value);
  tokenCache.set(idToken, { profile, expiresAt: Math.min(expiresAt, Date.now() + CACHE_TTL_MS) });
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
    try { await lineRecipient.rememberLineRecipient(profile.sub, req.lineProfile); }
    catch { throw authError('LINE_PROFILE_UNAVAILABLE'); }
    next();
  } catch (err) {
    const unavailable = ['LINE_LOGIN_NOT_CONFIGURED', 'LINE_AUTH_UNAVAILABLE', 'LINE_PROFILE_UNAVAILABLE'].includes(err.code);
    res.status(unavailable ? 503 : 401).json({
      code: unavailable ? err.code : 'LINE_AUTH_REQUIRED',
      error: unavailable ? 'ระบบเชื่อมต่อ LINE หรือบันทึกบัญชีไม่พร้อม กรุณาลองใหม่ภายหลัง' : 'กรุณาเข้าสู่ระบบ LINE ใหม่ก่อนใช้งาน'
    });
  }
}

module.exports = { getBearerToken, verifyLineIdToken, requireLineUser };
