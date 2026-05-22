# ขั้นตอน Deploy SmartLife SmartLine ขึ้น Render

เป้าหมาย: ทำให้ LINE Bot ออนไลน์ตลอด 24 ชั่วโมง แม้ปิดโน้ตบุ๊ก

## ก่อนเริ่ม

ห้ามนำไฟล์ `.env` ที่มีรหัสจริงขึ้นที่สาธารณะ ให้ใช้ `.env.example` เป็นตัวอย่างเท่านั้น

ข้อมูลที่ต้องเตรียม:

- MongoDB URI
- LINE Channel Secret
- LINE Channel Access Token
- ชื่อ URL ที่จะใช้บน Render
- Admin API Key ที่ตั้งเอง

## ขั้นตอนที่ 1: อัปโหลดโค้ดขึ้น GitHub

1. สร้าง repository ใหม่ เช่น `smartlife-smartline`
2. อัปโหลดไฟล์โปรเจกต์ทั้งหมด
3. อย่าอัปโหลดไฟล์ `.env`
4. ตรวจว่า `.gitignore` มี `.env` แล้ว

## ขั้นตอนที่ 2: สร้าง Web Service บน Render

1. เข้า Render
2. เลือก New Web Service
3. เชื่อม GitHub repository `smartlife-smartline`
4. ตั้งค่า:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /health
```

ถ้าใช้ `render.yaml` ระบบจะอ่านค่าพื้นฐานให้บางส่วน

## ขั้นตอนที่ 3: ใส่ Environment Variables

ใส่ค่าต่อไปนี้ใน Render:

```text
APP_TIMEZONE=Asia/Bangkok
MONGODB_URI=ค่าจริงจาก MongoDB Atlas
LINE_CHANNEL_SECRET=ค่าจริงจาก LINE Developers
LINE_CHANNEL_ACCESS_TOKEN=ค่าจริงจาก LINE Developers
LINE_SKIP_SIGNATURE_VERIFY=false
PUBLIC_BASE_URL=https://ชื่อระบบจริง.onrender.com
ADMIN_API_KEY=ตั้งรหัสลับผู้ดูแล
ALERT_INGEST_API_KEY=ตั้งรหัสลับรับข้อมูลแจ้งเตือน
ENABLE_USGS_EARTHQUAKE_ALERTS=true
```

## ขั้นตอนที่ 4: Deploy

1. กด Deploy
2. รอ build สำเร็จ
3. เปิด URL:

```text
https://ชื่อระบบจริง.onrender.com/health
```

ต้องเห็นประมาณนี้:

```json
{
  "status": "ok",
  "database": "connected",
  "lineConfigured": true
}
```

## ขั้นตอนที่ 5: เปลี่ยน Webhook ใน LINE Developers

เข้า LINE Developers แล้วตั้ง:

```text
Webhook URL = https://ชื่อระบบจริง.onrender.com/webhooks/line
```

จากนั้น:

1. กด Verify
2. เปิด Use webhook
3. ทดสอบพิมพ์ `คำสั่ง`
4. ทดสอบพิมพ์ `ฟอร์มนัด`
5. ทดสอบพิมพ์ `พรุ่งนี้`

## ขั้นตอนที่ 6: ตรวจภาษาไทย

ทดสอบคำสั่ง:

```text
แพ็กเกจ
คำสั่ง
คู่มือ
```

ถ้าข้อความไทยอ่านปกติ แสดงว่า deploy สำเร็จและ encoding ถูกต้อง

## สรุป

หลัง deploy สำเร็จและ LINE Webhook เปลี่ยนเป็น URL ถาวรแล้ว ผู้ใช้จะใช้งานได้แม้ปิดโน้ตบุ๊ก

