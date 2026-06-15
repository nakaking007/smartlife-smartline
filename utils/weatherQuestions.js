// utils/weatherQuestions.js
const weather = require('./weather');
const { formatBangkokDateTime } = require('./time');
const assessment = require('./riskAssessment');

function formatValue(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return 'ยังไม่มีข้อมูล';
  }

  return `${value}${suffix}`;
}

function isWeatherQuestion(text) {
  return /ฝน|อุณหภูมิ|ฝุ่น|pm2\.?5|หนาว|ร้อน|หน้ากาก|แมส|mask/i.test(text);
}

async function answerWeatherQuestion(text) {
  let report;

  try {
    report = await weather.getReport();
  } catch (err) {
    return [
      "เรียน นายท่าน",
      "",
      "ตอนนี้ระบบยังดึงข้อมูลอากาศจริงไม่ได้ค่ะ",
      `สาเหตุ: ${err.message}`,
      "ดิฉันจะไม่เดาค่าอากาศแทนข้อมูลจริงนะคะ"
    ].join("\n");
  }

  const normalized = String(text || '').trim().toLowerCase();
  const answers = [];

  if (/ฝน/.test(normalized)) {
    if (report.rainChance !== null && report.rainChance !== undefined) {
      answers.push(`โอกาสฝนในช่วง 12 ชั่วโมงข้างหน้าประมาณ ${report.rainChance}% ระดับ${report.rainChanceAssessment.level}ค่ะ`);
    }

    if (report.rainMm1h > 0) {
      answers.push(`ฝนล่าสุด: พบฝนใน 1 ชั่วโมงที่ผ่านมา ปริมาณประมาณ ${report.rainMm1h} มม. ระดับ${report.rainAmountAssessment.level}`);
    } else {
      answers.push("ฝนล่าสุด: ยังไม่พบฝนใน 1 ชั่วโมงที่ผ่านมา ระบบไม่มีข้อมูลย้อนหลังพอจะระบุได้ว่าฝนหยุดมากี่ชั่วโมงแล้วค่ะ");
    }

    if (report.nextRainAt) {
      answers.push(`คาดฝนถัดไป: ${assessment.formatHours(report.nextRainInHours)} โอกาส ${formatValue(report.nextRainChance, '%')} ปริมาณคาดการณ์รอบ 3 ชม. ประมาณ ${formatValue(report.nextRainMm3h, ' มม.')} ระดับ${report.nextRainAssessment.level}`);
    } else {
      answers.push("คาดฝนถัดไป: ยังไม่พบสัญญาณฝนในข้อมูล forecast รอบถัดไปค่ะ");
    }
  }

  if (/อุณหภูมิ|สูงสุด/.test(normalized)) {
    answers.push(`วันนี้อุณหภูมิสูงสุดประมาณ ${formatValue(report.tempMax, '°C')} ระดับ${report.tempAssessment.level}ค่ะ`);
    if (report.heatIndex !== null && report.heatIndex !== undefined && report.heatIndexAssessment) {
      answers.push(`ดัชนีความร้อนประมาณ ${report.heatIndex}°C ระดับ${report.heatIndexAssessment.level}`);
    }
  }

  if (/ฝุ่น|pm2\.?5|หน้ากาก|แมส|mask/.test(normalized)) {
    const pm25Assessment = report.pm25Assessment;
    answers.push(`วันนี้ฝุ่น PM2.5 อยู่ที่ ${formatValue(report.pm25, ' µg/m³')} ระดับ${pm25Assessment.level}ค่ะ`);
    answers.push(`คำแนะนำหน้ากาก: ${pm25Assessment.maskAdvice}`);
  }

  if (/หนาว/.test(normalized)) {
    if (report.temp !== null && report.temp < 20) {
      answers.push(`วันนี้อากาศค่อนข้างหนาว อุณหภูมิประมาณ ${report.temp}°C ค่ะ แนะนำให้ใส่เสื้อกันหนาวนะคะ`);
    } else {
      answers.push(`วันนี้ยังไม่ถือว่าหนาวค่ะ อุณหภูมิปัจจุบันประมาณ ${formatValue(report.temp, '°C')}`);
    }
  }

  if (/ร้อน/.test(normalized)) {
    if (report.tempMax !== null && report.tempMax >= 33) {
      answers.push(`วันนี้อากาศ${report.tempAssessment.level}ค่ะ อุณหภูมิสูงสุดประมาณ ${report.tempMax}°C ${report.tempAssessment.advice}`);
    } else {
      answers.push(`วันนี้อากาศยังไม่ร้อนจัดค่ะ อุณหภูมิสูงสุดประมาณ ${formatValue(report.tempMax, '°C')}`);
    }
  }

  if (answers.length === 0) {
    answers.push(`วันนี้อุณหภูมิสูงสุดประมาณ ${formatValue(report.tempMax, '°C')} ระดับ${report.tempAssessment.level}`);
    answers.push(`โอกาสฝน ${formatValue(report.rainChance, '%')} ระดับ${report.rainChanceAssessment.level}`);
    answers.push(`PM2.5 ${formatValue(report.pm25, ' µg/m³')} ระดับ${report.pm25Assessment.level}`);
  }

  return [
    "เรียน นายท่าน",
    "",
    ...answers,
    "",
    `ข้อมูลจาก ${report.source || 'แหล่งข้อมูลอากาศ'} เวลา ${formatBangkokDateTime(report.observedAt)}`
  ].join("\n");
}

module.exports = {
  answerWeatherQuestion,
  isWeatherQuestion
};
