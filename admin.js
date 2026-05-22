const express = require("express");

const User = require("../models/user");

const router = express.Router();

router.use((req, res, next) => {
  const apiKey = process.env.ADMIN_API_KEY || process.env.ALERT_INGEST_API_KEY;

  if (apiKey && req.get("x-api-key") !== apiKey) {
    return res.status(401).json({ message: "Invalid admin API key" });
  }

  if (!apiKey) {
    return res.status(403).json({ message: "ADMIN_API_KEY is required before using admin tools" });
  }

  next();
});

router.get("/users", async (req, res) => {
  const users = await User.find({})
    .select("lineUserId fullName phone plan requestedPlan paymentStatus subscriptionStartedAt subscriptionExpiresAt lastPayment createdAt updatedAt")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  res.json(users);
});

router.post("/users/:lineUserId/unlock", async (req, res) => {
  const plan = req.body.plan || "basic";
  const months = Number(req.body.months || 1);
  const amount = Number(req.body.amount || (plan === "premium" ? 100 : 50));

  if (!["basic", "premium"].includes(plan)) {
    return res.status(400).json({ message: "plan must be basic or premium" });
  }

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  const user = await User.findOneAndUpdate(
    { lineUserId: req.params.lineUserId },
    {
      $set: {
        plan,
        requestedPlan: plan,
        paymentStatus: "paid",
        subscriptionStartedAt: now,
        subscriptionExpiresAt: expiresAt,
        lastPayment: {
          amount,
          method: req.body.method || "promptpay",
          slipReference: req.body.slipReference || "",
          paidAt: now,
          approvedBy: req.body.approvedBy || "admin"
        }
      }
    },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json({
    message: "User unlocked",
    lineUserId: user.lineUserId,
    plan: user.plan,
    paymentStatus: user.paymentStatus,
    subscriptionExpiresAt: user.subscriptionExpiresAt
  });
});

router.post("/users/:lineUserId/lock", async (req, res) => {
  const user = await User.findOneAndUpdate(
    { lineUserId: req.params.lineUserId },
    {
      $set: {
        plan: "free",
        paymentStatus: "expired",
        subscriptionExpiresAt: new Date()
      }
    },
    { new: true }
  );

  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }

  res.json({
    message: "User locked",
    lineUserId: user.lineUserId,
    plan: user.plan,
    paymentStatus: user.paymentStatus
  });
});

module.exports = router;
