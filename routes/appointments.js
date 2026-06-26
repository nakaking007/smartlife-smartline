const express = require('express');
const appointments = require('../utils/appointments');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await appointments.listAppointments({
      status: req.query.status,
      activeOnly: req.query.activeOnly === 'true',
      limit: Number(req.query.limit) || 50
    });

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/duplicates', async (req, res) => {
  try {
    const groups = await appointments.findPotentialDuplicates();
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const repeat = req.body.repeat || req.body.recurrence;
    const count = Number(req.body.count || req.body.times || 1);
    const result = repeat || count > 1
      ? await appointments.createRecurringAppointments(req.body)
      : await appointments.createAppointment(req.body);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:id/copy', async (req, res) => {
  try {
    const appointment = await appointments.copyAppointment(req.params.id, req.body);
    res.status(201).json(appointment);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const appointment = await appointments.updateAppointment(req.params.id, req.body);
    res.json(appointment);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const appointment = await appointments.deleteAppointment(req.params.id);
    res.json(appointment);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
