require("dotenv").config();

const mongoose = require("mongoose");
const { configureDns } = require("../services/dnsConfig");

async function main() {
  const mongoUri = process.env.MONGODB_URI;

  console.log("SmartLife config check");
  console.log("----------------------");
  console.log(`MONGODB_URI: ${mongoUri ? "set" : "missing"}`);
  console.log(`LINE_CHANNEL_ACCESS_TOKEN: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? "set" : "missing"}`);
  console.log(`LINE_CHANNEL_SECRET: ${process.env.LINE_CHANNEL_SECRET ? "set" : "missing"}`);
  console.log(`ALERT_RSS_FEEDS: ${process.env.ALERT_RSS_FEEDS ? "set" : "not set"}`);
  console.log(`DNS_SERVERS: ${process.env.DNS_SERVERS ? process.env.DNS_SERVERS : "system default"}`);
  configureDns();

  if (!mongoUri) {
    console.log("MongoDB check: skipped because MONGODB_URI is missing");
    process.exitCode = 1;
    return;
  }

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`MongoDB check: connected (${collections.length} collections visible)`);
    await mongoose.disconnect();
  } catch (error) {
    console.log(`MongoDB check: failed (${error.message})`);
    process.exitCode = 1;
  }
}

main();
