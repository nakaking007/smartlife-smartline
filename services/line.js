const crypto = require("crypto");
const axios = require("axios");

const LINE_API_BASE_URL = "https://api.line.me/v2/bot";

function verifyLineSignature(rawBody, signature) {
  if (process.env.LINE_SKIP_SIGNATURE_VERIFY === "true") {
    return true;
  }

  const secret = process.env.LINE_CHANNEL_SECRET;

  if (!secret) {
    return true;
  }

  const hash = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return hash === signature;
}

async function pushLineMessage(to, messages) {
  return sendLineRequest("/message/push", {
    to,
    messages: normalizeMessages(messages)
  });
}

async function replyLineMessage(replyToken, messages) {
  const result = await sendLineRequest("/message/reply", {
    replyToken,
    messages: normalizeMessages(messages)
  });
  console.log("LINE reply sent");
  return result;
}

async function sendLineRequest(path, body) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token || token === "replace_with_channel_access_token") {
    console.log("[LINE skipped]", JSON.stringify(body));
    return { skipped: true };
  }

  const response = await axios.post(`${LINE_API_BASE_URL}${path}`, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

function textMessage(text) {
  return {
    type: "text",
    text: text.slice(0, 5000)
  };
}

function normalizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [messages];

  return list.map((message) => {
    if (typeof message === "string") {
      return textMessage(message);
    }

    return message;
  });
}

module.exports = {
  pushLineMessage,
  replyLineMessage,
  textMessage,
  verifyLineSignature
};
