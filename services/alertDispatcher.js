const User = require("../models/user");
const { isUserInAlertArea } = require("./geo");
const { pushLineMessage } = require("./line");
const { alertMessage } = require("./messages");

async function dispatchAlert(alert) {
  const users = await User.find({
    active: true,
    "alertPreferences.disaster": true,
    lineUserId: { $exists: true, $ne: "" }
  });
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of users) {
    if (!isUserInAlertArea(user, alert)) {
      skipped += 1;
      continue;
    }

    try {
      await pushLineMessage(user.lineUserId, alertMessage(alert));
      alert.sentTo.push(user._id);
      sent += 1;
    } catch (error) {
      console.error(`Failed to dispatch alert to ${user.lineUserId}:`, error.message);
      failed += 1;
    }
  }

  await alert.save();
  return { sent, skipped, failed };
}

module.exports = {
  dispatchAlert
};
