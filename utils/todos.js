const mongoose = require('mongoose');
const Todo = require('../models/Todo');
const { getBangkokDayRange, getBangkokWeekRange, parseBangkokDate } = require('./time');

const DEFAULT_REMINDER_MINUTES = 60;
const DUE_PROMPT_GRACE_MS = 2 * 60 * 60 * 1000;

const EDITABLE_FIELDS = [
  'title',
  'dueAt',
  'priority',
  'category',
  'notes',
  'responsible',
  'reminderMinutesBefore',
  'status',
  'lineUserId'
];

function normalizeStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['done', 'completed', 'เสร็จ', 'เสร็จแล้ว'].includes(value)) return 'done';
  if (['deleted', 'ลบ'].includes(value)) return 'deleted';
  return 'open';
}

async function listTodos(filters = {}) {
  const query = {};

  if (filters.status) {
    query.status = normalizeStatus(filters.status);
  }

  if (filters.activeOnly) {
    query.status = { $ne: 'deleted' };
  }

  if (filters.openOnly) {
    query.status = 'open';
  }

  if (filters.lineUserId) {
    query.lineUserId = filters.lineUserId;
  }

  if (filters.dueAtFrom || filters.dueAtTo) {
    query.dueAt = {};
    if (filters.dueAtFrom) query.dueAt.$gte = filters.dueAtFrom;
    if (filters.dueAtTo) query.dueAt.$lte = filters.dueAtTo;
  }

  return Todo.find(query).sort({ status: 1, dueAt: 1, createdAt: -1 }).limit(filters.limit || 100);
}

async function createTodo(changes = {}) {
  const title = String(changes.title || '').trim();
  if (!title) {
    throw new Error('Todo title is required');
  }

  const todo = new Todo({
    ...changes,
    title,
    dueAt: changes.dueAt ? parseBangkokDate(changes.dueAt) : undefined,
    responsible: changes.responsible || '',
    priority: changes.priority || 'normal',
    reminderMinutesBefore: Number(changes.reminderMinutesBefore || DEFAULT_REMINDER_MINUTES),
    status: normalizeStatus(changes.status || 'open')
  });

  if (todo.dueAt) {
    todo.remindAt = new Date(todo.dueAt.getTime() - todo.reminderMinutesBefore * 60 * 1000);
  }

  if (todo.status === 'done' && !todo.completedAt) {
    todo.completedAt = new Date();
  }

  return todo.save();
}

async function getTodo(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid todo id');
  }

  const todo = await Todo.findById(id);
  if (!todo || todo.status === 'deleted') {
    throw new Error('Todo not found');
  }

  return todo;
}

async function updateTodo(id, changes = {}) {
  const todo = await getTodo(id);

  for (const field of EDITABLE_FIELDS) {
    if (changes[field] !== undefined) {
      todo[field] = field === 'dueAt' && changes[field]
        ? parseBangkokDate(changes[field])
        : changes[field];
    }
  }

  if (changes.status !== undefined) {
    todo.status = normalizeStatus(changes.status);
    todo.completedAt = todo.status === 'done' ? (todo.completedAt || new Date()) : undefined;
  }

  if (changes.dueAt !== undefined || changes.reminderMinutesBefore !== undefined) {
    todo.reminderMinutesBefore = Number(todo.reminderMinutesBefore || DEFAULT_REMINDER_MINUTES);
    todo.remindAt = todo.dueAt
      ? new Date(todo.dueAt.getTime() - todo.reminderMinutesBefore * 60 * 1000)
      : undefined;
    todo.reminderSentAt = undefined;
    todo.duePromptSentAt = undefined;
  }

  return todo.save();
}

async function completeTodo(id) {
  return updateTodo(id, { status: 'done' });
}

async function reopenTodo(id) {
  return updateTodo(id, { status: 'open' });
}

async function deleteTodo(id) {
  return updateTodo(id, { status: 'deleted' });
}

async function getToday(baseDate = new Date()) {
  const { end } = getBangkokDayRange(baseDate);
  return listTodos({
    openOnly: true,
    dueAtFrom: baseDate,
    dueAtTo: end,
    limit: 100
  });
}

async function getOverdue(baseDate = new Date()) {
  const { start } = getBangkokDayRange(baseDate);
  return listTodos({
    openOnly: true,
    dueAtTo: start,
    limit: 100
  });
}

async function getThisWeek(baseDate = new Date()) {
  const { start, end } = getBangkokWeekRange(baseDate);
  return listTodos({
    activeOnly: true,
    dueAtFrom: start,
    dueAtTo: end,
    limit: 100
  });
}

async function findDueTodoReminders(now = new Date()) {
  return Todo.find({
    status: 'open',
    dueAt: { $gte: now },
    remindAt: { $lte: now },
    reminderSentAt: { $exists: false }
  }).sort({ dueAt: 1 }).limit(50);
}

async function findDueTodoPrompts(now = new Date()) {
  return Todo.find({
    status: 'open',
    dueAt: {
      $gte: new Date(now.getTime() - DUE_PROMPT_GRACE_MS),
      $lte: now
    },
    duePromptSentAt: { $exists: false }
  }).sort({ dueAt: 1 }).limit(50);
}

async function markTodoReminderSent(todo, sentAt = new Date()) {
  todo.reminderSentAt = sentAt;
  return todo.save();
}

async function markTodoDuePromptSent(todo, sentAt = new Date()) {
  todo.duePromptSentAt = sentAt;
  return todo.save();
}

function parseCreateText(text) {
  const trimmed = String(text || '').trim();
  const match = trimmed.match(/^\/?(?:เพิ่มงาน|บันทึกงาน|todo|to do)\s*\|\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }

  const parts = match[1].split('|').map(part => part.trim());
  if (!parts[0]) {
    return null;
  }

  const priorities = ['urgent', 'high', 'normal', 'low'];
  const oldFormat = priorities.includes(String(parts[2] || '').toLowerCase());

  if (oldFormat) {
    return {
      title: parts[0],
      dueAt: parts[1] || undefined,
      priority: parts[2] || 'normal',
      notes: parts[3] || ''
    };
  }

  return {
    title: parts[0],
    dueAt: parts[1] || undefined,
    responsible: parts[2] || '',
    priority: parts[3] || 'normal',
    notes: parts[4] || '',
    reminderMinutesBefore: parts[5] ? Number(parts[5]) : DEFAULT_REMINDER_MINUTES
  };
}

module.exports = {
  listTodos,
  createTodo,
  getTodo,
  updateTodo,
  completeTodo,
  reopenTodo,
  deleteTodo,
  getToday,
  getOverdue,
  getThisWeek,
  findDueTodoReminders,
  findDueTodoPrompts,
  markTodoReminderSent,
  markTodoDuePromptSent,
  parseCreateText,
  normalizeStatus
};
