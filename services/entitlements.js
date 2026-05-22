function hasActivePlan(user, minimumPlan = "basic") {
  if (!user) return false;
  if (user.paymentStatus !== "paid") return false;
  if (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) < new Date()) return false;

  return planRank(user.plan) >= planRank(minimumPlan);
}

function planRank(plan) {
  return {
    free: 0,
    basic: 1,
    premium: 2
  }[plan] || 0;
}

function planLabel(plan) {
  return {
    free: "Free",
    basic: "Basic 50 บาท",
    premium: "Premium 100 บาท"
  }[plan] || "Free";
}

function lockedMessage(minimumPlan = "basic") {
  return [
    "ฟีเจอร์นี้ยังไม่ได้ปลดล็อก",
    `ต้องใช้แพ็กเกจ ${planLabel(minimumPlan)} ขึ้นไป`,
    "กรุณาโอนเงินผ่านพร้อมเพย์ 095-525-5901 แล้วส่งสลิปไปที่ LINE ID: charnb015 เพื่อให้ผู้ดูแลเปิดสิทธิ์ใช้งาน"
  ].join("\n");
}

module.exports = {
  hasActivePlan,
  lockedMessage,
  planLabel,
  planRank
};
