// utils/tasks.js
const Task = require('../models');

async function getToday() {
  const today = new Date();
  const start = new Date(today.setHours(0,0,0,0));
  const end = new Date(today.setHours(23,59,59,999));
  return Task.find({ date: { $gte: start, $lte: end } });
}

module.exports = { getToday };
