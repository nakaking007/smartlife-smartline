const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    lineUserId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    displayName: {
      type: String,
      default: ""
    },
    fullName: {
      type: String,
      default: ""
    },
    plan: {
      type: String,
      enum: ["free", "basic", "premium"],
      default: "free"
    },
    requestedPlan: {
      type: String,
      enum: ["free", "basic", "premium"],
      default: "free"
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "expired"],
      default: "unpaid",
      index: true
    },
    subscriptionStartedAt: {
      type: Date
    },
    subscriptionExpiresAt: {
      type: Date
    },
    lastPayment: {
      amount: { type: Number },
      method: { type: String, default: "" },
      slipReference: { type: String, default: "" },
      paidAt: { type: Date },
      approvedBy: { type: String, default: "" }
    },
    phone: {
      type: String,
      default: ""
    },
    location: {
      label: { type: String, default: "" },
      latitude: { type: Number },
      longitude: { type: Number },
      province: { type: String, default: "" },
      district: { type: String, default: "" }
    },
    travelLocations: [
      {
        label: { type: String, default: "" },
        latitude: { type: Number },
        longitude: { type: Number },
        province: { type: String, default: "" },
        district: { type: String, default: "" },
        active: { type: Boolean, default: true },
        savedAt: { type: Date, default: Date.now }
      }
    ],
    alertPreferences: {
      appointment: { type: Boolean, default: true },
      disaster: { type: Boolean, default: true },
      weather: { type: Boolean, default: true },
      traffic: { type: Boolean, default: true },
      astronomy: { type: Boolean, default: true }
    },
    active: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
