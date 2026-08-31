// src/utils/qaMatcher.js
// -----------------------------------------------------------------------------
// จับคู่ MS Form 2 ไฟล์ (คำถามท้ายคลิปของเจ้าของ + คำตอบของผู้รีวิว) แล้วคิด "คะแนน Q&A"
// เป็นคะแนนแยกต่างหาก (ไม่รวมกับคะแนน rubric peer review เดิม)
//
// การลิงก์: clipCode (ไฟล์ผู้รีวิว) = รหัส นศ. เจ้าของ -> คำถามต้นฉบับ (ไฟล์เจ้าของ)
// ใช้ roster sisId<->ชื่อ จากข้อมูล Canvas ที่ระบบมีอยู่แล้ว (students/graders) เป็นสะพาน
// -----------------------------------------------------------------------------
import * as XLSX from 'xlsx';

export const QA_REVIEW_TARGET = 3;      // ต้องรีวิว 3 คลิป
export const QA_MATCH_THRESHOLD = 0.5;  // เกณฑ์ความคล้ายคำถาม (ค่าตั้งต้น — admin ปรับทับได้ต่อรายการ)

// ===== text utils =====
export function normName(s) {
  if (!s) return '';
  const t = String(s).toUpperCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  // รองรับทั้ง "FIRST LAST" และ "LAST, FIRST" ด้วยการเรียง token
  // ตัด token ที่เป็นตัวเลขล้วนทิ้ง (เช่นรหัส นศ. ที่ Canvas ใส่นำหน้าชื่อ "670510370 MARIOAN KAEOTA")
  // เพื่อให้จับคู่กับไฟล์เจ้าของที่มีแค่ชื่อได้
  return t.split(' ').filter((x) => x && !/^\d+$/.test(x)).sort().join(' ');
}

// ตัดรหัส (ตัวเลขนำหน้า) ออกจากชื่อเต็มของ roster เพื่อการแสดงผลที่สะอาด
function stripIdPrefix(full) {
  return String(full || '').replace(/^\s*\d{6,10}\s+/, '').trim();
}

function normText(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // ตัดคำลงท้ายสุภาพที่เป็น noise (ไม่ใช่คีย์เวิร์ดเนื้อหา) — ไม่ตัด อย่างไร/ทำไม/ไหม ที่เป็นคำถามจริง
    .replace(/นะคะ|นะครับ|ครับผม|ครับ|ค่ะ|คะ|จ้ะ|จ้า/g, '')
    .replace(/\s+/g, '')
    .replace(/[?？.,!"'’“”\-—_()/\\]+/g, '');
}

// สร้าง n-gram (bigram + trigram) — bigram ช่วยจับคำไทยสั้น 2-3 พยางค์ได้ดีขึ้น
function ngrams(s) {
  const t = normText(s);
  const set = new Set();
  if (!t) return set;
  if (t.length < 2) { set.add(t); return set; }
  for (let i = 0; i <= t.length - 2; i++) set.add(t.slice(i, i + 2));
  for (let i = 0; i <= t.length - 3; i++) set.add(t.slice(i, i + 3));
  return set;
}

// ความคล้ายคำถามภาษาไทย (0..1) — ผสม Dice กับ containment (overlap coefficient)
// containment = ตัวร่วม / ตัวที่เล็กกว่า → ข้อความสั้นที่เป็น subset ของข้อยาวได้คะแนนสูง
// แก้ปัญหา Jaccard ที่ลงโทษความยาวต่างกัน (ผู้รีวิวถอดคำถามสั้นแต่คีย์เวิร์ดตรง)
export function questionSimilarity(a, b) {
  const A = ngrams(a);
  const B = ngrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const dice = (2 * inter) / (A.size + B.size);
  const small = Math.min(A.size, B.size);
  const contain = inter / small;
  const w = small < 6 ? 0.5 : 0.85; // ข้อความสั้นมาก → เชื่อ containment น้อยลง กัน match มั่ว
  return Math.max(dice, w * contain);
}

function substantive(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (t === '' || /^[-.\s]+$/.test(t)) return false;
  return t.length >= 5;
}

function digitsOnly(s) {
  return String(s == null ? '' : s).replace(/[^\d]/g, '');
}

// ===== xlsx parsing =====
// อ่าน .xlsx (ArrayBuffer จาก browser) -> array ของ row (array of arrays)
export function rowsFromArrayBuffer(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // blankrows:true เพื่อให้ index ของแถวตรงกับเลขแถวจริงใน Excel (ไว้อ้างอิงให้ TA ตรวจย้อนกลับ)
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });
}

function headerIndex(headerRow, keywords) {
  for (let i = 0; i < headerRow.length; i++) {
    const h = String(headerRow[i] || '');
    if (keywords.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// ไฟล์เจ้าของคลิป -> [{ email, name, question, ownAnswer }]
export function parseOwnerRows(rows) {
  if (!rows || !rows.length) return [];
  const hdr = rows[0];
  const iEmail = headerIndex(hdr, ['Email']);
  const iName = headerIndex(hdr, ['Name']);
  const iQ = headerIndex(hdr, ['คำถามปลายเปิด', 'ทิ้งท้ายในคลิป']);
  const iA = headerIndex(hdr, ['คำตอบของคุณเองต่อคำถาม']);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = String((iEmail >= 0 ? row[iEmail] : '') || '').trim();
    const name = String((iName >= 0 ? row[iName] : '') || '').trim();
    if (!email && !name) continue;
    out.push({
      email,
      name,
      question: String((iQ >= 0 ? row[iQ] : '') || '').trim(),
      ownAnswer: String((iA >= 0 ? row[iA] : '') || '').trim(),
      rowNumber: r + 1, // เลขแถวจริงใน Excel (header = แถว 1)
    });
  }
  return out;
}

// ไฟล์ผู้รีวิว -> [{ reviewerEmail, reviewerName, order, clipCode, transcribedQ, myAnswer, publish, publishReason }]
export function parseReviewerRows(rows) {
  if (!rows || !rows.length) return [];
  const hdr = rows[0];
  const iEmail = headerIndex(hdr, ['Email']);
  const iName = headerIndex(hdr, ['Name']);
  const iOrder = headerIndex(hdr, ['ลำดับที่', 'คลิปลำดับ', 'ลำดับ']);
  const iCode = headerIndex(hdr, ['รหัสคลิป']);
  const iQ = headerIndex(hdr, ['เพื่อนตั้งคำถามทิ้งท้าย', 'เพื่อนตั้งคำถาม', 'คำถามทิ้งท้าย']);
  const iA = headerIndex(hdr, ['คำตอบของคุณต่อคำถาม']);
  const iPub = headerIndex(hdr, ['เผยแพร่สู่สาธารณะ', 'ควรได้รับการเผยแพร่', 'เผยแพร่']);
  const iReason = headerIndex(hdr, ['เหตุผล']);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const email = String((iEmail >= 0 ? row[iEmail] : '') || '').trim();
    const name = String((iName >= 0 ? row[iName] : '') || '').trim();
    const code = digitsOnly(iCode >= 0 ? row[iCode] : '');
    if (!email && !name && !code) continue;
    out.push({
      reviewerEmail: email,
      reviewerName: name,
      order: String((iOrder >= 0 ? row[iOrder] : '') || '').trim(),
      clipCode: code,
      transcribedQ: String((iQ >= 0 ? row[iQ] : '') || '').trim(),
      myAnswer: String((iA >= 0 ? row[iA] : '') || '').trim(),
      publish: String((iPub >= 0 ? row[iPub] : '') || '').trim(),
      publishReason: String((iReason >= 0 ? row[iReason] : '') || '').trim(),
      rowNumber: r + 1, // เลขแถวจริงใน Excel (header = แถว 1)
    });
  }
  return out;
}

// roster จากข้อมูล Canvas เดิม (students/graders key = "<sisId> <ชื่อ>")
export function buildRoster(students, graders) {
  const nameToId = {};
  const idToName = {};
  const add = (id, full) => {
    id = String(id || '').trim();
    full = String(full || '').trim();
    if (!id) return;
    if (full) nameToId[normName(full)] = id; // normName ตัด token ตัวเลขทิ้งอยู่แล้ว
    const clean = stripIdPrefix(full) || full; // เก็บชื่อสะอาด (ไม่มีรหัสนำหน้า) ไว้แสดงผล
    if (!idToName[id]) idToName[id] = clean;
  };
  Object.values(students || {}).forEach((s) => add(s.studentId, s.fullName || s.studentName));
  Object.values(graders || {}).forEach((g) => add(g.graderId, g.fullName || g.graderName));
  return { nameToId, idToName };
}

/**
 * จับคู่ + คิดคะแนน Q&A
 * @param {{ ownerData, reviewerData, students, graders, threshold? }} args
 * @returns {{ reviews, reviewers, stats }}
 */
export function computeQA({ ownerData, reviewerData, students, graders, threshold = QA_MATCH_THRESHOLD }) {
  const { nameToId, idToName } = buildRoster(students, graders);

  // แผนที่คำถามเจ้าของ: ตาม sisId และตามชื่อ
  const ownerQById = {};
  const ownerQByName = {};
  (ownerData || []).forEach((o) => {
    if (!o.question) return;
    const prefix = (o.email || '').split('@')[0];
    const id = /^\d{9,10}$/.test(prefix) ? prefix : nameToId[normName(o.name)] || null;
    const rec = { question: o.question, ownAnswer: o.ownAnswer, name: o.name };
    if (id) ownerQById[id] = rec;
    if (o.name) ownerQByName[normName(o.name)] = rec;
  });

  // แผนที่คะแนนเจ้าของคลิป (key = sisId) + เซ็ตไว้ categorize เคส "ไม่พบคำถาม"
  // ตั้งคำถาม 1 คะแนน + ตอบคำถามตัวเอง 1 คะแนน = เต็ม 2
  const owners = {};
  const ownerSubmittedIds = new Set();   // เจ้าของที่ "ส่งฟอร์ม" (resolve id ได้)
  const ownerSubmittedNames = new Set(); // เจ้าของที่ส่งฟอร์ม (ตามชื่อ)
  (ownerData || []).forEach((o) => {
    const prefix = (o.email || '').split('@')[0];
    const id = /^\d{9,10}$/.test(prefix) ? prefix : nameToId[normName(o.name)] || null;
    const nn = o.name ? normName(o.name) : '';
    if (nn) ownerSubmittedNames.add(nn);
    if (id) ownerSubmittedIds.add(id);
    if (!id) return; // ไม่มี sisId → join กับหน้าคะแนนชิ้นงานไม่ได้ (นับเป็นส่งฟอร์มแล้วผ่าน name set)
    const posed = substantive(o.question);
    const answered = substantive(o.ownAnswer);
    owners[id] = {
      ownerId: id,
      ownerName: o.name || idToName[id] || '',
      question: o.question || '',
      ownAnswer: o.ownAnswer || '',
      posed,
      answered,
      score: (posed ? 1 : 0) + (answered ? 1 : 0),
      rowNumber: o.rowNumber ?? null, // แถวใน MS Form ไฟล์เจ้าของ
    };
  });

  const reviews = [];
  const reviewers = {};
  let resolvedOwner = 0;
  const unresolved = { bad_clipcode: 0, linked_no_question: 0, owner_not_submitted: 0 };

  (reviewerData || []).forEach((rv) => {
    if (!rv.clipCode && !rv.reviewerName) return;

    // หา "คำถามต้นฉบับ" ของเจ้าของคลิป
    let ownerRec = ownerQById[rv.clipCode];
    if (!ownerRec) {
      const nm = idToName[rv.clipCode];
      if (nm) ownerRec = ownerQByName[normName(nm)];
    }
    const ownerQuestion = ownerRec ? ownerRec.question : '';
    const ownerName = ownerRec ? ownerRec.name : idToName[rv.clipCode] || '';
    if (ownerQuestion) resolvedOwner++;

    // จำแนกสาเหตุที่ "ไม่พบคำถามต้นฉบับ" (ตอบข้อ #3)
    let reason = '';
    if (!ownerQuestion) {
      const rosterName = idToName[rv.clipCode] ? normName(idToName[rv.clipCode]) : '';
      if (!/^\d{9,10}$/.test(rv.clipCode)) {
        reason = 'bad_clipcode';
      } else if (ownerSubmittedIds.has(rv.clipCode) || (rosterName && ownerSubmittedNames.has(rosterName))) {
        reason = 'linked_no_question';
      } else {
        reason = 'owner_not_submitted';
      }
      unresolved[reason] = (unresolved[reason] || 0) + 1;
    }

    // ผูกผู้รีวิวกับ grader เดิม
    const rPrefix = (rv.reviewerEmail || '').split('@')[0];
    const reviewerId = /^\d{9,10}$/.test(rPrefix) ? rPrefix : nameToId[normName(rv.reviewerName)] || '';
    const reviewerKey = reviewerId || normName(rv.reviewerName);

    const matchScore = ownerQuestion ? questionSimilarity(ownerQuestion, rv.transcribedQ) : null;
    const watched = matchScore != null && matchScore >= threshold;
    const answered = substantive(rv.myAnswer);
    const full = watched && answered;

    reviews.push({
      reviewerId,
      reviewerName: rv.reviewerName,
      reviewerKey,
      clipCode: rv.clipCode,
      ownerName,
      ownerQuestion,
      transcribedQ: rv.transcribedQ,
      myAnswer: rv.myAnswer,
      matchScore: matchScore == null ? null : Math.round(matchScore * 100) / 100,
      watched,
      answered,
      full,
      publish: rv.publish,
      reason, // '' ถ้าเจอคำถาม, else bad_clipcode|linked_no_question|owner_not_submitted
      rowNumber: rv.rowNumber ?? null, // แถวใน MS Form ไฟล์ผู้รีวิว
      reviewerEmail: rv.reviewerEmail || '', // ไว้ให้ TA ยืนยันกับต้นทาง
      order: rv.order || '',
      publishReason: rv.publishReason || '',
    });

    if (!reviewers[reviewerKey]) {
      reviewers[reviewerKey] = {
        reviewerId,
        reviewerName: rv.reviewerName,
        submitted: 0,
        watched: 0,
        answered: 0,
        full: 0,
        clips: [],
      };
    }
    const a = reviewers[reviewerKey];
    a.submitted++;
    if (watched) a.watched++;
    if (answered) a.answered++;
    if (full) a.full++;
    if (rv.clipCode) a.clips.push(rv.clipCode);
  });

  // สรุปคะแนน + flag ต่อผู้รีวิว
  Object.values(reviewers).forEach((a) => {
    a.qaScore = Math.min(a.full, QA_REVIEW_TARGET);
    a.flags = [];
    if (a.answered > a.watched) a.flags.push('qa_no_match'); // ตอบแต่คำถามไม่ตรง = อาจไม่ได้ดู
    if (a.full < QA_REVIEW_TARGET) a.flags.push('qa_incomplete');
  });

  const ownerList = Object.values(owners);
  const stats = {
    reviewerCount: Object.keys(reviewers).length,
    reviewCount: reviews.length,
    ownerResolved: resolvedOwner,
    ownerResolvedPct: reviews.length ? Math.round((100 * resolvedOwner) / reviews.length) : 0,
    fullCount: reviews.filter((r) => r.full).length,
    threshold,
    target: QA_REVIEW_TARGET,
    unresolved, // เคส "ไม่พบคำถามต้นฉบับ" แยกตามสาเหตุ
    ownerCount: ownerList.length,
    ownerPosedCount: ownerList.filter((o) => o.posed).length,
    ownerAnsweredCount: ownerList.filter((o) => o.answered).length,
  };

  return { reviews, reviewers, owners, stats };
}
