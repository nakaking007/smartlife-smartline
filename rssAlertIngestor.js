const axios = require("axios");
const { XMLParser } = require("fast-xml-parser");

const Alert = require("../models/alert");
const { classifyAlert } = require("./alertClassifier");
const { dispatchAlert } = require("./alertDispatcher");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

async function pollConfiguredRssFeeds() {
  const feeds = getConfiguredFeeds();
  const results = [];

  for (const feed of feeds) {
    try {
      results.push(await ingestRssFeed(feed));
    } catch (error) {
      console.error(`RSS ingest failed for ${feed.name}:`, error.message);
      results.push({ name: feed.name, created: 0, skipped: 0, error: error.message });
    }
  }

  return results;
}

async function ingestRssFeed(feed) {
  const response = await axios.get(feed.url, { timeout: 15000 });
  const xml = parser.parse(response.data);
  const channel = xml.rss?.channel || xml.feed || {};
  const rawItems = channel.item || channel.entry || [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  let created = 0;
  let skipped = 0;

  for (const item of items.slice(0, feed.limit || 10)) {
    const alertData = itemToAlert(item, feed);
    const existing = await Alert.findOne({
      source: alertData.source,
      externalId: alertData.externalId
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    const alert = await Alert.create(alertData);
    await dispatchAlert(alert);
    created += 1;
  }

  return { name: feed.name, created, skipped };
}

function itemToAlert(item, feed) {
  const title = asText(item.title) || "ประกาศแจ้งเตือน";
  const description = stripHtml(asText(item.description || item.summary || item.content)) || title;
  const link = asText(item.link?.href || item.link || item.guid) || feed.url;
  const externalId = asText(item.guid?.["#text"] || item.guid || item.id || link || `${title}-${asText(item.pubDate || item.updated)}`);
  const classified = classifyAlert(`${feed.name} ${title} ${description}`);

  return {
    type: feed.type || classified.type,
    severity: feed.severity || classified.severity,
    title,
    message: description.slice(0, 900),
    areaText: feed.areaText || "",
    source: feed.source || feed.name,
    sourceUrl: link,
    externalId,
    startsAt: parseDate(item.pubDate || item.published || item.updated) || new Date(),
    active: true
  };
}

function getConfiguredFeeds() {
  const raw = process.env.ALERT_RSS_FEEDS;

  if (!raw) {
    return [];
  }

  try {
    const feeds = JSON.parse(raw);
    return Array.isArray(feeds) ? feeds.filter((feed) => feed.name && feed.url) : [];
  } catch (error) {
    return raw.split(",").map((url, index) => ({
      name: `rss-${index + 1}`,
      source: "RSS",
      url: url.trim()
    })).filter((feed) => feed.url);
  }
}

function asText(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "object") {
    return value["#text"] || value.__cdata || "";
  }

  return String(value);
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseDate(value) {
  const date = new Date(asText(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = {
  ingestRssFeed,
  pollConfiguredRssFeeds
};
