function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatHours(hours) {
  if (hours === null || hours === undefined) return 'ยังไม่มีข้อมูล';
  if (hours < 1) return 'ภายใน 1 ชั่วโมง';
  return `อีกประมาณ ${Math.round(hours)} ชั่วโมง`;
}

function assessTemperature(tempC) {
  const value = toNumber(tempC);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', advice: 'ยังประเมินอุณหภูมิไม่ได้' };
  if (value < 20) return { level: 'เย็น', advice: 'อากาศเย็นกว่าปกติ เตรียมเสื้อคลุมได้' };
  if (value < 33) return { level: 'ปกติ', advice: 'โดยรวมยังไม่ร้อนจัด' };
  if (value < 37) return { level: 'ร้อน', advice: 'ดื่มน้ำและเลี่ยงแดดนานๆ' };
  if (value < 40) return { level: 'ร้อนมาก', advice: 'ลดกิจกรรมกลางแดดและเฝ้าดูอาการอ่อนเพลีย' };
  return { level: 'ร้อนจัด', advice: 'ควรลดกิจกรรมกลางแจ้งช่วงแดดแรง' };
}

function calculateHeatIndex(tempC, humidity) {
  const temp = toNumber(tempC);
  const rh = toNumber(humidity);
  if (temp === null || rh === null || temp < 27) return null;

  const fahrenheit = temp * 9 / 5 + 32;
  const heatIndexF =
    -42.379 +
    2.04901523 * fahrenheit +
    10.14333127 * rh -
    0.22475541 * fahrenheit * rh -
    0.00683783 * fahrenheit * fahrenheit -
    0.05481717 * rh * rh +
    0.00122874 * fahrenheit * fahrenheit * rh +
    0.00085282 * fahrenheit * rh * rh -
    0.00000199 * fahrenheit * fahrenheit * rh * rh;

  return Math.round(((heatIndexF - 32) * 5 / 9) * 10) / 10;
}

function assessHeatIndex(heatIndexC) {
  const value = toNumber(heatIndexC);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', advice: 'ยังประเมินดัชนีความร้อนไม่ได้' };
  if (value < 32) return { level: 'ปกติ', advice: 'ยังไม่ใช่ช่วงร้อนเสี่ยงสูง' };
  if (value < 41) return { level: 'ร้อน', advice: 'พักเป็นช่วงและดื่มน้ำให้พอ' };
  if (value < 54) return { level: 'อันตรายจากความร้อน', advice: 'ลดงานกลางแจ้งหนักและเฝ้าดูอาการหน้ามืด' };
  return { level: 'อันตรายมากจากความร้อน', advice: 'ควรหลีกเลี่ยงกิจกรรมหนักกลางแดด' };
}

function assessRainChance(percent) {
  const value = toNumber(percent);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', advice: 'ยังประเมินโอกาสฝนไม่ได้' };
  if (value < 10) return { level: 'แทบไม่ตก', advice: 'โอกาสฝนน้อยมาก' };
  if (value < 30) return { level: 'โอกาสน้อย', advice: 'อาจมีฝนเฉพาะบางพื้นที่' };
  if (value < 60) return { level: 'มีโอกาสตก', advice: 'เตรียมร่มหากต้องเดินทางไกล' };
  if (value < 80) return { level: 'โอกาสมาก', advice: 'ควรเผื่อเวลาเดินทางและเตรียมร่ม' };
  return { level: 'โอกาสสูงมาก', advice: 'มีแนวโน้มฝนสูง ควรวางแผนเดินทาง' };
}

function assessRainAmount(mm, periodLabel = 'ช่วงที่รายงาน') {
  const value = toNumber(mm);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', advice: `ยังประเมินปริมาณฝน${periodLabel}ไม่ได้` };
  if (value <= 0) return { level: 'ไม่พบฝน', advice: `ยังไม่พบฝนใน${periodLabel}` };
  if (value < 2.5) return { level: 'ฝนเล็กน้อย', advice: `ฝนน้อยใน${periodLabel}` };
  if (value < 10) return { level: 'ฝนเบาถึงปานกลาง', advice: `พื้นถนนอาจเปียกใน${periodLabel}` };
  if (value < 35) return { level: 'ฝนหนัก', advice: `ฝนค่อนข้างมากใน${periodLabel}` };
  return { level: 'ฝนหนักมาก', advice: `ฝนมากใน${periodLabel}` };
}

function assessPm25(pm25) {
  const value = toNumber(pm25);
  if (value === null) {
    return { level: 'ยังไม่มีข้อมูล', advice: 'ยังประเมินฝุ่นไม่ได้', maskAdvice: 'ยังไม่มีคำแนะนำจากข้อมูลจริง' };
  }
  if (value <= 15) {
    return { level: 'ดี/น้อย', advice: 'คุณภาพอากาศโดยรวมดี', maskAdvice: 'คนทั่วไปยังไม่จำเป็นต้องสวมหน้ากากกันฝุ่น' };
  }
  if (value <= 25) {
    return { level: 'ปานกลาง', advice: 'ยังพอใช้ได้ แต่ผู้ไวต่อฝุ่นควรสังเกตอาการ', maskAdvice: 'กลุ่มเสี่ยงอาจสวมหน้ากากเมื่ออยู่นอกอาคารนาน' };
  }
  if (value <= 37.5) {
    return { level: 'เริ่มสูง', advice: 'เริ่มมีผลกระทบต่อผู้ไวต่อฝุ่น', maskAdvice: 'กลุ่มเสี่ยงควรสวมหน้ากากกันฝุ่นเมื่ออยู่กลางแจ้ง' };
  }
  if (value <= 75) {
    return { level: 'สูง/อันตรายต่อสุขภาพบางกลุ่ม', advice: 'ลดเวลานอกอาคาร โดยเฉพาะริมถนนหรือพื้นที่ควันมาก', maskAdvice: 'ควรสวมหน้ากากกันฝุ่น เช่น N95/KN95 เมื่อต้องอยู่กลางแจ้ง' };
  }
  if (value <= 150) {
    return { level: 'สูงมาก/อันตราย', advice: 'ควรลดกิจกรรมกลางแจ้งและเฝ้าดูอาการ', maskAdvice: 'ควรสวม N95/KN95 เมื่อออกนอกอาคาร' };
  }
  return { level: 'วิกฤติ', advice: 'ควรลดการออกนอกอาคารเท่าที่ทำได้', maskAdvice: 'ควรสวม N95/KN95 หากจำเป็นต้องออกนอกอาคาร' };
}

function assessEarthquakeMagnitude(magnitude) {
  const value = toNumber(magnitude);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', description: 'ยังไม่มีขนาดแผ่นดินไหว' };
  if (value < 3) return { level: 'เล็กมาก', description: 'ส่วนใหญ่มักไม่รู้สึก' };
  if (value < 4) return { level: 'เล็ก', description: 'บางพื้นที่ใกล้ศูนย์กลางอาจรู้สึกได้' };
  if (value < 5) return { level: 'ปานกลางค่อนไปทางเบา', description: 'มักรู้สึกได้ใกล้ศูนย์กลาง' };
  if (value < 6) return { level: 'ปานกลาง', description: 'อาจรู้สึกชัดในพื้นที่ใกล้ศูนย์กลาง' };
  if (value < 7) return { level: 'รุนแรง', description: 'สั่นสะเทือนชัดเป็นบริเวณกว้าง' };
  if (value < 8) return { level: 'รุนแรงมาก', description: 'มีพลังงานสูงและรับรู้ได้กว้าง' };
  return { level: 'รุนแรงยิ่ง', description: 'เป็นแผ่นดินไหวขนาดใหญ่มาก' };
}

function assessStormWind(windKph) {
  const value = toNumber(windKph);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', description: 'ยังไม่มีความเร็วลม' };
  if (value < 39) return { level: 'หย่อม/ลมแรงต่ำ', description: 'ยังต่ำกว่าระดับพายุดีเปรสชันเขตร้อน' };
  if (value < 63) return { level: 'ดีเปรสชัน', description: 'ลมแรงระดับต้นของพายุเขตร้อน' };
  if (value < 89) return { level: 'พายุโซนร้อน', description: 'ลมแรงและอาจมีฝนต่อเนื่อง' };
  if (value < 118) return { level: 'พายุโซนร้อนกำลังแรง', description: 'ลมแรงมากขึ้นและฝนอาจมาก' };
  if (value < 184) return { level: 'ไต้ฝุ่น', description: 'พายุรุนแรงระดับไต้ฝุ่น' };
  return { level: 'ไต้ฝุ่นกำลังแรงมาก', description: 'ลมรุนแรงมากในพื้นที่ที่รายงาน' };
}

function assessTsunamiWave(waveHeightMeters) {
  const value = toNumber(waveHeightMeters);
  if (value === null) return { level: 'ยังไม่มีข้อมูล', description: 'ยังไม่มีความสูงคลื่น' };
  if (value < 0.2) return { level: 'ต่ำมาก', description: 'ระดับน้ำเปลี่ยนแปลงเล็กน้อย' };
  if (value < 0.5) return { level: 'ต่ำ', description: 'คลื่นต่ำตามรายงาน' };
  if (value < 1) return { level: 'ปานกลาง', description: 'ระดับน้ำเปลี่ยนแปลงชัดขึ้นในพื้นที่ชายฝั่ง' };
  if (value < 3) return { level: 'สูง/รุนแรง', description: 'คลื่นสูงตามรายงานในพื้นที่ชายฝั่ง' };
  return { level: 'สูงมาก/รุนแรงมาก', description: 'คลื่นสูงมากตามรายงาน' };
}

function describeAsiaRegion(data = {}) {
  const text = [
    data.areaText,
    data.areaName,
    data.locationName,
    data.place,
    data.region,
    data.title,
    data.country
  ].filter(Boolean).join(' ');
  const lower = text.toLowerCase();

  if (/thailand|myanmar|burma|laos|cambodia|vietnam|malaysia|singapore|indonesia|philippines|brunei|asean|sumatra|java|sulawesi|bali|luzon|mindanao|ไทย|เมียนมา|พม่า|ลาว|กัมพูชา|เวียดนาม|มาเลเซีย|สิงคโปร์|อินโดนีเซีย|ฟิลิปปินส์|บรูไน|อาเซียน/.test(lower)) {
    return 'เอเชียตะวันออกเฉียงใต้';
  }
  if (/japan|china|taiwan|korea|mongolia|ญี่ปุ่น|จีน|ไต้หวัน|เกาหลี|มองโกเลีย/.test(lower)) {
    return 'เอเชียตะวันออก';
  }
  if (/india|sri lanka|bangladesh|nepal|pakistan|maldives|อินเดีย|ศรีลังกา|บังกลาเทศ|เนปาล|ปากีสถาน|มัลดีฟส์/.test(lower)) {
    return 'เอเชียใต้';
  }
  if (/iran|iraq|turkey|saudi|oman|yemen|uae|qatar|kuwait|อิหร่าน|อิรัก|ตุรกี|ซาอุดี|โอมาน|เยเมน|กาตาร์|คูเวต/.test(lower)) {
    return 'เอเชียตะวันตก';
  }

  const lat = toNumber(data.latitude || data.lat);
  const lon = toNumber(data.longitude || data.lon || data.lng);
  if (lat !== null && lon !== null) {
    if (lat >= -11 && lat <= 29 && lon >= 92 && lon <= 142) return 'เอเชียตะวันออกเฉียงใต้';
    if (lat >= 15 && lat <= 55 && lon >= 73 && lon <= 146) return 'เอเชียตะวันออก';
    if (lat >= 0 && lat <= 38 && lon >= 60 && lon <= 98) return 'เอเชียใต้';
    if (lat >= 12 && lat <= 43 && lon >= 26 && lon <= 63) return 'เอเชียตะวันตก';
    if (lat >= 35 && lat <= 56 && lon >= 46 && lon <= 88) return 'เอเชียกลาง';
  }

  return 'ยังระบุส่วนของเอเชียไม่ได้จากข้อมูลที่มี';
}

module.exports = {
  assessTemperature,
  calculateHeatIndex,
  assessHeatIndex,
  assessRainChance,
  assessRainAmount,
  assessPm25,
  assessEarthquakeMagnitude,
  assessStormWind,
  assessTsunamiWave,
  describeAsiaRegion,
  formatHours
};
