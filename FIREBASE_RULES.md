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
- Duel Mode ใช้ **Realtime Database** ที่ path `rooms/{roomId}`
- ดังนั้น error `Missing or insufficient permissions` ของโหมดดวล จะเกี่ยวกับ **Realtime Database Rules** ไม่ใช่ `firestore.rules`
- ควรเปิด Anonymous Auth และตั้ง RTDB Rules ให้ user ที่ล็อกอินแล้ว (รวม anonymous) อ่าน/เขียนห้องของ Duel ได้

## วิธีแก้ `permission_denied` ของ Duel แบบเร็ว
1. เปิด `Firebase Console > Authentication > Sign-in method > Anonymous` ให้เป็น **Enabled**
2. Deploy RTDB rules จากไฟล์ `database.rules.json` ใน repo นี้:
   ```bash
   firebase deploy --only database
   ```
3. ทดสอบใหม่โดยเปิดหน้า `duel.html` แล้วสร้างห้องรหัสใหม่ (รองรับ 4-6 หลัก)

ไฟล์ `database.rules.json` ถูกตั้งค่าให้:
- อนุญาต `read/write` เฉพาะ user ที่ login แล้ว (`auth != null`)
- อนุญาตเฉพาะ `roomId` ที่เป็นตัวเลข 4-6 หลัก
- ตั้ง validation แบบยืดหยุ่น (schema-light) เพื่อรองรับโหมดเกมใหม่ในอนาคต โดยไม่ผูกตายกับโครงสร้าง `settings/state` แบบเก่า
- ยังมี guard ขั้นพื้นฐานกับฟิลด์หลักที่ใช้บ่อย เช่น `roomId`, `pin`, `hostUid`, `players`

## ถ้ายังไม่หาย: รีเซ็ตระบบ Duel แล้วเริ่มใหม่
ถ้าข้อมูลห้องเดิมค้าง/เพี้ยน ให้ลบ node `rooms` ทั้งหมดใน Realtime Database แล้วเริ่มสร้างห้องใหม่:

1. ไปที่ `Firebase Console > Realtime Database > Data`
2. เลือก node `rooms`
3. กดเมนู `⋮` แล้วเลือก **Delete node**
4. กลับไปหน้าเว็บ แล้วสร้างห้อง Duel ใหม่

> หมายเหตุ: การลบ `rooms` จะลบห้องดวลที่กำลังรอ/กำลังเล่นทั้งหมดทันที

## วิธีหา UID แอดมิน
- เปิดหน้า `adminchamp.html`
- ดูข้อความสถานะที่หัวหน้า Dashboard จะเห็น `uid`
- นำ UID ไปแทนที่ `REPLACE_WITH_ADMIN_UID_1` ใน `firestore.rules`
