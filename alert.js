const mongoose = require("mongoose");

const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "earthquake",
        "tsunami",
        "storm",
        "flood",
        "pm25",
        "cold",
        "heat",
        "heavy_rain",
        "traffic",
        "crime",
        "astronomy",
        "dust_storm",
        "typhoon",
        "sinkhole",
        "storm_surge",
        "other"
      ],
      required: true,
      index: true
    },
    severity: {
      type: String,
      enum: ["info", "watch", "warning", "critical"],
      default: "warning"
    },
    title: {
      type: String,
      required: true
    },
    message: {
      type: String,
      required: true
    },
    areaText: {
      type: String,
      default: ""
    },
    latitude: {
      type: Number
    },
    longitude: {
      type: Number
    },
    radiusKm: {
      type: Number,
      default: 20
    },
    source: {
      type: String,
      default: "manual"
    },
    sourceUrl: {
      type: String,
      default: ""
    },
    externalId: {
      type: String
    },
    startsAt: {
      type: Date,
      default: Date.now
    },
    expiresAt: {
      type: Date
    },
    sentTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    ],
    active: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

alertSchema.index(
  { source: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalId: { $exists: true, $type: "string" }
    }
  }
);

module.exports = mongoose.model("Alert", alertSchema);
