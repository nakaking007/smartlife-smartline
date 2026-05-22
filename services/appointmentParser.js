const monthMap = {
  "ม.ค.": 1, "มค.": 1, "มกราคม": 1,
  "ก.พ.": 2, "กพ.": 2, "กุมภาพันธ์": 2,
  "มี.ค.": 3, "มีค.": 3, "มีนาคม": 3,
  "เม.ย.": 4, "เมย.": 4, "เมษายน": 4,
  "พ.ค.": 5, "พค.": 5, "พฤษภาคม": 5,
  "มิ.ย.": 6, "มิย.": 6, "มิถุนายน": 6,
  "ก.ค.": 7, "กค.": 7, "กรกฎาคม": 7,
  "ส.ค.": 8, "สค.": 8, "สิงหาคม": 8,
  "ก.ย.": 9, "กย.": 9, "กันยายน": 9,
  "ต.ค.": 10, "ตค.": 10, "ตุลาคม": 10,
  "พ.ย.": 11, "พย.": 11, "พฤศจิกายน": 11,
  "ธ.ค.": 12, "ธค.": 12, "ธันวาคม": 12
};

function parseAppointmentCommand(text) {
  const content = text.replace(/^(นัด|กิจกรรม)[:：]?/i, "").trim();
  const fields = parseFields(content);
  const title = fields.title || firstPart(content);
  const dateText = fields.datetime || secondPart(content);

  if (!title || !dateText) {
    throw new Error("กรุณากรอกชื่องาน และ วดป./เวลา");
  }

  const startAt = parseThaiDateTime(dateText);
  const reminderMinutes = fields.reminders.length > 0 ? fields.reminders : [60];
  const reminders = reminderMinutes.map((minutesBefore) => ({
    minutesBefore,
    remindAt: new Date(startAt.getTime() - minutesBefore * 60 * 1000)
  })).sort((a, b) => a.remindAt - b.remindAt);

  return {
    title,
    activityType: fields.activityType,
    startAt,
    reminderMinutesBefore: reminders[0].minutesBefore,
    remindAt: reminders[0].remindAt,
    reminders,
    locationName: fields.location,
    mapUrl: fields.location ? googleMapsSearchUrl(fields.location) : "",
    preparation: fields.preparation,
    dressCode: fields.dressCode,
    contactName: fields.contactName,
    contactPhone: fields.contactPhone,
    contactLineId: fields.contactLineId,
    speechType: fields.speechType,
    speechDraftRequested: fields.speechDraftRequested
  };
}

function parseFields(content) {
  const fields = {
    title: "",
    datetime: "",
    reminders: [],
    location: "",
    preparation: "",
    dressCode: "",
    activityType: "appointment",
    contactName: "",
    contactPhone: "",
    contactLineId: "",
    speechType: "none",
    speechDraftRequested: false
  };
  const lines = content.split(/\r?\n|\|/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const normalized = line.replace(/\s+/g, " ").trim();

    if (/^(ชื่องานนัดหมาย|ชื่องาน|หัวข้อ|ชื่อนัด)\s*[:：]/i.test(normalized)) {
      fields.title = valueAfterColon(normalized);
    } else if (/^(วดป\.?|วันเวลา|วันที่|เวลา)\s*[:：]/i.test(normalized)) {
      fields.datetime = valueAfterColon(normalized);
    } else if (/^(ให้เตือนก่อน|เตือนก่อน|เตือน)\s*[:：]?/i.test(normalized)) {
      fields.reminders = parseReminderMinutesList(normalized);
    } else if (/^(สถานที่)\s*[:：]?/i.test(normalized)) {
      fields.location = normalized.replace(/^สถานที่\s*[:：]?/i, "").trim();
    } else if (/^(นัดกับ|กับ)\s*[:：]?/i.test(normalized)) {
      parseContact(normalized.replace(/^(นัดกับ|กับ)\s*[:：]?/i, "").trim(), fields);
    } else if (/^(สิ่งต้องเตรียม|สิ่งที่ต้องเตรียม|เตรียม)\s*[:：]?/i.test(normalized)) {
      fields.preparation = normalized.replace(/^(สิ่งต้องเตรียม|สิ่งที่ต้องเตรียม|เตรียม)\s*[:：]?/i, "").trim();
    } else if (/^(ชุด|ธีม|การแต่งกาย|แต่งกาย)\s*[:：]?/i.test(normalized)) {
      fields.dressCode = normalized.replace(/^(ชุด|ธีม|การแต่งกาย|แต่งกาย)\s*[:：]?/i, "").trim();
    } else if (/^(ประเภท|กิจกรรม)\s*[:：]?/i.test(normalized)) {
      fields.activityType = activityTypeFromText(normalized);
    } else if (/^(โทร|เบอร์)\s*[:：]?/i.test(normalized)) {
      fields.contactPhone = normalized.replace(/^(โทร|เบอร์)\s*[:：]?/i, "").trim();
    } else if (/^line\s*[:：]?/i.test(normalized)) {
      fields.contactLineId = normalized.replace(/^line\s*[:：]?/i, "").trim();
    } else if (normalized.includes("คำกล่าว") || normalized.includes("สุนทรพจน์")) {
      fields.speechDraftRequested = true;
      fields.speechType = speechTypeFromText(normalized);
    }
  }

  if (!fields.title && lines.length > 0 && !lines[0].includes(":")) fields.title = lines[0];
  if (!fields.datetime) fields.datetime = lines.find((line) => /\d{1,2}.*\d{2,4}.*\d{1,2}[:.]\d{2}/.test(line)) || "";
  return fields;
}

function parseContact(value, fields) {
  const phoneMatch = value.match(/(?:โทร|เบอร์)\s*[:：]?\s*([0-9+\-\s]+)/i);
  if (phoneMatch) {
    fields.contactPhone = phoneMatch[1].trim();
    value = value.replace(phoneMatch[0], "").trim();
  }
  fields.contactName = value.replace(/^ชื่อ\s*/i, "").trim();
}

function activityTypeFromText(value) {
  if (/ออกกำลังกาย|วิ่ง|ฟิตเนส|โยคะ/i.test(value)) return "exercise";
  if (/ทานข้าว|กินข้าว|อาหาร|มื้อ/i.test(value)) return "meal";
  if (/เดินทาง|ไปงาน|ออกจากบ้าน/i.test(value)) return "travel";
  if (/งานแต่ง|แต่งงาน/i.test(value)) return "wedding";
  if (/พิธี|เปิดงาน|กล่าวเปิด/i.test(value)) return "ceremony";
  if (/ประจำวัน|กิจวัตร/i.test(value)) return "daily";
  return "appointment";
}

function speechTypeFromText(value) {
  if (/เปิดงาน|พิธีเปิด/i.test(value)) return "opening";
  if (/งานแต่ง|แต่งงาน/i.test(value)) return "wedding";
  if (/ขอบคุณ/i.test(value)) return "thanks";
  if (/คำกล่าว|สุนทรพจน์/i.test(value)) return "speech";
  return "none";
}

function valueAfterColon(value) {
  return value.replace(/^[^:：]+[:：]\s*/, "").trim();
}

function firstPart(content) {
  return content.split("|").map((part) => part.trim()).filter(Boolean)[0] || "";
}

function secondPart(content) {
  return content.split("|").map((part) => part.trim()).filter(Boolean)[1] || "";
}

function parseThaiDateTime(value) {
  const normalized = value.replace(/เวลา\s*[:：]?/i, " ").replace(/น\.?/g, "").replace(/\s+/g, " ").trim();
  const isoMatch = normalized.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2})[:.](\d{2})/);
  if (isoMatch) return buildDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]), Number(isoMatch[4]), Number(isoMatch[5]));

  const thaiMatch = normalized.match(/(\d{1,2})\s*([^\s\d]+\.?)\s*(\d{2,4})\s+(\d{1,2})[:.](\d{2})/i);
  if (thaiMatch) {
    const month = monthMap[thaiMatch[2]] || monthMap[thaiMatch[2].replace(/\./g, "") + "."];
    let year = Number(thaiMatch[3]);
    if (!month) throw new Error("ไม่รู้จักชื่อเดือน กรุณาใช้เช่น พ.ค. หรือ 2026-05-22 09:00");
    if (year > 2400) year -= 543;
    else if (year < 100) year += 2000;
    return buildDate(year, month, Number(thaiMatch[1]), Number(thaiMatch[4]), Number(thaiMatch[5]));
  }

  const date = new Date(normalized.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง ใช้เช่น 22 พ.ค. 2569 เวลา 09:00 หรือ 2026-05-22 09:00");
  return date;
}

function buildDate(year, month, day, hour, minute) {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(date.getTime())) throw new Error("รูปแบบวันเวลาไม่ถูกต้อง");
  return date;
}

function parseReminderMinutesList(value) {
  const reminders = [];
  const pattern = /(\d+)\s*(วัน|ชั่วโมง|ชม\.?|นาที|น\.?)/g;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit.startsWith("วัน")) reminders.push(amount * 24 * 60);
    else if (unit.startsWith("ชั่วโมง") || unit.startsWith("ชม")) reminders.push(amount * 60);
    else reminders.push(amount);
  }
  return [...new Set(reminders)].sort((a, b) => b - a);
}

function googleMapsSearchUrl(locationName) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName)}`;
}

module.exports = {
  parseAppointmentCommand
};
