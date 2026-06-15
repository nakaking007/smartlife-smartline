const express = require('express');
const earthquakeWarnings = require('../utils/earthquakeWarnings');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await earthquakeWarnings.listRecentWarnings(Number(req.query.limit) || 10);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await earthquakeWarnings.syncEarthquakeWarnings({ force: req.query.force === 'true' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
