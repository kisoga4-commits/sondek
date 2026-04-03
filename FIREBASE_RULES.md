# สาเหตุที่เห็นเป็น `(anonymous)` และแนวทางแก้

## สาเหตุ
- ฝั่งเว็บในโปรเจกต์นี้ใช้ `signInAnonymously()` สำหรับการอ่าน/เขียน Firestore อัตโนมัติ
- ดังนั้นใน Firebase Authentication ผู้ใช้งานจะถูกแสดงเป็น **Anonymous user**
- ถ้า Firestore Rules ไม่อนุญาตสิทธิ์ลบ (`delete`) ให้บัญชีที่ล็อกอินอยู่ จะเกิดอาการลบแบบทดสอบไม่สำเร็จ

## แนวทางใช้งาน Rules แบบปลอดภัยขึ้น
1. เปิด `Firebase Console > Authentication > Sign-in method > Anonymous`
2. Publish ไฟล์ `firestore.rules` ที่อยู่ใน repo นี้
3. ค่อย ๆ ย้ายจากเงื่อนไข `|| signedIn()` ไปใช้ `isAdmin()` อย่างเดียว เมื่อมีระบบล็อกอินแอดมินจริง (เช่น Google Sign-In + custom claims)

## วิธีหา UID แอดมิน
- เปิดหน้า `adminchamp.html`
- ดูข้อความสถานะที่หัวหน้า Dashboard จะเห็น `uid`
- นำ UID ไปแทนที่ `REPLACE_WITH_ADMIN_UID_1` ใน `firestore.rules`
