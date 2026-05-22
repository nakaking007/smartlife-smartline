const express = require("express");

const Appointment = require("../models/appointment");
const User = require("../models/user");
const { appointmentSavedMessage, speechDraft } = require("../services/messages");
const { pushLineMessage } = require("../services/line");

const router = express.Router();

router.get("/appointment", async (req, res) => {
  const lineUserId = req.query.lineUserId || "";
  res.type("html").send(renderAppointmentForm({ lineUserId }));
});

router.post("/appointment", async (req, res) => {
  try {
    const user = await User.findOneAndUpdate(
      { lineUserId: req.body.lineUserId },
      { $setOnInsert: { lineUserId: req.body.lineUserId, active: true, plan: "basic" } },
      { new: true, upsert: true }
    );

    const startAt = parseThaiDateTime(req.body.dateText, req.body.timeText);
    const reminderMinutes = normalizeReminderMinutes(req.body.reminders);
    const reminders = reminderMinutes
      .map((minutesBefore) => ({
        minutesBefore,
        remindAt: new Date(startAt.getTime() - minutesBefore * 60 * 1000)
      }))
      .sort((a, b) => a.remindAt - b.remindAt);

    const locationName = clean(req.body.locationName);
    const mapUrl = locationName
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName)}`
      : "";

    const appointment = await Appointment.create({
      user: user._id,
      title: clean(req.body.title),
      activityType: req.body.activityType || "appointment",
      startAt,
      reminderMinutesBefore: reminders[0].minutesBefore,
      remindAt: reminders[0].remindAt,
      reminders,
      locationName,
      location: {
        label: locationName
      },
      mapUrl,
      contactName: clean(req.body.contactName),
      contactPhone: clean(req.body.contactPhone),
      contactLineId: clean(req.body.contactLineId),
      preparation: clean(req.body.preparation),
      dressCode: clean(req.body.dressCode),
      speechType: req.body.speechType || "none",
      speechDraftRequested: Boolean(req.body.speechType && req.body.speechType !== "none")
    });

    const messages = [appointmentSavedMessage(appointment)];
    if (appointment.speechDraftRequested) {
      messages.push(speechDraft(appointment.title, appointment.speechType));
    }

    await pushLineMessage(user.lineUserId, messages);
    res.type("html").send(renderSuccessPage(appointment));
  } catch (error) {
    res.status(400).type("html").send(renderErrorPage(error.message));
  }
});

router.get("/appointments", async (req, res) => {
  try {
    const lineUserId = req.query.lineUserId || "";
    const range = req.query.range || "today";
    const user = await User.findOne({ lineUserId });

    if (!user) {
      return res.type("html").send(renderErrorPage("ยังไม่พบข้อมูลสมาชิก กรุณาพิมพ์ สมัคร ใน LINE ก่อน"));
    }

    const { start, end, title } = dateRange(range);
    const appointments = await Appointment.find({
      user: user._id,
      status: "scheduled",
      startAt: { $gte: start, $lt: end }
    }).sort({ startAt: 1 });

    res.type("html").send(renderAppointmentListPage({ appointments, title, lineUserId }));
  } catch (error) {
    res.status(400).type("html").send(renderErrorPage(error.message));
  }
});

router.get("/signup", async (req, res) => {
  const lineUserId = req.query.lineUserId || "";
  res.type("html").send(renderSignupForm({ lineUserId }));
});

router.get("/travel-location", async (req, res) => {
  const lineUserId = req.query.lineUserId || "";
  res.type("html").send(renderTravelLocationForm({ lineUserId }));
});

router.post("/travel-location", async (req, res) => {
  try {
    const latitude = req.body.latitude ? Number(req.body.latitude) : undefined;
    const longitude = req.body.longitude ? Number(req.body.longitude) : undefined;
    const travelLocation = {
      label: clean(req.body.travelLabel) || "พื้นที่เดินทาง",
      latitude,
      longitude,
      province: clean(req.body.province),
      district: clean(req.body.district),
      active: true,
      savedAt: new Date()
    };

    const user = await User.findOneAndUpdate(
      { lineUserId: req.body.lineUserId },
      {
        $setOnInsert: { lineUserId: req.body.lineUserId, active: true, plan: "basic" },
        $push: {
          travelLocations: {
            $each: [travelLocation],
            $slice: -5
          }
        }
      },
      { new: true, upsert: true }
    );

    await pushLineMessage(user.lineUserId, [
      "บันทึกพื้นที่เดินทางเรียบร้อย",
      `พื้นที่: ${travelLocation.label}`,
      travelLocation.latitude && travelLocation.longitude ? "มีพิกัดจาก Location แล้ว" : "ยังไม่มีพิกัด ใช้ชื่อพื้นที่สำหรับอ้างอิงก่อน",
      "ระบบจะใช้พื้นที่นี้ร่วมกับพื้นที่บ้าน สำหรับแจ้งเตือนฝน ฝุ่น อากาศ พายุ แผ่นดินไหว และสึนามิ"
    ].join("\n"));

    res.type("html").send(renderTravelLocationSuccessPage(travelLocation));
  } catch (error) {
    res.status(400).type("html").send(renderErrorPage(error.message));
  }
});

router.post("/signup", async (req, res) => {
  try {
    const latitude = req.body.latitude ? Number(req.body.latitude) : undefined;
    const longitude = req.body.longitude ? Number(req.body.longitude) : undefined;
    const user = await User.findOneAndUpdate(
      { lineUserId: req.body.lineUserId },
      {
        $set: {
          fullName: clean(req.body.fullName),
          phone: clean(req.body.phone),
          plan: req.body.plan || "basic",
          active: true,
          location: {
            label: clean(req.body.homeLabel) || "บ้าน",
            latitude,
            longitude,
            province: clean(req.body.province),
            district: clean(req.body.district)
          }
        }
      },
      { new: true, upsert: true }
    );

    await pushLineMessage(user.lineUserId, [
      "สมัครสมาชิก SmartLife เรียบร้อย",
      `ชื่อ: ${user.fullName || "-"}`,
      `แพ็กเกจ: ${user.plan === "premium" ? "Premium 100 บาท" : "Basic 50 บาท"}`,
      user.phone ? `โทร: ${user.phone}` : "",
      user.location?.label ? `พื้นที่หลัก: ${user.location.label}` : "",
      "ต่อไปพิมพ์ ฟอร์มนัด เพื่อบันทึกกิจกรรมหรือนัดหมายได้เลย"
    ].filter(Boolean).join("\n"));

    res.type("html").send(renderSignupSuccessPage(user));
  } catch (error) {
    res.status(400).type("html").send(renderErrorPage(error.message));
  }
});

function renderAppointmentForm({ lineUserId }) {
  return page("แบบบันทึกปฏิทินกิจกรรม", `
    <h1>แบบบันทึกปฏิทินกิจกรรม</h1>
    <p class="lead">กรอกง่ายสำหรับใช้บนมือถือ: วันที่กับเวลาแยกช่องกัน และสถานที่นัดให้พิมพ์ชื่อสถานที่ได้เอง</p>
    <form method="post" action="/forms/appointment">
      <input type="hidden" name="lineUserId" value="${escapeHtml(lineUserId)}">
      <label for="title">ชื่องานนัดหมาย / กิจกรรม</label>
      <input id="title" name="title" required placeholder="ตรวจสุขภาพ / ประชุม / งานแต่งงาน">

      <fieldset>
        <legend>ประเภทกิจกรรม</legend>
        ${radio("activityType", "appointment", "นัดหมาย", true)}
        ${radio("activityType", "exercise", "ออกกำลังกาย")}
        ${radio("activityType", "meal", "ทานข้าว")}
        ${radio("activityType", "travel", "เดินทาง")}
        ${radio("activityType", "ceremony", "งานพิธี")}
        ${radio("activityType", "wedding", "งานแต่งงาน")}
        ${radio("activityType", "daily", "กิจกรรมประจำวัน")}
        ${radio("activityType", "other", "อื่นๆ")}
      </fieldset>

      <div class="grid">
        <div>
          <label for="dateText">วันที่นัด</label>
          <input id="dateText" name="dateText" required inputmode="numeric" placeholder="22-05-2569">
          <div class="hint">แนะนำให้ใส่ขีด เช่น 22-05-2569 หรือ 22-05-2026</div>
        </div>
        <div>
          <label for="timeText">เวลา</label>
          <input id="timeText" name="timeText" required inputmode="numeric" placeholder="09:00">
          <div class="hint">ใส่เวลาแบบ 09:00 หรือ 9.00</div>
        </div>
      </div>

      <fieldset>
        <legend>ให้เตือนก่อน</legend>
        ${checkbox("reminders", "1440", "1 วันก่อน", true)}
        ${checkbox("reminders", "60", "1 ชั่วโมงก่อน", true)}
        ${checkbox("reminders", "30", "30 นาทีก่อน")}
      </fieldset>

      <label for="locationName">สถานที่</label>
      <input id="locationName" name="locationName" placeholder="รพ.นนทเวช / โรงแรม / ร้านอาหาร / สถานที่จัดงาน">
      <div class="hint">กรอกสถานที่นัดจริง ระบบจะสร้างลิงก์ Google Maps จากชื่อสถานที่ให้ ไม่ใช้ Location ปัจจุบัน</div>

      <div class="grid">
        <div>
          <label for="contactName">นัดกับ</label>
          <input id="contactName" name="contactName" placeholder="ชื่อหมอ / ชื่อเพื่อน / ผู้ประสานงาน">
        </div>
        <div>
          <label for="contactPhone">เบอร์โทร (ไม่บังคับ)</label>
          <input id="contactPhone" name="contactPhone" inputmode="tel" placeholder="08x-xxx-xxxx">
        </div>
      </div>

      <label for="preparation">สิ่งที่ต้องเตรียม</label>
      <textarea id="preparation" name="preparation" placeholder="ใบนัด, บัตรประชาชน, เอกสาร, อุปกรณ์"></textarea>

      <label for="dressCode">ชุด / ธีมที่ต้องใส่</label>
      <input id="dressCode" name="dressCode" placeholder="ชุดสุภาพ / สีฟ้า / ธีมงาน">

      <fieldset>
        <legend>คำกล่าว / สุนทรพจน์</legend>
        ${radio("speechType", "none", "ไม่ต้องการ", true)}
        ${radio("speechType", "speech", "ร่างคำกล่าวทั่วไป")}
        ${radio("speechType", "opening", "ร่างคำกล่าวเปิดงาน")}
        ${radio("speechType", "wedding", "ร่างคำกล่าวงานแต่งงาน")}
        ${radio("speechType", "thanks", "ร่างคำกล่าวขอบคุณ")}
      </fieldset>

      <button type="submit">บันทึกและส่งสรุปเข้า LINE</button>
    </form>
  `);
}

function renderSignupForm({ lineUserId }) {
  return page("สมัคร SmartLife", `
    <h1>สมัคร SmartLife</h1>
    <p class="lead">ใช้ข้อมูลพื้นที่หลักเพื่อเตือนอากาศ ฝุ่น ฝน พายุ แผ่นดินไหว และสึนามิใกล้ตัว</p>
    <form method="post" action="/forms/signup">
      <input type="hidden" name="lineUserId" value="${escapeHtml(lineUserId)}">
      <input type="hidden" id="latitude" name="latitude">
      <input type="hidden" id="longitude" name="longitude">

      <label for="fullName">ชื่อ-นามสกุล</label>
      <input id="fullName" name="fullName" required placeholder="เขมวันต์ ...">

      <label for="phone">เบอร์โทร (ไม่บังคับ)</label>
      <input id="phone" name="phone" inputmode="tel" placeholder="08x-xxx-xxxx">

      <fieldset>
        <legend>แพ็กเกจ</legend>
        ${radio("plan", "basic", "Basic 50 บาท", true)}
        ${radio("plan", "premium", "Premium 100 บาท")}
      </fieldset>

      <label for="homeLabel">พื้นที่หลัก / บ้าน</label>
      <input id="homeLabel" name="homeLabel" placeholder="บ้าน / คอนโด / ที่พัก / ตำบล อำเภอ จังหวัด">
      <button class="secondary" type="button" onclick="useCurrentLocation()">แนบ Location บ้านเพิ่มเติม</button>
      <div id="locationStatus" class="hint">ไม่บังคับ แต่ช่วยให้แจ้งเตือนภัยและอากาศตรงพื้นที่มากขึ้น</div>

      <div class="grid">
        <div>
          <label for="province">จังหวัด</label>
          <input id="province" name="province" placeholder="นนทบุรี">
        </div>
        <div>
          <label for="district">อำเภอ / เขต</label>
          <input id="district" name="district" placeholder="เมืองนนทบุรี">
        </div>
      </div>

      <button type="submit">สมัครสมาชิก</button>
    </form>
    ${geoScript()}
  `);
}

function renderTravelLocationForm({ lineUserId }) {
  return page("เพิ่มพื้นที่เดินทาง", `
    <h1>เพิ่มพื้นที่เดินทาง</h1>
    <p class="lead">ใช้เมื่อต้องเดินทาง ไปเที่ยว ไปต่างจังหวัด หรือพักที่อื่นชั่วคราว เพื่อรับเตือนฝน ฝุ่น อุณหภูมิ และภัยใกล้พื้นที่นั้น</p>
    <form method="post" action="/forms/travel-location">
      <input type="hidden" name="lineUserId" value="${escapeHtml(lineUserId)}">
      <input type="hidden" id="latitude" name="latitude">
      <input type="hidden" id="longitude" name="longitude">

      <label for="travelLabel">ชื่อพื้นที่เดินทาง</label>
      <input id="travelLabel" name="travelLabel" required placeholder="เชียงใหม่ / หัวหิน / โรงแรมที่พัก / จุดที่กำลังเดินทาง">

      <button class="secondary" type="button" onclick="useCurrentLocation()">แนบ Location ปัจจุบันของพื้นที่นี้</button>
      <div id="locationStatus" class="hint">แนะนำให้กดเมื่ออยู่ในพื้นที่เดินทางจริง เพื่อให้เตือนตรงตำแหน่งมากขึ้น</div>

      <div class="grid">
        <div>
          <label for="province">จังหวัด</label>
          <input id="province" name="province" placeholder="เชียงใหม่">
        </div>
        <div>
          <label for="district">อำเภอ / เขต</label>
          <input id="district" name="district" placeholder="เมืองเชียงใหม่">
        </div>
      </div>

      <button type="submit">บันทึกพื้นที่เดินทาง</button>
    </form>
    ${geoScript()}
  `);
}

function renderSuccessPage(appointment) {
  return page("บันทึกสำเร็จ", `
    <h1>บันทึกสำเร็จ</h1>
    <p>บันทึก "${escapeHtml(appointment.title)}" แล้ว และส่งสรุปเข้า LINE ให้แล้ว</p>
    <p class="hint">ระบบจะเตือนตามรอบที่เลือก เช่น 1 วันก่อน และ 1 ชั่วโมงก่อนงาน</p>
  `);
}

function renderTravelLocationSuccessPage(location) {
  return page("บันทึกพื้นที่เดินทางสำเร็จ", `
    <h1>บันทึกพื้นที่เดินทางสำเร็จ</h1>
    <p>บันทึกพื้นที่ "${escapeHtml(location.label)}" แล้ว และส่งสรุปเข้า LINE ให้แล้ว</p>
    <p class="hint">พื้นที่นี้จะถูกใช้ร่วมกับพื้นที่บ้านสำหรับแจ้งเตือนอากาศ ฝุ่น ฝน พายุ แผ่นดินไหว และสึนามิ</p>
  `);
}

function renderSignupSuccessPage(user) {
  return page("สมัครสำเร็จ", `
    <h1>สมัครสำเร็จ</h1>
    <p>บันทึกข้อมูลสมาชิก "${escapeHtml(user.fullName || "SmartLife")}" แล้ว และส่งสรุปเข้า LINE ให้แล้ว</p>
  `);
}

function renderAppointmentListPage({ appointments, title, lineUserId }) {
  const items = appointments.map((appointment) => `
    <article class="item">
      <h2>${escapeHtml(appointment.title)}</h2>
      <div>เวลา: ${escapeHtml(formatDateTime(appointment.startAt))}</div>
      ${appointment.locationName ? `<div>สถานที่: ${escapeHtml(appointment.locationName)}</div>` : ""}
      ${appointment.mapUrl ? `<div><a href="${escapeHtml(appointment.mapUrl)}">เปิด Google Maps</a></div>` : ""}
      ${appointment.contactName ? `<div>นัดกับ: ${escapeHtml(appointment.contactName)}</div>` : ""}
      ${appointment.preparation ? `<div>สิ่งที่ต้องเตรียม: ${escapeHtml(appointment.preparation)}</div>` : ""}
      ${appointment.dressCode ? `<div>ชุด/ธีม: ${escapeHtml(appointment.dressCode)}</div>` : ""}
    </article>
  `).join("");

  return page(title, `
    <h1>${escapeHtml(title)}</h1>
    <nav class="tabs">
      <a href="/forms/appointments?lineUserId=${encodeURIComponent(lineUserId)}&range=today">วันนี้</a>
      <a href="/forms/appointments?lineUserId=${encodeURIComponent(lineUserId)}&range=tomorrow">พรุ่งนี้</a>
      <a href="/forms/appointments?lineUserId=${encodeURIComponent(lineUserId)}&range=week">สัปดาห์นี้</a>
      <a href="/forms/appointments?lineUserId=${encodeURIComponent(lineUserId)}&range=month">เดือนนี้</a>
      <a href="/forms/appointments?lineUserId=${encodeURIComponent(lineUserId)}&range=upcoming">ใกล้ถึง</a>
    </nav>
    ${appointments.length ? items : "<p>ไม่พบกิจกรรมในช่วงนี้</p>"}
  `);
}

function renderErrorPage(message) {
  return page("บันทึกไม่สำเร็จ", `
    <h1>บันทึกไม่สำเร็จ</h1>
    <p>${escapeHtml(message)}</p>
  `);
}

function page(title, body) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #1f2933; }
    main { max-width: 760px; margin: 0 auto; padding: 20px; }
    form { background: white; padding: 18px; border-radius: 8px; border: 1px solid #e3e7ed; box-shadow: 0 1px 8px rgba(15,23,42,.06); }
    h1 { font-size: 24px; margin: 0 0 8px; }
    h2 { font-size: 18px; margin: 0 0 8px; }
    .lead, .hint { color: #5b6776; }
    .hint { font-size: 14px; margin-top: 6px; }
    label { display: block; font-weight: 700; margin-top: 16px; }
    input, textarea { box-sizing: border-box; width: 100%; margin-top: 6px; padding: 12px; border: 1px solid #c8d0d9; border-radius: 6px; font-size: 16px; background: white; }
    textarea { min-height: 90px; resize: vertical; }
    fieldset { border: 1px solid #d8dee6; border-radius: 8px; margin: 16px 0 0; padding: 12px; background: #fbfcfd; }
    legend { font-weight: 700; padding: 0 6px; }
    .choice { display: flex; gap: 10px; align-items: center; margin: 10px 0; font-weight: 500; }
    .choice input { width: 20px; height: 20px; margin: 0; flex: 0 0 auto; }
    button { width: 100%; margin-top: 18px; padding: 13px; border: 0; border-radius: 6px; background: #06c755; color: white; font-size: 17px; font-weight: 700; }
    .secondary { background: #334155; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
    .tabs a { color: #05603a; background: white; border: 1px solid #d8dee6; border-radius: 6px; padding: 8px 10px; text-decoration: none; }
    .item { background: white; border: 1px solid #d8dee6; border-radius: 8px; padding: 14px; margin: 12px 0; }
    a { color: #05603a; }
    @media (max-width: 640px) { main { padding: 14px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

function radio(name, value, label, checked = false) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}"${checked ? " checked" : ""}> ${label}</label>`;
}

function checkbox(name, value, label, checked = false) {
  return `<label class="choice"><input type="checkbox" name="${name}" value="${value}"${checked ? " checked" : ""}> ${label}</label>`;
}

function geoScript() {
  return `<script>
    function useCurrentLocation() {
      const status = document.getElementById("locationStatus");
      if (!navigator.geolocation) {
        status.textContent = "เครื่องนี้ไม่รองรับการระบุตำแหน่ง";
        return;
      }
      status.textContent = "กำลังขอตำแหน่ง...";
      navigator.geolocation.getCurrentPosition(function (position) {
        document.getElementById("latitude").value = position.coords.latitude;
        document.getElementById("longitude").value = position.coords.longitude;
        status.textContent = "แนบ Location เพิ่มเติมแล้ว";
      }, function () {
        status.textContent = "ยังไม่ได้แนบ Location แต่ยังพิมพ์ชื่อสถานที่และบันทึกได้";
      });
    }
  </script>`;
}

function parseThaiDateTime(dateText, timeText) {
  const parsedDate = parseThaiDate(dateText);
  const parsedTime = parseThaiTime(timeText);
  const date = new Date(parsedDate.year, parsedDate.month - 1, parsedDate.day, parsedTime.hour, parsedTime.minute, 0, 0);

  if (Number.isNaN(date.getTime())) {
    throw new Error("กรุณากรอกวันที่และเวลาให้ถูกต้อง เช่น 22-05-2569 และ 09:00");
  }

  return date;
}

function parseThaiDate(value) {
  const text = clean(value).replace(/\s+/g, " ");
  const numeric = text.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (numeric) {
    return normalizeDateParts(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]));
  }

  const iso = text.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (iso) {
    return normalizeDateParts(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  }

  throw new Error("กรุณากรอกวันที่ เช่น 22-05-2569");
}

function parseThaiTime(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2})[:\.](\d{2})$/);
  if (!match) throw new Error("กรุณากรอกเวลา เช่น 09:00");

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("กรุณากรอกเวลาในรูปแบบ 00:00 ถึง 23:59");
  }

  return { hour, minute };
}

function normalizeDateParts(day, month, year) {
  const christianYear = year > 2400 ? year - 543 : year;
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error("กรุณากรอกวันที่ให้ถูกต้อง");
  }
  return { day, month, year: christianYear };
}

function normalizeReminderMinutes(value) {
  const values = Array.isArray(value) ? value : value ? [value] : ["60"];
  const reminders = [...new Set(values.map(Number).filter((item) => Number.isFinite(item) && item > 0))]
    .sort((a, b) => b - a);
  return reminders.length ? reminders : [60];
}

function dateRange(range) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (range === "tomorrow") {
    const start = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, title: "กิจกรรมพรุ่งนี้" };
  }

  if (range === "upcoming") {
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: now, end, title: "กิจกรรมใกล้ถึง 7 วัน" };
  }

  if (range === "week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end, title: "กิจกรรมสัปดาห์นี้" };
  }

  if (range === "month") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { start, end, title: "กิจกรรมเดือนนี้" };
  }

  const end = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  return { start: today, end, title: "กิจกรรมวันนี้" };
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: process.env.APP_TIMEZONE || "Asia/Bangkok"
  }).format(new Date(value));
}

function clean(value) {
  return String(value || "").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = router;
