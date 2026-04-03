# Firebase Storage Rules สำหรับระบบอัปโหลดรูป

ไฟล์นี้กำหนดสิทธิ์การอัปโหลดรูปให้ **สอดคล้องกับ Firestore Rules**:
- ข้อมูลสาธารณะอ่านได้
- การเขียนต้องล็อกอินแล้ว (รวม Anonymous Auth)

## ไฟล์ที่ต้อง Publish
- `storage.rules`

## สิ่งที่ Rules นี้ทำ
- อนุญาตอ่านรูปแบบสาธารณะ (`read: if true`) สำหรับ:
  - `profile-images/{uid}/{fileName}`
  - `users/{uid}/profile/{fileName}` (path รูปโปรไฟล์แบบใหม่)
  - `teaching-images/{uid}/{fileName}`
- อนุญาตเขียนได้เฉพาะผู้ใช้ที่ล็อกอิน และ `request.auth.uid` ต้องตรงกับ `{uid}` ใน path
- อนุญาตเฉพาะไฟล์รูปภาพ (`image/*`)
- จำกัดขนาดไฟล์ไม่เกิน 5 MB
- ปิดสิทธิ์ทุก path อื่นที่ไม่ได้ประกาศ

## การ Deploy ตัวอย่าง
```bash
firebase deploy --only storage
```

> หมายเหตุ: โปรเจกต์นี้ใช้ Anonymous Auth ในหน้าเว็บ จึงยังนับว่าเป็นผู้ใช้ที่ยืนยันตัวตนแล้ว (`request.auth != null`).

## คำถามที่พบบ่อย
- ถ้าเปลี่ยน “ค่าฟิลด์” ใน Firestore ให้เก็บเป็น URL (เช่น `profile_image_url` หรือ `profileUrl`) โดยยังเขียนใน collection เดิม (`profile`) **ไม่จำเป็นต้องเปลี่ยน Firestore Rules**.
- แต่ถ้าเปลี่ยน “ตำแหน่งไฟล์” ที่อัปโหลดใน Firebase Storage (เช่นจาก `profile-images/...` ไปเป็น `users/...`) ต้องอัปเดต `storage.rules` ให้ตรงกับ path ใหม่.
