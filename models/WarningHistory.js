const mongoose = require('mongoose');

const warningHistorySchema = new mongoose.Schema({
  type: String,
  externalId: String,
  source: String,
  sourceUrl: String,
  title: String,
  areaText: String,
  latitude: Number,
  longitude: Number,
  magnitude: Number,
  depthKm: Number,
  distanceFromBangkokKm: Number,
  severity: String,
  riskLevel: String,
  confidence: String,
  message: String,
  publicAdvice: String,
  startsAt: Date,
  expiresAt: Date,
  active: Boolean
}, {
  collection: 'warning_history',
  strict: false,
  timestamps: true
});

warningHistorySchema.index({ externalId: 1 }, { unique: true, sparse: true });
warningHistorySchema.index({ type: 1, startsAt: -1 });

module.exports = mongoose.model('WarningHistory', warningHistorySchema);
