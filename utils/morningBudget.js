const axios = require('axios');
const config = require('../config');
const { getBangkokDateKey } = require('./time');

const FREE_MONTHLY_MESSAGE_CAP = 300;

function planMorningMessages(quota, consumption, recipients, now = new Date()) {
  if (!['limited', 'none'].includes(quota?.type) ||
      (quota.type === 'limited' && (!Number.isSafeInteger(quota.value) || quota.value < 0)) ||
      !Number.isSafeInteger(consumption?.totalUsage) || consumption.totalUsage < 0) {
    throw new Error('Invalid LINE quota response');
  }
  const limit = quota.type === 'limited'
    ? Math.min(quota.value, FREE_MONTHLY_MESSAGE_CAP) : FREE_MONTHLY_MESSAGE_CAP;
  const remaining = Math.max(0, limit - consumption.totalUsage);
  const [year, month, day] = getBangkokDateKey(now).split('-').map(Number);
  const daysRemaining = new Date(Date.UTC(year, month, 0)).getUTCDate() - day + 1;
  const candidates = [...new Set(recipients)].sort();
  const summary = { limit, used: consumption.totalUsage, remaining, daysRemaining };
  if (!candidates.length) return { ...summary, status: 'no_recipients', recipients: [] };
  if (!remaining) return { ...summary, status: 'quota_exhausted', recipients: [] };

  // Reserve room for the remaining days instead of spending the monthly balance at once.
  let dailyBudget = Math.floor(remaining / daysRemaining);
  if (!dailyBudget && daysRemaining % Math.ceil(daysRemaining / remaining) === 0) dailyBudget = 1;
  const count = Math.min(candidates.length, remaining, dailyBudget);
  // Rotation follows consumed units, so a reduced daily allowance does not always select one user.
  const start = consumption.totalUsage % candidates.length;
  const selected = Array.from({ length: count }, (_, index) => candidates[(start + index) % candidates.length]);
  return {
    ...summary,
    status: count ? (count < candidates.length ? 'reduced' : 'ready') : 'paced',
    recipients: selected,
  };
}

async function checkMorningBudget(recipients, now = new Date(), options = {}) {
  if (!recipients.length) return { status: 'no_recipients', recipients: [] };
  const token = options.accessToken ?? config.lineAccessToken;
  if (!token) return { status: 'quota_unavailable', recipients: [] };
  const client = options.client || axios;
  try {
    const settings = { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 };
    const [quota, consumption] = await Promise.all([
      client.get('https://api.line.me/v2/bot/message/quota', settings),
      client.get('https://api.line.me/v2/bot/message/quota/consumption', settings),
    ]);
    return planMorningMessages(quota.data, consumption.data, recipients, now);
  } catch {
    // Fail closed; never disclose request configuration, headers or tokens in an error log.
    return { status: 'quota_unavailable', recipients: [] };
  }
}

function nextBudgetCheck(status, now = new Date()) {
  if (status === 'quota_unavailable') return new Date(now.getTime() + 15 * 60 * 1000);
  return new Date(new Date(`${getBangkokDateKey(now)}T00:00:00+07:00`).getTime() + 86400000);
}

module.exports = { FREE_MONTHLY_MESSAGE_CAP, planMorningMessages, checkMorningBudget, nextBudgetCheck };
