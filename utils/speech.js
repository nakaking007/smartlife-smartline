const ai = require('./ai');

function buildFallbackSpeech(eventName) {
  const name = String(eventName || '').trim();

  return [
    `คำกล่าวสำหรับพิธี${name}`,
    '',
    'เรียน ท่านประธานในพิธี ท่านผู้มีเกียรติ และผู้เข้าร่วมงานทุกท่าน',
    '',
    `ในโอกาสพิธี${name}วันนี้ กระผม/ดิฉันขอแสดงความยินดีและขอบคุณทุกท่านที่ให้เกียรติมาร่วมงานอันมีความหมายยิ่งนี้`,
    '',
    'งานครั้งนี้สะท้อนถึงความตั้งใจ ความร่วมมือ และความรับผิดชอบของทุกฝ่ายที่ร่วมกันผลักดันให้เกิดผลสำเร็จอย่างเป็นรูปธรรม',
    '',
    'ขอขอบคุณคณะผู้จัดงาน ผู้สนับสนุน และผู้เกี่ยวข้องทุกท่านที่ทุ่มเทแรงกายแรงใจด้วยความมุ่งมั่น',
    '',
    `ขอให้พิธี${name}ดำเนินไปด้วยความเรียบร้อย ก่อให้เกิดประโยชน์สูงสุด และเป็นจุดเริ่มต้นของความสำเร็จที่งดงามต่อไป`,
    '',
    'ขอบคุณครับ/ค่ะ'
  ].join('\n');
}

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

  try {
    return await ai.generateText(prompt, {
      history: [],
      systemPrompt: 'You are a senior Thai speechwriter. Write polished, professional Thai ceremonial speeches with graceful language and no generic filler.'
    });
  } catch (err) {
    return buildFallbackSpeech(name);
  }
}

module.exports = { createSpeechDraft };
