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

## 4) เพิ่ม External App (LTI 1.1) ใน Canvas course — วิธี **By URL** (ได้เมนู Course Navigation)
> ⚠️ **Manual Entry ตั้ง placement course_navigation ไม่ได้** — ต้องใช้ XML config
> แอปมี endpoint `/api/lti-config` ที่คืน XML ให้แล้ว (ประกาศ course_navigation + privacy public + เปิดแท็บใหม่)

Canvas → คอร์ส → **Settings → Apps → View App Configurations → + App**
- **Configuration Type:** `By URL`
- **Name:** เช่น `ตรวจสอบผลอุทธรณ์คะแนน`
- **Consumer Key:** = `LTI_KEY`
- **Shared Secret:** = `LTI_SECRET`
- **Config URL:** = `https://<โดเมนจริง>/api/lti-config`
- **Submit** → Canvas จะดึง XML แล้วสร้างเมนูใน **Course Navigation** ให้อัตโนมัติ (เปิดแท็บใหม่ · privacy public เพื่อส่งอีเมล)

**ทางเลือกสำรอง (Paste XML):** เปิด `https://<โดเมน>/api/lti-config` คัดลอก XML ทั้งหมด แล้วเลือก Configuration Type = `Paste XML` วางลงไป (Key/Secret ใส่เหมือนเดิม)

> ระบุเทอม: ถ้าต้องการล็อกเทอม ใส่ custom field `custom_semester=<semesterId>` เพิ่มได้ (ไม่ใส่ = ระบบใช้เทอมล่าสุด)

## 5) วางลิงก์ให้ นศ. เข้าถึง
- **Course Navigation** จะมีเมนูให้อัตโนมัติจากขั้นตอนข้อ 4 (เปิดแท็บใหม่) — เป็นวิธีหลัก
- หรือเพิ่มเป็น **Module item → External Tool** เลือกเครื่องมือนี้ (ติ๊ก "Load in a new tab") ก็ได้
- ในคำอธิบาย assignment ใส่ได้แค่ **ลิงก์/ข้อความชี้ไปเมนู/module item** — **ฝัง iframe ตัวแอปสดในคำอธิบายไม่ได้** (Canvas ตัด script/iframe + เป็น GET ไม่มี launch ที่เซ็น = ไม่ผ่าน auth)

---

## ช่องทางรับคำร้อง (มี 2 ทาง ใช้ร่วมกันได้)
1. **นักศึกษายื่นในพอร์ทัลโดยตรง** (แนะนำ) — login ผ่าน Canvas → กรอกฟอร์ม (เลือกส่วน + เหตุผล) → เขียนลง `appeals/{รหัส}` เอง ผูกตัวตนที่ยืนยันแล้วอัตโนมัติ เจ้าหน้าที่เห็นทันที (realtime)
2. **อัปโหลดไฟล์ MS Form (.xlsx)** ในการ์ด "จัดการอุทธรณ์คะแนน" — สำหรับ นศ. ที่ยื่นผ่านฟอร์มเดิม (key = รหัสจาก prefix อีเมล)

## การใช้งาน (ฝั่งเจ้าหน้าที่)
1. **เผยแพร่คะแนนให้ นศ.**: หน้า **ดูข้อมูล → การ์ด "เผยแพร่คะแนนให้นักศึกษา (พอร์ทัล)"** → กด **เผยแพร่คะแนน**
   (คำนวณ 3 ส่วนล่าสุดเขียนลง `studentScores/{รหัส}` · กดซ้ำได้เมื่อคะแนนเปลี่ยน)
2. **ตั้งกำหนดการ + เปิด/ปิดรับคำร้อง**: หน้า **จัดการ → การ์ด "จัดการอุทธรณ์คะแนน"**
   - วันสุดท้ายที่ยื่นขอตรวจสอบ + วันประกาศคะแนนจริง (นศ. เห็นในพอร์ทัล)
   - ติ๊ก **"ปิดรับคำร้องทันที"** เพื่อปิดก่อนกำหนด (แอปยังอยู่ให้ดูคะแนน/สถานะได้ — **ไม่ต้องลบแอปออกจาก Canvas**)
   - ระบบปิดรับอัตโนมัติเมื่อเลยวันสุดท้าย
3. ตั้ง **เทมเพลต checklist** (1 บรรทัด/ข้อ) ครั้งเดียว
4. เปิดแต่ละคำร้อง → **ติ๊ก checklist + พิมพ์ข้อความ + ตั้งสถานะ** → บันทึก → นศ. เห็นทันที (realtime)

## ฝั่งนักศึกษาเห็นอะไร
- **คะแนนจริง 3 ส่วน + รวม** (ระบุว่าเป็นคะแนนที่จะประกาศ) + กำหนดการ
- **ยื่นขอตรวจสอบคะแนนได้ 1 ครั้ง** (ถ้าเห็นว่าไม่ถูกต้อง) หรือกดปุ่ม **"โอเคกับคะแนนนี้แล้ว"** (รับทราบ)
- **ถ้าไม่กดปุ่มใด ๆ ถือว่ายอมรับคะแนน** · เจ้าหน้าที่เห็นว่าใครรับทราบ/ใครยื่นคำร้องในหน้าจัดการ

## ใครเข้าพอร์ทัลได้
- **นักศึกษาที่ลงทะเบียนคอร์ส** — การ launch ผ่าน LTI สำเร็จ = Canvas ยืนยันแล้วว่าอยู่ในคอร์ส (Canvas ยิง launch ให้เฉพาะคนในคอร์ส) + อีเมลเป็นรูปแบบรหัส นศ. (`รหัส@cmu.ac.th`)
- ระงับรายบุคคลได้โดยเพิ่ม doc ที่ `semesters/{id}/appealDenylist/{รหัส}` (ผ่าน Firebase Console)

## หมายเหตุความปลอดภัย
- ลายเซ็นตรวจฝั่ง server; `LTI_SECRET` ไม่อยู่ใน client → ปลอมคำขอไม่ได้
- Authorization บังคับที่ **Firestore rules** (data layer) ไม่ใช่ซ่อน UI → เปิด URL ตรงเห็นแค่หน้าว่าง
- นศ. อ่านได้เฉพาะ `appeals/{รหัสตัวเอง}` (uid == sisId)

## Troubleshooting
- **ลายเซ็นไม่ผ่าน:** `LTI_LAUNCH_URL` ต้องตรงกับ Launch URL ใน Canvas ทุกตัวอักษร (รวม https / ไม่มี / ท้าย)
- **ไม่ได้อีเมล:** ตั้ง Privacy = Public
- **sign-in ค้าง/พัง:** ตั้งให้เปิดแท็บใหม่ (iframe โดน block cookie)
- **คำขอหมดอายุ:** เวลาเครื่อง server ควรตรง (timestamp ±5 นาที)
