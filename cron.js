// cron.js
require('dotenv').config();

const cron = require('node-cron');
const mongoose = require('mongoose');
const config = require('./config');
const Alert = require('./models/Alert');
const weather = require('./utils/weather');
const appointments = require('./utils/appointments');
const todos = require('./utils/todos');
const alerts = require('./utils/alerts');
const liveDisasters = require('./utils/liveDisasters');
const earthquakeWarnings = require('./utils/earthquakeWarnings');
const line = require('./utils/line');
const { THAILAND_TIME_ZONE, formatBangkokDateTime, formatBangkokTime, getBangkokDateKey } = require('./utils/time');

const LIVE_DISASTER_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MORNING_REPORT_JOB = 'morning-report';
const BEDTIME_TODO_PROMPT_JOB = 'bedtime-todo-prompt';
const MORNING_REPORT_CATCH_UP_END_HOUR = 12;
let lastLiveDisasterSyncAt = 0;
const morningReportInFlight = new Set();

async function getWeatherReport() {
  try {
    return await weather.getReport();
  } catch (err) {
    console.error("SmartLife weather error:", err.message);
    return {
      tempMax: '-',
      temp: null,
      humidity: null,
      rainMm1h: 0,
      rainChance: null,
      pm25: null,
      source: 'fallback',
      observedAt: new Date()
    };
  }
}

function buildHealthAdvice(report) {
  const cityAdvice = [];
  const ruralAdvice = [];

  if (report.rainChance !== null && report.rainChance >= 60) {
    cityAdvice.push("เผื่อเวลาเดินทางและเตรียมร่ม");
    ruralAdvice.push("เช็กงานกลางแจ้งและทางดินที่อาจลื่น");
  } else if (report.rainMm1h > 0) {
    cityAdvice.push("ถนนอาจเปียกและรถติดกว่าปกติ");
    ruralAdvice.push("พื้นที่โล่งและทางดินอาจเดินทางช้าลง");
  }

  if (report.pm25 !== null && report.pm25 > 50) {
    cityAdvice.push("ลดเวลาริมถนนและพื้นที่รถหนาแน่น");
    ruralAdvice.push("เลี่ยงควันเผาและงานกลางแจ้งนานๆ หากทำได้");
  }

  if (report.tempMax !== null && report.tempMax >= 35) {
    cityAdvice.push("พกน้ำและระวังความร้อนสะสมระหว่างเดินทาง");
    ruralAdvice.push("แบ่งงานกลางแจ้งเป็นช่วงสั้นและดื่มน้ำให้พอ");
  }

  if (report.temp !== null && report.temp < 20) {
    cityAdvice.push("เตรียมเสื้อคลุมสำหรับช่วงเช้า/ค่ำ");
    ruralAdvice.push("ดูแลผู้สูงอายุ เด็ก และสัตว์เลี้ยงช่วงอากาศเย็น");
  }

  if (cityAdvice.length === 0 && ruralAdvice.length === 0) {
    return "วันนี้ยังไม่มีสัญญาณอากาศเด่นจากข้อมูลที่ระบบได้รับค่ะ";
  }

  return [
    cityAdvice.length ? `คนเมือง: ${cityAdvice.join(' / ')}` : null,
    ruralAdvice.length ? `ชนบท: ${ruralAdvice.join(' / ')}` : null
  ].filter(Boolean).join("\n");
}

async function sendMorningReport() {
  try {
    const report = await getWeatherReport();
    const appointmentsToday = await appointments.getToday();
    const todosToday = await todos.getToday();
    const overdueTodos = await todos.getOverdue();
    const events = appointmentsToday.map(item => ({
      eventId: item._id,
      summary: item.title || '-',
      start: formatBangkokTime(item.startAt),
      locationName: item.locationName || '-'
    }));
    const todoSummary = {
      today: todosToday.map(item => ({
        id: item._id,
        title: item.title || '-',
        dueAt: item.dueAt,
        responsible: item.responsible,
        priority: item.priority || 'normal'
      })),
      overdue: overdueTodos.map(item => ({
        id: item._id,
        title: item.title || '-',
        dueAt: item.dueAt,
        responsible: item.responsible,
        priority: item.priority || 'normal'
      }))
    };

    await line.sendMorningGreeting({
      tempMax: report.tempMax,
      heatIndex: report.heatIndex,
      tempAssessment: report.tempAssessment,
      heatIndexAssessment: report.heatIndexAssessment,
      rainChance: report.rainChance,
      rainChanceAssessment: report.rainChanceAssessment,
      rainMm1h: report.rainMm1h,
      rainAmountAssessment: report.rainAmountAssessment,
      nextRainAt: report.nextRainAt,
      nextRainInHours: report.nextRainInHours,
      nextRainMm3h: report.nextRainMm3h,
      nextRainAssessment: report.nextRainAssessment,
      pm25: report.pm25,
      pm25Assessment: report.pm25Assessment,
      healthAdvice: buildHealthAdvice(report),
      source: report.source,
      observedAt: report.observedAt
    }, events, todoSummary);

    await sendMorningActiveAlerts();
    return true;
  } catch (err) {
    console.error("SmartLife cron error:", err);
    return false;
  }
}

async function sendBedtimeTodoPrompt(baseDate = new Date()) {
  try {
    const dateKey = getBangkokDateKey(baseDate);

    if (await hasCronRunSent(BEDTIME_TODO_PROMPT_JOB, dateKey)) {
      return false;
    }

    await line.pushMessage([
      'เรียน นายท่าน ก่อนพักผ่อนคืนนี้ จะลงบันทึก To-do สำหรับพรุ่งนี้หรือสัปดาห์นี้ไหมคะ',
      '',
      'พิมพ์ตัวอย่าง:',
      'เพิ่มงาน | ชื่องาน | 28-06-2569 : 17.00 น. | ผู้รับผิดชอบ | high | หมายเหตุ',
      '',
      'ดูงาน: งานวันนี้ / งานสัปดาห์นี้ / งานค้าง'
    ].join('\n'));
    await markCronRunSent(BEDTIME_TODO_PROMPT_JOB, dateKey);
    return true;
  } catch (err) {
    console.error("SmartLife bedtime todo prompt error:", err.message);
    return false;
  }
}

async function sendMorningActiveAlerts() {
  try {
    if (!config.lineUserId) {
      return 0;
    }

    await syncLiveDisasterAlerts({ force: true });

    const activeAlerts = await alerts.listActiveUrgentAlerts(new Date(), 10);
    let sentCount = 0;

    for (const alert of activeAlerts) {
      await line.pushMessage(alerts.formatAlert(alert));
      await alerts.markAlertSent(alert._id, config.lineUserId);
      sentCount += 1;
    }

    return sentCount;
  } catch (err) {
    console.error("SmartLife morning alert error:", err.message);
    return 0;
  }
}

function getBangkokClockParts(baseDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: THAILAND_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    numberingSystem: 'latn'
  }).formatToParts(baseDate).reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = Number(part.value);
    }

    return acc;
  }, {});

  return {
    hour: parts.hour,
    minute: parts.minute
  };
}

function isMorningReportCatchUpWindow(baseDate = new Date()) {
  const { hour } = getBangkokClockParts(baseDate);
  return hour >= 6 && hour < MORNING_REPORT_CATCH_UP_END_HOUR;
}

function getCronRunCollection() {
  return mongoose.connection.collection('cron_runs');
}

async function hasMorningReportSent(dateKey) {
  return hasCronRunSent(MORNING_REPORT_JOB, dateKey);
}

async function hasCronRunSent(job, dateKey) {
  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  const existing = await getCronRunCollection().findOne({
    job,
    dateKey,
    status: 'success'
  });

  return Boolean(existing);
}

async function markMorningReportSent(dateKey) {
  return markCronRunSent(MORNING_REPORT_JOB, dateKey);
}

async function markCronRunSent(job, dateKey) {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const now = new Date();
  await getCronRunCollection().updateOne(
    { job, dateKey },
    {
      $set: {
        job,
        dateKey,
        status: 'success',
        sentAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        createdAt: now
      }
    },
    { upsert: true }
  );
}

async function sendDailyMorningReport(baseDate = new Date()) {
  const dateKey = getBangkokDateKey(baseDate);

  if (morningReportInFlight.has(dateKey)) {
    return false;
  }

  if (await hasMorningReportSent(dateKey)) {
    return false;
  }

  morningReportInFlight.add(dateKey);
  try {
    const sent = await sendMorningReport();
    if (!sent) {
      return false;
    }

    await markMorningReportSent(dateKey);
    return true;
  } finally {
    morningReportInFlight.delete(dateKey);
  }
}

async function sendMissedMorningReportIfNeeded(baseDate = new Date()) {
  if (!isMorningReportCatchUpWindow(baseDate)) {
    return false;
  }

  if (mongoose.connection.readyState !== 1) {
    return false;
  }

  return sendDailyMorningReport(baseDate);
}

function formatReminderLead(minutesBefore) {
  if (minutesBefore === 1440) return "1 วัน";
  if (minutesBefore === 360) return "6 ชั่วโมง";
  if (minutesBefore === 60) return "1 ชั่วโมง";
  if (minutesBefore === 30) return "30 นาที";
  return `${minutesBefore} นาที`;
}

function buildReminderMessage(appointment, minutesBefore) {
  return {
    type: 'text',
    text: [
      `เรียน นายท่าน อีก ${formatReminderLead(minutesBefore)} จะถึงกิจกรรมค่ะ`,
      "",
      `หัวข้อ: ${appointment.title || '-'}`,
      `เวลา: ${formatBangkokDateTime(appointment.startAt)}`,
      appointment.locationName ? `สถานที่: ${appointment.locationName}` : null,
      appointment.dressCode ? `การแต่งกาย: ${appointment.dressCode}` : null,
      appointment.preparation ? `สิ่งที่ต้องเตรียม: ${appointment.preparation}` : null,
      "",
      "หากต้องการแก้ไขหรือลบนัดหมาย กรุณากดปุ่มด้านล่างค่ะ"
    ].filter(Boolean).join("\n"),
    quickReply: {
      items: [
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'แก้ไข',
            data: `action=edit&id=${appointment._id}`,
            displayText: 'แก้ไขนัดหมาย'
          }
        },
        {
          type: 'action',
          action: {
            type: 'postback',
            label: 'ลบ',
            data: `action=delete&id=${appointment._id}`,
            displayText: 'ลบนัดหมาย'
          }
        }
      ]
    }
  };
}

async function sendDueAppointmentReminders() {
  try {
    const dueItems = await appointments.findDueReminders();

    for (const item of dueItems) {
      for (const reminder of item.reminders) {
        await line.sendAppointmentReminder(
          item.appointment._id,
          item.appointment.title || '-',
          formatBangkokDateTime(item.appointment.startAt),
          {
            leadTime: formatReminderLead(reminder.minutesBefore),
            locationName: item.appointment.locationName,
            dressCode: item.appointment.dressCode,
            contactName: item.appointment.contactName,
            contactPhone: item.appointment.contactPhone,
            contactLineId: item.appointment.contactLineId
          }
        );
        await appointments.markReminderSent(item.appointment, reminder.minutesBefore);
      }
    }
  } catch (err) {
    console.error("SmartLife reminder error:", err);
  }
}

async function sendDueTodoReminders() {
  try {
    const reminderItems = await todos.findDueTodoReminders();

    for (const todo of reminderItems) {
      await line.pushMessage([
        'เรียน นายท่าน ใกล้ถึงเวลากำหนดเสร็จงานค่ะ',
        '',
        `งาน: ${todo.title || '-'}`,
        `กำหนดเสร็จ: ${todo.dueAt ? formatBangkokDateTime(todo.dueAt) : '-'}`,
        todo.responsible ? `ผู้รับผิดชอบ: ${todo.responsible}` : null,
        '',
        'ถ้าเสร็จแล้วพิมพ์ งานเสร็จ <ID> ค่ะ',
        `ID: ${todo._id}`
      ].filter(Boolean).join('\n'));
      await todos.markTodoReminderSent(todo);
    }

    const dueItems = await todos.findDueTodoPrompts();

    for (const todo of dueItems) {
      await line.pushMessage([
        'เรียน นายท่าน ถึงเวลากำหนดส่งงานแล้วค่ะ',
        '',
        `งาน: ${todo.title || '-'}`,
        `กำหนดเสร็จ: ${todo.dueAt ? formatBangkokDateTime(todo.dueAt) : '-'}`,
        todo.responsible ? `ผู้รับผิดชอบ: ${todo.responsible}` : null,
        '',
        'งานนี้ส่งรายงานเสร็จหรือยังคะ ถ้าเสร็จแล้วพิมพ์ งานเสร็จ <ID> ค่ะ',
        `ID: ${todo._id}`
      ].filter(Boolean).join('\n'));
      await todos.markTodoDuePromptSent(todo);
    }
  } catch (err) {
    console.error("SmartLife todo reminder error:", err.message);
  }
}

async function sendUrgentAlerts() {
  try {
    if (!config.lineUserId) {
      return;
    }

    const urgentAlerts = await alerts.listUnsentUrgentAlerts(config.lineUserId);

    for (const alert of urgentAlerts) {
      await line.pushMessage(alerts.formatAlert(alert));
      await alerts.markAlertSent(alert._id, config.lineUserId);
    }
  } catch (err) {
    console.error("SmartLife alert error:", err);
  }
}

async function syncLiveDisasterAlerts({ force = false } = {}) {
  try {
    const now = new Date();

    if (!force && now.getTime() - lastLiveDisasterSyncAt < LIVE_DISASTER_SYNC_INTERVAL_MS) {
      return 0;
    }

    lastLiveDisasterSyncAt = now.getTime();
    await earthquakeWarnings.syncEarthquakeWarnings({ now });
    const candidates = await liveDisasters.fetchLiveDisasterAlertCandidates(now);
    let insertedCount = 0;

    for (const candidate of candidates) {
      const { externalId, ...fields } = candidate;
      if (!externalId) {
        continue;
      }

      const result = await Alert.updateOne(
        { externalId },
        {
          $set: fields,
          $setOnInsert: { externalId, sentTo: [] }
        },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        insertedCount += 1;
      }
    }

    return insertedCount;
  } catch (err) {
    console.error("SmartLife live disaster sync error:", err.message);
    return 0;
  }
}

cron.schedule('0 6 * * *', () => sendDailyMorningReport(), {
  timezone: THAILAND_TIME_ZONE
});

cron.schedule('30 21 * * *', () => sendBedtimeTodoPrompt(), {
  timezone: THAILAND_TIME_ZONE
});

cron.schedule('* * * * *', async () => {
  await sendMissedMorningReportIfNeeded();
  await syncLiveDisasterAlerts();
  await sendDueAppointmentReminders();
  await sendDueTodoReminders();
  await sendUrgentAlerts();
}, {
  timezone: THAILAND_TIME_ZONE
});

setTimeout(() => {
  sendMissedMorningReportIfNeeded().catch(err => {
    console.error("SmartLife morning catch-up error:", err.message);
  });
}, 15000);

setTimeout(async () => {
  try {
    await syncLiveDisasterAlerts({ force: true });
    await sendUrgentAlerts();
  } catch (err) {
    console.error("SmartLife startup disaster alert error:", err.message);
  }
}, 5000);

module.exports = {
  sendMorningReport,
  sendDailyMorningReport,
  sendMissedMorningReportIfNeeded,
  sendBedtimeTodoPrompt,
  sendMorningActiveAlerts,
  sendDueAppointmentReminders,
  sendDueTodoReminders,
  sendUrgentAlerts,
  syncLiveDisasterAlerts
};
