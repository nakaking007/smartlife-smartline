const mongoose = require('mongoose');

const todoSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.Mixed,
  lineUserId: String,
  title: String,
  dueAt: Date,
  responsible: String,
  priority: String,
  category: String,
  notes: String,
  reminderMinutesBefore: Number,
  remindAt: Date,
  reminderSentAt: Date,
  duePromptSentAt: Date,
  status: String,
  completedAt: Date
}, {
  collection: 'todos',
  strict: false,
  timestamps: true
});

module.exports = mongoose.model('Todo', todoSchema);
