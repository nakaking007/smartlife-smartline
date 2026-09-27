const User = require("../models/User");
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

exports.registerUser = async (req, res) => {
  try {
    const { username, password, email, phone, plan, paymentNote } = req.body;
    if (!username || !password || !email) return res.status(400).json({ message: 'กรุณากรอกชื่อ อีเมล และรหัสผ่านให้ครบ' });

    // ตรวจสอบว่ามี user ซ้ำหรือไม่
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    const newUser = new User({
      username,
      password: hashPassword(password),
      email,
      phone,
      lineUserId: req.lineUserId,
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
