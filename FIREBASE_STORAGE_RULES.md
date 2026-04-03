# Firebase Storage Rules (แยกจาก Firestore Rules เดิม)

ไฟล์นี้เพิ่มมาเพื่อรองรับการอัปโหลดรูปจากเครื่องในหน้า `adminchamp.html` โดย **ไม่แก้ไฟล์ `firestore.rules` เดิม**.

## ไฟล์ที่ต้อง Publish
- `storage.rules`

## สิ่งที่ Rules นี้ทำ
- อนุญาตอ่านรูปแบบสาธารณะ (`read: if true`) สำหรับสองโฟลเดอร์:
  - `profile-images/{uid}/{fileName}`
  - `teaching-images/{uid}/{fileName}`
- อนุญาตอัปโหลด/แก้ไข/ลบได้เฉพาะผู้ใช้ที่ล็อกอินและ UID ตรงกับ path
- จำกัดให้เป็นไฟล์รูปภาพเท่านั้น (`image/*`)
- จำกัดขนาดไฟล์ไม่เกิน 5 MB (หลังบีบรูปฝั่งเว็บแล้ว)
- ปิดสิทธิ์ทุก path อื่นที่ไม่ได้ประกาศ

## การ Deploy ตัวอย่าง
```bash
firebase deploy --only storage
```

> หมายเหตุ: ระบบนี้ใช้ Anonymous Auth ในหน้าเว็บ จึงยังนับว่าเป็น `request.auth != null` ได้ตามเดิม.
