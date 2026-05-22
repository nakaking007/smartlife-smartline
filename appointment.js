const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    activityType: {
      type: String,
      enum: ["appointment", "exercise", "meal", "travel", "ceremony", "wedding", "daily", "other"],
      default: "appointment"
    },
    startAt: {
      type: Date,
      required: true,
      index: true
    },
    endAt: {
      type: Date
    },
    reminderMinutesBefore: {
      type: Number,
      default: 60
    },
    remindAt: {
      type: Date,
      required: true,
      index: true
    },
    reminders: [
      {
        minutesBefore: {
          type: Number,
          required: true
        },
        remindAt: {
          type: Date,
          required: true,
          index: true
        },
        sentAt: {
          type: Date,
          default: null
        }
      }
    ],
    locationName: {
      type: String,
      default: ""
    },
    location: {
      label: { type: String, default: "" },
      latitude: { type: Number },
      longitude: { type: Number }
    },
    mapUrl: {
      type: String,
      default: ""
    },
    contactName: {
      type: String,
      default: ""
    },
    contactPhone: {
      type: String,
      default: ""
    },
    contactLineId: {
      type: String,
      default: ""
    },
    preparation: {
      type: String,
      default: ""
    },
    dressCode: {
      type: String,
      default: ""
    },
    speechType: {
      type: String,
      enum: ["none", "speech", "opening", "wedding", "thanks"],
      default: "none"
    },
    speechDraftRequested: {
      type: Boolean,
      default: false
    },
    status: {
      type: String,
      enum: ["scheduled", "reminded", "cancelled"],
      default: "scheduled"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appointment", appointmentSchema);
