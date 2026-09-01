# คู่มือตั้งค่า: พอร์ทัลติดตามผลอุทธรณ์คะแนน (Canvas LTI 1.1)

พอร์ทัลให้ นักศึกษา login **ผ่าน Canvas เท่านั้น** เพื่อดูสถานะ + ข้อความตอบกลับการอุทธรณ์คะแนน
ยืนยันตัวตนด้วย **LTI 1.1** (instructor เพิ่มเองที่ระดับคอร์สได้ ไม่ต้องเป็น LMS admin)

## ภาพรวมการทำงาน
1. นศ. คลิกลิงก์เครื่องมือใน Canvas → Canvas ส่ง **POST launch (เซ็น OAuth1 HMAC-SHA1)** ไป `/api/lti-launch`
2. Server ตรวจลายเซ็น → กัน replay (nonce) → อ่านอีเมล → เช็ค allowlist → ออก **Firebase custom token** (role=student, uid=รหัส นศ.)
3. หน้าเว็บ sign in แล้วพาเข้าพอร์ทัล — เห็นเฉพาะคำร้องของตัวเอง (Firestore rules บังคับ)
4. เปิด URL ตรง (ไม่ผ่าน Canvas) = ไม่มี session = Firestore ปฏิเสธทุกอย่าง = หน้าว่าง

---

## 1) ตั้ง Environment Variables บน Vercel
Settings → Environment Variables (แล้ว **Redeploy**):

| Name | Value | หมายเหตุ |
|---|---|---|
| `LTI_KEY` | (ตั้งเอง เช่น `peerreview-appeal`) | Consumer Key ที่จะใส่ใน Canvas |
| `LTI_SECRET` | (สุ่มยาว ๆ เช่น 32+ ตัวอักษร) | Shared Secret — **ห้ามหลุด** |
| `LTI_LAUNCH_URL` | `https://<โดเมนจริง>/api/lti-launch` | ต้องตรงกับ Launch URL ใน Canvas **เป๊ะ** |
| `FIREBASE_ADMIN_KEY` | (JSON ของ service account ทั้งก้อน) | ดูวิธีสร้างข้อ 2 |

> ⚠️ `LTI_SECRET` และ `FIREBASE_ADMIN_KEY` เป็นความลับ — อยู่ใน env เท่านั้น ห้าม commit ลง repo

## 2) สร้าง Firebase service account key
1. Firebase Console → ⚙️ Project settings → **Service accounts**
2. **Generate new private key** → ได้ไฟล์ JSON
3. เปิดไฟล์ คัดลอกเนื้อหา JSON ทั้งก้อน → วางเป็นค่า `FIREBASE_ADMIN_KEY` ใน Vercel
   - ถ้า UI ของ Vercel มีปัญหากับ newline ใน private key: เข้ารหัสเป็น base64 ก่อนแล้ววาง (ระบบรองรับทั้ง JSON ตรงและ base64)

## 3) Publish Firestore Security Rules
ใช้ rules ล่าสุดใน `FIREBASE_SETUP.md` (มี match สำหรับ `appeals`, `appealAllowlist`, `ltiNonces` แล้ว) → Publish

## 4) เพิ่ม External App (LTI 1.1) ใน Canvas course
Canvas → คอร์ส → **Settings → Apps → View App Configurations → + App**
- **Configuration Type:** `Manual Entry`
- **Name:** เช่น `ตรวจสอบผลอุทธรณ์คะแนน`
- **Consumer Key:** = `LTI_KEY`
- **Shared Secret:** = `LTI_SECRET`
- **Launch URL:** = `LTI_LAUNCH_URL` (เช่น `https://<โดเมน>/api/lti-launch`)
- **Privacy:** เลือก **Public** (ไม่งั้น Canvas ไม่ส่งอีเมล → ระบบยืนยันตัวตนไม่ได้)
- (ถ้ามีช่อง Custom Fields) ใส่ `custom_semester=<semesterId>` เพื่อระบุเทอม ไม่ใส่ก็ได้ (ระบบใช้เทอมล่าสุด)

### ให้เปิดในแท็บใหม่ (กัน third-party cookie ใน iframe)
- ถ้าตั้งค่าผ่าน XML/placement ได้ ให้ตั้ง placement เป็น **open in new tab**
- วิธีที่ชัวร์สุด: วางเป็น **Module item (External Tool)** แล้วติ๊ก **"Load in a new tab"**

## 5) วางลิงก์ให้ นศ. เข้าถึง
- เพิ่มเป็น **Module item → External Tool** เลือกเครื่องมือนี้ (แนะนำ "Load in a new tab")
- หรือเปิดใน **Course Navigation**
- ในคำอธิบาย assignment ใส่ได้แค่ **ลิงก์/ข้อความชี้ไป module item** — **ฝัง iframe ตัวแอปสดในคำอธิบายไม่ได้** (Canvas ตัด script/iframe + เป็น GET ไม่มี launch ที่เซ็น = ไม่ผ่าน auth)

---

## การใช้งาน (ฝั่งเจ้าหน้าที่)
1. หน้า **จัดการ → การ์ด "จัดการอุทธรณ์คะแนน"**
2. **อัปโหลดไฟล์ MS Form (คำร้อง .xlsx)** → ระบบสร้างคำร้องต่อ นศ. (key = รหัสจาก prefix อีเมล)
3. ตั้ง **เทมเพลต checklist** (1 บรรทัด/ข้อ) ครั้งเดียว
4. เปิดแต่ละคำร้อง → **ติ๊ก checklist + พิมพ์ข้อความ + ตั้งสถานะ** → บันทึก → นศ. เห็นทันที (realtime)

## Allowlist (ใครเข้าได้)
- นศ. เข้าได้เมื่อ **มีคำร้องอุทธรณ์ในระบบ** (admin อัปโหลด MS Form แล้ว) หรือมีใน `semesters/{id}/appealAllowlist/{รหัส}`
- อีเมลนอกเงื่อนไข = หน้า "ไม่มีสิทธิ์"

## หมายเหตุความปลอดภัย
- ลายเซ็นตรวจฝั่ง server; `LTI_SECRET` ไม่อยู่ใน client → ปลอมคำขอไม่ได้
- Authorization บังคับที่ **Firestore rules** (data layer) ไม่ใช่ซ่อน UI → เปิด URL ตรงเห็นแค่หน้าว่าง
- นศ. อ่านได้เฉพาะ `appeals/{รหัสตัวเอง}` (uid == sisId)

## Troubleshooting
- **ลายเซ็นไม่ผ่าน:** `LTI_LAUNCH_URL` ต้องตรงกับ Launch URL ใน Canvas ทุกตัวอักษร (รวม https / ไม่มี / ท้าย)
- **ไม่ได้อีเมล:** ตั้ง Privacy = Public
- **sign-in ค้าง/พัง:** ตั้งให้เปิดแท็บใหม่ (iframe โดน block cookie)
- **คำขอหมดอายุ:** เวลาเครื่อง server ควรตรง (timestamp ±5 นาที)
