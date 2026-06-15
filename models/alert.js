// models/Alert.js
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  type: String,
  severity: String,
  title: String,
  message: String,
  areaText: String,
  latitude: Number,
  longitude: Number,
  radiusKm: Number,
  source: String,
  sourceUrl: String,
  externalId: String,
  startsAt: Date,
  expiresAt: Date,
  sentTo: [mongoose.Schema.Types.Mixed],
  active: Boolean
}, {
  collection: 'alerts',
  strict: false,
  timestamps: true
});

module.exports = mongoose.model('Alert', alertSchema);
