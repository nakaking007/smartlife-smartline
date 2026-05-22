const { guidanceForAlert } = require("./alertGuidance");

function helpMessage() {
  return [
    "คู่มือ SmartLife SmartLine",
    "",
    "SmartLife SmartLine เป็นเลขาส่วนตัวประจำมือถือของท่าน สำหรับบันทึกกิจกรรม นัดหมาย การเดินทาง งานพิธี และรับแจ้งเตือนภัยอัตโนมัติผ่าน LINE",
    "",
    "คำสั่งหลัก:",
    "สมัคร - เปิดฟอร์มสมัครสมาชิกและบันทึกพื้นที่หลัก",
    "พื้นที่เดินทาง - เพิ่มพื้นที่ที่กำลังไปเที่ยวหรือเดินทาง",
    "ฟอร์มนัด - เปิดแบบบันทึกปฏิทินกิจกรรม",
    "วันนี้ - ดูกิจกรรมวันนี้",
    "พรุ่งนี้ - ดูกิจกรรมพรุ่งนี้",
    "สัปดาห์นี้ - ดูกิจกรรมสัปดาห์นี้",
    "เดือนนี้ - ดูกิจกรรมเดือนนี้",
    "ปฏิทิน - เปิดลิงก์ดูรายการกิจกรรม",
    "แพ็กเกจ - ดูราคา Basic/Premium",
    "ฝน / ฝุ่น / อุณหภูมิ - ตรวจหรือเตรียมแจ้งข้อมูลตามพื้นที่ที่บันทึกไว้",
    "",
    "ข้อมูลที่ควรกรอกในฟอร์มนัด:",
    "ชื่องาน: ตรวจสุขภาพ",
    "วันที่นัด: 22-05-2569",
    "เวลา: 09:00",
    "ให้เตือนก่อน: 1 วัน และ 1 ชั่วโมง",
    "สถานที่: รพ.นนทเวช หรือชื่อสถานที่นัดจริง",
    "นัดกับ: ชื่อหมอ โทร...",
    "สิ่งที่ต้องเตรียม: ใบนัด, บัตรประชาชน",
    "ชุด/ธีม: ชุดสุภาพ หรือธีมงาน",
    "คำกล่าว: เลือกได้ถ้าต้องการร่างคำกล่าวหรือสุนทรพจน์",
    "",
    "ติดต่อผู้ดูแล:",
    "ดร.เขมวันต์",
    "โทร. 095-525-5901",
    "LINE ID: charnb015",
    "",
    "การสมัคร/ปลดล็อก:",
    "โอนเงินผ่านพร้อมเพย์ไปที่เบอร์ 095-525-5901 แล้วส่งสลิปไปที่ LINE ID: charnb015 เพื่อให้ผู้ดูแลเปิดสิทธิ์ใช้งาน"
  ].join("\n");
}

function packageMessage() {
  return [
    "แพ็กเกจ SmartLife SmartLine",
    "",
    "Basic 50 บาท",
    "- บันทึกกิจกรรมประจำวันและนัดหมาย",
    "- เตือนก่อนงานตามเวลาที่เลือก",
    "- ดูรายการวันนี้ พรุ่งนี้ สัปดาห์นี้ และเดือนนี้",
    "",
    "Premium 100 บาท",
    "- ทุกอย่างใน Basic",
    "- แจ้งเตือนภัยตามพื้นที่หลักและพื้นที่เดินทาง",
    "- อากาศ ฝุ่น PM2.5 ฝนตกหนัก พายุ น้ำท่วม",
    "- แผ่นดินไหวและสึนามิจากแหล่งข้อมูลสากล",
    "- ช่วยร่างคำกล่าว สุนทรพจน์ และพิธีเปิดงาน",
    "",
    "การสมัคร/ปลดล็อก:",
    "โอนเงินผ่านพร้อมเพย์ไปที่เบอร์ 095-525-5901",
    "แล้วส่งสลิปไปที่ LINE ID: charnb015",
    "",
    "ติดต่อผู้ดูแล:",
    "ดร.เขมวันต์",
    "โทร. 095-525-5901",
    "LINE ID: charnb015"
  ].join("\n");
}

function commandListMessage() {
  return [
    "คำสั่ง SmartLife SmartLine",
    "",
    "คู่มือ - ดูวิธีใช้งานแบบละเอียด",
    "คำสั่ง - ดูรายการคำสั่งทั้งหมด",
    "สมัคร - เปิดฟอร์มสมัครสมาชิก",
    "ฟอร์มนัด - เปิดแบบบันทึกนัดหมาย/กิจกรรม",
    "วันนี้ - ดูนัดหมายวันนี้",
    "พรุ่งนี้ - ดูนัดหมายพรุ่งนี้",
    "สัปดาห์นี้ - ดูนัดหมายสัปดาห์นี้",
    "เดือนนี้ - ดูนัดหมายเดือนนี้",
    "พื้นที่เดินทาง - เพิ่มพื้นที่ไปเที่ยว/เดินทางเพื่อรับเตือนฝน ฝุ่น อากาศ และภัย",
    "พิกัด - วิธีส่ง Location ให้ระบบ",
    "แพ็กเกจ - ดูราคา Basic/Premium และวิธีปลดล็อก",
    "ฝน / ฝุ่น / อากาศ - ตรวจหรือเตรียมแจ้งข้อมูลตามพื้นที่ที่บันทึกไว้",
    "ช่วยเขียนคำกล่าว ... - ให้ระบบร่างคำกล่าวหรือสุนทรพจน์"
  ].join("\n");
}

function appointmentSavedMessage(appointment) {
  const reminders = (appointment.reminders || [])
    .map((reminder) => formatReminderMinutes(reminder.minutesBefore))
    .join(", ");

  return [
    "บันทึกกิจกรรมเรียบร้อย",
    `ประเภท: ${activityTypeLabel(appointment.activityType)}`,
    `ชื่องาน: ${appointment.title}`,
    `วันเวลา: ${formatDateTime(appointment.startAt)}`,
    reminders ? `ระบบจะเตือนก่อน: ${reminders}` : "",
    appointment.locationName ? `สถานที่: ${appointment.locationName}` : "",
    appointment.mapUrl ? `แผนที่: ${appointment.mapUrl}` : "",
    appointment.contactName ? `นัดกับ: ${appointment.contactName}` : "",
    appointment.contactPhone ? `โทร: ${appointment.contactPhone}` : "",
    appointment.preparation ? `สิ่งที่ต้องเตรียม: ${appointment.preparation}` : "",
    appointment.dressCode ? `ชุด/ธีม: ${appointment.dressCode}` : "",
    "",
    "ข้อความเตือนที่จะได้รับ:",
    `เตือนกิจกรรม: ${appointment.title}`,
    `เวลา: ${formatDateTime(appointment.startAt)}`,
    appointment.locationName ? `สถานที่: ${appointment.locationName}` : "",
    appointment.preparation ? `อย่าลืมเตรียม: ${appointment.preparation}` : ""
  ].filter(Boolean).join("\n");
}

function appointmentReminderMessage(appointment) {
  return [
    `เตือนกิจกรรม: ${appointment.title}`,
    `เวลา: ${formatDateTime(appointment.startAt)}`,
    appointment.locationName ? `สถานที่: ${appointment.locationName}` : "",
    appointment.mapUrl ? `แผนที่: ${appointment.mapUrl}` : "",
    appointment.preparation ? `อย่าลืมเตรียม: ${appointment.preparation}` : "",
    appointment.dressCode ? `ชุด/ธีม: ${appointment.dressCode}` : "",
    appointment.contactName ? `นัดกับ: ${appointment.contactName}` : "",
    appointment.contactPhone ? `โทร: ${appointment.contactPhone}` : ""
  ].filter(Boolean).join("\n");
}

function alertMessage(alert) {
  const prefixBySeverity = {
    info: "แจ้งข้อมูล",
    watch: "เฝ้าระวัง",
    warning: "แจ้งเตือน",
    critical: "แจ้งเตือนด่วน"
  };
  const guidance = guidanceForAlert(alert.type);

  return [
    `${prefixBySeverity[alert.severity] || "แจ้งเตือน"}: ${alert.title}`,
    alert.message,
    ...guidance.map((item) => `คำแนะนำ: ${item}`),
    alert.areaText ? `พื้นที่: ${alert.areaText}` : "",
    alert.source ? `แหล่งข้อมูล: ${alert.source}` : "",
    alert.sourceUrl ? `รายละเอียด: ${alert.sourceUrl}` : ""
  ].filter(Boolean).join("\n");
}

function speechDraft(topic, speechType = "speech") {
  const labelByType = {
    speech: "คำกล่าวทั่วไป",
    opening: "คำกล่าวเปิดงาน",
    wedding: "คำกล่าวงานแต่งงาน",
    thanks: "คำกล่าวขอบคุณ"
  };
  const subject = topic || "งานสำคัญครั้งนี้";

  return [
    `ร่าง${labelByType[speechType] || "คำกล่าว"}ประมาณ 5 นาที`,
    "",
    "เรียนท่านผู้มีเกียรติทุกท่าน",
    "",
    `วันนี้เป็นโอกาสสำคัญที่พวกเราได้มาร่วมกันใน${subject} ซึ่งเป็นช่วงเวลาที่มีความหมายและสะท้อนถึงความร่วมมือ ความตั้งใจ และความปรารถนาดีของทุกฝ่าย`,
    "",
    "ผม/ดิฉันขอขอบคุณทุกท่านที่สละเวลาเข้าร่วมงาน และขอชื่นชมผู้เกี่ยวข้องทุกคนที่ช่วยกันเตรียมงานให้เกิดขึ้นอย่างเรียบร้อย",
    "",
    "ขอให้งานครั้งนี้เป็นจุดเริ่มต้นของสิ่งที่ดี สร้างประโยชน์ต่อผู้เข้าร่วม ชุมชน และสังคมโดยรวม",
    "",
    "ท้ายที่สุดนี้ ขออำนวยพรให้ทุกท่านมีสุขภาพแข็งแรง ประสบความสำเร็จ และขอให้งานครั้งนี้สำเร็จลุล่วงตามวัตถุประสงค์ทุกประการ",
    "",
    "ขอบคุณครับ/ค่ะ"
  ].join("\n");
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE || "Asia/Bangkok"
  }).format(new Date(value));
}

function formatReminderMinutes(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} วัน`;
  if (minutes % 60 === 0) return `${minutes / 60} ชั่วโมง`;
  return `${minutes} นาที`;
}

function activityTypeLabel(type) {
  return {
    appointment: "นัดหมาย",
    exercise: "ออกกำลังกาย",
    meal: "ทานข้าว",
    travel: "เดินทาง",
    ceremony: "งานพิธี",
    wedding: "งานแต่งงาน",
    daily: "กิจกรรมประจำวัน",
    other: "อื่นๆ"
  }[type] || "นัดหมาย";
}

module.exports = {
  alertMessage,
  appointmentReminderMessage,
  appointmentSavedMessage,
  commandListMessage,
  helpMessage,
  packageMessage,
  speechDraft
};
