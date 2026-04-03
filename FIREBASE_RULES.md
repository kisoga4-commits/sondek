# สาเหตุที่เห็นเป็น `(anonymous)` และแนวทางแก้

## สาเหตุ
- ฝั่งเว็บในโปรเจกต์นี้ใช้ `signInAnonymously()` สำหรับการอ่าน/เขียน Firestore อัตโนมัติ
- ดังนั้นใน Firebase Authentication ผู้ใช้งานจะถูกแสดงเป็น **Anonymous user**
- ถ้า Firestore Rules ไม่อนุญาตสิทธิ์ลบ (`delete`) ให้บัญชีที่ล็อกอินอยู่ จะเกิดอาการลบแบบทดสอบไม่สำเร็จ

## แนวทางใช้งาน Rules แบบปลอดภัยขึ้น
1. เปิด `Firebase Console > Authentication > Sign-in method > Anonymous`
2. Publish ไฟล์ `firestore.rules` ที่อยู่ใน repo นี้
3. ค่อย ๆ ย้ายจากเงื่อนไข `|| signedIn()` ไปใช้ `isAdmin()` อย่างเดียว เมื่อมีระบบล็อกอินแอดมินจริง (เช่น Google Sign-In + custom claims)

## Duel Mode ใช้ฐานข้อมูลอะไร?
- Duel Mode ถูกปรับให้ใช้ **Realtime Database** ที่ path `duel_rooms/{roomId}` แล้ว
- ดังนั้น error `Missing or insufficient permissions` ของโหมดดวล จะเกี่ยวกับ **Realtime Database Rules** ไม่ใช่ `firestore.rules`
- ควรเปิด Anonymous Auth และตั้ง RTDB Rules ให้ user ที่ล็อกอินแล้ว (รวม anonymous) อ่าน/เขียนห้องของ Duel ได้

ตัวอย่างแนวคิด Rules สำหรับ RTDB:
- อนุญาต `read/write` เมื่อ `auth != null`
- บังคับ `roomId` เป็นตัวเลข 4 หลัก
- จำกัดจำนวน player ไม่เกิน 2 คน (validation เพิ่มใน rules ได้)

## วิธีหา UID แอดมิน
- เปิดหน้า `adminchamp.html`
- ดูข้อความสถานะที่หัวหน้า Dashboard จะเห็น `uid`
- นำ UID ไปแทนที่ `REPLACE_WITH_ADMIN_UID_1` ใน `firestore.rules`
