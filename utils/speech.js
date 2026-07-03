const ai = require('./ai');

async function createSpeechDraft(eventName) {
  const name = String(eventName || '').trim();

  if (!name) {
    throw new Error('Event name is required');
  }

  const prompt = [
    `เขียนคำกล่าวภาษาไทยสำหรับพิธี "${name}"`,
    'ให้เป็นคำกล่าวระดับมืออาชีพ ภาษาสละสลวย สุภาพ มีจังหวะการพูดที่ดี',
    'ห้ามใช้ภาษาหยาบ ห้ามใช้โครงเทมเพลตแข็งๆ ห้ามเขียนแบบกว้างจนไม่มีน้ำหนัก',
    'ให้มีคำขึ้นต้น คำกล่าวเปิด ประเด็นคุณค่าของงาน คำขอบคุณ และคำลงท้าย',
    'ความยาวประมาณ 6-9 ย่อหน้า อ่านบนเวทีได้จริง',
    'ถ้าไม่มีข้อมูลเฉพาะ ให้เขียนแบบเป็นกลางและมีศักดิ์ศรี'
  ].join('\n');

  return ai.generateText(prompt, {
    history: [],
    systemPrompt: 'You are a senior Thai speechwriter. Write polished, professional Thai ceremonial speeches with graceful language and no generic filler.'
  });
}

module.exports = { createSpeechDraft };
