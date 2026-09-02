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

  const format = req.query?.format === 'html' ? 'html' : 'json';
  const qToken = req.query?.token ? String(req.query.token) : '';

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
      if (format === 'html') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(200).send(renderSemesterList(list, qToken));
      }
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

    const payload = {
      semester: { id: semesterId, name: sem.name || semesterId, workMax, bandWidth },
      totals,
      distribution,
      pendingReasons,
      pending,
      generatedAt: new Date().toISOString(),
    };

    if (format === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(renderReport(payload));
    }
    return res.status(200).json(payload);
  } catch (err) {
    console.error('score-summary error:', err.message);
    return res.status(500).json({ error: err.message || 'score-summary error' });
  }
}

// ---------------------------------------------------------------------------
// HTML rendering (รายงานหน้าเว็บ ไว้เปิดในเบราว์เซอร์ / สั่งพิมพ์เป็น PDF)
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PAGE_HEAD = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>สรุปคะแนนรูบริค (คลิป)</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f1f5f9; color:#0f172a;
    font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Thai",Tahoma,sans-serif;
    line-height:1.5; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px 18px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color:#64748b; font-size: 13px; margin-bottom: 20px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:22px; }
  .card { flex:1 1 120px; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; }
  .card .n { font-size: 26px; font-weight:700; }
  .card .l { font-size:12px; color:#64748b; }
  .card.warn { background:#fff7ed; border-color:#fed7aa; }
  .card.warn .n { color:#c2410c; }
  h2 { font-size:15px; margin: 26px 0 10px; }
  table { width:100%; border-collapse:collapse; background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
  th,td { padding:9px 12px; text-align:left; font-size:13px; border-bottom:1px solid #eef2f7; }
  th { background:#f8fafc; color:#475569; font-weight:600; }
  tr:last-child td { border-bottom:none; }
  .bar { height:10px; background:#e2e8f0; border-radius:6px; overflow:hidden; min-width:80px; }
  .bar > i { display:block; height:100%; background:#6366f1; }
  .num { text-align:right; font-variant-numeric: tabular-nums; }
  .pill { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; }
  .pill.over { background:#fee2e2; color:#b91c1c; }
  .pill.spread { background:#fef3c7; color:#92400e; }
  .pill.few { background:#e0e7ff; color:#3730a3; }
  .pill.none { background:#f1f5f9; color:#475569; }
  .empty { color:#16a34a; background:#f0fdf4; border:1px solid #bbf7d0; padding:12px 14px; border-radius:12px; font-size:14px; }
  .foot { margin-top:26px; color:#94a3b8; font-size:12px; }
  a { color:#4f46e5; }
  @media print { body { background:#fff; } .card,table { border-color:#cbd5e1; } }
</style></head><body><div class="wrap">`;
const PAGE_FOOT = `</div></body></html>`;

function renderSemesterList(list, token) {
  const rows = list.map((s) => {
    const href = `/api/score-summary?format=html&semesterId=${encodeURIComponent(s.id)}&token=${encodeURIComponent(token)}`;
    return `<tr><td><a href="${esc(href)}">${esc(s.name)}</a></td>
      <td class="num">${s.workMaxScore == null ? '—' : esc(s.workMaxScore)}</td></tr>`;
  }).join('');
  return `${PAGE_HEAD}
    <h1>เลือกเทอม / รายการที่จะดูสรุปคะแนน</h1>
    <div class="sub">คลิกชื่อเทอมเพื่อดูรายงานสรุปคะแนนรูบริค (คลิป)</div>
    <table><thead><tr><th>รายการ</th><th class="num">คะแนนเต็ม (workMax)</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="2">ไม่พบเทอม</td></tr>'}</tbody></table>
    ${PAGE_FOOT}`;
}

function pillFor(reason) {
  if (reason.startsWith('มีผู้รีวิวให้เกิน')) return '<span class="pill over">เกินคะแนนเต็ม</span>';
  if (reason.startsWith('คะแนนกระจาย')) return '<span class="pill spread">คะแนนกระจาย</span>';
  if (reason.startsWith('รีวิวไม่ครบ')) return '<span class="pill few">รีวิวไม่ครบ 3</span>';
  return '<span class="pill none">ไม่มีผู้รีวิว</span>';
}

function renderReport(p) {
  const maxBand = Math.max(1, ...p.distribution.map((b) => b.count));
  const distRows = p.distribution.map((b) => {
    const pct = Math.round((b.count / maxBand) * 100);
    return `<tr><td>${esc(b.label)}</td>
      <td class="num">${b.count}</td>
      <td><div class="bar"><i style="width:${pct}%"></i></div></td></tr>`;
  }).join('');

  const pendRows = p.pending.map((s) => {
    const grades = (s.grades || []).join(', ');
    return `<tr>
      <td>${esc(s.studentId)}</td>
      <td>${esc(s.name)}</td>
      <td>${pillFor(s.reason)}</td>
      <td>${esc(grades) || '—'}</td>
      <td class="num">${s.graderCount}</td>
    </tr>`;
  }).join('');

  const gen = new Date(p.generatedAt);
  const genStr = gen.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });

  return `${PAGE_HEAD}
    <h1>สรุปคะแนนรูบริค (คลิป) — ${esc(p.semester.name)}</h1>
    <div class="sub">คะแนนเต็ม ${esc(p.semester.workMax)} · ความกว้างช่วง ${esc(p.semester.bandWidth)} คะแนน · ข้อมูล ณ ${esc(genStr)} น. (สด — สะท้อนที่ TA แก้ล่าสุด)</div>

    <div class="cards">
      <div class="card"><div class="n">${p.totals.students}</div><div class="l">นักศึกษาทั้งหมด</div></div>
      <div class="card"><div class="n">${p.totals.scored}</div><div class="l">มีคะแนนแล้ว</div></div>
      <div class="card warn"><div class="n">${p.totals.pending}</div><div class="l">รอตรวจ (ยังไม่มีคะแนน TA)</div></div>
      <div class="card"><div class="n">${p.totals.ta}</div><div class="l">TA ให้คะแนนเอง</div></div>
      <div class="card"><div class="n">${p.totals.auto}</div><div class="l">อัตโนมัติ (Max)</div></div>
    </div>

    <h2>การกระจายคะแนน (เฉพาะที่มีคะแนนแล้ว ${p.totals.scored} คน)</h2>
    <table><thead><tr><th>ช่วงคะแนน</th><th class="num">จำนวน</th><th></th></tr></thead>
      <tbody>${distRows}</tbody></table>

    <h2>ควรตรวจสอบก่อนเผยแพร่ (${p.totals.pending} คน)</h2>
    ${p.pending.length === 0
      ? '<div class="empty">✓ ไม่มีนักศึกษาที่รอตรวจ — ทุกคนมีคะแนนสิ้นสุดแล้ว พร้อมเผยแพร่</div>'
      : `<table><thead><tr><th>รหัส</th><th>ชื่อ</th><th>เหตุผล</th><th>คะแนนผู้รีวิว</th><th class="num">จำนวนรีวิว</th></tr></thead>
        <tbody>${pendRows}</tbody></table>`}

    <div class="foot">
      รายงานอ่านอย่างเดียว · คำนวณคะแนนสิ้นสุดด้วยตรรกะเดียวกับหน้าจัดการ (clipFinal) ·
      สั่งพิมพ์เป็น PDF ได้จากเมนูพิมพ์ของเบราว์เซอร์
    </div>
    ${PAGE_FOOT}`;
}
