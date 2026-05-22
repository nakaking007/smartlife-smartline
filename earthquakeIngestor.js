const axios = require("axios");

const Alert = require("../models/alert");
const { dispatchAlert } = require("./alertDispatcher");

const DEFAULT_USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

async function pollUsgsEarthquakes() {
  const feedUrl = process.env.USGS_EARTHQUAKE_FEED || DEFAULT_USGS_FEED;
  const minMagnitude = Number(process.env.USGS_EARTHQUAKE_MIN_MAGNITUDE || 4.5);
  const maxAgeMinutes = Number(process.env.USGS_EARTHQUAKE_MAX_AGE_MINUTES || 180);
  const since = Date.now() - maxAgeMinutes * 60 * 1000;
  const response = await axios.get(feedUrl, { timeout: 15000 });
  const features = Array.isArray(response.data?.features) ? response.data.features : [];
  const results = [];

  for (const feature of features) {
    const props = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || [];
    const magnitude = Number(props.mag);
    const eventTime = Number(props.time);

    if (!Number.isFinite(magnitude) || magnitude < minMagnitude) continue;
    if (!Number.isFinite(eventTime) || eventTime < since) continue;
    if (!Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1])) continue;

    const externalId = feature.id || props.code || props.ids || props.url;
    if (!externalId) continue;

    const alertData = buildEarthquakeAlert({
      externalId,
      magnitude,
      place: props.place || "ไม่ระบุพื้นที่",
      eventTime,
      longitude: Number(coordinates[0]),
      latitude: Number(coordinates[1]),
      depthKm: Number(coordinates[2]),
      url: props.url || "",
      tsunami: Number(props.tsunami) === 1
    });

    try {
      const alert = await Alert.create(alertData);
      const dispatch = await dispatchAlert(alert);
      results.push({
        externalId,
        created: true,
        sent: dispatch.sent,
        skipped: dispatch.skipped,
        failed: dispatch.failed
      });
    } catch (error) {
      if (error.code === 11000) {
        results.push({ externalId, created: false, duplicate: true });
        continue;
      }

      results.push({ externalId, created: false, error: error.message });
    }
  }

  return {
    feedUrl,
    checked: features.length,
    results
  };
}

function buildEarthquakeAlert({ externalId, magnitude, place, eventTime, latitude, longitude, depthKm, url, tsunami }) {
  const occurredAt = new Date(eventTime);
  const type = tsunami ? "tsunami" : "earthquake";
  const severity = tsunami ? "critical" : severityFromMagnitude(magnitude);
  const radiusKm = alertRadiusFromMagnitude(magnitude, tsunami);
  const depthText = Number.isFinite(depthKm) ? ` ความลึกประมาณ ${depthKm.toFixed(1)} กม.` : "";

  return {
    type,
    severity,
    title: tsunami
      ? `เฝ้าระวังสึนามิจากแผ่นดินไหว M${magnitude.toFixed(1)}`
      : `แผ่นดินไหว M${magnitude.toFixed(1)}`,
    message: [
      `USGS รายงานแผ่นดินไหวขนาด M${magnitude.toFixed(1)} บริเวณ ${place}`,
      `เวลาเกิดเหตุ: ${formatThaiDateTime(occurredAt)}${depthText}`,
      tsunami ? "เหตุการณ์นี้มีธงเตือนความเป็นไปได้ของสึนามิจาก USGS โปรดติดตามประกาศทางการและหลีกเลี่ยงพื้นที่ชายฝั่ง" : "หากอยู่ในอาคารสูงหรือรู้สึกสั่นไหว โปรดตั้งสติ อยู่ห่างกระจก และติดตามประกาศทางการ"
    ].join("\n"),
    areaText: place,
    latitude,
    longitude,
    radiusKm,
    source: "USGS Earthquake Hazards Program",
    sourceUrl: url,
    externalId: `usgs:${externalId}`,
    startsAt: occurredAt,
    expiresAt: new Date(eventTime + 6 * 60 * 60 * 1000)
  };
}

function severityFromMagnitude(magnitude) {
  if (magnitude >= 7) return "critical";
  if (magnitude >= 6) return "warning";
  if (magnitude >= 5) return "watch";
  return "info";
}

function alertRadiusFromMagnitude(magnitude, tsunami) {
  if (tsunami) return 1500;
  if (magnitude >= 7) return 1200;
  if (magnitude >= 6.5) return 800;
  if (magnitude >= 6) return 500;
  if (magnitude >= 5.5) return 300;
  return 150;
}

function formatThaiDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE || "Asia/Bangkok"
  }).format(value);
}

module.exports = {
  pollUsgsEarthquakes
};
