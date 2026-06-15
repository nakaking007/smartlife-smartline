const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true },
  email: { type: String, required: true },
  phone: String,
  lineUserId: String,
  plan: { type: String, default: "free" },
  paymentNote: String,
  paymentStatus: { type: String, default: "pending" },
  unlockedUntil: Date,
  unlockedBy: String,
  unlockedAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model("User", userSchema);
