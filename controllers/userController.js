const User = require("../models/User");

exports.registerUser = async (req, res) => {
  try {
    const { username, password, email, phone, lineUserId, plan, paymentNote } = req.body;

    // ตรวจสอบว่ามี user ซ้ำหรือไม่
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = new User({
      username,
      password,
      email,
      phone,
      lineUserId,
      plan: plan || "free",
      paymentNote,
      paymentStatus: plan && plan !== "free" ? "pending_review" : "free"
    });
    await newUser.save();

    res.status(201).json({
      message: "User registered successfully",
      userId: newUser._id,
      plan: newUser.plan,
      paymentStatus: newUser.paymentStatus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
