# สรุปการสืบสวนปัญหา: "เริ่มเกมไม่สำเร็จ: permission_denied"

## ขอบเขต
- เอกสารนี้เป็นผลการวิเคราะห์จากโค้ดและ Rules เท่านั้น
- **ไม่มีการแก้ logic ระบบหลัก**

## สาเหตุที่เป็นไปได้สูงสุด

### 1) Firebase Anonymous Auth ยังไม่เปิด หรือโดเมนยังไม่ถูกอนุญาต
ฝั่งเว็บเรียก `signInAnonymously()` ก่อนเขียนข้อมูล ถ้าปิด Anonymous หรือโดเมนไม่อยู่ใน Authorized domains จะทำให้คำสั่งเขียน DB โดนปฏิเสธ และปลายทางเห็นเป็น `permission_denied`.

หลักฐานในโค้ด:
- `ensureAuthReady()` เรียก `signInAnonymously(auth)` และแปลง error เป็นข้อความชี้ไปที่ Anonymous/Auth domain.
- ค่าข้อความ hint ระบุชัดว่าต้องเปิด Anonymous และ publish RTDB Rules.

### 2) Deploy Rules ผิดตัว (ไป deploy Firestore rules แต่เกมใช้ RTDB)
Duel/start game ใช้ Realtime Database path `rooms/{roomId}` และ game rooms (`*_rooms/{roomId}/public|private`). ถ้า deploy เฉพาะ Firestore rules จะไม่ช่วย.

### 3) Rules ของเกมย่อยผูกกับสมาชิกใน `rooms/{roomId}/players/{auth.uid}`
ใน `database.rules.json` สิทธิ์อ่าน/เขียน `*_rooms/{roomId}/public|private` อนุญาตเฉพาะ user ที่ยังอยู่ใน `rooms/{roomId}/players/{auth.uid}` เท่านั้น.

ผลกระทบ:
- ถ้า UID ปัจจุบันไม่อยู่ใน node `players` (เช่น anonymous UID เปลี่ยนหลัง refresh/login ใหม่), การเริ่มเกมย่อยหรือเขียน state เกมจะโดน `permission_denied` ทันที.

## จุดตรวจสอบเร็ว (ไม่แก้ระบบหลัก)
1. Firebase Console > Authentication > Sign-in method > Anonymous = Enabled
2. Firebase Console > Authentication > Settings > Authorized domains มีโดเมนที่ใช้งานจริง
3. Deploy RTDB rules ด้วย `firebase deploy --only database`
4. ที่ RTDB Data ตรวจว่ามี `rooms/<roomId>/players/<currentAuthUid>` จริงก่อนกดเริ่มเกม
5. ถ้าห้องค้างจากการทดสอบ ให้ลบ node ห้องเก่าแล้วสร้างใหม่

## หลักฐานไฟล์ที่ใช้วิเคราะห์
- `js/db.js`
- `database.rules.json`
- `FIREBASE_RULES.md`
- `games/sheriff-th/js/app.js`
- `games/pob-kintub/js/app.js`
- `games/pob-joktab-v2/js/app.js`
- `games/logic-spy/js/app.js`
