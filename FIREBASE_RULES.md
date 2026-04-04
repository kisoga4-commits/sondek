# แนวทางแก้ `permission_denied` ของ Duel Mode (อัปเดต)

## ทำไมยังเจอ `permission_denied`
สาเหตุที่เจอบ่อยในระบบนี้มี 4 ข้อ:

1. **ยังไม่ได้เปิด Anonymous Auth**
   - ฝั่งเว็บใช้ `signInAnonymously()` ก่อนอ่าน/เขียน Firebase
   - ถ้า Anonymous ปิดอยู่ จะเขียน RTDB ไม่ได้ทันที

2. **Deploy ผิด Rules (Firestore อย่างเดียว แต่ Duel ใช้ RTDB)**
   - Duel ใช้ **Realtime Database** เป็นหลักที่ path `rooms/{roomId}`
   - ถ้า publish แค่ `firestore.rules` จะไม่ช่วยอาการดวล

3. **Path ใน Rules ไม่ตรงกับโค้ดจริง**
   - โค้ดฝั่งเว็บเขียนที่ `rooms/{roomId}`
   - แต่บางโปรเจกต์ตั้ง rules ไว้ที่ `duel_rooms/{roomId}` อย่างเดียว ทำให้โดนปฏิเสธสิทธิ์

4. **Validation เข้มเกินไป/ล็อก schema ตายตัวเกิน**
   - ถ้ากติกา `.validate` บังคับรูปแบบไม่ตรง payload ที่เกมเขียนจริง (เช่น transaction update รอบเกม)
   - RTDB จะตอบกลับ `permission_denied`

---

## สรุปสั้น ๆ ว่าต้องแก้อะไร
1. เปิด `Firebase Console > Authentication > Sign-in method > Anonymous` เป็น **Enabled**
2. ใช้ไฟล์ `database.rules.json` ใน repo นี้ (รองรับทั้ง `rooms` และ `duel_rooms`)
3. Deploy RTDB rules:

```bash
firebase deploy --only database
```

4. ทดสอบใหม่โดยสร้างห้องใหม่บน `duel.html`

---

## หมายเหตุเรื่อง Firestore
- `firestore.rules` ยังจำเป็นสำหรับระบบคอร์ส/ข้อสอบ/โปรไฟล์/ลีดเดอร์บอร์ด
- แต่ error `permission_denied` ของ Duel เกือบทั้งหมดจะชี้ไปที่ **RTDB Rules + Auth**

---

## ถ้ายังไม่หายหลัง deploy
1. ไปที่ `Realtime Database > Data`
2. ลบ node `rooms` (และ `duel_rooms` ถ้ามีของเก่าค้าง)
3. รีเฟรชหน้าและสร้างห้องใหม่

> การลบ node จะเคลียร์ห้องที่กำลังรอ/กำลังเล่นทั้งหมด
