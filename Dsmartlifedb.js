const mongoose = require('mongoose');
require('dotenv').config();
const { configureMongoDns } = require('./utils/mongoDns');

configureMongoDns();
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/smartlife", {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to SmartLife DB (Atlas)"))
.catch(err => console.error("❌ Connection error:", err));

module.exports = mongoose;
