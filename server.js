require("dotenv").config();

const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const cron = require("node-cron");

const alertRoutes = require("./routes/alerts");
const formRoutes = require("./routes/forms");
const lineWebhookRoutes = require("./routes/lineWebhook");
const Appointment = require("./models/appointment");
const User = require("./models/user");
const { configureDns } = require("./services/dnsConfig");
const { pollUsgsEarthquakes } = require("./services/earthquakeIngestor");
const { pushLineMessage } = require("./services/line");
const { appointmentReminderMessage } = require("./services/messages");
const { pollConfiguredRssFeeds } = require("./services/rssAlertIngestor");

configureDns();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;

app.use(cors());
app.use(express.json({
  verify: (req, res, buffer) => {
    req.rawBody = buffer.toString();
  }
}));
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.json({
    name: "SmartLife API",
    status: "ok",
    endpoints: ["/webhooks/line", "/api/alerts", "/api/alerts/poll-rss", "/health"]
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    database: mongoose.connection.readyState === 1 ? "connected" : "not_connected",
    lineConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET),
    rssFeedsConfigured: Boolean(process.env.ALERT_RSS_FEEDS)
  });
});

app.use("/api/alerts", alertRoutes);
app.use("/forms", formRoutes);
app.use("/webhooks/line", lineWebhookRoutes);

cron.schedule(process.env.MORNING_BRIEF_CRON || "0 6 * * *", async () => {
  try {
    await sendDailyBrief("today");
  } catch (error) {
    console.error("Morning brief failed:", error.message);
  }
}, {
  timezone: process.env.APP_TIMEZONE || "Asia/Bangkok"
});

cron.schedule(process.env.BEDTIME_PROMPT_CRON || "0 21 * * *", async () => {
  try {
    await sendDailyBrief("tomorrow");
  } catch (error) {
    console.error("Bedtime prompt failed:", error.message);
  }
}, {
  timezone: process.env.APP_TIMEZONE || "Asia/Bangkok"
});

// Check every minute for appointments that should trigger a LINE reminder.
cron.schedule("* * * * *", async () => {
  const now = new Date();

  try {
    const dueAppointments = await Appointment.find({
      status: "scheduled",
      reminders: {
        $elemMatch: {
          remindAt: { $lte: now },
          sentAt: null
        }
      }
    }).populate("user").limit(20);

    for (const appointment of dueAppointments) {
      const user = appointment.user;

      if (!user || !user.lineUserId) {
        appointment.status = "reminded";
        await appointment.save();
        continue;
      }

      const dueReminders = appointment.reminders.filter((reminder) => {
        return !reminder.sentAt && reminder.remindAt <= now;
      });

      for (const reminder of dueReminders) {
        await pushLineMessage(user.lineUserId, appointmentReminderMessage(appointment));
        reminder.sentAt = new Date();
      }

      if (appointment.reminders.every((reminder) => reminder.sentAt)) {
        appointment.status = "reminded";
      }

      await appointment.save();
    }
  } catch (error) {
    console.error("Reminder job failed:", error.message);
  }
});

async function sendDailyBrief(range) {
  const users = await User.find({
    active: true,
    lineUserId: { $exists: true, $ne: "" }
  }).limit(500);

  for (const user of users) {
    const appointments = await Appointment.find({
      user: user._id,
      status: "scheduled",
      startAt: dateRangeQuery(range)
    }).sort({ startAt: 1 }).limit(10);

    await pushLineMessage(user.lineUserId, dailyBriefMessage(user, appointments, range));
  }
}

function dailyBriefMessage(user, appointments, range) {
  const formUrl = `${publicBaseUrl()}/forms/appointment?lineUserId=${encodeURIComponent(user.lineUserId)}`;

  if (range === "today") {
    if (appointments.length === 0) {
      return [
        "อรุณสวัสดิ์ครับ",
        "วันนี้ยังไม่มีนัดหมายสำหรับท่าน",
        "หากต้องการบันทึกกิจกรรมหรือนัดหมายเพิ่มเติม กรุณาคลิกแบบฟอร์มนี้",
        formUrl
      ].join("\n");
    }

    return [
      "อรุณสวัสดิ์ครับ",
      "สรุปนัดหมายวันนี้สำหรับท่าน",
      "",
      appointments.map(formatAppointmentLine).join("\n\n")
    ].join("\n");
  }

  if (appointments.length === 0) {
    return [
      "ก่อนนอนคืนนี้ ขอทบทวนพรุ่งนี้สักครู่ครับ",
      "พรุ่งนี้ยังไม่มีนัดหมายสำหรับท่าน",
      "ท่านต้องการบันทึกการนัดหมายหรือกิจกรรมเพิ่มเติมหรือไม่ กรุณาคลิกแบบฟอร์มนี้",
      formUrl
    ].join("\n");
  }

  return [
    "ก่อนนอนคืนนี้ ขอทบทวนพรุ่งนี้สักครู่ครับ",
    "สรุปนัดหมายพรุ่งนี้สำหรับท่าน",
    "",
    appointments.map(formatAppointmentLine).join("\n\n"),
    "",
    "หากต้องการเพิ่มนัดหมาย กรุณาคลิกแบบฟอร์มนี้",
    formUrl
  ].join("\n");
}

function formatAppointmentLine(appointment, index) {
  return [
    `${index + 1}. ${appointment.title}`,
    `เวลา: ${formatDateTime(appointment.startAt)}`,
    appointment.locationName ? `สถานที่: ${appointment.locationName}` : "",
    appointment.preparation ? `เตรียม: ${appointment.preparation}` : ""
  ].filter(Boolean).join("\n");
}

function dateRangeQuery(range) {
  const bangkokOffsetMs = 7 * 60 * 60 * 1000;
  const bangkokNow = new Date(Date.now() + bangkokOffsetMs);
  const todayStartUtc = Date.UTC(
    bangkokNow.getUTCFullYear(),
    bangkokNow.getUTCMonth(),
    bangkokNow.getUTCDate()
  ) - bangkokOffsetMs;
  const start = new Date(todayStartUtc + (range === "tomorrow" ? 24 * 60 * 60 * 1000 : 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { $gte: start, $lt: end };
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE || "Asia/Bangkok"
  }).format(new Date(value));
}

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
}

if (process.env.ALERT_RSS_FEEDS) {
  cron.schedule(process.env.ALERT_RSS_CRON || "*/5 * * * *", async () => {
    try {
      const results = await pollConfiguredRssFeeds();
      console.log("RSS alert ingest:", JSON.stringify(results));
    } catch (error) {
      console.error("RSS alert ingest failed:", error.message);
    }
  });
}

if (process.env.ENABLE_USGS_EARTHQUAKE_ALERTS !== "false") {
  cron.schedule(process.env.USGS_EARTHQUAKE_CRON || "*/5 * * * *", async () => {
    try {
      const results = await pollUsgsEarthquakes();
      console.log("USGS earthquake ingest:", JSON.stringify(results));
    } catch (error) {
      console.error("USGS earthquake ingest failed:", error.message);
    }
  }, {
    timezone: process.env.APP_TIMEZONE || "Asia/Bangkok"
  });
}

async function start() {
  try {
    if (!mongoUri) {
      throw new Error("MONGODB_URI is required");
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000
    });
    console.log("Connected to MongoDB");

    app.listen(port, () => {
      console.log(`SmartLife API running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    console.error("Check MONGODB_URI in .env. For an authenticated database, include username, password, and authSource.");
    process.exit(1);
  }
}

start();
