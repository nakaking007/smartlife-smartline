// models/Appointment.js
const mongoose = require('mongoose');

const reminderSchema = new mongoose.Schema({
  minutesBefore: Number,
  remindAt: Date,
  sentAt: Date
}, { strict: false });

const appointmentSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.Mixed,
  title: String,
  activityType: String,
  startAt: Date,
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

module.exports = mongoose.model('Appointment', appointmentSchema);
