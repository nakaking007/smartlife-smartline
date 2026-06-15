// models.js
const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: String,
  date: Date,
  owner: String
});

module.exports = mongoose.model('Task', taskSchema);
