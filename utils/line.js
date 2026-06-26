// utils/line.js
const { messagingApi } = require('@line/bot-sdk');
const config = require('../config');
const { formatBangkokDateTime } = require('./time');
const { formatHours } = require('./riskAssessment');

const client = new messagingApi.MessagingApiClient({
  channelAccessToken: config.lineAccessToken
});

function validateLineAccessToken() {
  if (!config.lineAccessToken) {
    throw new Error('LINE_ACCESS_TOKEN is not configured');
  }
}

function validateLinePushConfig() {
  validateLineAccessToken();

  if (!config.lineUserId) {
    throw new Error('LINE_USER_ID is not configured');
  }
}

function normalizeMessages(message) {
  if (typeof message === 'string') {
    return [{ type: 'text', text: message }];
  }

  if (Array.isArray(message)) {
    return message;
  }

  return [message];
}

function replyMessage(replyToken, message) {
  validateLineAccessToken();
  return client.replyMessage({
    replyToken,
    messages: normalizeMessages(message)
  });
}

function reply(replyToken, text) {
  return replyMessage(replyToken, text);
}

function pushMessage(message) {
  validateLinePushConfig();
  return client.pushMessage({
    to: config.lineUserId,
    messages: normalizeMessages(message)
  });
}

function pushMessageTo(to, message) {
  validateLineAccessToken();

  if (!to) {
    throw new Error('LINE recipient is not configured');
  }

  return client.pushMessage({
    to,
    messages: normalizeMessages(message)
  });
}

async function sendMessage(text) {
  return pushMessage(text);
}

async function sendAppointmentReminder(eventId, summary, time, details = {}) {
  const bodyContents = [
    { type: "text", text: `📅 นัดหมาย: ${summary}`, weight: "bold", size: "md", wrap: true },
    { type: "text", text: `🕒 เวลา: ${time}`, size: "sm", color: "#555555", wrap: true }
  ];

  if (details.leadTime) {
    bodyContents.unshift({ type: "text", text: `อีก ${details.leadTime} จะถึงกิจกรรมค่ะ`, size: "sm", color: "#1DB446", wrap: true });
  }

  if (details.locationName) {
    bodyContents.push({ type: "text", text: `📍 สถานที่: ${details.locationName}`, size: "sm", color: "#555555", wrap: true });
  }

  if (details.dressCode) {
    bodyContents.push({ type: "text", text: `👔 การแต่งกาย: ${details.dressCode}`, size: "sm", color: "#555555", wrap: true });
  }

  return pushMessage({
    type: "flex",
    altText: "แจ้งเตือนนัดหมาย",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1DB446",
            action: {
              type: "postback",
              label: "แก้ไข",
              data: `action=edit&eventId=${eventId}`
            }
          },
          {
            type: "button",
            style: "secondary",
            color: "#FF3B30",
            action: {
              type: "postback",
              label: "ลบ",
              data: `action=delete&eventId=${eventId}`
            }
          }
        ]
      }
    }
  });
}

function buildAppointmentFlexMessages(events) {
  if (!events || events.length === 0) {
    return [];
  }

  return [{
    type: "flex",
    altText: "เมนูนัดหมายวันนี้",
    contents: {
      type: "carousel",
      contents: events.slice(0, 10).map((event, index) => ({
        type: "bubble",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "sm",
          contents: [
            { type: "text", text: `นัดหมาย ${index + 1}`, size: "xs", color: "#777777" },
            { type: "text", text: event.summary || "-", weight: "bold", size: "md", wrap: true },
            { type: "text", text: `🕒 เวลา: ${event.start || "-"}`, size: "sm", color: "#555555", wrap: true },
            { type: "text", text: `📍 สถานที่: ${event.locationName || "-"}`, size: "sm", color: "#555555", wrap: true }
          ]
        },
        footer: {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#1DB446",
              action: {
                type: "postback",
                label: "แก้ไข",
                data: `action=edit&eventId=${event.eventId}`
              }
            },
            {
              type: "button",
              style: "secondary",
              color: "#FF3B30",
              action: {
                type: "postback",
                label: "ลบ",
                data: `action=delete&eventId=${event.eventId}`
              }
            }
          ]
        }
      }))
    }
  }];
}

function formatWeatherValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'ยังไม่มีข้อมูล';
  }

  return `${value}${suffix}`;
}

function buildTodoMorningText(todoSummary = {}) {
  const priorityLabel = {
    urgent: 'เร่งด่วน',
    high: 'สำคัญ',
    normal: 'ปกติ'
  };
  const overdue = Array.isArray(todoSummary.overdue) ? todoSummary.overdue : [];
  const today = Array.isArray(todoSummary.today) ? todoSummary.today : [];
  const lines = ['🧾 To-do:'];

  if (!overdue.length && !today.length) {
    lines.push('- ไม่มีงานค้างหรืองานที่ครบกำหนดวันนี้ค่ะ');
    lines.push('- นายท่านจะลงบันทึก To-do ตอนนี้ไหมคะ พิมพ์: เพิ่มงาน | ชื่องาน | วันเวลา | ผู้รับผิดชอบ | high | หมายเหตุ');
    return lines.join('\n');
  }

  overdue.slice(0, 5).forEach(item => {
    lines.push(`- ค้าง: ${item.title || '-'}${item.responsible ? ` / ผู้รับผิดชอบ: ${item.responsible}` : ''} (${priorityLabel[item.priority] || item.priority || 'ปกติ'})`);
  });

  today.slice(0, 5).forEach(item => {
    lines.push(`- วันนี้: ${item.title || '-'}${item.responsible ? ` / ผู้รับผิดชอบ: ${item.responsible}` : ''} (${priorityLabel[item.priority] || item.priority || 'ปกติ'})`);
  });

  const hiddenCount = Math.max(0, overdue.length + today.length - 10);
  if (hiddenCount > 0) {
    lines.push(`- ยังมีอีก ${hiddenCount} งาน เปิด /ปฏิทิน เพื่อดูทั้งหมด`);
  }

  lines.push('- นายท่านจะลงบันทึกเพิ่มหรืออัปเดตงานตอนนี้ไหมคะ');

  return lines.join('\n');
}

async function sendMorningGreeting(weather, events, todoSummary = {}) {
  let eventText = "📋 ตารางงานวันนี้:\n";

  if (events.length === 0) {
    eventText += "- ไม่มีนัดหมายค่ะ\n";
  } else {
    events.forEach(event => {
      eventText += `- ${event.summary} เวลา ${event.start}\n`;
    });
  }
  const todoText = buildTodoMorningText(todoSummary);

const message =
`เรียน นายท่าน วันนี้ดิฉัน SmartLife ขอรายงานดังนี้ค่ะ

🌤 อุณหภูมิสูงสุด: ${formatWeatherValue(weather.tempMax, '°C')} (${weather.tempAssessment ? weather.tempAssessment.level : 'ยังไม่มีข้อมูล'})
🥵 ดัชนีความร้อน: ${formatWeatherValue(weather.heatIndex, '°C')}${weather.heatIndexAssessment ? ` (${weather.heatIndexAssessment.level})` : ''}
🌧 โอกาสฝน 12 ชม.: ${formatWeatherValue(weather.rainChance, '%')} (${weather.rainChanceAssessment ? weather.rainChanceAssessment.level : 'ยังไม่มีข้อมูล'})
☔ ฝนล่าสุด 1 ชม.: ${formatWeatherValue(weather.rainMm1h, ' มม.')} (${weather.rainAmountAssessment ? weather.rainAmountAssessment.level : 'ยังไม่มีข้อมูล'})
🌦 คาดฝนถัดไป: ${weather.nextRainAt ? `${formatHours(weather.nextRainInHours)} / ${formatWeatherValue(weather.nextRainMm3h, ' มม.')} ในรอบ 3 ชม. (${weather.nextRainAssessment ? weather.nextRainAssessment.level : 'ยังไม่มีข้อมูล'})` : 'ยังไม่พบสัญญาณฝนใน forecast'}
💨 PM2.5: ${formatWeatherValue(weather.pm25, ' µg/m³')} (${weather.pm25Assessment ? weather.pm25Assessment.level : 'ยังไม่มีข้อมูล'})
😷 หน้ากาก: ${weather.pm25Assessment ? weather.pm25Assessment.maskAdvice : 'ยังไม่มีข้อมูล'}

${eventText}

${todoText}

${weather.healthAdvice || 'วันนี้ยังไม่มีคำแนะนำเฉพาะจากข้อมูลที่ระบบได้รับค่ะ'}

ที่มา: ${weather.source || 'แหล่งข้อมูลอากาศ'} เวลา ${formatBangkokDateTime(weather.observedAt)}
ขอให้นายท่านเดินทางโดยปลอดภัยนะคะ`;

  return pushMessage([
    { type: 'text', text: message },
    ...buildAppointmentFlexMessages(events)
  ]);
}

module.exports = {
  reply,
  replyMessage,
  pushMessage,
  pushMessageTo,
  sendMessage,
  sendAppointmentReminder,
  sendMorningGreeting,
  buildTodoMorningText
};
