// Vercel Serverless Function — สรุปคะแนนรูบริค (clip) สำหรับรายงานตอนเช้า
// -----------------------------------------------------------------------------
// อ่านข้อมูลจาก Firestore ด้วย Admin SDK (ข้าม security rules) แล้วคำนวณคะแนนคลิป
// "สิ้นสุด" ต่อ นศ. (ตรรกะเดียวกับ clipFinal ใน DataViewer.jsx) เพื่อสรุป:
//   - การกระจายจำนวน นศ. ตามช่วงคะแนน (ความกว้างช่วง = 3)
//   - รายชื่อ/จำนวนที่ยัง "รอตรวจ" (pending: ยังไม่มีคะแนน TA) เพื่อให้ตรวจก่อนเผยแพร่
//
// อ่านอย่างเดียว — ไม่แตะ Canvas, ไม่เขียน Firestore
// ป้องกันด้วย token (env SUMMARY_TOKEN) เพราะผลลัพธ์มีชื่อ+คะแนน นศ.
//
// ใช้:
//   GET /api/score-summary                      -> รายการเทอม [{id,name}] (ไว้เลือก semesterId)
//   GET /api/score-summary?semesterId=<id>      -> สรุปคะแนนของเทอมนั้น
//   header: x-summary-token: <SUMMARY_TOKEN>     (หรือ ?token=<SUMMARY_TOKEN>)

import { adminDb } from './_lib/firebaseAdmin.js';

export const config = { maxDuration: 60 };

const SPREAD_LIMIT = 2; // ต้องตรงกับ DataViewer.jsx

// เทียบ token แบบกันการเดา (ความยาวเท่ากันจึงเทียบทีละตัว)
function tokenOk(provided) {
  const expected = process.env.SUMMARY_TOKEN || '';
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ตรรกะเดียวกับ clipFinal (DataViewer.jsx) — คืนคะแนนสิ้นสุด + สถานะ + เหตุผลที่ยัง pending
function computeClipFinal(workScore, taScore, workMax) {
  const ws = workScore || {};
  const grades = (ws.grades || []).filter((g) => g != null && !isNaN(g));
  const n = grades.length;
  const range = n ? (ws.range ?? (Math.max(...grades) - Math.min(...grades))) : 0;
  const overMax = grades.some((g) => g > workMax);
  const hasTa = taScore != null && !isNaN(taScore);
  const autoEligible = n >= 3 && range <= SPREAD_LIMIT && !overMax;

  if (hasTa) return { status: 'ta', final: Number(taScore), grades, n, range, overMax };
  if (autoEligible) return { status: 'auto', final: ws.max, grades, n, range, overMax };

  // pending — ระบุเหตุผลเพื่อช่วยจัดลำดับการตรวจ
  let reason;
  if (n === 0) reason = 'ไม่มีผู้รีวิว';
  else if (overMax) reason = `มีผู้รีวิวให้เกินคะแนนเต็ม (${workMax})`;
  else if (n < 3) reason = `รีวิวไม่ครบ 3 คน (${n} คน)`;
  else reason = `คะแนนกระจาย (ช่วง ${range} > ${SPREAD_LIMIT})`;
  return { status: 'pending', final: null, grades, n, range, overMax, reason };
}

export default async function handler(req, res) {
  // ---- auth ----
  const provided = req.headers['x-summary-token'] || (req.query && req.query.token) || '';
  if (!tokenOk(String(provided))) {
    return res.status(401).json({ error: 'unauthorized (token ไม่ถูกต้องหรือยังไม่ได้ตั้ง SUMMARY_TOKEN)' });
  }

  let db;
  try {
    db = adminDb();
  } catch (e) {
    return res.status(500).json({ error: `init firebase-admin ล้มเหลว: ${e.message}` });
  }

  const semesterId = req.query?.semesterId ? String(req.query.semesterId) : '';

  try {
    // ไม่ระบุ semesterId -> คืนรายการเทอมให้เลือก
    if (!semesterId) {
      const snap = await db.collection('semesters').get();
      const list = snap.docs.map((d) => ({
        id: d.id,
        name: d.data()?.name || d.id,
        workMaxScore: d.data()?.workMaxScore ?? null,
      }));
      return res.status(200).json({ semesters: list });
    }

    // ---- meta / workMax ----
    const semSnap = await db.collection('semesters').doc(semesterId).get();
    if (!semSnap.exists) return res.status(404).json({ error: `ไม่พบเทอม ${semesterId}` });
    const sem = semSnap.data() || {};

    const metaSnap = await db.doc(`semesters/${semesterId}/peerReviewData/meta`).get();
    if (!metaSnap.exists) return res.status(404).json({ error: 'ไม่พบข้อมูล peerReviewData (ยังไม่ได้ประมวลผล)' });
    const stats = metaSnap.data()?.stats || {};

    const workMax = Number(sem.workMaxScore) > 0 ? Number(sem.workMaxScore) : (stats.maxScore || 12);

    // ---- students (รวม chunk students_*) ----
    const prSnap = await db.collection('semesters').doc(semesterId).collection('peerReviewData').get();
    let students = {};
    prSnap.docs.forEach((d) => {
      if (d.id.startsWith('students_')) students = { ...students, ...(d.data()?.data || {}) };
    });

    // ---- TA overrides (studentId -> taScore) ----
    const ovSnap = await db.collection('semesters').doc(semesterId).collection('clipScoreOverrides').get();
    const overrides = {};
    ovSnap.docs.forEach((d) => { overrides[d.id] = d.data()?.taScore; });

    // ---- คำนวณต่อ นศ. ----
    const bandWidth = 3;
    const bandCount = Math.max(1, Math.ceil(workMax / bandWidth));
    const distribution = Array.from({ length: bandCount }, (_, i) => {
      const lo = i * bandWidth;
      const hi = Math.min((i + 1) * bandWidth, workMax);
      return { label: `${lo}–${hi}`, lo, hi, count: 0 };
    });

    const totals = { students: 0, scored: 0, pending: 0, auto: 0, ta: 0, overMax: 0 };
    const pendingReasons = { 'ไม่มีผู้รีวิว': 0 };
    const pending = [];

    Object.values(students).forEach((st) => {
      totals.students++;
      const cf = computeClipFinal(st.workScore, overrides[st.studentId], workMax);
      if (cf.overMax) totals.overMax++;

      if (cf.status === 'pending') {
        totals.pending++;
        pendingReasons[cf.reason] = (pendingReasons[cf.reason] || 0) + 1;
        pending.push({
          studentId: st.studentId,
          name: st.fullName || st.studentName || '',
          grades: cf.grades,
          graderCount: cf.n,
          range: cf.range,
          reason: cf.reason,
        });
        return;
      }

      // มีคะแนนสิ้นสุด -> นับเข้า band + สถานะ
      totals.scored++;
      if (cf.status === 'auto') totals.auto++;
      if (cf.status === 'ta') totals.ta++;
      const score = cf.final;
      let idx = Math.floor(score / bandWidth);
      if (idx >= bandCount) idx = bandCount - 1; // score == workMax ตกช่วงบนสุด
      if (idx < 0) idx = 0;
      distribution[idx].count++;
    });

    // เรียง pending: ที่น่ากังวลก่อน (overMax > กระจาย > ไม่ครบ 3 > ไม่มีรีวิว) แล้วตามรหัส
    const reasonRank = (r) => (r.startsWith('มีผู้รีวิวให้เกิน') ? 0 : r.startsWith('คะแนนกระจาย') ? 1 : r.startsWith('รีวิวไม่ครบ') ? 2 : 3);
    pending.sort((a, b) => reasonRank(a.reason) - reasonRank(b.reason) || String(a.studentId).localeCompare(String(b.studentId)));

    return res.status(200).json({
      semester: { id: semesterId, name: sem.name || semesterId, workMax, bandWidth },
      totals,
      distribution,
      pendingReasons,
      pending,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('score-summary error:', err.message);
    return res.status(500).json({ error: err.message || 'score-summary error' });
  }
}
