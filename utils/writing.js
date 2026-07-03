const ai = require('./ai');

async function createArticle(topic) {
  const subject = String(topic || '').trim();
  if (!subject) {
    throw new Error('กรุณาระบุหัวข้อบทความ');
  }

  return ai.generateText([
    `เขียนบทความภาษาไทยเรื่อง "${subject}"`,
    'ตั้งชื่อเรื่องที่ชัดเจนและน่าอ่าน',
    'เขียนอย่างมืออาชีพ มีบทนำ เนื้อหาที่มีเหตุผล ตัวอย่างหรือมุมมองที่เป็นประโยชน์ และบทสรุป',
    'ใช้ภาษาสละสลวยเป็นธรรมชาติ ไม่ใช้ประโยคสำเร็จรูป ไม่เขียนวนซ้ำ และไม่แต่งข้อเท็จจริงที่ตรวจสอบไม่ได้',
    'จัดย่อหน้าให้อ่านง่าย ความยาวประมาณ 700-1,000 คำ',
    'ตอบเป็นบทความพร้อมใช้เท่านั้น'
  ].join('\n'), {
    history: [],
    systemPrompt: 'You are a senior Thai editor and feature writer. Produce original, polished Thai prose with strong structure, precise reasoning, and no generic template filler.'
  });
}

module.exports = { createArticle };
