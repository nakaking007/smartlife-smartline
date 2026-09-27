// models/Appointment.js
const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  minutesBefore: Number,
  remindAt: Date,
  sentAt: Date
}, { strict: false });

const appointmentSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.Mixed,
  lineUserId: String,
  title: String,
  activityType: String,
  appointmentType: {
    type: String,
    enum: ['single', 'multi_day', 'recurring'],
    default: 'single'
  },
  startAt: Date,
  endAt: Date,
  repeat: String,
  repeatIndex: Number,
  repeatCount: Number,
  recurrenceGroupId: String,
  reminderMinutesBefore: Number,
  remindAt: Date,
  reminders: [reminderSchema],
  locationName: String,
  location: mongoose.Schema.Types.Mixed,
  mapUrl: String,
  contactName: String,
  contactPhone: String,
  contactLineId: String,
  preparation: String,
  dressCode: String,
  speechType: String,
  speechDraftRequested: Boolean,
  status: String
}, {
  collection: 'appointments',
  strict: false,
  timestamps: true
});

appointmentSchema.index({ lineUserId: 1, startAt: 1, status: 1 });
appointmentSchema.index({ lineUserId: 1, recurrenceGroupId: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
