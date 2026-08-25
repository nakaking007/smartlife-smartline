// utils/line.js
const { messagingApi } = require('@line/bot-sdk');
const axios = require('axios');
const crypto = require('crypto');
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

function createRetryKey(...parts) {
  const hash = crypto
    .createHash('sha256')
    .update(parts.map(part => String(part || '')).join(':'))
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x40;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function createTextMessages(text, maxLength = 4500) {
  let remaining = String(text || '').trim();
  const messages = [];

  while (remaining) {
    let splitAt = Math.min(maxLength, remaining.length);
    if (remaining.length > maxLength) {
      const paragraphBreak = remaining.lastIndexOf('\n', maxLength);
      if (paragraphBreak >= Math.floor(maxLength * 0.6)) {
        splitAt = paragraphBreak;
      }
    }

    messages.push({ type: 'text', text: remaining.slice(0, splitAt).trim() });
    remaining = remaining.slice(splitAt).trim();
  }

  return messages.slice(0, 5);
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

async function pushMessage(message, to, options = {}) {
  validateLineAccessToken();
  const recipient = to || config.lineUserId;

  if (!recipient) {
    throw new Error('LINE recipient is not configured');
  }

  const payload = {
    to: recipient,
    messages: normalizeMessages(message)
  };

  if (options.retryKey) {
    try {
      return await axios.post('https://api.line.me/v2/bot/message/push', payload, {
        headers: {
          Authorization: `Bearer ${config.lineAccessToken}`,
          'Content-Type': 'application/json',
          'X-Line-Retry-Key': options.retryKey
        }
      });
    } catch (err) {
      if (err.response && err.response.status === 409) {
        return { duplicate: true, retryKey: options.retryKey };
      }

      throw err;
    }
  }

  return client.pushMessage({
    to: recipient,
    messages: payload.messages
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
  const to = details.to || details.lineUserId;
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

  if (details.contactName) {
    bodyContents.push({ type: "text", text: `ผู้ประสานงาน: ${details.contactName}`, size: "sm", color: "#555555", wrap: true });
  }

  if (details.contactPhone) {
    bodyContents.push({ type: "text", text: `โทร: ${details.contactPhone}`, size: "sm", color: "#555555", wrap: true });
  }

  if (details.contactLineId) {
    bodyContents.push({ type: "text", text: `LINE: ${details.contactLineId}`, size: "sm", color: "#555555", wrap: true });
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
  }, to);
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

async function sendMorningGreeting(weather, events, todoSummary = {}, to, options = {}) {
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

  const messages = [{ type: 'text', text: message }];

  if (options.includeAppointmentCards) {
    messages.push(...buildAppointmentFlexMessages(events));
  }

  return pushMessage(messages, to, options);
}

module.exports = {
  createRetryKey,
  reply,
  replyMessage,
  pushMessage,
  pushMessageTo,
  sendMessage,
  sendAppointmentReminder,
  sendMorningGreeting,
  createTextMessages,
  buildTodoMorningText
};
