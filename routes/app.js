const express = require('express');
const { requireLineUser } = require('../middleware/lineAuth');
const lineRecipient = require('../utils/lineRecipient');
const appointments = require('../utils/appointments');
const todos = require('../utils/todos');
const alerts = require('../utils/alerts');
const weather = require('../utils/weather');
const freeServices = require('../utils/freeServices');

const router = express.Router();
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
router.use(requireLineUser);

router.get('/me', asyncRoute(async (req, res) => {
  const saved = await lineRecipient.getLineRecipient(req.lineUserId);
  res.json({
    displayName: req.lineProfile.displayName || saved?.displayName || '',
    pictureUrl: req.lineProfile.pictureUrl || saved?.pictureUrl || '',
    province: saved?.province || '',
    morningReport: saved?.morningReport !== false,
    alertPreferences: saved?.alertPreferences || {
      disaster: true,
      severeWeather: true,
      publicSafety: true,
      severeAccident: true
    }
  });
}));

router.patch('/me', asyncRoute(async (req, res) => {
  const saved = await lineRecipient.updateLineRecipient(req.lineUserId, req.body || {});
  res.json({
    province: saved?.province || '',
    morningReport: saved?.morningReport !== false,
    alertPreferences: saved?.alertPreferences || {}
  });
}));

router.get('/dashboard', asyncRoute(async (req, res) => {
  const [appointmentItems, todoItems, activeAlerts, weatherResult] = await Promise.all([
    appointments.getToday(new Date(), { lineUserId: req.lineUserId, includeLegacyForAdmin: false }),
    todos.getToday(new Date(), { lineUserId: req.lineUserId }),
    alerts.listActiveUrgentAlerts(new Date()),
    weather.getReport().catch(() => null)
  ]);
  res.json({
    appointments: appointmentItems,
    todos: todoItems,
    alerts: activeAlerts.slice(0, 8),
    weather: weatherResult
  });
}));

router.get('/alerts', asyncRoute(async (req, res) => {
  const items = await alerts.listActiveUrgentAlerts(new Date());
  res.json(items.slice(0, 50));
}));

router.get('/emergency', (req, res) => {
  res.json(freeServices.EMERGENCY_SERVICE_GROUPS);
});

module.exports = router;
