# Peer Review Analyzer — System Overview & Handoff

> เอกสารสรุประบบสำหรับผู้พัฒนา/ผู้ดูแล ใช้เป็น context เริ่มต้นเวลาเปิดงานต่อในแชทใหม่
> คอร์ส: **261111 Internet and Online Community in the Age of AI**

## 1. ระบบนี้คืออะไร

เว็บแอปสำหรับ **วิเคราะห์และให้คะแนนการทำ Peer Review** ของนักศึกษา (~2,900 คน) โดยดึงข้อมูลจาก
**Canvas LMS แบบอ่านอย่างเดียว** มาคำนวณคะแนน และมีฟีเจอร์ **Q&A** ที่จับคู่ไฟล์ MS Form 2 ไฟล์
(คำถามท้ายคลิปของเจ้าของงาน กับคำถาม/คำตอบที่ผู้รีวิวถอดมา) เพื่อวัดว่าผู้รีวิว "ดูคลิปจริง" และ "ตั้งใจตอบ"

**ข้อจำกัดสำคัญ:** ระบบ **ห้ามแก้ไขข้อมูลใน Canvas** — เข้าถึง Canvas แบบอ่านอย่างเดียวเท่านั้น
การนำคะแนนกลับเข้า Canvas ทำโดย admin **ดาวน์โหลด CSV แล้ว import เอง** (เป็นการกระทำของ admin ไม่ใช่ระบบ)

## 2. Tech stack & deploy

- **Frontend:** Vite + React 18, TailwindCSS, lucide-react
- **Backend/Data:** Firebase (Authentication + Firestore)
- **Canvas:** GraphQL (read-only) ผ่าน serverless proxy `api/canvas.js`
- **Parsing:** SheetJS (`xlsx`) อ่าน MS Form .xlsx ฝั่ง browser · `papaparse` อ่าน CSV roster
- **Deploy:** Vercel — `peer-review-analyzer-lxgk.vercel.app` (auto-deploy จาก branch `main`)
- **Git workflow:** พัฒนาบน `claude/peer-review-analyzer-canvas-j85j99`, commit+push `main`, แล้ว sync branch ให้ตรง main

## 3. โครงสร้างข้อมูล Firestore

| Path | เก็บอะไร |
|---|---|
| `users/{uid}` | `role`: `admin` / `ta` / `pending`, displayName, email |
| `canvasConfigs/{uid}` | ต่อ admin: `canvasUrl`, `canvasApiKey` (ใช้ดึง Canvas) |
| `taAssignments` | แผนที่ TA → กลุ่มที่ดูแล |
| `settings` | ตั้งค่าระบบรวม |
| `semesters/{id}` | ข้อมูลรายการ (ดูฟิลด์ด้านล่าง) |

**`semesters/{id}` fields หลัก:** `name`, `canvasUrl`, `canvasCourseId`, `canvasAssignmentId`, `assignmentName`,
`workMaxScore` (คะแนนเต็มรูบริค เช่น 11), `qaMatchThreshold` (เกณฑ์ความคล้ายคำถาม 0–1),
`exportClipHeader` / `exportOwnerHeader` / `exportPeerHeader` (หัวคอลัมน์ปลายทาง A1.1/A1.2/A1.3),
`qaOwnerSheetUrl` / `qaReviewerSheetUrl` (ลิงก์ Excel Online ต้นทาง)

**subcollections ของ `semesters/{id}`:**

| Subcollection | เก็บอะไร | เขียนโดย |
|---|---|---|
| `peerReviewData` (chunks) | ข้อมูล peer review จาก Canvas | admin (ตอนดึง) |
| `studentData` (chunks) | roster + `workScore` (rubric grades[]) | admin (ตอนดึง/อัปโหลด) |
| `peerQAData` (`meta`, `reviewers_N`, `reviews_N`, `owners_N`) | ผล Q&A ที่คำนวณแล้ว | admin (ตอนประมวลผล Q&A) |
| `reviewStatuses` | สถานะการตรวจต่อรายการ | admin/TA |
| `qaReviewOverrides/{reviewerId__clipCode}` | TA แก้คะแนนรีวิว 0/1 | admin/TA |
| `clipScoreOverrides/{studentId}` | TA ใส่คะแนนคลิป (รูบริค) | admin/TA |

> **สำคัญ:** คะแนนที่ TA แก้เก็บใน `qaReviewOverrides` / `clipScoreOverrides` แยกจาก `peerQAData`
> ดังนั้นการ **re-process Q&A (เขียนทับ `peerQAData`) ไม่ลบคะแนน TA** และค่าที่ TA แก้จะ "ชนะ" ค่าอัตโนมัติเสมอ

## 4. ตรรกะการให้คะแนน (ไฟล์หลัก)

### 4.1 คะแนนคลิป / รูบริค — `src/components/DataViewer.jsx` (`clipFinal`)
- `workMax` = `semester.workMaxScore` > 0 ? ค่านั้น : (Canvas maxScore || 12)
- ลำดับการตัดสิน:
  1. **TA กรอกคะแนนแล้ว → ใช้คะแนน TA เสมอ** (n===2 รวมกับรีวิวแล้วเช็ค spread; อื่น ๆ ใช้ taScore)
  2. ยังไม่มี TA + **auto-eligible** (`รีวิว ≥3 && range ≤2 && ไม่มีคะแนนเกินเต็ม`) → ใช้ **Max**
  3. อื่น ๆ → **pending "รอตรวจ"** (แดง)
- **over-max:** รีวิวคนใดให้เกิน `workMax` → บังคับ pending + โชว์แดง + คำเตือน (กัน auto-max เอาคะแนนเกินไปใช้)

### 4.2 คะแนนตอบคำถามท้ายคลิป (เจ้าของ, เต็ม 2) — `src/utils/qaMatcher.js`
- ตั้งคำถามในคลิป (posed) 1 คะแนน + ตอบคำถามตัวเอง (answered) 1 คะแนน

### 4.3 คะแนน peer review (เต็ม 3, 1/คลิป) — `src/utils/qaMatcher.js` + `DataViewer.jsx`
- `watched` = `questionSimilarity(คำถามเจ้าของ, คำถามที่ผู้รีวิวถอด) ≥ threshold`
- `answered` = `substantive(คำตอบ)` (ยาว ≥ 5 ตัวอักษร ไม่ใช่ "-"/ว่าง)
- `full` (ได้ 1 คะแนนคลิปนั้น) = `answered && (watched || ownerNoQuestion)`
  - **ownerNoQuestion**: เจ้าของไม่ตั้งคำถาม (`owner_not_submitted`/`linked_no_question`) → ไม่มีคำถามให้เทียบ = ไม่ใช่ความผิดผู้รีวิว → ให้เครดิตตามคำตอบ (`bad_clipcode` ไม่เข้าเงื่อนไข)
- **Diligence bump** (`applyDiligenceBump` ใน `DataViewer.jsx`): ผู้รีวิว **≥3 คลิป และได้ 2 → เป็น 3** (เคสเปิดคลิปเพื่อนไม่ได้) — **เว้นถ้า TA กด 0 คลิปใดไว้** (คำนวณตอนแสดง/ส่งออก ไม่ต้อง re-process)
- **TA override 0/1** (`qaReviewOverrides`) ชนะค่าอัตโนมัติ

### 4.4 ความคล้ายคำถาม — `questionSimilarity` (`src/utils/qaMatcher.js`)
- n-gram = **bigram + trigram** ของข้อความไทย (ตัด whitespace/เครื่องหมาย/คำลงท้ายสุภาพ)
- `score = max(Dice, w · containment)` โดย containment = ตัวร่วม/ตัวที่เล็กกว่า (แก้ปัญหา Jaccard ที่ลงโทษคำตอบสั้น), `w` ลดลงถ้าข้อความสั้นมาก
- เกณฑ์ (`threshold`) admin ตั้งได้ต่อรายการ (ค่าตั้งต้น 0.5) → เก็บใน `stats.threshold`

## 5. การส่งออกเข้า Canvas — `CanvasExportModal` (`DataViewer.jsx`)
- รูปแบบ **Canvas Gradebook Import CSV**: หัวตาราง
  `Student, ID, SIS User ID, SIS Login ID, Integration ID, Section, <A1.1>, <A1.2>, <A1.3>`
  + แถว `Points Possible` (คลิป=`workMax` / เจ้าของ=2 / peer=3) + 1 แถว/คน
- Canvas จับคู่ นศ. ด้วย **ID / SIS User ID**; หัวคอลัมน์ `ชื่อ (id)` = อัปเดต assignment เดิม, ชื่อเปล่า = สร้างใหม่
- หัวคอลัมน์ 3 ช่อง prefill จาก `semester.export*Header` (admin ตั้งในหน้าจัดการ) → localStorage → ว่าง

**บริบท Canvas ปัจจุบัน:** assignment#1 phase 2 (id เดิม) ตั้งเป็น 0; ประกาศแยก — คลิป(11)→**A1.1**, ตอบคำถามท้ายคลิป(2)→**A1.2**, peer review(3)→**A1.3**

## 6. ไฟล์สำคัญ
- `src/components/DataViewer.jsx` — หน้าแสดงข้อมูล/คะแนน, ตรรกะ clipFinal, graderQaTotal, โมดัลตรวจ (ClipScoreModal, QADetailModal, OwnerQATooltip), CanvasExportModal
- `src/components/AdminPanel.jsx` — หน้าจัดการ: ดึง Canvas, อัปโหลด roster, อัปโหลด+ประมวลผล Q&A, ตั้งค่ารายการ, จัดการผู้ใช้/TA
- `src/utils/qaMatcher.js` — parse MS Form, จับคู่, คิดคะแนน Q&A (`computeQA`, `questionSimilarity`)
- `src/utils/csvParser.js` — parse Canvas data, `workScore` (grades/max/min/range), `isComplete`
- `api/canvas.js` — serverless proxy เรียก Canvas GraphQL
- `FIREBASE_SETUP.md` — Firestore security rules (role-based)

## 7. สิ่งที่ทำเสร็จแล้ว (ประวัติล่าสุด)
- ปรับหน้าแรกเป็นหน้าจัดการ, อัปโหลด Q&A หลายไฟล์, แก้ name-linkage
- คะแนนเจ้าของ (posed+answered /2), peer review = คุณภาพ Q&A (เอา bonus ออก), เกณฑ์ "สมบูรณ์" = ให้คะแนนใน Canvas
- workflow ให้ TA ตรวจ/แก้คะแนน (clip + peer 0/1), realtime sync, toast ยืนยัน
- คะแนนรูบริค x/11 (workMaxScore), เปลี่ยนชื่อ "คะแนนสิ้นสุด"→"คะแนนรูบริค"
- Canvas export → A1.1/A1.2/A1.3 (admin ตั้งหัวคอลัมน์ในหน้าจัดการ) + คอลัมน์ Integration ID
- clipFinal: TA ชนะ auto + flag คะแนนเกินเต็ม
- similarity n-gram containment + threshold ตั้งได้, ให้เครดิตเคสเจ้าของไม่ตั้งคำถาม, bump 2/3→3 (รีวิวครบ 3)

## 8. สิ่งที่ TA/แอดมินต้องทำเมื่อเปลี่ยนสูตร/เกณฑ์
- เปลี่ยนสูตรความคล้าย/เกณฑ์/เงื่อนไขให้เครดิต → **re-process Q&A** (อัปโหลดไฟล์ 2 อัน + ประมวลผล + บันทึก)
- diligence bump และ Canvas export **ไม่ต้อง** re-process (คำนวณตอนแสดงผล)
