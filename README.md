# SmartLife Scheduler & Alert

LINE-first MVP สำหรับระบบนัดหมายและแจ้งเตือนภัยอัตโนมัติ

## เป้าหมาย

ผู้ใช้เพิ่มเพื่อน LINE Official Account แล้วใช้งานผ่าน LINE ได้ทันที:

- สมัครสมาชิก
- ส่งพิกัดเพื่อรับแจ้งเตือนตามพื้นที่
- ตั้งนัดหมายและกำหนดเวลาเตือนล่วงหน้า เช่น 1 วัน หรือ 1 ชั่วโมง
- รับ Google Maps link ของสถานที่
- พิมพ์คำถามหรือคำสั่ง เช่น `คู่มือ`, `วันนี้`, `แพ็กเกจ`
- ขอให้ช่วยร่างคำกล่าวหรือสุนทรพจน์
- รับแจ้งเตือนภัยจากระบบโดยอัตโนมัติเมื่อมีข้อมูลเข้ามา

หมายเหตุ: LINE Notify ยุติบริการแล้วตั้งแต่ 31 มีนาคม 2025 ระบบนี้จึงใช้ LINE Official Account + LINE Messaging API

## Setup

```bash
npm install
copy .env.example .env
npm run check:config
npm run dev
```

ต้องมี MongoDB รันอยู่ที่ `mongodb://127.0.0.1:27017/smartlife` หรือแก้ค่า `MONGODB_URI` ใน `.env`

สำหรับ MongoDB Atlas ให้ใช้ผู้ใช้ระดับแอป เช่น `smartlifeUser` ที่มีสิทธิ์ `readWrite` บนฐานข้อมูล `smartlife`

```bash
MONGODB_URI=mongodb+srv://smartlifeUser:<password>@<cluster-url>/smartlife?retryWrites=true&w=majority
```

ไม่ควรใส่รหัสผ่านจริงลงในไฟล์ตัวอย่างหรือ commit ขึ้น Git

ถ้า MongoDB เปิด auth ไว้ ต้องตั้ง `MONGODB_URI` ให้มี username/password ที่ถูกต้อง เช่น:

```bash
MONGODB_URI=mongodb://smartlifeUser:<password>@127.0.0.1:27017/smartlife?authSource=smartlife
```

## LINE Webhook

ตั้งค่า Webhook URL ใน LINE Developers:

```text
https://your-domain.com/webhooks/line
```

ระหว่างทดสอบด้วย tunnel สามารถตั้งค่า:

```bash
LINE_SKIP_SIGNATURE_VERIFY=true
```

เมื่อ deploy จริงควรปิดค่านี้ หรือเปลี่ยนเป็น `false`

ถ้าทดสอบในเครื่อง ให้ใช้ tunnel เช่น ngrok/cloudflared แล้วนำ URL ไปตั้งใน LINE Developers

## คำสั่งใน LINE

```text
คู่มือ
สมัคร
แพ็กเกจ
พิกัด
วันนี้
ช่วยเขียนคำกล่าว: งานเปิดโครงการ SmartLife
```

ตัวอย่างตั้งนัด:

```text
นัด: ตรวจสุขภาพ | 2026-05-22 09:00 | เตือน 1 วัน | สถานที่ รพ.นนทเวช | เตรียม บัตรประชาชน ผลตรวจเดิม
```

```text
นัด: ประชุมทีม | 2026-05-22 14:00 | เตือน 1 ชั่วโมง | สถานที่ อาคาร A ชั้น 3 | กับ คุณสมชาย
```

## Alert Ingest API

ใช้สำหรับรับข้อมูลภัยจากระบบภายนอกหรือผู้ดูแล แล้วส่ง LINE ไปยังสมาชิกที่อยู่ในพื้นที่

```http
POST /api/alerts
x-api-key: replace_with_private_key
Content-Type: application/json

{
  "type": "heavy_rain",
  "severity": "warning",
  "title": "ฝนตกหนัก",
  "message": "ฝนตกหนักในเขตบางเขน โปรดเตรียมอุปกรณ์กันฝนและหลีกเลี่ยงพื้นที่น้ำท่วมขัง",
  "areaText": "บางเขน กรุงเทพฯ",
  "latitude": 13.8737,
  "longitude": 100.5968,
  "radiusKm": 15,
  "source": "admin"
}
```

## RSS Alert Ingest

ระบบสามารถดึงประกาศจาก RSS/API ภายนอกที่แปลงเป็น RSS ได้ โดยตั้งค่าใน `.env`

```bash
ALERT_RSS_CRON=*/5 * * * *
ALERT_RSS_FEEDS=[{"name":"TMD Warning","source":"กรมอุตุนิยมวิทยา","url":"https://example.com/tmd-warning-rss.xml","limit":5}]
```

สั่งดึงทันที:

```http
POST /api/alerts/poll-rss
x-api-key: replace_with_private_key
```

ระบบจะกันส่งซ้ำจาก `source + externalId` และแปลงคำสำคัญ เช่น `สึนามิ`, `แผ่นดินไหว`, `PM2.5`, `ฝนตกหนัก` เป็นประเภทภัยให้อัตโนมัติ

ประเภทภัยที่รองรับ:

- `earthquake`
- `tsunami`
- `storm`
- `flood`
- `pm25`
- `cold`
- `heat`
- `heavy_rain`
- `traffic`
- `crime`
- `astronomy`
- `dust_storm`
- `typhoon`
- `sinkhole`
- `storm_surge`
- `other`

ตัวอย่างแผ่นดินไหว:

```http
POST /api/alerts
x-api-key: replace_with_private_key
Content-Type: application/json

{
  "type": "earthquake",
  "severity": "warning",
  "title": "แผ่นดินไหว",
  "message": "ตรวจพบแผ่นดินไหวขนาด M5.3 ใกล้ชายฝั่งเมียนมา อาจรู้สึกแรงสั่นในบางพื้นที่",
  "areaText": "ภาคเหนือ กรุงเทพฯ และนนทบุรี",
  "latitude": 16.8661,
  "longitude": 96.1951,
  "radiusKm": 350,
  "source": "กรมอุตุนิยมวิทยา",
  "sourceUrl": "https://www.tmd.go.th"
}
```

ตัวอย่างสึนามิ:

```http
POST /api/alerts
x-api-key: replace_with_private_key
Content-Type: application/json

{
  "type": "tsunami",
  "severity": "critical",
  "title": "เฝ้าระวังสึนามิ",
  "message": "มีประกาศเฝ้าระวังคลื่นสึนามิบริเวณชายฝั่งทะเลอันดามัน",
  "areaText": "ภูเก็ต พังงา กระบี่ ระนอง ตรัง สตูล",
  "latitude": 8.4500,
  "longitude": 98.5200,
  "radiusKm": 300,
  "source": "กรมอุตุนิยมวิทยา / ปภ.",
  "sourceUrl": "https://www.tmd.go.th"
}
```

## โครงสร้างหลัก

```text
models/user.js           สมาชิก LINE และพิกัด
models/appointment.js    นัดหมายและเวลาเตือน
models/alert.js          เหตุภัยพิบัติ/ฉุกเฉิน
routes/lineWebhook.js    รับข้อความจาก LINE
routes/alerts.js         รับเหตุแจ้งเตือนจากแหล่งข้อมูล
services/line.js         ส่งข้อความผ่าน LINE Messaging API
services/messages.js     จัดรูปแบบข้อความ
services/geo.js          ตรวจระยะพื้นที่แจ้งเตือน
```
