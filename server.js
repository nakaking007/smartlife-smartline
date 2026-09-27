// server.js
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const path = require('path');
const config = require('./config');
const { isValidLineSignature } = require('./middleware/lineWebhook');
const { configureMongoDns } = require('./utils/mongoDns');
const line = require('./utils/line');
const tasks = require('./utils/tasks');
const appointments = require('./utils/appointments');
const alerts = require('./utils/alerts');
const speech = require('./utils/speech');
const writing = require('./utils/writing');
const manual = require('./utils/manual');
const ai = require('./utils/ai');
const weather = require('./utils/weather');
const weatherQuestions = require('./utils/weatherQuestions');
const liveDisasters = require('./utils/liveDisasters');
const freeServices = require('./utils/freeServices');
const knowledge = require('./utils/knowledge');
const scamCheck = require('./utils/scamCheck');
const todos = require('./utils/todos');
const earthquakeWarnings = require('./utils/earthquakeWarnings');
const lineRecipient = require('./utils/lineRecipient');
const User = require('./models/User');
const { THAILAND_TIME_ZONE, formatBangkokDateTime, getBangkokDateKey, getBangkokDayRange } = require('./utils/time');
const { formatHours } = require('./utils/riskAssessment');
const userRoutes = require('./routes/userRoutes');
const appointmentRoutes = require('./routes/appointments');
const todoRoutes = require('./routes/todos');
const earthquakeWarningRoutes = require('./routes/earthquakeWarnings');
const appRoutes = require('./routes/app');
const cronJobs = require('./cron');

const app = express();
const port = Number(process.env.PORT) || 3000;
const pendingAppointmentEdits = new Map();
const pendingAppointmentLists = new Map();
const pendingModes = new Map();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  next();
});
app.use(bodyParser.json({
  verify(req, res, buffer) {
    if (req.originalUrl === '/webhook' || req.originalUrl === '/webhooks/line') {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/assets', express.static(path.join(__dirname, 'public')));
app.use('/users', userRoutes);
app.use('/appointments', appointmentRoutes);
app.use('/todos', todoRoutes);
app.use('/earthquake-warnings', earthquakeWarningRoutes);
app.use('/api', appRoutes);

configureMongoDns();
mongoose.connect(config.mongoUri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000
})
  .then(async () => {
    console.log("SmartLife MongoDB connected...");
    const recoveredUserId = await lineRecipient.recoverLineRecipient();
    console.log(`SmartLife LINE push recipient ${recoveredUserId ? 'ready' : 'not configured'}...`);
  })
  .catch(err => console.error("SmartLife MongoDB connection error:", err));

app.get('/', (req, res) => {
  res.type('html').send([
    '<!doctype html>',
    '<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SmartLife</title></head><body style="font-family:Segoe UI,Tahoma,sans-serif;padding:24px">',
    '<h1>SmartLife server is running</h1>',
    '<p><a href="/appointments-panel">เปิดแผงนัดหมาย</a></p>',
    '<p><a href="/health">ตรวจสถานะระบบ</a></p>',
    '</body></html>'
  ].join(''));
});

app.get('/health', (req, res) => {
  const mongoStates = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };
  const mongoReadyState = mongoose.connection.readyState;

  res.json({
    status: mongoReadyState === 1 ? 'ok' : 'degraded',
    release: process.env.RENDER_GIT_COMMIT ? process.env.RENDER_GIT_COMMIT.slice(0, 7) : 'local',
    timezone: THAILAND_TIME_ZONE,
    thailandTime: formatBangkokDateTime(new Date()),
    mongo: mongoStates[mongoReadyState] || 'unknown',
    line: {
      accessTokenConfigured: Boolean(config.lineAccessToken),
      userIdConfigured: Boolean(config.lineUserId),
      pushConfigured: Boolean(config.lineAccessToken),
      webhookSignatureConfigured: Boolean(config.lineChannelSecret),
      liffConfigured: Boolean(config.liffId && config.lineLoginChannelId)
    },
    ai: ai.getStatus()
  });
});

app.post('/cron/morning-catchup', async (req, res) => {
  if (!config.cronSecret) {
    return res.status(503).json({ error: 'Scheduler security is not configured' });
  }
  if (req.headers.authorization !== `Bearer ${config.cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized scheduler' });
  }
  const bangkokParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: THAILAND_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
  const bangkokMinutes = bangkokParts.hour * 60 + bangkokParts.minute;

  if (bangkokMinutes < 6 * 60 + 1 || bangkokMinutes >= 12 * 60) {
    res.status(403).json({ error: 'Morning catch-up is available from 06:01 to 11:59 Asia/Bangkok' });
    return;
  }

  try {
    const sent = await cronJobs.sendDailyMorningReport(new Date());
    await cronJobs.syncLiveDisasterAlerts({ force: true });
    await cronJobs.sendUrgentAlerts();
    res.json({ status: 'ok', morningSent: sent });
  } catch (err) {
    console.error('SmartLife morning catch-up endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/ai/status', (req, res) => {
  res.json(ai.getStatus());
});

app.get('/api-config', (req, res) => {
  res.json({
    liffId: config.liffId || '',
    officialAccountId: config.lineOfficialAccountId,
    addFriendUrl: `https://line.me/R/ti/p/${encodeURIComponent(config.lineOfficialAccountId)}`
  });
});

app.get('/appointments-panel', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/forms', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/register-panel', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/register-form', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/appointment-form', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/liff', (req, res) => {
  res.redirect('/liff/calendar');
});

app.get('/liff/calendar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function formatBangkokDate(date) {
  return formatBangkokDateTime(date);
}

function getPublicUrl(routePath) {
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const baseUrl = config.publicBaseUrl || `http://localhost:${port}`;
  return `${String(baseUrl).replace(/\/+$/, '')}${normalizedPath}`;
}

function getCalendarUrl(userId) {
  if (config.liffId) return `https://liff.line.me/${config.liffId}`;
  return getPublicUrl('/liff/calendar');
}

function hasPublicUrl() {
  return Boolean(config.publicBaseUrl);
}

function normalizeCommand(text) {
  return String(text || '').trim().replace(/^\/+/, '').trim();
}

function getPendingMode(userId) {
  if (!userId) {
    return null;
  }

  const mode = pendingModes.get(userId);
  if (!mode) {
    return null;
  }

  return typeof mode === 'string' ? { type: mode } : mode;
}

function getAppointmentIdFromData(data) {
  const params = new URLSearchParams(data);
  const fromParams = params.get('id') || params.get('eventId') || params.get('appointmentId') || params.get('taskId');

  if (fromParams) {
    return fromParams;
  }

  const match = String(data || '').match(/([a-f\d]{24})/i);
  return match ? match[1] : null;
}

function getPostbackAction(data) {
  const params = new URLSearchParams(data);
  const action = params.get('action');

  if (action) {
    return action;
  }

  if (String(data).includes('edit')) {
    return 'edit';
  }

  if (String(data).includes('delete')) {
    return 'delete';
  }

  return '';
}

function rememberAppointmentSelection(userId, items) {
  if (!userId) {
    return;
  }

  pendingAppointmentLists.set(userId, items.map(item => String(item._id)));
}

function getAppointmentIdFromSelection(userId, index) {
  if (!userId || !Number.isInteger(index) || index < 1) {
    return null;
  }

  const ids = pendingAppointmentLists.get(userId) || [];
  return ids[index - 1] || null;
}

function buildEditPrompt(appointment) {
  const currentLines = appointment
    ? [
        "",
        `รายการที่เลือก: ${appointment.title || '-'}`,
        `เวลาปัจจุบัน: ${formatBangkokDate(appointment.startAt)}`,
        appointment.locationName ? `สถานที่: ${appointment.locationName}` : null
      ].filter(Boolean)
    : [];

  return [
    "เรียน นายท่าน กรุณาส่งข้อมูลใหม่ตามรูปแบบเวลา 24 ชั่วโมงค่ะ",
    ...currentLines,
    "",
    "แก้เฉพาะเวลา: พิมพ์เวลาจริงที่ต้องการ เช่น 15.00 น.",
    "หรือแก้ทั้งหมดตามรูปแบบ: ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "ตัวอย่างรูปแบบ: ประชุมทีม | 2026-05-28 15.00 น. | ห้องประชุม | ชุดสุภาพ"
  ].join("\n");
}

function buildMainMenuMessage() {
  return {
    type: 'text',
    text: [
      "แผงหลัก SmartLife ค่ะ",
      "",
      "เลือกเมนูที่ต้องการได้เลยค่ะ",
      "1. สมัครสมาชิก",
      "2. บันทึกนัดหมาย",
      "3. แก้ไขนัดหมาย",
      "4. แปลภาษา",
      "5. ตอบคำถาม",
      "6. ดูนัดหมาย",
      "7. เขียนบทความ/สุนทรพจน์",
      "",
      "คำสั่งพิมพ์เร็ว:",
      "/สภาพอากาศ /นัดหมาย /ภัยพิบัติ /พรุ่งนี้ /สัปดาห์นี้ /เดือนนี้",
      "/ปฏิทิน /บทความ /สุนทรพจน์ /คำถามอื่น /คำถาม /แปลภาษา /สมัคร /ปลดลอค /บริการฉุกเฉิน /ตรวจเช็ค"
    ].join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'สภาพอากาศ',
            text: '/สภาพอากาศ'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'สมัครสมาชิก',
            text: 'สมัครสมาชิก'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'บันทึกนัดหมาย',
            text: 'บันทึกนัดหมาย'
          }
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'แก้ไขนัดหมาย',
            data: 'action=list_appointments',
            displayText: 'แก้ไขนัดหมาย'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'แปลภาษา',
            text: 'แปลภาษา'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ตอบคำถาม',
            text: 'ตอบคำถาม'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ดูนัดหมาย',
            text: '/ปฏิทิน'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ภัยพิบัติ',
            text: '/ภัยพิบัติ'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ปลดล็อก',
            text: '/ปลดลอค'
          }
        },
        {
          type: 'action',
          action: {
            type: 'message',
            label: 'ตรวจเช็ค',
            text: '/ตรวจเช็ค'
          }
        }
      ]
    }
  };
}

function buildTranslatePromptMessage() {
  const message = buildCommandOutputMessage({
    title: 'แปลภาษา',
    available: true,
    detail: [
      'พิมพ์คำว่า แปล ตามด้วยข้อความที่ต้องการแปล',
      '',
      'ตัวอย่าง:',
      'แปล วันนี้ฉันมีประชุมเวลา 15.00 น.'
    ].join("\n"),
    command: '/แปลภาษา',
    actionLabel: 'แปลภาษา'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ตัวอย่างแปล', text: 'แปล วันนี้ฉันมีประชุมเวลา 15.00 น.' }
      }
    ]
  };

  return message;
}

function buildChatPromptMessage(userId) {
  if (userId) {
    pendingModes.set(userId, 'chat');
  }

  const status = ai.getStatus();
  const message = buildCommandOutputMessage({
    title: 'ตอบคำถาม AI',
    available: status.textAiConfigured,
    detail: status.textAiConfigured
      ? 'พิมพ์คำถามมาได้เลย ระบบจะส่งต่อให้สมอง AI ฟรี/สำรองที่ตั้งค่าไว้ ถ้าจะกลับเมนูหลัก พิมพ์ เมนู'
      : 'ไม่มี provider ถามตอบที่พร้อมใช้',
    command: '/คำถามอื่น',
    actionLabel: 'ถามต่อ'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ถามตัวอย่าง', text: 'ช่วยแนะนำการเตรียมตัวเดินทางวันนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'เมนู', text: 'เมนู' }
      }
    ]
  };

  return message;
}

function buildAppointmentViewMenuMessage() {
  const message = buildCommandOutputMessage({
    title: 'ดูนัดหมาย',
    available: true,
    detail: 'เลือกช่วงเวลาที่ต้องการดู ระบบจะแสดงรายการตามเวลาไทย 24 ชั่วโมง',
    command: '/นัดหมาย',
    actionLabel: 'ดูทั้งหมด'
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'วันนี้', text: 'นัดหมายวันนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'พรุ่งนี้', text: 'นัดหมายพรุ่งนี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'สัปดาห์นี้', text: 'นัดหมายสัปดาห์นี้' }
      },
      {
        type: 'action',
        action: { type: 'message', label: 'เดือนนี้', text: 'นัดหมายเดือนนี้' }
      }
    ]
  };

  return message;
}

function buildLinkMessage(title, body, label, url) {
  if (!hasPublicUrl()) {
    return [
      title,
      "",
      body,
      "",
      "ตอนนี้ยังไม่มี PUBLIC_BASE_URL แบบ HTTPS สำหรับเปิดฟอร์มจากมือถือใน LINE",
      "ลิงก์นี้เปิดได้บนเครื่องที่รันระบบ:",
      url,
      "",
      "หากต้องการเปิดจากมือถือ ให้ตั้ง PUBLIC_BASE_URL หรือ APPOINTMENTS_PANEL_URL เป็น URL สาธารณะก่อนค่ะ"
    ].join("\n");
  }

  return {
    type: 'text',
    text: [title, "", body, "", url].join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'uri',
            label,
            uri: url
          }
        }
      ]
    }
  };
}

function hasPaymentOutputConfigured() {
  return Boolean(
    config.paymentPromptPay ||
    config.paymentBankAccount ||
    config.paymentQrUrl ||
    config.paymentInstructions
  );
}

function buildStatusBubble({ title, available = true, detail, command, uri }) {
  const statusText = available ? 'มี' : 'ไม่มี';
  const statusColor = available ? '#12805c' : '#b42318';
  const action = uri && hasPublicUrl()
    ? { type: 'uri', label: 'เปิด', uri }
    : { type: 'message', label: 'ใช้คำสั่ง', text: command || title };

  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: title, weight: 'bold', wrap: true, size: 'md' },
        { type: 'text', text: statusText, weight: 'bold', color: statusColor, size: 'xl' },
        { type: 'text', text: detail || '-', wrap: true, color: '#475467', size: 'sm' }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: available ? 'primary' : 'secondary',
          color: available ? '#12805c' : '#667085',
          action
        }
      ]
    }
  };
}

function limitCardText(value, maxLength = 1200) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text || '-';
  }

  return `${text.slice(0, maxLength - 20).trim()}\n...ดูรายละเอียดต่อด้วยคำสั่งเดิม`;
}

function buildCommandOutputCard({ title, available = true, detail, command, actionLabel, uri }) {
  return {
    ...buildStatusBubble({
      title,
      available,
      detail: limitCardText(detail),
      command,
      uri
    }),
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: available ? 'primary' : 'secondary',
          color: available ? '#12805c' : '#667085',
          action: uri && hasPublicUrl()
            ? { type: 'uri', label: actionLabel || 'เปิด', uri }
            : { type: 'message', label: actionLabel || 'ใช้คำสั่ง', text: command || title }
        }
      ]
    }
  };
}

function buildCommandOutputMessage(options) {
  return {
    type: 'flex',
    altText: options.title || 'SmartLife',
    contents: buildCommandOutputCard(options)
  };
}

function buildStatusCarouselMessage(altText, cards) {
  return {
    type: 'flex',
    altText,
    contents: {
      type: 'carousel',
      contents: cards
    }
  };
}

function buildStatusCarouselMessages(altText, cards) {
  const groups = chunkItems(cards, 10);
  return groups.map((group, index) => buildStatusCarouselMessage(
    groups.length > 1 ? `${altText} ${index + 1}/${groups.length}` : altText,
    group
  ));
}

function buildFormSelectorMessage() {
  const cards = [
    buildStatusBubble({
      title: 'แบบฟอร์มสมัครสมาชิก',
      available: true,
      detail: hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้ผ่าน /register-form' : 'มีฟอร์มแล้ว แต่ยังไม่มี PUBLIC_BASE_URL สำหรับมือถือ',
      command: 'แบบฟอร์มสมัคร',
      uri: getPublicUrl('/register-form')
    }),
    buildStatusBubble({
      title: 'แบบฟอร์มนัดหมาย',
      available: true,
      detail: 'บันทึกนัดหมาย เวลาไทย 24 ชั่วโมง แยกจากฟอร์มสมัคร',
      command: 'แบบฟอร์มนัดหมาย',
      uri: getPublicUrl('/appointment-form')
    }),
    buildStatusBubble({
      title: 'แผงแก้ไขนัดหมาย',
      available: true,
      detail: 'ดู แก้ไข บันทึก หรือลบนัดหมายทั้งหมด',
      command: 'แผงนัดหมาย',
      uri: getPublicUrl('/appointments-panel')
    })
  ];

  return buildStatusCarouselMessage('การ์ดแบบฟอร์ม SmartLife', cards);
}

function buildRegisterFormLinkMessage() {
  return buildCommandOutputMessage({
    title: 'แบบฟอร์มสมัครสมาชิก',
    available: true,
    detail: [
      freeServices.buildRegisterPaymentText(),
      '',
      hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้' : 'ไม่มี PUBLIC_BASE_URL จึงยังเปิดฟอร์มจากมือถือ LINE ไม่ได้'
    ].join("\n"),
    command: 'แบบฟอร์มสมัคร',
    actionLabel: hasPublicUrl() ? 'เปิดฟอร์ม' : 'ดูฟอร์ม',
    uri: getPublicUrl('/register-form')
  });
}

function buildAppointmentFormLinkMessage() {
  const message = buildCommandOutputMessage({
    title: 'แบบฟอร์มนัดหมาย',
    available: true,
    detail: [
      'บันทึกนัดหมาย เวลาไทย 24 ชั่วโมง',
      'ถ้าเปิดฟอร์มไม่ได้ ให้พิมพ์ใน LINE ได้เลย:',
      'บันทึกนัดหมาย | ชื่อ | 28-05-2569 : 15.00 น. | สถานที่ | ชุด',
      '',
      hasPublicUrl() ? 'เปิดจากมือถือ LINE ได้' : 'ไม่มี PUBLIC_BASE_URL จึงยังเปิดฟอร์มจากมือถือ LINE ไม่ได้'
    ].join("\n"),
    command: 'แบบฟอร์มนัดหมาย',
    actionLabel: hasPublicUrl() ? 'เปิดฟอร์ม' : 'ดูวิธีบันทึก',
    uri: getPublicUrl('/appointment-form')
  });

  message.quickReply = {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: 'ตัวอย่างบันทึก', text: 'บันทึกนัดหมาย | ประชุม | 28-05-2569 : 15.00 น. | ห้องประชุม | ชุดสุภาพ' }
      }
    ]
  };

  return message;
}

function buildLineCommandChecklist() {
  const status = ai.getStatus();
  const lines = [
    `/สภาพอากาศ: มี`,
    `/นัดหมาย: มี`,
    `/แบบฟอร์ม: ${hasPublicUrl() ? 'มี' : 'ไม่มีลิงก์ HTTPS มือถือ'}`,
    `/คำถามอื่น: ${status.textAiConfigured ? 'มี' : 'ไม่มี provider แชต'}`,
    `/บทความ: ${status.textAiConfigured ? 'มี' : 'ไม่มี provider AI'}`,
    `/สุนทรพจน์: ${status.textAiConfigured ? 'มี' : 'ไม่มี provider AI'}`,
    `/แปลภาษา: มี`,
    `ช่องทางโอนจริง: ${hasPaymentOutputConfigured() ? 'มี' : 'ไม่มี'}`
  ];

  const message = buildCommandOutputMessage({
    title: 'ตรวจเช็ค SmartLife',
    available: status.textAiConfigured || hasPublicUrl(),
    detail: [
      'สรุปสถานะคำสั่งหลักตามที่ขอ',
      '',
      ...lines,
      '',
      `AI: ${status.configuredProviders && status.configuredProviders.length ? status.configuredProviders.join(' > ') : 'ไม่มี'}`
    ].join("\n"),
    command: '/ตรวจเช็ค',
    actionLabel: 'ตรวจอีก'
  });

  message.quickReply = {
    items: [
      { type: 'action', action: { type: 'message', label: 'ฟอร์ม', text: '/แบบฟอร์ม' } },
      { type: 'action', action: { type: 'message', label: 'ถาม AI', text: '/คำถามอื่น' } },
      { type: 'action', action: { type: 'message', label: 'เขียนบทความ', text: '/บทความ การพัฒนาคุณภาพชีวิต' } }
    ]
  };

  return message;
}

function buildAppointmentMenuMessage(items) {
  if (items.length === 0) {
    const message = buildCommandOutputMessage({
      title: 'นัดหมายทั้งหมด',
      available: false,
      detail: 'ไม่มีนัดหมายที่บันทึกไว้',
      command: 'บันทึกนัดหมาย',
      actionLabel: 'บันทึกนัด'
    });

    message.quickReply = {
      items: [
        {
          type: 'action',
          action: { type: 'message', label: 'บันทึกนัดหมาย', text: 'บันทึกนัดหมาย' }
        },
        {
          type: 'action',
          action: { type: 'message', label: 'แผงหลัก', text: 'เมนูหลัก' }
        }
      ]
    };

    return message;
  }

  const lines = [
    "เมนูแก้ไขนัดหมายค่ะ",
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "วิธีแก้:",
    "แก้นัดหมาย <ID> | ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "หรือแก้เฉพาะเวลา: แก้เวลา <ID> <เวลาจริง>",
    "ตัวอย่างรูปแบบ: แก้เวลา <ID> 15.00 น.",
    "หรือพิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "",
    "วิธีลบ:",
    "ลบนัดหมาย <ID>",
    "หรือพิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ];

  const quickReplyItems = items.slice(0, 6).flatMap((appointment, index) => ([
    {
      type: 'action',
      action: {
        type: 'postback',
        label: `แก้ ${index + 1}`,
        data: `action=edit&id=${appointment._id}`,
        displayText: `แก้นัดหมาย ${index + 1}`
      }
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: `ลบ ${index + 1}`,
        data: `action=delete&id=${appointment._id}`,
        displayText: `ลบนัดหมาย ${index + 1}`
      }
    }
  ]));

  return {
    type: 'text',
    text: lines.join("\n"),
    quickReply: {
      items: quickReplyItems
    }
  };
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildAppointmentCarouselMessage(items, offset = 0) {
  return {
    type: 'flex',
    altText: 'รายการนัดหมายพร้อมปุ่มแก้ไขและลบ',
    contents: {
      type: 'carousel',
      contents: items.map((appointment, index) => {
        const number = offset + index + 1;
        return {
          type: 'bubble',
          size: 'mega',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              { type: 'text', text: `รายการ ${number}`, size: 'xs', color: '#667085' },
              { type: 'text', text: appointment.title || '-', weight: 'bold', wrap: true },
              { type: 'text', text: `เวลา: ${formatBangkokDate(appointment.startAt)}`, size: 'sm', color: '#344054', wrap: true },
              { type: 'text', text: `สถานที่: ${appointment.locationName || '-'}`, size: 'sm', color: '#475467', wrap: true }
            ]
          },
          footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#12805c',
                action: {
                  type: 'postback',
                  label: 'แก้ไข',
                  data: `action=edit&id=${appointment._id}`,
                  displayText: `แก้นัดหมาย ${number}`
                }
              },
              {
                type: 'button',
                style: 'secondary',
                color: '#b42318',
                action: {
                  type: 'postback',
                  label: 'ลบ',
                  data: `action=delete&id=${appointment._id}`,
                  displayText: `ลบนัดหมาย ${number}`
                }
              }
            ]
          }
        };
      })
    }
  };
}

function buildAppointmentMenuMessages(items) {
  if (items.length === 0) {
    return [buildAppointmentMenuMessage(items)];
  }

  const groups = chunkItems(items.slice(0, 40), 10);
  return [
    buildAppointmentMenuMessage(items),
    ...groups.slice(0, 4).map((group, groupIndex) => buildAppointmentCarouselMessage(group, groupIndex * 10))
  ];
}

function buildDuplicateMessage(groups) {
  if (groups.length === 0) {
    return "ยังไม่พบนัดหมายที่มีแนวโน้มซ้ำค่ะ";
  }

  const lines = ["พบนัดหมายที่อาจซ้ำกันค่ะ", ""];

  groups.slice(0, 5).forEach((group, groupIndex) => {
    lines.push(`ชุดที่ ${groupIndex + 1}`);
    group.forEach(appointment => {
      lines.push(`- ${appointment.title || '-'} | ${formatBangkokDate(appointment.startAt)} | ID: ${appointment._id}`);
    });
    lines.push("");
  });

  lines.push("ถ้าต้องการลบรายการซ้ำ ให้พิมพ์:");
  lines.push("ลบนัดหมาย <ID>");
  return lines.join("\n");
}

async function buildRequestedReport(userId) {
  const items = await appointments.getToday(new Date(), { lineUserId: userId });
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return "เรียน นายท่าน วันนี้ยังไม่มีนัดหมายที่บันทึกไว้ค่ะ";
  }

  return [
    "เรียน นายท่าน ตารางนัดหมายวันนี้มีดังนี้ค่ะ",
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "หากต้องการแก้ไข พิมพ์:",
    "แก้นัดหมาย <ID> | ชื่อ | วันเวลาจริง | สถานที่ | ชุด",
    "หรือแก้เฉพาะเวลา: แก้เวลา <ID> <เวลาจริง>",
    "ตัวอย่างรูปแบบ: แก้เวลา <ID> 15.00 น.",
    "หรือพิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "",
    "หากต้องการลบ พิมพ์:",
    "ลบนัดหมาย <ID>",
    "หรือพิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ].join("\n");
}

function formatWeatherValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'ยังไม่มีข้อมูล';
  }

  return `${value}${suffix}`;
}

async function buildWeatherAssessmentReport(location) {
  try {
    const report = await weather.getReport(location);

    return [
      'รายงานสภาพอากาศและคุณภาพชีวิต',
      `พื้นที่: ${report.locationName || 'Bangkok'} | เวลาไทย ${formatBangkokDate(report.observedAt)}`,
      '',
      `อุณหภูมิ: ${formatWeatherValue(report.temp, '°C')} | สูงสุด 24 ชม.: ${formatWeatherValue(report.tempMax, '°C')} (${report.tempAssessment.level})`,
      `ดัชนีความร้อน: ${formatWeatherValue(report.heatIndex, '°C')}${report.heatIndexAssessment ? ` (${report.heatIndexAssessment.level})` : ''}`,
      `ฝนล่าสุด 1 ชม.: ${formatWeatherValue(report.rainMm1h, ' มม.')} (${report.rainAmountAssessment.level})`,
      `โอกาสฝน 12 ชม.: ${formatWeatherValue(report.rainChance, '%')} (${report.rainChanceAssessment.level})`,
      `คาดฝนถัดไป: ${report.nextRainAt ? `${formatHours(report.nextRainInHours)} | โอกาส ${formatWeatherValue(report.nextRainChance, '%')} | ${formatWeatherValue(report.nextRainMm3h, ' มม. ในรอบ 3 ชม.')} (${report.nextRainAssessment.level})` : 'ยังไม่พบสัญญาณฝนในรอบคาดการณ์'}`,
      `ลม/พายุ: ${formatWeatherValue(report.windSpeedKph, ' กม./ชม.')} (${report.stormAssessment.level})`,
      `PM2.5: ${formatWeatherValue(report.pm25, ' µg/m³')} (${report.pm25Assessment.level})`,
      `หน้ากาก: ${report.pm25Assessment.maskAdvice}`,
      '',
      report.healthAdvice || 'ยังไม่มีคำแนะนำเพิ่มจากข้อมูลที่ได้รับ',
      '',
      `ที่มา: ${report.source || 'แหล่งข้อมูลอากาศ'}`
    ].join("\n");
  } catch (err) {
    return [
      'รายงานสภาพอากาศ',
      '',
      'ตอนนี้ระบบดึงข้อมูลอากาศจริงไม่ได้ค่ะ',
      `สาเหตุ: ${err.message}`,
      'ระบบจะไม่เดาค่าแทนข้อมูลจริง'
    ].join("\n");
  }
}

async function buildWeatherAssessmentMessage(location) {
  try {
    const report = await weather.getReport(location);

    return buildCommandOutputMessage({
      title: 'สภาพอากาศ',
      available: true,
      detail: [
        `พื้นที่: ${report.locationName || 'Bangkok'}`,
        `เวลาไทย: ${formatBangkokDate(report.observedAt)}`,
        `อุณหภูมิ: ${formatWeatherValue(report.temp, '°C')} | สูงสุด 24 ชม.: ${formatWeatherValue(report.tempMax, '°C')} (${report.tempAssessment.level})`,
        `ฝนล่าสุด 1 ชม.: ${formatWeatherValue(report.rainMm1h, ' มม.')} (${report.rainAmountAssessment.level})`,
        `โอกาสฝน 12 ชม.: ${formatWeatherValue(report.rainChance, '%')} (${report.rainChanceAssessment.level})`,
        `ลม/พายุ: ${formatWeatherValue(report.windSpeedKph, ' กม./ชม.')} (${report.stormAssessment.level})`,
        `PM2.5: ${formatWeatherValue(report.pm25, ' µg/m³')} (${report.pm25Assessment.level})`,
        `หน้ากาก: ${report.pm25Assessment.maskAdvice}`,
        `ที่มา: ${report.source || 'แหล่งข้อมูลอากาศ'}`
      ].join("\n"),
      command: '/สภาพอากาศ',
      actionLabel: 'รีเฟรช'
    });
  } catch (err) {
    return buildCommandOutputMessage({
      title: 'สภาพอากาศ',
      available: false,
      detail: `ไม่มีข้อมูลอากาศจริงตอนนี้\nสาเหตุ: ${err.message}\nระบบจะไม่เดาค่าแทนข้อมูลจริง`,
      command: '/สภาพอากาศ',
      actionLabel: 'ลองใหม่'
    });
  }
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getBangkokWeekdayIndex(baseDate = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: THAILAND_TIME_ZONE,
    weekday: 'short'
  }).format(baseDate);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
}

function getBangkokWeekRange(baseDate = new Date()) {
  const dateKey = getBangkokDateKey(baseDate);
  const currentMidnight = new Date(`${dateKey}T00:00:00.000+07:00`);
  const weekday = getBangkokWeekdayIndex(baseDate);
  const diffToMonday = ((weekday === -1 ? 1 : weekday) + 6) % 7;
  const start = addDays(currentMidnight, -diffToMonday);
  const end = addDays(start, 7);
  end.setMilliseconds(end.getMilliseconds() - 1);

  return { start, end };
}

function getBangkokMonthRange(baseDate = new Date()) {
  const [yearText, monthText] = getBangkokDateKey(baseDate).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const start = new Date(`${yearText}-${monthText}-01T00:00:00.000+07:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = new Date(`${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-01T00:00:00.000+07:00`);
  end.setMilliseconds(end.getMilliseconds() - 1);

  return { start, end };
}

async function buildAppointmentRangeReport(userId, mode) {
  let label = 'วันนี้';
  let range = getBangkokDayRange(new Date());

  if (mode === 'tomorrow') {
    label = 'พรุ่งนี้';
    range = getBangkokDayRange(addDays(new Date(), 1));
  } else if (mode === 'week') {
    label = 'สัปดาห์นี้';
    range = getBangkokWeekRange(new Date());
  } else if (mode === 'month') {
    label = 'เดือนนี้';
    range = getBangkokMonthRange(new Date());
  }

  const items = await appointments.listAppointments({
    activeOnly: true,
    startAtFrom: range.start,
    startAtTo: range.end,
    lineUserId: userId,
    limit: ['week', 'month'].includes(mode) ? 200 : 50
  });
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return `ยังไม่มีนัดหมาย${label}ค่ะ`;
  }

  return [
    `นัดหมาย${label}ค่ะ`,
    "",
    ...items.map((appointment, index) => (
      `${index + 1}. ${appointment.title || '-'}\nเวลา: ${formatBangkokDate(appointment.startAt)}\nสถานที่: ${appointment.locationName || '-'}\nID: ${appointment._id}`
    )),
    "",
    "แก้ไข: พิมพ์ แก้นัดหมาย <เลขลำดับ> เช่น แก้นัดหมาย 1",
    "ลบ: พิมพ์ ลบนัดหมาย <เลขลำดับ> เช่น ลบนัดหมาย 1"
  ].join("\n");
}

async function buildAppointmentRangeMessages(userId, mode) {
  let label = 'วันนี้';
  let range = getBangkokDayRange(new Date());

  if (mode === 'tomorrow') {
    label = 'พรุ่งนี้';
    range = getBangkokDayRange(addDays(new Date(), 1));
  } else if (mode === 'week') {
    label = 'สัปดาห์นี้';
    range = getBangkokWeekRange(new Date());
  } else if (mode === 'month') {
    label = 'เดือนนี้';
    range = getBangkokMonthRange(new Date());
  }

  const items = await appointments.listAppointments({
    activeOnly: true,
    startAtFrom: range.start,
    startAtTo: range.end,
    lineUserId: userId,
    limit: ['week', 'month'].includes(mode) ? 200 : 50
  });
  rememberAppointmentSelection(userId, items);

  if (items.length === 0) {
    return [buildCommandOutputMessage({
      title: `นัดหมาย${label}`,
      available: false,
      detail: `ไม่มีนัดหมาย${label}`,
      command: mode === 'tomorrow' ? '/พรุ่งนี้' : mode === 'week' ? '/สัปดาห์นี้' : mode === 'month' ? '/เดือนนี้' : 'นัดหมายวันนี้',
      actionLabel: 'บันทึกนัด'
    })];
  }

  const summaryCard = buildCommandOutputMessage({
    title: `นัดหมาย${label}`,
    available: true,
    detail: [
      `มี ${items.length} รายการ`,
      'กดปุ่มแก้ไข/ลบในการ์ดแต่ละรายการ หรือพิมพ์ แก้นัดหมาย <เลขลำดับ>'
    ].join("\n"),
    command: '/นัดหมาย',
    actionLabel: 'ดูทั้งหมด'
  });
  const groups = chunkItems(items.slice(0, 30), 10);

  return [
    summaryCard,
    ...groups.slice(0, 4).map((group, groupIndex) => buildAppointmentCarouselMessage(group, groupIndex * 10))
  ].slice(0, 5);
}

async function buildUrgentAlertReport() {
  const urgentAlerts = await alerts.listActiveUrgentAlerts();

  if (urgentAlerts.length === 0) {
    return "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานภาวะฉุกเฉินหรือเร่งด่วนที่ยัง active ค่ะ";
  }

  return urgentAlerts.map(alert => alerts.formatAlert(alert)).join("\n\n---\n\n");
}

async function buildDisasterReport(types, emptyMessage) {
  const disasterAlerts = await alerts.listActiveAlertsByTypes(types);

  if (disasterAlerts.length === 0) {
    return emptyMessage;
  }

  return disasterAlerts.map(alert => alerts.formatAlert(alert)).join("\n\n---\n\n");
}

async function buildAsiaDisasterMessages() {
  try {
    const report = await liveDisasters.buildAsiaDisasterReport();
    const hasItems = !/ยังไม่พบรายการ|ยังไม่มีรายงาน|อ่านไม่ได้/.test(report);

    return [buildCommandOutputMessage({
      title: 'ภัยพิบัติเอเชีย',
      available: hasItems,
      detail: report,
      command: '/ภัยพิบัติ',
      actionLabel: 'รีเฟรช'
    })];
  } catch (err) {
    return [buildCommandOutputMessage({
      title: 'ภัยพิบัติเอเชีย',
      available: false,
      detail: `ไม่มีข้อมูลภัยพิบัติที่อ่านได้ตอนนี้\nสาเหตุ: ${err.message}`,
      command: '/ภัยพิบัติ',
      actionLabel: 'ลองใหม่'
    })];
  }
}

async function handleAdminUnlockCommand(text, userId) {
  const match = String(text || '').trim().match(/^\/?admin\s+ปลด(?:ล็อค|ลอค|ล็อก)\s+(\S+)\s+(free|plus|vip|ตลอดชีพ)(?:\s+(\d{1,4}))?$/i);

  if (!match) {
    return null;
  }

  if (!config.lineUserId || userId !== config.lineUserId) {
    return 'คำสั่งนี้ใช้ได้เฉพาะแอดมินที่ตรงกับ LINE_USER_ID ค่ะ';
  }

  const target = match[1];
  const rawPlan = match[2].toLowerCase();
  const plan = rawPlan === 'ตลอดชีพ' ? 'vip' : rawPlan;
  const days = match[3] ? Number(match[3]) : (plan === 'vip' ? null : 30);
  const user = await User.findOne({
    $or: [
      { email: target },
      { username: target },
      { lineUserId: target }
    ]
  });

  if (!user) {
    return `ยังไม่พบสมาชิก ${target} ค่ะ`;
  }

  user.plan = plan;
  user.paymentStatus = 'admin_unlocked';
  user.unlockedBy = userId;
  user.unlockedAt = new Date();
  user.unlockedUntil = plan === 'vip' ? null : addDays(new Date(), days);
  await user.save();

  return [
    'ปลดล็อกสมาชิกเรียบร้อยค่ะ',
    `ผู้ใช้: ${user.username || user.email}`,
    `แพ็กเกจ: ${user.plan}`,
    `ใช้ได้ถึง: ${user.unlockedUntil ? formatBangkokDate(user.unlockedUntil) : 'ตลอดชีพ'}`
  ].join("\n");
}

async function sendAppointmentMenu(replyToken, userId) {
  const items = await appointments.listAppointments({ activeOnly: true, lineUserId: userId, limit: 50 });
  rememberAppointmentSelection(userId, items);
  return line.replyMessage(replyToken, buildAppointmentMenuMessages(items));
}

function formatTodoPriority(priority) {
  return {
    urgent: 'เร่งด่วน',
    high: 'สำคัญ',
    normal: 'ปกติ'
  }[priority] || priority || 'ปกติ';
}

function formatTodoDueAt(todo) {
  return todo.dueAt ? formatBangkokDate(todo.dueAt) : 'ไม่กำหนดเวลา';
}

function buildTodoListText(items, emptyText) {
  if (!items || items.length === 0) {
    return emptyText;
  }

  const lines = items.slice(0, 10).map((todo, index) => [
    `${index + 1}. ${todo.title || '-'}`,
    `กำหนด: ${formatTodoDueAt(todo)}`,
    todo.responsible ? `ผู้รับผิดชอบ: ${todo.responsible}` : null,
    `ความสำคัญ: ${formatTodoPriority(todo.priority)}`,
    `สถานะ: ${todo.status || 'open'}`,
    todo.notes ? `หมายเหตุ: ${todo.notes}` : null,
    `ID: ${todo._id}`
  ].filter(Boolean).join("\n"));

  if (items.length > 10) {
    lines.push(`ยังมีอีก ${items.length - 10} งาน เปิด /ปฏิทิน เพื่อดูทั้งหมด`);
  }

  return lines.join("\n\n");
}

function buildEarthquakeWarningListText(items) {
  if (!items || items.length === 0) {
    return 'ยังไม่มีประวัติประเมินแผ่นดินไหวล่าสุดค่ะ';
  }

  return items.slice(0, 5).map((item, index) => [
    `${index + 1}. ${item.title || 'แผ่นดินไหว'}`,
    `พื้นที่: ${item.areaText || '-'}`,
    `ระดับระบบ: ${item.riskLevel || item.severity || '-'}`,
    `ไกลจาก กทม.: ${item.distanceFromBangkokKm === undefined || item.distanceFromBangkokKm === null ? '-' : `${Math.round(item.distanceFromBangkokKm)} กม.`}`,
    `เวลา: ${item.startsAt ? formatBangkokDate(item.startsAt) : '-'}`,
    `ที่มา: ${item.source || '-'}`
  ].join("\n")).join("\n\n");
}

function buildWeatherLocationFromLineMessage(message = {}) {
  const title = String(message.title || '').trim();
  const address = String(message.address || '').trim();
  const name = [title, address].filter(Boolean).join(' - ') || 'ตำแหน่งที่ส่งมา';

  return {
    name,
    latitude: message.latitude,
    longitude: message.longitude
  };
}

async function handleLocationMessage(event) {
  const location = buildWeatherLocationFromLineMessage(event.message || {});
  const normalizedLocation = weather.normalizeLocation(location);

  if (normalizedLocation.isDefault) {
    await line.reply(event.replyToken, [
      'ระบบอ่านพิกัดจากโลเคชันนี้ไม่ได้ค่ะ',
      'กรุณาส่งโลเคชันจากปุ่มแชร์ตำแหน่งใน LINE อีกครั้ง ระบบจะรายงานอากาศจากพิกัดจริงเท่านั้น'
    ].join("\n"));
    return true;
  }

  await line.replyMessage(event.replyToken, await buildWeatherAssessmentMessage(normalizedLocation));
  return true;
}

async function handleTextMessage(event) {
  const text = event.message.text.trim();
  const userId = event.source && event.source.userId;
  const command = normalizeCommand(text);

  if (text === '/' || command === '') {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.replyMessage(event.replyToken, buildMainMenuMessage());
    return true;
  }

  const adminUnlockResult = await handleAdminUnlockCommand(text, userId);
  if (adminUnlockResult) {
    await line.reply(event.replyToken, adminUnlockResult);
    return true;
  }

  if (['คู่มือ', 'วิธีใช้', 'help', 'Help'].includes(text) || ['คู่มือ', 'วิธีใช้', 'help'].includes(command)) {
    await line.reply(event.replyToken, manual.getManualText());
    return true;
  }

  if (['เมนูหลัก', 'แผงหลัก', 'เมนู', 'main menu'].includes(text) || ['เมนูหลัก', 'แผงหลัก', 'เมนู'].includes(command)) {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.replyMessage(event.replyToken, buildMainMenuMessage());
    return true;
  }

  if (['ตรวจเช็ค', 'ตรวจเช็คระบบ', 'ตรวจระบบ', 'สถานะคำสั่ง'].includes(command)) {
    await line.replyMessage(event.replyToken, buildLineCommandChecklist());
    return true;
  }

  if (['แบบฟอร์ม', 'ฟอร์ม', 'forms', 'แยกแบบฟอร์ม'].includes(command)) {
    await line.replyMessage(event.replyToken, buildFormSelectorMessage());
    return true;
  }

  if (['สภาพอากาศ', 'อากาศ', 'weather'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildWeatherAssessmentMessage());
    return true;
  }

  if (['นัดหมาย', 'แก้ไขนัดหมาย', 'แก้นัดหมาย'].includes(command)) {
    await sendAppointmentMenu(event.replyToken, userId);
    return true;
  }

  if (['ภัยพิบัติ', 'เตือนภัย'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAsiaDisasterMessages());
    return true;
  }

  if (['แผ่นดินไหวล่าสุด', 'รายงานแผ่นดินไหว', 'เตือนแผ่นดินไหว'].includes(command)) {
    const syncResult = await earthquakeWarnings.syncEarthquakeWarnings();
    const items = await earthquakeWarnings.listRecentWarnings(5);
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'ประเมินแผ่นดินไหว',
      available: true,
      detail: [
        buildEarthquakeWarningListText(items),
        '',
        `ประเมินล่าสุด: ${syncResult.evaluated} รายการ`,
        'หมายเหตุ: ระบบนี้เป็นการเตือนเสริม ไม่ใช่ประกาศทางการ'
      ].join("\n"),
      command: 'แผ่นดินไหวล่าสุด',
      actionLabel: 'ตรวจอีกครั้ง'
    }));
    return true;
  }

  if (['พรุ่งนี้', 'นัดหมายพรุ่งนี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'tomorrow'));
    return true;
  }

  if (['สัปดาห์นี้', 'อาทิตย์นี้', 'นัดหมายสัปดาห์นี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'week'));
    return true;
  }

  if (['เดือนนี้', 'นัดหมายเดือนนี้'].includes(command)) {
    await line.replyMessage(event.replyToken, await buildAppointmentRangeMessages(userId, 'month'));
    return true;
  }

  if (['คำถาม', 'คำถามอื่น', 'ตอบคำถาม', 'ถาม AI', 'ถามเอไอ', 'ถามอื่น', 'คุยกับ AI', 'คุยกับเอไอ'].includes(command)) {
    await line.reply(event.replyToken, buildChatPromptMessage(userId));
    return true;
  }

  if (['แปลภาษา', 'แปล'].includes(command)) {
    await line.reply(event.replyToken, buildTranslatePromptMessage());
    return true;
  }

  if (['ดูนัดหมาย', 'ดูตารางนัดหมาย'].includes(command)) {
    await line.replyMessage(event.replyToken, buildAppointmentViewMenuMessage());
    return true;
  }

  if (['งานวันนี้', 'todoวันนี้', 'to-doวันนี้'].includes(command)) {
    const items = await todos.getToday(new Date(), { lineUserId: userId });
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do วันนี้',
      available: true,
      detail: buildTodoListText(items, 'วันนี้ยังไม่มี To-do ที่ครบกำหนดค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getCalendarUrl(userId)
    }));
    return true;
  }

  if (['งานค้าง', 'todoค้าง', 'to-doค้าง'].includes(command)) {
    const items = await todos.getOverdue(new Date(), { lineUserId: userId });
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do ค้าง',
      available: true,
      detail: buildTodoListText(items, 'ยังไม่มี To-do ค้างค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getCalendarUrl(userId)
    }));
    return true;
  }

  if (['งานสัปดาห์นี้', 'todoสัปดาห์นี้', 'to-doสัปดาห์นี้'].includes(command)) {
    const items = await todos.getThisWeek(new Date(), { lineUserId: userId });
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do สัปดาห์นี้',
      available: true,
      detail: buildTodoListText(items, 'สัปดาห์นี้ยังไม่มี To-do ค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getCalendarUrl(userId)
    }));
    return true;
  }

  if (['งานทั้งหมด', 'รายการงาน', 'to-do', 'todos'].includes(command)) {
    const items = await todos.listTodos({ openOnly: true, lineUserId: userId, limit: 50 });
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'To-do ทั้งหมด',
      available: true,
      detail: buildTodoListText(items, 'ยังไม่มี To-do ที่เปิดอยู่ค่ะ'),
      command: '/ปฏิทิน',
      actionLabel: 'เปิดปฏิทิน',
      uri: getCalendarUrl(userId)
    }));
    return true;
  }

  if (['ปฏิทิน', 'calendar', 'liff', 'todo', 'to do'].includes(command)) {
    await line.replyMessage(
      event.replyToken,
      buildLinkMessage(
        'SmartLife Calendar',
        'เปิดหน้า To Do List Calendar สำหรับดู เพิ่ม และลบนัดหมายใน LINE',
        'เปิดปฏิทิน',
        getCalendarUrl(userId)
      )
    );
    return true;
  }

  if (['สร้างภาพ', 'วาดภาพ', 'ทำภาพ'].includes(command)) {
    await line.reply(event.replyToken, 'ระบบสร้างภาพถูกลบออกแล้วค่ะ');
    return true;
  }

  if (['ปลดลอค', 'ปลดล็อค', 'ปลดล็อก', 'แพ็กเกจ', 'แพคเกจ'].includes(command)) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'ปลดล็อก/แพ็กเกจ',
      available: true,
      detail: freeServices.buildUnlockPlanText(),
      command: '/ปลดลอค',
      actionLabel: 'ดูอีกครั้ง'
    }));
    return true;
  }

  if (['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(command)) {
    await line.replyMessage(event.replyToken, buildRegisterFormLinkMessage());
    return true;
  }

  if (['บันทึกนัดหมาย', 'เพิ่มนัดหมาย', 'สร้างนัดหมาย', 'นัดหมายใหม่', 'แบบฟอร์มนัดหมาย', 'ฟอร์มนัดหมาย', 'ฟอร์มนัด', 'ฟอร์มบันทึกนัดหมาย'].includes(command)) {
    await line.replyMessage(event.replyToken, buildAppointmentFormLinkMessage());
    return true;
  }

  if (['บริการฉุกเฉิน', 'บริการฟรี', 'เบอร์ฉุกเฉิน', 'ฉุกเฉิน', 'มูลนิธิ', 'กู้ภัย', 'สุขภาพ', 'สิทธิสุขภาพ', 'สุขภาพใจ', 'เดินทาง', 'จราจร', 'ร้องเรียน', 'ปลอดภัยออนไลน์'].includes(command)) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'บริการฉุกเฉิน',
      available: true,
      detail: freeServices.buildEmergencyServicesText(command),
      command: '/บริการฉุกเฉิน',
      actionLabel: 'ดูอีกครั้ง'
    }));
    return true;
  }

  const knowledgeCommandMatch = text.match(/^\/?(?:ความรู้|วิกิ|สารานุกรม)\s+([\s\S]+)$/i);
  if (knowledgeCommandMatch) {
    try {
      const answer = await knowledge.answerKnowledgeQuestion(knowledgeCommandMatch[1]);
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'ความรู้',
        available: true,
        detail: answer,
        command: `/ความรู้ ${knowledgeCommandMatch[1]}`,
        actionLabel: 'ค้นอีก'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'ความรู้',
        available: false,
        detail: `ยังค้นความรู้จากวิกิพีเดียไทยไม่ได้ค่ะ: ${err.message}`,
        command: '/ความรู้',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const scamCommandMatch = text.match(/^\/?(?:เช็คโกง|เช็กโกง|ตรวจโกง|กันโกง)\s*([\s\S]*)$/i);
  if (scamCommandMatch) {
    await line.replyMessage(event.replyToken, buildCommandOutputMessage({
      title: 'เช็คโกง',
      available: true,
      detail: scamCheck.checkScam(scamCommandMatch[1]),
      command: '/เช็คโกง',
      actionLabel: 'ตรวจอีก'
    }));
    return true;
  }

  const completeTodoMatch = text.match(/^(?:งานเสร็จ|ปิดงาน|todo done|done)\s+([a-f\d]{24})$/i);
  if (completeTodoMatch) {
    try {
      const completed = await todos.completeTodo(completeTodoMatch[1], { lineUserId: userId });
      await line.reply(event.replyToken, `บันทึกว่างานเสร็จแล้วค่ะ\n\nงาน: ${completed.title || '-'}\nID: ${completed._id}`);
    } catch (err) {
      await line.reply(event.replyToken, `ยังปิดงานไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const createTodoPayload = todos.parseCreateText(text);
  if (createTodoPayload) {
    try {
      const created = await todos.createTodo({
        ...createTodoPayload,
        lineUserId: userId
      });
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'เพิ่ม To-do',
        available: true,
        detail: [
          `${created.title || '-'}`,
          `กำหนด: ${formatTodoDueAt(created)}`,
          `ความสำคัญ: ${formatTodoPriority(created.priority)}`,
          created.notes ? `หมายเหตุ: ${created.notes}` : null,
          `ID: ${created._id}`
        ].filter(Boolean).join("\n"),
        command: 'งานวันนี้',
        actionLabel: 'ดูงานวันนี้'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'เพิ่ม To-do',
        available: false,
        detail: `ยังเพิ่ม To-do ไม่ได้ค่ะ: ${err.message}`,
        command: 'เพิ่มงาน',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const createAppointmentPayload = appointments.parseCreateText(text);
  if (createAppointmentPayload) {
    try {
      const createdItems = await appointments.createRecurringAppointments({
        ...createAppointmentPayload,
        lineUserId: userId
      });
      const created = createdItems[0];
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'บันทึกนัดหมาย',
        available: true,
        detail: [
          createdItems.length > 1 ? `สร้างนัดหมายซ้ำ ${createdItems.length} ครั้งแล้วค่ะ` : `${created.title || '-'}`,
          `เวลา: ${formatBangkokDate(created.startAt)}`,
          `สถานที่: ${created.locationName || '-'}`,
          `ID: ${created._id}`
        ].join("\n"),
        command: '/นัดหมาย',
        actionLabel: 'ดูนัดหมาย'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'บันทึกนัดหมาย',
        available: false,
        detail: `ยังบันทึกนัดหมายไม่ได้ค่ะ: ${err.message}`,
        command: 'บันทึกนัดหมาย',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const copyAppointmentPayload = appointments.parseCopyText(text);
  if (copyAppointmentPayload) {
    try {
      const copied = await appointments.copyAppointment(
        copyAppointmentPayload.id,
        { ...copyAppointmentPayload.changes, lineUserId: userId },
        { lineUserId: userId }
      );
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'คัดลอกนัดหมาย',
        available: true,
        detail: [
          `${copied.title || '-'}`,
          `เวลา: ${formatBangkokDate(copied.startAt)}`,
          `สถานที่: ${copied.locationName || '-'}`,
          `ID: ${copied._id}`
        ].join("\n"),
        command: '/นัดหมาย',
        actionLabel: 'ดูนัดหมาย'
      }));
    } catch (err) {
      await line.reply(event.replyToken, `ยังคัดลอกนัดหมายไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const pendingMode = getPendingMode(userId);

  if (['แบบฟอร์ม', 'ฟอร์ม', 'แยกแบบฟอร์ม'].includes(text)) {
    await line.replyMessage(event.replyToken, buildFormSelectorMessage());
    return true;
  }

  if (['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(text) || ['สมัครสมาชิก', 'สมัคร', 'แบบฟอร์มสมัคร', 'ฟอร์มสมัคร', 'ใบสมัคร'].includes(command)) {
    await line.replyMessage(event.replyToken, buildRegisterFormLinkMessage());
    return true;
  }

  if (['บันทึกนัดหมาย', 'เพิ่มนัดหมาย', 'สร้างนัดหมาย', 'นัดหมายใหม่', 'แบบฟอร์มนัดหมาย', 'ฟอร์มนัดหมาย', 'ฟอร์มนัด', 'ฟอร์มบันทึกนัดหมาย'].includes(text)) {
    await line.replyMessage(event.replyToken, buildAppointmentFormLinkMessage());
    return true;
  }

  if (['เมนูแก้ไข', 'แก้ไข', 'แก้ไขนัดหมาย', 'แก้นัดหมาย', 'แก้ไขนัดหมายทั้งหมด'].includes(text)) {
    await sendAppointmentMenu(event.replyToken, userId);
    return true;
  }

  if (['แผงนัดหมาย', 'ตารางนัดทั้งหมด', 'นัดหมายทั้งหมด'].includes(text)) {
    await line.replyMessage(
      event.replyToken,
      buildLinkMessage(
        'แผงตารางนัดหมายทั้งหมดค่ะ',
        'กดปุ่มด้านล่างเพื่อเปิดตารางนัดหมายทั้งหมด พร้อมแก้ไข บันทึก และลบ',
        'เปิดตาราง',
        getPublicUrl('/appointments-panel')
      )
    );
    return true;
  }

  if (['แปลภาษา', 'แปล'].includes(text)) {
    await line.reply(event.replyToken, buildTranslatePromptMessage());
    return true;
  }

  if (['คำถามอื่น', 'ตอบคำถาม', 'ถาม AI', 'ถามเอไอ', 'ถามอื่น', 'คุยกับ AI', 'คุยกับเอไอ'].includes(text)) {
    await line.reply(event.replyToken, buildChatPromptMessage(userId));
    return true;
  }

  if (['ดูนัดหมาย', 'ดูตารางนัดหมาย'].includes(text)) {
    await line.replyMessage(event.replyToken, buildAppointmentViewMenuMessage());
    return true;
  }

  if (['นัดหมายวันนี้', 'วันนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'today'));
    return true;
  }

  if (['นัดหมายพรุ่งนี้', 'พรุ่งนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'tomorrow'));
    return true;
  }

  if (['นัดหมายสัปดาห์นี้', 'สัปดาห์นี้', 'อาทิตย์นี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'week'));
    return true;
  }

  if (['นัดหมายเดือนนี้', 'เดือนนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildAppointmentRangeReport(userId, 'month'));
    return true;
  }

  if (['สร้างภาพ', 'วาดภาพ', 'ทำภาพ'].includes(text)) {
    await line.reply(event.replyToken, 'ระบบสร้างภาพถูกลบออกแล้วค่ะ');
    return true;
  }

  if (['สถานะ AI', 'สถานะเอไอ', 'สมอง', 'ai status'].includes(text)) {
    const status = ai.getStatus();
    await line.reply(
      event.replyToken,
      [
        "สถานะสมอง AI ค่ะ",
        `Provider: ${status.provider}`,
        `ลำดับสำรอง: ${status.providerOrder && status.providerOrder.length ? status.providerOrder.join(' > ') : '-'}`,
        `ตัวที่ตั้งค่าแล้ว: ${status.configuredProviders && status.configuredProviders.length ? status.configuredProviders.join(', ') : 'ยังไม่มี'}`,
        `แชต/บทความ/สุนทรพจน์/แปล: ${status.textAiConfigured ? 'พร้อมใช้' : 'ยังไม่ตั้งค่า'}`
      ].join("\n")
    );
    return true;
  }

  if (['รายงาน', 'รายงานวันนี้', 'ดูรายงาน', 'ตารางวันนี้'].includes(text)) {
    await line.reply(event.replyToken, await buildRequestedReport(userId));
    return true;
  }

  if (weatherQuestions.isWeatherQuestion(text) || (text.startsWith('/') && weatherQuestions.isWeatherQuestion(command))) {
    const answer = await weatherQuestions.answerWeatherQuestion(text.startsWith('/') ? command : text);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'คำถามอากาศ',
        available: true,
        detail: answer,
        command: '/สภาพอากาศ',
        actionLabel: 'ดูอากาศ'
      }));
    } else {
      await line.reply(event.replyToken, answer);
    }
    return true;
  }

  if (['ภาวะฉุกเฉิน', 'เร่งด่วน', 'รายงานฉุกเฉิน'].includes(text)) {
    await line.reply(event.replyToken, await buildUrgentAlertReport());
    return true;
  }

  if (['ภัยพิบัติ', 'เตือนภัย'].includes(text)) {
    await line.reply(event.replyToken, await buildUrgentAlertReport());
    return true;
  }

  if (['พายุ', 'เตือนพายุ'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['storm', 'thunderstorm', 'typhoon', 'cyclone', 'พายุ'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานพายุที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['แผ่นดินไหว', 'เตือนแผ่นดินไหว'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['earthquake', 'แผ่นดินไหว'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานแผ่นดินไหวที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['น้ำท่วม', 'เตือนน้ำท่วม'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['flood', 'flooding', 'flash_flood', 'น้ำท่วม'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานน้ำท่วมที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (['จราจล', 'เหตุความไม่สงบ', 'ความปลอดภัยสาธารณะ'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['public_safety', 'riot', 'civil_unrest', 'จราจล', 'เหตุความไม่สงบ'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีประกาศเหตุความไม่สงบที่ยัง active จากแหล่งทางการค่ะ"
      )
    );
    return true;
  }

  if (['อุบัติภัยร้ายแรง', 'อุบัติเหตุร้ายแรง', 'เหตุร้ายแรง'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['severe_accident', 'major_accident', 'อุบัติภัยร้ายแรง', 'อุบัติเหตุร้ายแรง'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานอุบัติภัยร้ายแรงที่ยัง active จากแหล่งทางการค่ะ"
      )
    );
    return true;
  }

  if (['สึนามิ', 'สึมามิ', 'เตือนสึนามิ', 'คลื่นสึนามิ'].includes(text)) {
    await line.reply(
      event.replyToken,
      await buildDisasterReport(
        ['tsunami', 'tidal_wave', 'สึนามิ', 'สึมามิ', 'คลื่นสึนามิ'],
        "เรียน นายท่าน ขณะนี้ยังไม่มีรายงานสึนามิที่ยัง active ค่ะ"
      )
    );
    return true;
  }

  if (text === 'นัดหมายซ้ำ') {
    const duplicateGroups = await appointments.findPotentialDuplicates({ lineUserId: userId });
    await line.reply(event.replyToken, buildDuplicateMessage(duplicateGroups));
    return true;
  }

  const articleMatch = text.match(/^\/?(?:บทความ|เขียนบทความ)\s+([\s\S]+)$/i);
  if (articleMatch) {
    try {
      const article = await writing.createArticle(articleMatch[1]);
      await line.replyMessage(event.replyToken, line.createTextMessages(article));
    } catch (err) {
      await line.reply(event.replyToken, `ยังเขียนบทความไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  if (/^\/?(?:บทความ|เขียนบทความ)$/i.test(text)) {
    await line.reply(event.replyToken, 'กรุณาพิมพ์หัวข้อ เช่น /บทความ การเรียนรู้ตลอดชีวิต');
    return true;
  }

  const speechMatch = text.match(/^\/?(?:คำกล่าว|เขียนคำกล่าว|สุนทรพจน์|เขียนสุนทรพจน์)\s+([\s\S]+)$/i);
  if (speechMatch) {
    try {
      const draft = await speech.createSpeechDraft(speechMatch[1]);
      await line.replyMessage(event.replyToken, line.createTextMessages(draft));
    } catch (err) {
      await line.reply(event.replyToken, `ยังเขียนสุนทรพจน์ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  if (/^\/?(?:คำกล่าว|เขียนคำกล่าว|สุนทรพจน์|เขียนสุนทรพจน์)$/i.test(text)) {
    await line.reply(event.replyToken, 'กรุณาพิมพ์งานและโอกาส เช่น /สุนทรพจน์ กล่าวเปิดการอบรมครู');
    return true;
  }

  const translateMatch = text.match(/^\/?แปล(?:ภาษา)?\s+([\s\S]+)$/i);
  if (translateMatch) {
    try {
      const translated = await ai.translate(translateMatch[1], userId);
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'แปลภาษา',
        available: true,
        detail: translated,
        command: '/แปลภาษา',
        actionLabel: 'แปลอีก'
      }));
    } catch (err) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: 'แปลภาษา',
        available: false,
        detail: `ยังแปลไม่ได้ค่ะ: ${err.message}`,
        command: '/แปลภาษา',
        actionLabel: 'ลองใหม่'
      }));
    }
    return true;
  }

  const imageMatch = text.match(/^\/?(?:สร้างภาพ|วาดภาพ|ทำภาพ)\s+([\s\S]+)$/i);
  if (imageMatch) {
    if (userId) {
      pendingModes.delete(userId);
    }
    await line.reply(event.replyToken, 'ระบบสร้างภาพถูกลบออกแล้วค่ะ');
    return true;
  }

  const pendingId = userId && pendingAppointmentEdits.get(userId);
  const editPayload = appointments.parseEditText(text, pendingId);
  if (editPayload) {
    try {
      const updated = await appointments.updateAppointment(editPayload.id, editPayload.changes, { lineUserId: userId });

      if (pendingId) {
        pendingAppointmentEdits.delete(userId);
      }

      await line.reply(
        event.replyToken,
        `เรียน นายท่าน แก้ไขนัดหมายเรียบร้อยแล้วค่ะ\n\n${updated.title || '-'}\nเวลา: ${formatBangkokDate(updated.startAt)}\nสถานที่: ${updated.locationName || '-'}`
      );
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังแก้ไขนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const editTargetId = appointments.parseEditTargetText(text);
  if (editTargetId) {
    if (!userId) {
      await line.reply(event.replyToken, "เรียน นายท่าน ยังไม่พบข้อมูลผู้ใช้ จึงจำรายการที่ต้องแก้ไขไม่ได้ค่ะ");
      return true;
    }

    pendingAppointmentEdits.set(userId, editTargetId);
    const appointment = await appointments.getAppointment(editTargetId, { lineUserId: userId });
    await line.reply(event.replyToken, buildEditPrompt(appointment));
    return true;
  }

  const deleteId = appointments.parseDeleteText(text);
  if (deleteId) {
    try {
      await appointments.deleteAppointment(deleteId, { lineUserId: userId });
      await line.reply(event.replyToken, "เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ");
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  const selectionCommand = appointments.parseSelectionCommand(text);
  if (selectionCommand) {
    const appointmentId = getAppointmentIdFromSelection(userId, selectionCommand.index);

    if (!appointmentId) {
      await line.reply(event.replyToken, "เรียน นายท่าน กรุณาพิมพ์ เมนูแก้ไข หรือ รายงานวันนี้ ก่อนเลือกเลขลำดับค่ะ");
      return true;
    }

    if (selectionCommand.action === 'edit') {
      pendingAppointmentEdits.set(userId, appointmentId);
      const appointment = await appointments.getAppointment(appointmentId, { lineUserId: userId });
      await line.reply(event.replyToken, buildEditPrompt(appointment));
      return true;
    }

    try {
      await appointments.deleteAppointment(appointmentId, { lineUserId: userId });
      await line.reply(event.replyToken, "เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ");
    } catch (err) {
      await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }

  try {
    const aiText = await ai.chat(text, userId);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: command || 'AI',
        available: true,
        detail: aiText,
        command: '/คำถาม',
        actionLabel: 'ถามต่อ'
      }));
    } else {
      await line.reply(event.replyToken, aiText);
    }
    return true;
  } catch (err) {
    console.error("SmartLife AI error:", err);
    if (text.startsWith('/')) {
      await line.replyMessage(event.replyToken, buildCommandOutputMessage({
        title: command || 'AI',
        available: false,
        detail: `ตอนนี้สมอง AI ยังตอบไม่ได้ค่ะ: ${err.message}`,
        command: '/คำถาม',
        actionLabel: 'ลองใหม่'
      }));
    } else {
      await line.reply(event.replyToken, `ตอนนี้สมอง AI ยังตอบไม่ได้ค่ะ: ${err.message}`);
    }
    return true;
  }
}

async function handleImageMessage(event) {
  await line.reply(event.replyToken, 'ได้รับรูปแล้วค่ะ แต่ระบบสร้างภาพถูกลบออกแล้ว');
  return true;
}

async function handleLineEvent(event) {
  const eventUserId = event.source && event.source.userId;
  if (event.type === 'unfollow') {
    if (eventUserId) await lineRecipient.deactivateLineRecipient(eventUserId);
    return true;
  }
  if (eventUserId) await lineRecipient.rememberLineRecipient(eventUserId);

  if (event.type === 'follow') {
    await line.reply(
      event.replyToken,
      'ยินดีต้อนรับสู่ SmartLife ค่ะ ระบบได้รับการอัปเกรดแล้ว ใช้งานนัดหมาย การแจ้งเตือน และหน้า SmartLife ใหม่ได้จากเมนูด้านล่าง หรือพิมพ์ คู่มือ เพื่อดูคำสั่งทั้งหมดค่ะ'
    );
    return true;
  }
  if (event.type === 'message' && event.message && event.message.type === 'text') return handleTextMessage(event);
  if (event.type === 'message' && event.message && event.message.type === 'location') return handleLocationMessage(event);
  if (event.type === 'message' && event.message && event.message.type === 'image') return handleImageMessage(event);

  if (event.type === 'postback') {
    const data = event.postback.data;
    const action = getPostbackAction(data);
    const appointmentId = getAppointmentIdFromData(data);
    const userId = eventUserId;

    if (action === 'edit') {
      if (!appointmentId || !userId) {
        await line.reply(event.replyToken, 'เรียน นายท่าน กรุณาเลือกนัดหมายจากเมนูแก้ไขก่อนค่ะ');
      } else {
        pendingAppointmentEdits.set(userId, appointmentId);
        const appointment = await appointments.getAppointment(appointmentId, { lineUserId: userId });
        await line.reply(event.replyToken, buildEditPrompt(appointment));
      }
    } else if (action === 'list_appointments') {
      await sendAppointmentMenu(event.replyToken, userId);
    } else if (action === 'delete') {
      try {
        if (!appointmentId || !userId) throw new Error('Appointment not found');
        await appointments.deleteAppointment(appointmentId, { lineUserId: userId });
        await line.reply(event.replyToken, 'เรียน นายท่าน นัดหมายนี้ถูกลบเรียบร้อยแล้วค่ะ');
      } catch (err) {
        await line.reply(event.replyToken, `เรียน นายท่าน ยังลบนัดหมายนี้ไม่ได้ค่ะ: ${err.message}`);
      }
    }
  }
  return true;
}

async function handleLineWebhook(req, res) {
  if (!config.lineChannelSecret) return res.status(503).json({ error: 'LINE webhook security is not configured' });
  const signature = String(req.headers['x-line-signature'] || '');
  if (!isValidLineSignature(req.rawBody, signature, config.lineChannelSecret)) {
    return res.status(401).json({ error: 'Invalid LINE signature' });
  }

  const events = Array.isArray(req.body.events) ? req.body.events : [];
  res.sendStatus(200);
  const results = await Promise.allSettled(events.map(event => handleLineEvent(event)));
  results.forEach((result, index) => {
    if (result.status === 'rejected') console.error(`LINE event ${index + 1} error:`, result.reason);
  });
}

app.post('/webhook', handleLineWebhook);
app.post('/webhooks/line', handleLineWebhook);

app.use((err, req, res, next) => {
  console.error('SmartLife request error:', err);
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่ค่ะ' });
});

if (require.main === module) {
  app.listen(port, () => console.log(`SmartLife server running on port ${port}...`));
}

module.exports = {
  app,
  handleLineEvent,
  handleLineWebhook
};
