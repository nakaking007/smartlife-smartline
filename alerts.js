const express = require("express");

const Alert = require("../models/alert");
const { dispatchAlert } = require("../services/alertDispatcher");
const { pollUsgsEarthquakes } = require("../services/earthquakeIngestor");
const { pollConfiguredRssFeeds } = require("../services/rssAlertIngestor");

const router = express.Router();

router.post("/", async (req, res) => {
  const apiKey = process.env.ALERT_INGEST_API_KEY;

  if (apiKey && req.get("x-api-key") !== apiKey) {
    return res.status(401).json({ message: "Invalid API key" });
  }

  try {
    const alert = await Alert.create(req.body);
    const result = await dispatchAlert(alert);

    res.status(201).json({
      alert,
      dispatched: result.sent,
      skipped: result.skipped
    });
  } catch (error) {
    res.status(400).json({ message: "Could not create alert", error: error.message });
  }
});

router.get("/", async (req, res) => {
  const alerts = await Alert.find().sort({ createdAt: -1 }).limit(50);
  res.json(alerts);
});

router.post("/poll-rss", async (req, res) => {
  const apiKey = process.env.ALERT_INGEST_API_KEY;

  if (apiKey && req.get("x-api-key") !== apiKey) {
    return res.status(401).json({ message: "Invalid API key" });
  }

  const results = await pollConfiguredRssFeeds();
  res.json({ results });
});

router.post("/poll-earthquakes", async (req, res) => {
  const apiKey = process.env.ALERT_INGEST_API_KEY;

  if (apiKey && req.get("x-api-key") !== apiKey) {
    return res.status(401).json({ message: "Invalid API key" });
  }

  const results = await pollUsgsEarthquakes();
  res.json(results);
});

module.exports = router;
