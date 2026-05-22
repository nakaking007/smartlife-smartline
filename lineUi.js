function mainQuickReply() {
  return {
    items: [
      messageQuickReply("Start", "สมัคร"),
      messageQuickReply("Form", "ฟอร์มนัด"),
      messageQuickReply("Today", "วันนี้"),
      messageQuickReply("พรุ่งนี้", "พรุ่งนี้"),
      messageQuickReply("Trip", "พื้นที่เดินทาง"),
      locationQuickReply("GPS"),
      uriQuickReply("Admin", "https://line.me/ti/p/~charnb015")
    ]
  };
}

function textWithQuickReply(text) {
  return {
    type: "text",
    text: String(text).slice(0, 5000),
    quickReply: mainQuickReply()
  };
}

function welcomeFlex(lineUserId) {
  return flexMessage("SmartLife SmartLine", {
    type: "bubble",
    size: "mega",
    header: headerBox("SmartLife SmartLine", "เลขาส่วนตัวประจำมือถือของท่าน"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        text("เลือกเมนูที่ต้องการใช้งานได้ทันที", "md", "bold"),
        text("นัดหมายไม่พลาด พร้อมเตือนภัยใกล้ตัว เช่น ฝนตกหนัก แผ่นดินไหว พายุ น้ำท่วม และฝุ่น PM2.5", "sm", "regular", "#667085", true),
        separator(),
        button("สมัครสมาชิก", signupFormUrl(lineUserId), "primary"),
        button("บันทึกนัดหมาย", appointmentFormUrl(lineUserId), "secondary"),
        button("พื้นที่เดินทาง", travelLocationFormUrl(lineUserId), "secondary")
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        messageButton("ดูวันนี้", "วันนี้"),
        messageButton("ดูพรุ่งนี้", "พรุ่งนี้"),
        button("ติดต่อผู้ดูแล", "https://line.me/ti/p/~charnb015", "secondary")
      ]
    }
  });
}

function packageFlex(lineUserId) {
  return flexMessage("แพ็กเกจ SmartLife SmartLine", {
    type: "carousel",
    contents: [
      planBubble("Basic", "50 บาท", "บันทึกนัดหมาย เตือนกิจกรรม และดูรายการวันนี้/พรุ่งนี้/สัปดาห์นี้/เดือนนี้", lineUserId),
      planBubble("Premium", "100 บาท", "ทุกอย่างใน Basic พร้อมแจ้งเตือนอากาศ ฝุ่น ฝน ภัยพิบัติ พื้นที่เดินทาง และร่างคำกล่าว", lineUserId)
    ]
  });
}

function appointmentFormFlex(lineUserId) {
  return flexMessage("ฟอร์มนัดหมาย", {
    type: "bubble",
    size: "mega",
    header: headerBox("ฟอร์มนัด", "กรอกวัน เวลา สถานที่ และรอบเตือน"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        text("ระบบบันทึกนัดหมายจากฟอร์มเท่านั้น เพื่อป้องกันข้อมูลผิดพลาด", "sm", "regular", "#667085", true),
        separator(),
        infoRow("วันที่", "22-05-2569"),
        infoRow("เวลา", "09:00"),
        infoRow("เตือน", "1 วัน / 1 ชม. / 30 นาที"),
        infoRow("สถานที่", "พิมพ์ชื่อสถานที่จริง")
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        button("บันทึกการนัดหมาย", appointmentFormUrl(lineUserId), "primary"),
        messageButton("ดูพรุ่งนี้", "พรุ่งนี้")
      ]
    }
  });
}

function travelLocationFlex(lineUserId) {
  return flexMessage("พื้นที่เดินทาง", {
    type: "bubble",
    size: "mega",
    header: headerBox("พื้นที่เดินทาง", "ฝน ฝุ่น อากาศ และภัยใกล้ตัว"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        text("ใช้เมื่อเดินทาง ไปเที่ยว หรือพักต่างพื้นที่ เพื่อรับแจ้งเตือนตรงตำแหน่ง", "sm", "regular", "#667085", true),
        separator(),
        infoRow("ใช้กับ", "ฝน ฝุ่น พายุ แผ่นดินไหว"),
        infoRow("พิกัด", "กด GPS หรือเปิดฟอร์ม")
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        button("เปิดฟอร์มพื้นที่", travelLocationFormUrl(lineUserId), "primary"),
        messageButton("วิธีส่ง GPS", "พิกัด")
      ]
    }
  });
}

function paymentFlex(lineUserId) {
  return flexMessage("สมัครและปลดล็อก", {
    type: "bubble",
    size: "mega",
    header: headerBox("สมัคร / ปลดล็อก", "Basic 50 | Premium 100"),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        infoRow("Basic", "50 บาท"),
        infoRow("Premium", "100 บาท"),
        separator(),
        text("โอนผ่านพร้อมเพย์ 095-525-5901 แล้วส่งสลิปไปที่ LINE ID: charnb015 เพื่อให้ผู้ดูแลเปิดสิทธิ์", "sm", "regular", "#344054", true)
      ]
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        button("เปิดฟอร์มสมัคร", signupFormUrl(lineUserId), "primary"),
        button("ติดต่อผู้ดูแล", "https://line.me/ti/p/~charnb015", "secondary")
      ]
    }
  });
}

function emptyAppointmentsMessage(title, lineUserId) {
  return [
    textWithQuickReply(`${title}ไม่มีนัดหมายสำหรับท่าน\nหากต้องการบันทึกการนัดหมายเพิ่มเติม กรุณาคลิกแบบฟอร์มนี้`),
    appointmentFormFlex(lineUserId)
  ];
}

function flexMessage(altText, contents) {
  return { type: "flex", altText, contents };
}

function planBubble(title, price, detail, lineUserId) {
  return {
    type: "bubble",
    size: "kilo",
    header: headerBox(title, price),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        text(detail, "sm", "regular", "#667085", true),
        separator(),
        button("สมัคร", signupFormUrl(lineUserId), "primary")
      ]
    }
  };
}

function headerBox(title, subtitle) {
  return {
    type: "box",
    layout: "vertical",
    paddingAll: "20px",
    backgroundColor: "#06C755",
    contents: [
      text(title, "xl", "bold", "#FFFFFF"),
      text(subtitle, "sm", "regular", "#E8FFF1", true)
    ]
  };
}

function button(label, uri, style) {
  return {
    type: "button",
    style,
    height: "sm",
    action: { type: "uri", label, uri }
  };
}

function messageButton(label, message) {
  return {
    type: "button",
    style: "secondary",
    height: "sm",
    action: { type: "message", label, text: message }
  };
}

function infoRow(label, value) {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      text(label, "sm", "bold", "#344054"),
      text(value, "sm", "regular", "#667085", true, "end")
    ]
  };
}

function text(value, size = "sm", weight = "regular", color = "#101828", wrap = false, align = "start") {
  return { type: "text", text: value, size, weight, color, wrap, align };
}

function separator() {
  return { type: "separator", margin: "md" };
}

function messageQuickReply(label, message) {
  return { type: "action", action: { type: "message", label, text: message } };
}

function uriQuickReply(label, uri) {
  return { type: "action", action: { type: "uri", label, uri } };
}

function locationQuickReply(label) {
  return { type: "action", action: { type: "location", label } };
}

function signupFormUrl(lineUserId) {
  return `${publicBaseUrl()}/forms/signup?lineUserId=${encodeURIComponent(lineUserId)}`;
}

function appointmentFormUrl(lineUserId) {
  return `${publicBaseUrl()}/forms/appointment?lineUserId=${encodeURIComponent(lineUserId)}`;
}

function travelLocationFormUrl(lineUserId) {
  return `${publicBaseUrl()}/forms/travel-location?lineUserId=${encodeURIComponent(lineUserId)}`;
}

function publicBaseUrl() {
  return process.env.PUBLIC_BASE_URL || "http://localhost:3000";
}

module.exports = {
  appointmentFormFlex,
  emptyAppointmentsMessage,
  packageFlex,
  paymentFlex,
  textWithQuickReply,
  travelLocationFlex,
  welcomeFlex
};
