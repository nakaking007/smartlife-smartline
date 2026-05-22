const express = require("express");

const Appointment = require("../models/appointment");
const User = require("../models/user");
const { commandListMessage, helpMessage, packageMessage, speechDraft } = require("../services/messages");
const { replyLineMessage, verifyLineSignature } = require("../services/line");
const {
  appointmentFormFlex,
  emptyAppointmentsMessage,
  packageFlex,
  paymentFlex,
  textWithQuickReply,
  travelLocationFlex,
  welcomeFlex
} = require("../services/lineUi");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    endpoint: "/webhooks/line",
    method: "POST",
    message: "LINE webhook endpoint is ready. Use this URL in LINE Developers."
  });
});

router.post("/", async (req, res) => {
  const signature = req.get("x-line-signature");
  const events = req.body.events || [];

  console.log(`LINE webhook received ${events.length} event(s)`);

  if (!signature && events.length === 0) {
    return res.status(200).json({ received: true, verifier: true });
  }

  if (!verifyLineSignature(req.rawBody || "", signature)) {
    return res.status(401).json({ message: "Invalid LINE signature" });
  }

  res.status(200).json({ received: true });

  for (const event of events) {
    try {
      await handleLineEvent(event);
    } catch (error) {
      console.error("LINE event failed:", error.response?.data || error.message);
    }
  }
});

async function handleLineEvent(event) {
  if (!event.source || !event.source.userId || !event.replyToken) {
    console.log("LINE event skipped: missing userId or replyToken");
    return;
  }

  const user = await findOrCreateLineUser(event.source.userId);

  if (event.type === "follow") {
    await replyLineMessage(event.replyToken, [
      welcomeFlex(event.source.userId),
      textWithQuickReply("ยินดีต้อนรับสู่ SmartLife Scheduler & Alert เลือกเมนูด้านล่างได้เลยครับ", event.source.userId)
    ]);
    return;
  }

  if (event.type !== "message") {
    console.log(`LINE event skipped: ${event.type}`);
    return;
  }

  if (event.message.type === "location") {
    await saveUserLocation(user, event.message);
    await replyLineMessage(event.replyToken, [
      textWithQuickReply("บันทึก Location เรียบร้อยแล้ว ระบบจะใช้ตำแหน่งนี้ร่วมกับพื้นที่บ้าน/พื้นที่เดินทางสำหรับแจ้งเตือนอากาศ ฝุ่น PM2.5 และภัยใกล้ตัว", user.lineUserId),
      travelLocationFlex(user.lineUserId)
    ]);
    return;
  }

  if (event.message.type !== "text") {
    await replyLineMessage(event.replyToken, textWithQuickReply("ตอนนี้รองรับข้อความและการแชร์ Location ก่อนครับ เลือกเมนูด้านล่างได้เลย", user.lineUserId));
    return;
  }

  const text = event.message.text.trim();
  console.log(`LINE text from ${event.source.userId}: ${text}`);
  const response = await handleTextCommand(user, text);
  await replyLineMessage(event.replyToken, response);
}

async function handleTextCommand(user, text) {
  const command = normalizeCommand(text);

  if (hasAny(command, ["คำสั่ง", "command", "commands"])) {
    return [
      textWithQuickReply(commandListMessage()),
      welcomeFlex(user.lineUserId)
    ];
  }

  if (hasAny(command, ["คู่มือ", "help", "วิธีใช้", "เมนู"])) {
    return [
      welcomeFlex(user.lineUserId),
      textWithQuickReply(helpMessage(), user.lineUserId)
    ];
  }

  if (hasAny(command, ["สมัคร", "ฟอร์มสมัคร"])) {
    return [
      paymentFlex(user.lineUserId),
      textWithQuickReply("กรุณาเปิดฟอร์มสมัคร เลือกแพ็กเกจ และส่งสลิปให้ผู้ดูแลเพื่อปลดล็อกสิทธิ์ใช้งานครับ", user.lineUserId)
    ];
  }

  if (hasAny(command, ["ฟอร์มนัด", "เพิ่มนัด", "นัดหมาย", "เพิ่มกิจกรรม", "ฟอร์มกิจกรรม"])) {
    return [
      appointmentFormFlex(user.lineUserId),
      textWithQuickReply("เปิดแบบบันทึกปฏิทินกิจกรรมได้จากปุ่มด้านบนครับ ระบบจะบันทึกนัดหมายจากฟอร์มเท่านั้นเพื่อป้องกันความผิดพลาด", user.lineUserId)
    ];
  }

  if (hasAny(command, ["พื้นที่เดินทาง", "โลเคชั่นเดินทาง", "locationเดินทาง", "เพิ่มพื้นที่", "เพิ่มโลเคชั่น", "ไปเที่ยว"])) {
    return [
      travelLocationFlex(user.lineUserId),
      textWithQuickReply("เพิ่มพื้นที่เดินทางเมื่อไปต่างจังหวัด ไปเที่ยว หรือพักที่อื่น เพื่อรับแจ้งเตือนฝน ฝุ่น อากาศ และภัยใกล้ตัว", user.lineUserId)
    ];
  }

  if (hasAny(command, ["แพ็กเกจ", "package", "ราคา", "ชำระเงิน", "ปลดล็อก", "สลิป"])) {
    return [
      packageFlex(user.lineUserId),
      paymentFlex(user.lineUserId),
      textWithQuickReply(packageMessage(), user.lineUserId)
    ];
  }

  if (hasAny(command, ["ฝน", "ฝุ่น", "pm25", "pm2.5", "อุณหภูมิ", "อากาศ", "ร้อน", "หนาว"])) {
    return [
      travelLocationFlex(user.lineUserId),
      textWithQuickReply("ระบบจะใช้พื้นที่บ้านและพื้นที่เดินทางที่บันทึกไว้สำหรับแจ้งเตือนอากาศ ฝน ฝุ่น และอุณหภูมิ หากกำลังเดินทาง ให้กดเพิ่มพื้นที่เดินทางหรือส่ง Location ปัจจุบันครับ", user.lineUserId)
    ];
  }

  if (hasAny(command, ["พิกัด", "location", "โลเคชั่น", "ตำแหน่ง"])) {
    return textWithQuickReply("กดปุ่ม ส่ง Location ด้านล่าง เพื่อให้ระบบบันทึกพิกัดสำหรับแจ้งเตือนอากาศและภัยใกล้ตัวครับ", user.lineUserId);
  }

  if (hasAny(command, ["วันนี้", "นัดวันนี้"])) {
    return appointmentsMessage(user, "today");
  }

  if (hasAny(command, ["พรุ่งนี้", "พรุ่งนี้", "นัดพรุ่งนี้"])) {
    return appointmentsMessage(user, "tomorrow");
  }

  if (hasAny(command, ["สัปดาห์นี้", "สัปดานี้", "นัดสัปดาห์นี้"])) {
    return appointmentsMessage(user, "week");
  }

  if (hasAny(command, ["เดือนนี้", "นัดเดือนนี้"])) {
    return appointmentsMessage(user, "month");
  }

  if (hasAny(command, ["ปฏิทิน", "ปฏิทินกิจกรรม", "รายการนัด", "รายการกิจกรรม"])) {
    return [
      textWithQuickReply("เลือกช่วงเวลาที่ต้องการดูได้จากปุ่มลัด หรือเปิดแบบฟอร์มนัดเพื่อเพิ่มรายการใหม่", user.lineUserId),
      appointmentFormFlex(user.lineUserId)
    ];
  }

  if (text.startsWith("นัด")) {
    return [
      textWithQuickReply("เพื่อป้องกันการบันทึกผิด ระบบจะไม่บันทึกนัดจากข้อความสั้นโดยอัตโนมัติครับ กรุณาใช้แบบฟอร์มนัดเท่านั้น", user.lineUserId),
      appointmentFormFlex(user.lineUserId)
    ];
  }

  if (text.startsWith("ช่วยเขียนคำกล่าว") || text.startsWith("สุนทรพจน์")) {
    const topic = text.replace(/^ช่วยเขียนคำกล่าว[:：]?/, "").replace(/^สุนทรพจน์[:：]?/, "").trim();
    return textWithQuickReply(speechDraft(topic), user.lineUserId);
  }

  return [
    textWithQuickReply("ผมยังไม่เข้าใจคำสั่งนี้ครับ เลือกปุ่มลัดด้านล่าง หรือพิมพ์ คู่มือ เพื่อดูเมนูทั้งหมด", user.lineUserId),
    welcomeFlex(user.lineUserId)
  ];
}

async function findOrCreateLineUser(lineUserId) {
  return User.findOneAndUpdate(
    { lineUserId },
    { $setOnInsert: { lineUserId } },
    { new: true, upsert: true }
  );
}

async function saveUserLocation(user, message) {
  const location = {
    label: message.title || message.address || "Location จาก LINE",
    latitude: message.latitude,
    longitude: message.longitude,
    province: "",
    district: ""
  };

  if (!user.location?.latitude || !user.location?.longitude) {
    user.location = location;
  }

  user.travelLocations = [
    ...(user.travelLocations || []),
    {
      ...location,
      active: true,
      savedAt: new Date()
    }
  ].slice(-5);

  await user.save();
}

async function appointmentsMessage(user, range) {
  const { start, end, title } = dateRange(range);
  const appointments = await Appointment.find({
    user: user._id,
    status: "scheduled",
    startAt: { $gte: start, $lt: end }
  }).sort({ startAt: 1 }).limit(10);

  if (appointments.length === 0) {
    return emptyAppointmentsMessage(title, user.lineUserId);
  }

  return textWithQuickReply([
    `กิจกรรม${title}`,
    "",
    appointments.map((appointment, index) => [
      `${index + 1}. ${appointment.title}`,
      `เวลา: ${appointment.startAt.toLocaleString("th-TH", { timeZone: process.env.APP_TIMEZONE || "Asia/Bangkok" })}`,
      appointment.locationName ? `สถานที่: ${appointment.locationName}` : "",
      appointment.preparation ? `เตรียม: ${appointment.preparation}` : ""
    ].filter(Boolean).join("\n")).join("\n\n")
  ].join("\n"), user.lineUserId);
}

function dateRange(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === "tomorrow") {
    const start = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, title: "พรุ่งนี้" };
  }

  if (range === "week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end, title: "สัปดาห์นี้" };
  }

  if (range === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { start, end, title: "เดือนนี้" };
  }

  const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { start: today, end, title: "วันนี้" };
}

function normalizeCommand(text) {
  return text.toLowerCase().replace(/\s+/g, "");
}

function hasAny(value, keywords) {
  return keywords.some((keyword) => value.includes(keyword.toLowerCase().replace(/\s+/g, "")));
}

module.exports = router;
