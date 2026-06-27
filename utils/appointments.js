// utils/appointments.js
const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const { getBangkokDayRange, getBangkokMinuteKey, parseBangkokClockTime, parseBangkokDate, setBangkokClockTime } = require('./time');

const DEFAULT_REMINDER_MINUTES = [1440, 180, 60];
const MAX_RECURRING_APPOINTMENTS = 60;

const EDITABLE_FIELDS = [
  'title',
  'appointmentType',
  'startAt',
  'endAt',
  'locationName',
  'contactName',
  'contactPhone',
  'contactLineId',
  'preparation',
  'dressCode',
  'speechType',
  'status'
];

function getReminderMinutes(appointment) {
  const minutes = new Set(DEFAULT_REMINDER_MINUTES);

  if (Array.isArray(appointment.reminders) && appointment.reminders.length > 0) {
    appointment.reminders
      .map(reminder => reminder.minutesBefore)
      .filter(value => typeof value === 'number')
      .forEach(value => minutes.add(value));
  }

  if (typeof appointment.reminderMinutesBefore === 'number') {
    minutes.add(appointment.reminderMinutesBefore);
  }

  return [...minutes].sort((a, b) => b - a);
}

function rebuildReminders(appointment, options = {}) {
  if (!appointment.startAt) {
    return;
  }

  const preserveSent = options.preserveSent !== false;
  const startMs = appointment.startAt.getTime();
  const minutesList = getReminderMinutes(appointment);
  const firstMinutes = minutesList[0] || 1440;
  const existingReminders = Array.isArray(appointment.reminders) ? appointment.reminders : [];

  appointment.reminderMinutesBefore = firstMinutes;
  appointment.remindAt = new Date(startMs - firstMinutes * 60 * 1000);
  appointment.reminders = minutesList.map(minutesBefore => {
    const existing = existingReminders.find(reminder => reminder.minutesBefore === minutesBefore);

    return {
      minutesBefore,
      remindAt: new Date(startMs - minutesBefore * 60 * 1000),
      sentAt: preserveSent && existing ? existing.sentAt : undefined
    };
  });
}

function buildGoogleMapUrl(locationName) {
  if (!locationName) {
    return '';
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName)}`;
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function getDuplicateKey(appointment) {
  if (!appointment.startAt) {
    return null;
  }

  const titleKey = normalizeText(appointment.title);
  if (!titleKey) {
    return null;
  }

  return `${titleKey}|${getBangkokMinuteKey(appointment.startAt)}`;
}

function getMinuteRange(date) {
  const start = new Date(date);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 60 * 1000);

  return { start, end };
}

async function assertNoDuplicateAppointment(appointment) {
  const duplicateKey = getDuplicateKey(appointment);
  if (!duplicateKey || appointment.status === 'deleted') {
    return;
  }

  const { start, end } = getMinuteRange(appointment.startAt);
  const candidates = await Appointment.find({
    _id: { $ne: appointment._id },
    status: { $ne: 'deleted' },
    startAt: { $gte: start, $lt: end }
  }).limit(20);
  const duplicate = candidates.find(candidate => getDuplicateKey(candidate) === duplicateKey);

  if (duplicate) {
    throw new Error(`Duplicate appointment: ${appointment.title || '-'} at ${getBangkokMinuteKey(appointment.startAt)}`);
  }
}

async function listAppointments(filters = {}) {
  const query = {};

  if (filters.status) {
    query.status = filters.status;
  }

  if (filters.activeOnly) {
    query.status = { $ne: 'deleted' };
  }

  if (filters.startAtFrom || filters.startAtTo) {
    query.$and = [];
    if (filters.startAtTo) {
      query.$and.push({ startAt: { $lte: filters.startAtTo } });
    }
    if (filters.startAtFrom) {
      query.$and.push({
        $or: [
          { endAt: { $gte: filters.startAtFrom } },
          { endAt: null, startAt: { $gte: filters.startAtFrom } },
          { endAt: { $exists: false }, startAt: { $gte: filters.startAtFrom } }
        ]
      });
    }
  }

  return Appointment.find(query).sort({ startAt: 1 }).limit(filters.limit || 50);
}

async function createAppointment(changes = {}) {
  const repeat = normalizeRepeat(changes.repeat || changes.recurrence);
  const appointmentType = normalizeAppointmentType(changes.appointmentType || changes.type, repeat);
  const startAt = parseBangkokDate(changes.startAt);
  const endAt = ['multi_day', 'recurring'].includes(appointmentType) && changes.endAt
    ? parseBangkokDate(changes.endAt)
    : null;
  const appointment = new Appointment({
    ...changes,
    title: changes.title || changes.summary || 'นัดหมาย',
    appointmentType,
    startAt,
    endAt,
    repeat: repeat || undefined,
    status: changes.status || 'scheduled'
  });

  if (!appointment.startAt) {
    throw new Error('Appointment startAt is required');
  }

  if (appointmentType === 'multi_day' && !endAt) {
    throw new Error('Appointment endAt is required for multi-day appointments');
  }

  if (endAt && endAt <= startAt) {
    throw new Error('Appointment endAt must be after startAt');
  }

  if (appointment.locationName) {
    appointment.location = { label: appointment.locationName };
    appointment.mapUrl = buildGoogleMapUrl(appointment.locationName);
  }

  rebuildReminders(appointment, { preserveSent: false });
  await assertNoDuplicateAppointment(appointment);

  return appointment.save();
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeRepeat(value) {
  const text = String(value || '').trim().toLowerCase();
  if (['daily', 'day', 'ทุกวัน'].includes(text)) return 'daily';
  if (['weekly', 'week', 'ทุกสัปดาห์', 'ทุกอาทิตย์'].includes(text)) return 'weekly';
  if (['monthly', 'month', 'ทุกเดือน'].includes(text)) return 'monthly';
  if (['monthly_first_weekend', 'first_weekend', 'เสาร์อาทิตย์แรกของเดือน'].includes(text)) {
    return 'monthly_first_weekend';
  }
  return '';
}

function normalizeAppointmentType(value, repeat) {
  const text = String(value || '').trim().toLowerCase();
  if (repeat || ['recurring', 'repeat', 'ประจำ'].includes(text)) return 'recurring';
  if (['multi_day', 'multi-day', 'multiple', 'หลายวัน'].includes(text)) return 'multi_day';
  return 'single';
}

function addMonthsBangkok(date, months) {
  const [datePart, timePart] = getBangkokMinuteKey(date).split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return parseBangkokDate(`${targetYear}-${targetMonth}-${targetDay} ${timePart.replace(':', '.')}`);
}

function getFirstSaturdayBangkok(date, months) {
  const [datePart, timePart] = getBangkokMinuteKey(date).split(' ');
  const [year, month] = datePart.split('-').map(Number);
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 + 1;
  const firstDayOfWeek = new Date(Date.UTC(targetYear, targetMonth - 1, 1)).getUTCDay();
  const firstSaturday = 1 + ((6 - firstDayOfWeek + 7) % 7);
  return parseBangkokDate(`${targetYear}-${targetMonth}-${firstSaturday} ${timePart.replace(':', '.')}`);
}

async function createRecurringAppointments(changes = {}) {
  const repeat = normalizeRepeat(changes.repeat || changes.recurrence);
  const count = Math.min(Math.max(Number(changes.count || changes.times || 1), 1), MAX_RECURRING_APPOINTMENTS);

  if (!repeat || count <= 1) {
    return [await createAppointment(changes)];
  }

  const firstStartAt = parseBangkokDate(changes.startAt);
  if (!firstStartAt) {
    throw new Error('Appointment startAt is required');
  }

  const firstEndAt = changes.endAt ? parseBangkokDate(changes.endAt) : null;
  if (firstEndAt && firstEndAt <= firstStartAt) {
    throw new Error('Appointment endAt must be after startAt');
  }
  const durationMs = firstEndAt ? firstEndAt.getTime() - firstStartAt.getTime() : 0;
  const occurrenceDetails = Array.isArray(changes.occurrenceDetails)
    ? changes.occurrenceDetails
    : String(changes.occurrenceDetails || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const items = [];
  const recurrenceGroupId = new mongoose.Types.ObjectId().toString();
  for (let index = 0; index < count; index += 1) {
    const occurrenceStartAt = repeat === 'monthly'
      ? addMonthsBangkok(firstStartAt, index)
      : repeat === 'monthly_first_weekend'
        ? getFirstSaturdayBangkok(firstStartAt, index)
        : addDays(firstStartAt, repeat === 'weekly' ? index * 7 : index);
    const occurrenceDetail = occurrenceDetails[index] || '';
    items.push(await createAppointment({
      ...changes,
      appointmentType: 'recurring',
      startAt: occurrenceStartAt,
      endAt: durationMs ? new Date(occurrenceStartAt.getTime() + durationMs) : null,
      preparation: occurrenceDetail
        ? [changes.preparation, `เรื่อง: ${occurrenceDetail}`].filter(Boolean).join('\n')
        : changes.preparation,
      occurrenceNumber: index + 1,
      occurrenceDetail,
      repeat,
      repeatIndex: index + 1,
      repeatCount: count,
      recurrenceGroupId
    }));
  }

  return items;
}

async function copyAppointment(id, changes = {}) {
  const source = await getAppointment(id);
  return createAppointment({
    title: changes.title || source.title,
    startAt: changes.startAt || source.startAt,
    locationName: changes.locationName !== undefined ? changes.locationName : source.locationName,
    dressCode: changes.dressCode !== undefined ? changes.dressCode : source.dressCode,
    preparation: changes.preparation !== undefined ? changes.preparation : source.preparation,
    contactName: source.contactName,
    contactPhone: source.contactPhone,
    contactLineId: source.contactLineId,
    copiedFrom: source._id
  });
}

async function getAppointment(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid appointment id');
  }

  const appointment = await Appointment.findById(id);
  if (!appointment || appointment.status === 'deleted') {
    throw new Error('Appointment not found');
  }

  return appointment;
}

async function getToday(baseDate = new Date()) {
  const { start, end } = getBangkokDayRange(baseDate);

  return Appointment.find({
    startAt: { $lte: end },
    $or: [
      { endAt: { $gte: start } },
      { endAt: null },
      { endAt: { $exists: false } }
    ],
    status: { $ne: 'deleted' }
  }).sort({ startAt: 1 });
}

async function findDueReminders(now = new Date()) {
  const appointments = await Appointment.find({
    startAt: { $gte: now },
    status: { $ne: 'deleted' }
  }).sort({ startAt: 1 }).limit(200);
  const due = [];

  for (const appointment of appointments) {
    rebuildReminders(appointment);

    const dueReminders = appointment.reminders.filter(reminder => (
      !reminder.sentAt &&
      reminder.remindAt &&
      reminder.remindAt <= now
    )).sort((a, b) => b.remindAt.getTime() - a.remindAt.getTime());

    if (dueReminders.length > 0) {
      const [latestReminder, ...staleReminders] = dueReminders;
      staleReminders.forEach(reminder => {
        reminder.sentAt = now;
      });
      due.push({ appointment, reminders: [latestReminder] });
    }
  }

  return due;
}

async function markReminderSent(appointment, minutesBefore, sentAt = new Date()) {
  const reminder = appointment.reminders.find(item => item.minutesBefore === minutesBefore);

  if (reminder) {
    reminder.sentAt = sentAt;
  }

  if (appointment.status !== 'deleted') {
    appointment.status = 'scheduled';
  }

  return appointment.save();
}

async function updateAppointment(id, changes) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid appointment id');
  }

  const appointment = await Appointment.findById(id);
  if (!appointment) {
    throw new Error('Appointment not found');
  }

  const previousStartAt = appointment.startAt ? appointment.startAt.getTime() : null;

  for (const field of EDITABLE_FIELDS) {
    if (changes[field] !== undefined) {
      appointment[field] = ['startAt', 'endAt'].includes(field)
        ? parseBangkokDate(changes[field])
        : changes[field];
    }
  }

  appointment.appointmentType = normalizeAppointmentType(
    appointment.appointmentType,
    appointment.repeat
  );
  if (!['multi_day', 'recurring'].includes(appointment.appointmentType)) {
    appointment.endAt = null;
  } else if (
    appointment.appointmentType === 'multi_day' &&
    (!appointment.endAt || appointment.endAt <= appointment.startAt)
  ) {
    throw new Error('Appointment endAt must be after startAt');
  } else if (appointment.endAt && appointment.endAt <= appointment.startAt) {
    throw new Error('Appointment endAt must be after startAt');
  }

  if (changes.startTime !== undefined) {
    appointment.startAt = setBangkokClockTime(appointment.startAt, changes.startTime);
  }

  if (changes.locationName !== undefined) {
    appointment.location = { label: changes.locationName };
    appointment.mapUrl = buildGoogleMapUrl(changes.locationName);
  }

  if (changes.startAt !== undefined || changes.startTime !== undefined) {
    const nextStartAt = appointment.startAt ? appointment.startAt.getTime() : null;
    rebuildReminders(appointment, { preserveSent: previousStartAt === nextStartAt });
    if (appointment.status === 'reminded') {
      appointment.status = 'scheduled';
    }
  }

  await assertNoDuplicateAppointment(appointment);

  return appointment.save();
}

async function deleteAppointment(id) {
  return updateAppointment(id, { status: 'deleted' });
}

function parseEditText(text, pendingAppointmentId) {
  const trimmed = String(text || '').trim();
  const directMatch = trimmed.match(/^(?:แก้นัดหมาย|แก้ไขนัดหมาย|แก้)\s+([a-f\d]{24})\s*\|\s*(.+)$/i);
  const directTimeOnlyMatch = trimmed.match(/^(?:แก้เวลา|เวลา|ตั้งเวลา)\s+([a-f\d]{24})\s+(.+)$/i);
  const pendingTimeOnlyMatch = pendingAppointmentId && parseBangkokClockTime(trimmed)
    ? { id: pendingAppointmentId, body: trimmed }
    : null;
  const pendingMatch = pendingAppointmentId && trimmed.includes('|')
    ? { id: pendingAppointmentId, body: trimmed }
    : null;

  if (directTimeOnlyMatch || pendingTimeOnlyMatch) {
    return {
      id: directTimeOnlyMatch ? directTimeOnlyMatch[1] : pendingTimeOnlyMatch.id,
      changes: {
        startTime: directTimeOnlyMatch ? directTimeOnlyMatch[2].trim() : pendingTimeOnlyMatch.body
      }
    };
  }

  const id = directMatch ? directMatch[1] : pendingMatch && pendingMatch.id;
  const body = directMatch ? directMatch[2] : pendingMatch && pendingMatch.body;

  if (!id || !body) {
    return null;
  }

  const parts = body.split('|').map(part => part.trim());
  const changes = {};

  if (parts[0]) {
    changes.title = parts[0];
  }

  if (parts[1]) {
    changes.startAt = parts[1];
  }

  if (parts[2]) {
    changes.locationName = parts[2];
  }

  if (parts[3]) {
    changes.dressCode = parts[3];
  }

  return {
    id,
    changes
  };
}

function parseCreateText(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^\/?(?:บันทึกนัดหมาย|เพิ่มนัดหมาย|สร้างนัดหมาย|นัดหมายใหม่)\s*\|\s*([\s\S]+)$/i);

  if (!match) {
    return null;
  }

  const parts = match[1].split('|').map(part => part.trim());
  if (!parts[0] || !parts[1]) {
    return null;
  }

  const payload = {
    title: parts[0],
    startAt: parts[1],
    locationName: parts[2] || '',
    dressCode: parts[3] || '',
    preparation: parts[4] || ''
  };

  const tail = parts.slice(5).join(' ');
  const repeatMatch = tail.match(/(?:repeat|ซ้ำ)\s*=\s*(daily|weekly|monthly|ทุกวัน|ทุกสัปดาห์|ทุกอาทิตย์|ทุกเดือน)/i) ||
    tail.match(/\b(daily|weekly|monthly|ทุกวัน|ทุกสัปดาห์|ทุกอาทิตย์|ทุกเดือน)\b/i);
  const countMatch = tail.match(/(?:count|times|ครั้ง)\s*=\s*(\d{1,2})/i) ||
    tail.match(/(\d{1,2})\s*(?:ครั้ง|รอบ)/i);

  if (repeatMatch) {
    payload.repeat = normalizeRepeat(repeatMatch[1]);
  }

  if (countMatch) {
    payload.count = Number(countMatch[1]);
  }

  return payload;
}

function parseCopyText(text) {
  const match = String(text || '').trim().match(/^(?:copyนัด|คัดลอกนัด|copy appointment)\s+([a-f\d]{24})\s*\|\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const parts = match[2].split('|').map(part => part.trim());
  return {
    id: match[1],
    changes: {
      startAt: parts[0],
      title: parts[1] || undefined,
      locationName: parts[2] || undefined,
      dressCode: parts[3] || undefined,
      preparation: parts[4] || undefined
    }
  };
}

function parseDeleteText(text) {
  const match = String(text || '').trim().match(/^(?:ลบนัดหมาย|ลบ)\s+([a-f\d]{24})$/i);
  return match ? match[1] : null;
}

function parseEditTargetText(text) {
  const match = String(text || '').trim().match(/^(?:แก้นัดหมาย|แก้ไขนัดหมาย|แก้)\s+([a-f\d]{24})$/i);
  return match ? match[1] : null;
}

function parseSelectionCommand(text) {
  const trimmed = String(text || '').trim();
  const editMatch = trimmed.match(/^(?:แก้นัดหมาย|แก้ไขนัดหมาย|แก้)\s+(\d{1,2})$/i);
  if (editMatch) {
    return { action: 'edit', index: Number(editMatch[1]) };
  }

  const deleteMatch = trimmed.match(/^(?:ลบนัดหมาย|ลบ)\s+(\d{1,2})$/i);
  if (deleteMatch) {
    return { action: 'delete', index: Number(deleteMatch[1]) };
  }

  return null;
}

async function findPotentialDuplicates() {
  const appointments = await Appointment.find({ status: { $ne: 'deleted' } })
    .sort({ startAt: 1 })
    .limit(200);
  const groups = new Map();

  for (const appointment of appointments) {
    const key = getDuplicateKey(appointment);
    if (!key) {
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(appointment);
  }

  return [...groups.values()].filter(group => group.length > 1);
}

module.exports = {
  listAppointments,
  createAppointment,
  createRecurringAppointments,
  copyAppointment,
  getAppointment,
  getToday,
  findDueReminders,
  markReminderSent,
  updateAppointment,
  deleteAppointment,
  parseCreateText,
  parseCopyText,
  parseEditText,
  parseDeleteText,
  parseEditTargetText,
  parseSelectionCommand,
  getDuplicateKey,
  findPotentialDuplicates
};
