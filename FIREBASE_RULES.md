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


## เช็คลิสต์ก่อนขยายเกมใหม่ (Firestore Rules)
สำหรับเกมที่มีข้อมูลลับต่อผู้เล่น (เช่น role/action)
ให้ใช้ pattern เดียวกับ Secret Village:

- ข้อมูลสาธารณะ: `/duel_rooms/{roomId}`
- ข้อมูลลับรายคน: `/duel_rooms/{roomId}/private_players/{userId}`
- Rule หลัก: อนุญาตเฉพาะ `request.auth.uid == userId` ใน private path

แนวทางนี้ทำให้โค้ดฝั่งหน้าเว็บรองรับเกมอนาคตได้ง่าย:
1. อ่านสถานะรวมจาก document ห้อง (public)
2. อ่านข้อมูลลับจากเอกสารของตัวเองเท่านั้น (private)
3. ไม่ต้องเปิดสิทธิ์อ่าน private ของผู้เล่นอื่น
