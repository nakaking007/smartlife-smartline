function classifyAlert(text) {
  const value = (text || "").toLowerCase();

  if (hasAny(value, ["tsunami", "สึนามิ"])) {
    return { type: "tsunami", severity: "critical" };
  }

  if (hasAny(value, ["earthquake", "แผ่นดินไหว"])) {
    return { type: "earthquake", severity: hasAny(value, ["m6", "m7", "รุนแรง"]) ? "critical" : "warning" };
  }

  if (hasAny(value, ["pm2.5", "pm 2.5", "ฝุ่น", "air quality"])) {
    return { type: "pm25", severity: "warning" };
  }

  if (hasAny(value, ["heavy rain", "ฝนตกหนัก", "ฝนหนัก"])) {
    return { type: "heavy_rain", severity: "warning" };
  }

  if (hasAny(value, ["storm", "พายุ", "typhoon", "ไต้ฝุ่น"])) {
    return { type: hasAny(value, ["typhoon", "ไต้ฝุ่น"]) ? "typhoon" : "storm", severity: "warning" };
  }

  if (hasAny(value, ["flood", "น้ำท่วม", "น้ำหลาก"])) {
    return { type: "flood", severity: "warning" };
  }

  if (hasAny(value, ["heat", "อากาศร้อน", "ร้อนจัด"])) {
    return { type: "heat", severity: "warning" };
  }

  if (hasAny(value, ["cold", "อากาศหนาว", "หนาวจัด"])) {
    return { type: "cold", severity: "warning" };
  }

  if (hasAny(value, ["traffic", "จราจร", "รถติด"])) {
    return { type: "traffic", severity: "watch" };
  }

  if (hasAny(value, ["crime", "shooting", "กราดยิง", "เหตุร้าย"])) {
    return { type: "crime", severity: "critical" };
  }

  return { type: "other", severity: "info" };
}

function hasAny(value, keywords) {
  return keywords.some((keyword) => value.includes(keyword));
}

module.exports = {
  classifyAlert
};
