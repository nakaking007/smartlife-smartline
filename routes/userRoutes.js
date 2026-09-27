const express = require("express");
const { registerUser } = require("../controllers/userController");
const { requireLineUser } = require('../middleware/lineAuth');
const router = express.Router();

router.post("/register", requireLineUser, registerUser);

module.exports = router;
