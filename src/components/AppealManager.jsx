// src/components/AppealManager.jsx
// -----------------------------------------------------------------------------
// admin/TA: จัดการคำร้องอุทธรณ์คะแนน — อัปโหลดไฟล์ MS Form (คำร้อง), ตั้งเทมเพลต
// checklist, ติ๊ก + พิมพ์ข้อความตอบกลับ + ตั้งสถานะ (นักศึกษาเห็นผ่านพอร์ทัล)
// เขียนลง semesters/{id}/appeals/{sisId}
// -----------------------------------------------------------------------------
import React, { useState, useEffect, useCallback } from 'react';
import { doc, collection, onSnapshot, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { rowsFromArrayBuffer } from '../utils/qaMatcher';
import { findUserByEmail, postSubmissionComment } from '../utils/canvasApi';
import { Upload, Save, Search, MessageSquare, CheckCircle2, ChevronDown, ChevronRight, Send, Copy } from 'lucide-react';

const STATUS_OPTS = [
  { v: 'received', label: 'รับเรื่องแล้ว' },
  { v: 'in_review', label: 'กำลังตรวจสอบ' },
  { v: 'resolved', label: 'ตรวจสอบเสร็จสิ้น' },
];

// คอลัมน์ในไฟล์ MS Form อ้างอิงด้วยตัวอักษร (A=0) — H=7, I=8, K=10
const COL_H = 7;
const COL_I = 8;
const COL_K = 10;
const colLetter = (i) => String.fromCharCode(65 + i);

function fmtTs(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
    return d ? d.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '';
  } catch { return ''; }
}

// parse ไฟล์ MS Form คำร้อง -> [{ sisId, email, name, typedId, text, answers }]
// answers = คำตอบรายคอลัมน์ (เก็บ index เดิมของคอลัมน์ไว้ เพื่อจัดสีตามตัวอักษรคอลัมน์ H/I/K)
function parseAppeals(rows) {
  if (!rows || !rows.length) return [];
  const hdr = (rows[0] || []).map((h) => String(h || ''));
  const emailIdx = hdr.findIndex((h) => /email/i.test(h));
  const nameIdx = hdr.findIndex((h) => /name|ชื่อ/i.test(h));
  const typedIdIdx = hdr.findIndex((h) => /รหัสนักศึกษา|รหัส นักศึกษา|9\s*หลัก|student\s*id/i.test(h));
  const isMeta = (i, h) =>
    i === emailIdx || i === nameIdx ||
    /^(id|start time|completion time|last modified|เวลาเริ่ม|เวลาที่ทำ)/i.test(h);
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const email = String((emailIdx >= 0 ? row[emailIdx] : '') || '').trim().toLowerCase();
    if (!email) continue;
    // key = prefix อีเมล (รองรับทั้งอีเมลตัวเลขและอีเมลชื่อ เช่น thanatip.ch@cmu.ac.th)
    // การส่งฟีดแบคเข้า Canvas match ด้วย "อีเมลเต็ม" อยู่แล้ว จึงไม่บังคับรูปแบบรหัส
    const sisId = email.split('@')[0];
    const name = String((nameIdx >= 0 ? row[nameIdx] : '') || '').trim();
    const typedId = typedIdIdx >= 0 ? String(row[typedIdIdx] == null ? '' : row[typedIdIdx]).trim() : '';
    const answers = [];   // [{ i, v }] คงลำดับ/ดัชนีคอลัมน์เดิม
    const parts = [];     // ข้อความรวม (fallback + ใช้ประกอบฟีดแบค) — คงรูปแบบเดิม
    hdr.forEach((h, i) => {
      if (isMeta(i, h)) return;
      const v = String(row[i] == null ? '' : row[i]).trim();
      if (!v) return;
      answers.push({ i, v });
      parts.push(`${h}: ${v}`);
    });
    out.push({ sisId, email, name, typedId, text: parts.join('\n'), answers });
  }
  return out;
}

export default function AppealManager({ semesterId, canManage = true }) {
  const { currentUser, userData } = useAuth();
  const [appeals, setAppeals] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateText, setTemplateText] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [drafts, setDrafts] = useState({}); // sisId -> { reply, checklist:Set, status }
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [cfg, setCfg] = useState({ appealDeadline: '', scoreAnnounceDate: '', appealsClosed: false });
  const [cfgSaving, setCfgSaving] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testListText, setTestListText] = useState('');
  const [testSaving, setTestSaving] = useState(false);
  // ส่งฟีดแบคเข้า Canvas
  const [canvasCfg, setCanvasCfg] = useState(null); // { apiKey, canvasUrl, courseId }
  const [fbAsgId, setFbAsgId] = useState('');       // assignment id ปลายทางฟีดแบค
  const [idCache] = useState(() => new Map()); // email -> canvasUserId (cache กันค้นซ้ำ)
  const [sendingId, setSendingId] = useState('');
  const [sentFilter, setSentFilter] = useState('all'); // all | unsent | sent
  const [bulk, setBulk] = useState(null); // { running, done, total, ok, fail:[{name,reason}] }

  // โหลด appeals (realtime) + templates + portalConfig
  useEffect(() => {
    if (!semesterId) { setAppeals([]); setTemplates([]); setTemplateText(''); setCfg({ appealDeadline: '', scoreAnnounceDate: '', appealsClosed: false }); return; }
    const unsub = onSnapshot(collection(db, 'semesters', semesterId, 'appeals'), (snap) => {
      setAppeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => console.error('appeals load', e));
    idCache.clear(); // ล้าง cache เมื่อเปลี่ยนเทอม
    getDoc(doc(db, 'semesters', semesterId)).then((s) => {
      const d = s.exists() ? s.data() : {};
      const t = d.appealTemplates || [];
      setTemplates(t); setTemplateText(t.join('\n'));
      setCanvasCfg((prev) => ({ ...(prev || {}), canvasUrl: d.canvasUrl || (prev && prev.canvasUrl) || '', courseId: d.canvasCourseId || '' }));
    }).catch(() => {});
    getDoc(doc(db, 'semesters', semesterId, 'portalConfig', 'info')).then((s) => {
      if (s.exists()) {
        const d = s.data();
        setCfg({ appealDeadline: d.appealDeadline || '', scoreAnnounceDate: d.scoreAnnounceDate || '', appealsClosed: !!d.appealsClosed });
        setTestMode(!!d.testMode);
        setTestListText((Array.isArray(d.testAllowlist) ? d.testAllowlist : []).join('\n'));
        setFbAsgId(d.feedbackAssignmentId || '');
      }
    }).catch(() => {});
    // token ของ admin สำหรับเรียก Canvas
    if (currentUser?.uid) {
      getDoc(doc(db, 'canvasConfigs', currentUser.uid)).then((s) => {
        if (s.exists()) { const d = s.data(); setCanvasCfg((prev) => ({ ...(prev || {}), apiKey: d.canvasApiKey || d.apiKey || '', canvasUrl: d.canvasUrl || (prev && prev.canvasUrl) || '' })); }
      }).catch(() => {});
    }
    return unsub;
  }, [semesterId, currentUser]);

  const saveCfg = async (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next); setCfgSaving(true);
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'portalConfig', 'info'), {
        appealDeadline: next.appealDeadline || '', scoreAnnounceDate: next.scoreAnnounceDate || '',
        appealsClosed: !!next.appealsClosed, updatedAt: serverTimestamp(),
      }, { merge: true });
      flash('บันทึกกำหนดการแล้ว');
    } catch (err) { flash(`บันทึกไม่สำเร็จ: ${err.message}`); }
    finally { setCfgSaving(false); }
  };

  const saveTest = async (nextMode) => {
    const mode = nextMode == null ? testMode : nextMode;
    // รับรหัสทุกรูปแบบที่ Canvas ส่งมา (ไม่บังคับว่าต้องเป็นตัวเลขล้วน) + ตัดซ้ำ
    const list = [...new Set(testListText.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
    setTestMode(mode); setTestSaving(true);
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'portalConfig', 'info'), {
        testMode: mode, testAllowlist: list, updatedAt: serverTimestamp(),
      }, { merge: true });
      flash(mode ? `เปิดโหมดทดสอบ (${list.length} รหัส)` : 'ปิดโหมดทดสอบ — เปิดให้ทุกคน');
    } catch (err) { flash(`บันทึกไม่สำเร็จ: ${err.message}`); }
    finally { setTestSaving(false); }
  };

  const flash = (m) => { setNotice(m); setTimeout(() => setNotice((n) => (n === m ? '' : n)), 4000); };

  const saveFbAsg = async () => {
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'portalConfig', 'info'), { feedbackAssignmentId: fbAsgId.trim(), updatedAt: serverTimestamp() }, { merge: true });
      flash('บันทึก assignment ปลายทางฟีดแบคแล้ว');
    } catch (err) { flash(`บันทึกไม่สำเร็จ: ${err.message}`); }
  };

  const composeFeedback = (a) => {
    const parts = [];
    if (a.checklist && a.checklist.length) parts.push(a.checklist.map((c) => '• ' + c).join('\n'));
    if (a.reply) parts.push(a.reply);
    return parts.join('\n\n');
  };

  // หา target ของ นศ. ใน Canvas: ค้นด้วยอีเมล (เร็ว, cache) ไม่งั้น fallback sis_user_id
  const resolveTarget = async (a) => {
    const cfg = { apiKey: canvasCfg.apiKey, canvasUrl: canvasCfg.canvasUrl };
    const email = (a.email || '').toLowerCase();
    if (email) {
      if (idCache.has(email)) { const v = idCache.get(email); if (v) return String(v); }
      else {
        const id = await findUserByEmail(cfg, canvasCfg.courseId, email);
        idCache.set(email, id);
        if (id) return String(id);
      }
    }
    if (/^\d{6,10}$/.test(String(a.sisId || ''))) return `sis_user_id:${a.sisId}`;
    return null;
  };

  // ส่ง 1 ราย -> คืน { ok, reason }
  const sendOne = async (a) => {
    const text = composeFeedback(a);
    if (!text.trim()) return { ok: false, reason: 'ยังไม่มีข้อความตอบกลับ' };
    if (!canvasCfg?.apiKey || !canvasCfg?.courseId) return { ok: false, reason: 'ยังไม่มี Canvas token/course' };
    const target = await resolveTarget(a);
    if (!target) return { ok: false, reason: `ไม่พบอีเมล ${a.email || a.id} ใน Canvas` };
    await postSubmissionComment(
      { apiKey: canvasCfg.apiKey, canvasUrl: canvasCfg.canvasUrl },
      { courseId: canvasCfg.courseId, assignmentId: fbAsgId.trim(), userId: target, text },
    );
    await setDoc(doc(db, 'semesters', semesterId, 'appeals', a.id), { feedbackSentAt: serverTimestamp() }, { merge: true });
    return { ok: true };
  };

  const sendFeedback = async (a) => {
    if (!fbAsgId.trim()) { flash('ตั้ง assignment ปลายทางก่อน (ด้านบน)'); return; }
    setSendingId(a.id);
    try {
      const r = await sendOne(a);
      flash(r.ok ? `ส่งฟีดแบคให้ ${a.name || a.id} แล้ว` : `ส่งไม่สำเร็จ: ${r.reason}`);
    } catch (err) { flash(`ส่งไม่สำเร็จ: ${err.message || err}`); }
    finally { setSendingId(''); }
  };

  // ส่งเป็นชุด: เฉพาะที่ตอบแล้ว + ยังไม่ส่ง
  const sendAll = async () => {
    if (!fbAsgId.trim()) { flash('ตั้ง assignment ปลายทางก่อน (ด้านบน)'); return; }
    const targets = appeals.filter((a) => a.reply && !a.feedbackSentAt);
    if (targets.length === 0) { flash('ไม่มีคำร้องที่ตอบแล้วและยังไม่ส่ง'); return; }
    setBulk({ running: true, done: 0, total: targets.length, ok: 0, fail: [] });
    for (const a of targets) {
      try {
        const r = await sendOne(a);
        setBulk((b) => ({ ...b, done: b.done + 1, ok: b.ok + (r.ok ? 1 : 0), fail: r.ok ? b.fail : [...b.fail, { name: a.name || a.email || a.id, reason: r.reason }] }));
      } catch (err) {
        setBulk((b) => ({ ...b, done: b.done + 1, fail: [...b.fail, { name: a.name || a.email || a.id, reason: err.message || String(err) }] }));
      }
    }
    setBulk((b) => ({ ...b, running: false }));
  };

  const saveTemplates = async () => {
    const t = templateText.split('\n').map((x) => x.trim()).filter(Boolean);
    await setDoc(doc(db, 'semesters', semesterId), { appealTemplates: t }, { merge: true });
    setTemplates(t); flash('บันทึกเทมเพลตแล้ว');
  };

  const handleImport = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !semesterId) return;
    setImporting(true);
    try {
      let rowsAll = [];
      for (const f of files) rowsAll = rowsAll.concat(parseAppeals(rowsFromArrayBuffer(await f.arrayBuffer())));
      // group ตาม sisId -> submissions[]
      const byId = {};
      for (const a of rowsAll) {
        if (!byId[a.sisId]) byId[a.sisId] = { sisId: a.sisId, email: a.email, name: a.name, typedId: a.typedId || '', submissions: [] };
        byId[a.sisId].submissions.push({ text: a.text, answers: a.answers || [] });
        if (a.name && !byId[a.sisId].name) byId[a.sisId].name = a.name;
        if (a.typedId && !byId[a.sisId].typedId) byId[a.sisId].typedId = a.typedId;
      }
      const entries = Object.values(byId);
      for (const en of entries) {
        await setDoc(doc(db, 'semesters', semesterId, 'appeals', en.sisId), {
          sisId: en.sisId, email: en.email, name: en.name, typedId: en.typedId || '', submissions: en.submissions,
          importedAt: serverTimestamp(), importedBy: currentUser?.uid || '',
        }, { merge: true });
      }
      flash(`นำเข้าคำร้อง ${entries.length} คน`);
    } catch (err) {
      flash(`นำเข้าไม่สำเร็จ: ${err.message}`);
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const findAppeal = useCallback((id) => appeals.find((a) => a.id === id) || {}, [appeals]);
  const draftFor = useCallback((a) => {
    return drafts[a.id] || { reply: a.reply || '', checklist: new Set(a.checklist || []), status: a.status || 'received' };
  }, [drafts]);

  const setDraft = (id, patch) => setDrafts((prev) => {
    const a = findAppeal(id);
    const base = prev[id] || { reply: a.reply || '', checklist: new Set(a.checklist || []), status: a.status || 'received' };
    return { ...prev, [id]: { ...base, ...patch } };
  });

  const saveReply = async (a) => {
    const d = draftFor(a);
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'appeals', a.id), {
        reply: d.reply, checklist: Array.from(d.checklist), status: d.status,
        updatedBy: currentUser?.uid || '', updatedByName: userData?.displayName || currentUser?.email || '',
        updatedAt: serverTimestamp(),
      }, { merge: true });
      flash(`บันทึกการตอบกลับ ${a.name || a.id} แล้ว`);
    } catch (err) {
      flash(`บันทึกไม่สำเร็จ: ${err.message}`);
    }
  };

  const filtered = appeals.filter((a) => {
    if (sentFilter === 'unsent' && !(a.reply && !a.feedbackSentAt)) return false;
    if (sentFilter === 'sent' && !a.feedbackSentAt) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (a.id || '').includes(q) || (a.typedId || '').includes(q) || (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q);
  });

  const statusCount = STATUS_OPTS.map((s) => ({ ...s, n: appeals.filter((a) => (a.status || 'received') === s.v).length }));

  if (!semesterId) return null;

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-1 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-amber-400" /> จัดการอุทธรณ์คะแนน</h3>
      <p className="text-slate-400 text-sm mb-4">อัปโหลดคำร้องจาก MS Form → พิมพ์ข้อความตอบกลับ → ส่งเป็นคอมเมนต์เข้า Canvas ให้ นศ. แต่ละคน</p>

      {notice && <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-cyan-900/40 text-cyan-200">{notice}</div>}

      {/* import (admin เท่านั้น) + สรุปจำนวน */}
      <div className="mb-4 flex items-center flex-wrap gap-3">
        {canManage && (
          <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium disabled:opacity-50">
            <Upload className="w-4 h-4" /> {importing ? 'กำลังนำเข้า...' : 'อัปโหลดคำร้อง MS Form (.xlsx)'}
            <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleImport} disabled={importing} />
          </label>
        )}
        <span className="text-xs text-slate-500">
          รวม {appeals.length} · {statusCount.map((s) => `${s.label} ${s.n}`).join(' · ')} · รับทราบคะแนน {appeals.filter((a) => a.acknowledged).length}
          {canManage && <> · <span className="text-green-400">ส่ง Canvas แล้ว {appeals.filter((a) => a.feedbackSentAt).length}</span> · <span className="text-amber-400">ตอบแล้วยังไม่ส่ง {appeals.filter((a) => a.reply && !a.feedbackSentAt).length}</span></>}
        </span>
      </div>

      {/* ส่วนตั้งค่า/จัดการ — admin เท่านั้น */}
      {canManage && (<>
      {/* กำหนดการ + เปิด/ปิดรับคำร้อง */}
      <div className="mb-4 bg-slate-800/40 rounded-lg p-3 space-y-2">
        <div className="text-sm text-slate-300 font-medium">กำหนดการ (นักศึกษาเห็นในพอร์ทัล)</div>
        <div className="flex flex-wrap gap-4">
          <label className="text-xs text-slate-400">ยื่นขอตรวจสอบได้ถึง
            <input type="date" value={cfg.appealDeadline} onChange={(e) => saveCfg({ appealDeadline: e.target.value })}
              className="block mt-1 px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm" />
          </label>
          <label className="text-xs text-slate-400">ประกาศคะแนนจริง (ลง Canvas)
            <input type="date" value={cfg.scoreAnnounceDate} onChange={(e) => saveCfg({ scoreAnnounceDate: e.target.value })}
              className="block mt-1 px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={cfg.appealsClosed} onChange={(e) => saveCfg({ appealsClosed: e.target.checked })} disabled={cfgSaving} />
          <span>ปิดรับคำร้องทันที (ไม่ต้องรอถึงกำหนด) — นศ. ยังดูคะแนน/สถานะได้</span>
        </label>
      </div>

      {/* โหมดทดสอบ */}
      <div className="mb-4 bg-amber-950/30 border border-amber-500/20 rounded-lg p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer font-medium">
          <input type="checkbox" checked={testMode} onChange={(e) => saveTest(e.target.checked)} disabled={testSaving} />
          <span>🧪 โหมดทดสอบ — เปิดให้เข้าเฉพาะรหัสด้านล่างเท่านั้น (คนอื่นเจอ "ยังไม่เปิดให้บริการ")</span>
        </label>
        <textarea value={testListText} onChange={(e) => setTestListText(e.target.value)} rows={3}
          placeholder={'ใส่รหัสนักศึกษาที่อนุญาต (1 รหัส/บรรทัด หรือคั่นด้วยเว้นวรรค/คอมมา)\n660810437\n670510370'}
          className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm font-mono" />
        <button onClick={() => saveTest()} disabled={testSaving}
          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
          <Save className="w-3.5 h-3.5" /> {testSaving ? 'กำลังบันทึก...' : 'บันทึกรายชื่อทดสอบ'}
        </button>
        <p className="text-xs text-slate-500">พร้อมเปิดให้ทุกคน = ปิด checkbox นี้ (บันทึกอัตโนมัติ)</p>
      </div>

      {/* ส่งฟีดแบคเข้า Canvas */}
      <div className="mb-4 bg-slate-800/40 rounded-lg p-3 space-y-2">
        <div className="text-sm text-slate-300 font-medium">ส่งฟีดแบคเข้า Canvas (คอมเมนต์ใน assignment)</div>
        <p className="text-xs text-slate-500">สร้าง assignment ใหม่ใน Canvas สำหรับฟีดแบค แล้วใส่ <span className="text-slate-300">assignment id</span> (จาก URL <span className="text-slate-300">.../assignments/&lt;id&gt;</span>) — ระบบจะโพสต์ข้อความตอบกลับเป็นคอมเมนต์ให้ นศ. แต่ละคน (ไม่แตะคะแนน)</p>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="text" value={fbAsgId} onChange={(e) => setFbAsgId(e.target.value)} placeholder="assignment id เช่น 123456"
            className="w-48 px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm" />
          <button onClick={saveFbAsg} className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm flex items-center gap-1"><Save className="w-3.5 h-3.5" /> บันทึก</button>
          {!canvasCfg?.apiKey && <span className="text-xs text-amber-400">⚠️ ยังไม่มี Canvas token (ดึงข้อมูล Canvas ในหน้าจัดการก่อน)</span>}
        </div>
        {/* ส่งเป็นชุด */}
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button onClick={sendAll} disabled={bulk?.running}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> {bulk?.running ? `กำลังส่ง ${bulk.done}/${bulk.total}...` : 'ส่งฟีดแบคที่ตอบแล้วทั้งหมด (ข้ามที่ส่งแล้ว)'}
          </button>
          {bulk && !bulk.running && (
            <span className="text-xs text-slate-300">
              เสร็จ: สำเร็จ {bulk.ok} · ล้มเหลว {bulk.fail.length}
            </span>
          )}
        </div>
        {bulk && !bulk.running && bulk.fail.length > 0 && (
          <div className="text-xs text-red-300 bg-red-950/30 rounded p-2 max-h-32 overflow-y-auto">
            ล้มเหลว: {bulk.fail.map((f, i) => <div key={i}>• {f.name} — {f.reason}</div>)}
          </div>
        )}
      </div>

      {/* templates */}
      <details className="mb-4 bg-slate-800/40 rounded-lg p-3">
        <summary className="cursor-pointer text-sm text-slate-300">เทมเพลตข้อความ (checklist สำเร็จรูป — 1 บรรทัด/ข้อ)</summary>
        <textarea
          value={templateText} onChange={(e) => setTemplateText(e.target.value)} rows={4}
          placeholder={'ตรวจสอบคะแนนคลิปใน Canvas แล้ว — ถูกต้องตามเดิม\nแก้ไขคะแนน Q&A ให้แล้ว\nคำถามที่ถอดมาตรงตามเกณฑ์แล้ว'}
          className="mt-2 w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm"
        />
        <button onClick={saveTemplates} className="mt-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm flex items-center gap-1"><Save className="w-3.5 h-3.5" /> บันทึกเทมเพลต</button>
      </details>
      </>)}

      {/* search + filter */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นรหัส / ชื่อ / อีเมล"
            className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm" />
        </div>
        {canManage && (
          <select value={sentFilter} onChange={(e) => setSentFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm">
            <option value="all">ทั้งหมด</option>
            <option value="unsent">ตอบแล้ว · ยังไม่ส่ง Canvas</option>
            <option value="sent">ส่ง Canvas แล้ว</option>
          </select>
        )}
      </div>

      {/* list */}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && <div className="text-sm text-slate-500 italic py-6 text-center">ยังไม่มีคำร้อง (อัปโหลดไฟล์ MS Form ด้านบน)</div>}
        {filtered.map((a) => {
          const open = expanded === a.id;
          const d = draftFor(a);
          const stLabel = STATUS_OPTS.find((s) => s.v === (a.status || 'received'))?.label;
          const idForCopy = a.typedId || a.id;
          return (
            <div key={a.id} className="bg-slate-800/40 rounded-lg border border-white/5">
              <button onClick={() => setExpanded(open ? null : a.id)} className="w-full flex items-center justify-between px-3 py-2 text-left">
                <span className="flex items-center gap-2 text-sm">
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(idForCopy); flash(`คัดลอกรหัส ${idForCopy}`); }}
                    title="คลิกเพื่อคัดลอกรหัสไปค้นหา"
                    className="font-mono text-base font-bold text-cyan-300 bg-cyan-500/10 px-2 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer hover:bg-cyan-500/20 select-all"
                  >{idForCopy}<Copy className="w-3 h-3 opacity-60" /></span>
                  <span className="text-slate-300">{a.name || a.email || ''}</span>
                  {a.acknowledged && <span className="text-xs text-green-400" title="นักศึกษากดรับทราบคะแนนแล้ว">✓ รับทราบ</span>}
                  {(!a.submissions || a.submissions.length === 0) && a.acknowledged && <span className="text-xs text-slate-500">(ไม่ได้ยื่นอุทธรณ์)</span>}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${a.status === 'resolved' ? 'bg-green-900/40 text-green-300' : a.status === 'in_review' ? 'bg-amber-900/40 text-amber-300' : 'bg-blue-900/40 text-blue-300'}`}>{stLabel}</span>
              </button>
              {open && (
                <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-3">
                  {/* คำร้อง */}
                  {(a.submissions || []).map((s, i) => (
                    <div key={i} className="bg-slate-900/60 rounded p-2 text-xs text-slate-300">
                      <div className="mb-1 flex items-center gap-2 text-slate-500">
                        {s.category && <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{s.category}</span>}
                        <span>{s.source === 'portal' ? 'ยื่นในพอร์ทัล' : 'MS Form'}</span>
                      </div>
                      {s.answers && s.answers.length > 0 ? (
                        // แสดง "คำตอบ" อย่างเดียว (ไม่โชว์คำถาม) · ซ่อนคอลัมน์ I
                        // H: เขียวถ้า "คะแนนถูกต้องแล้ว" ไม่งั้นสีร้อน · K: ตัวเข้มอ่านง่าย (สิ่งที่ นศ. ตอบ)
                        <div className="space-y-1">
                          {s.answers.filter((ans) => ans.i !== COL_I).map((ans) => {
                            let cls = 'text-slate-300';
                            if (ans.i === COL_H) cls = /คะแนนถูกต้องแล้ว/.test(ans.v) ? 'text-emerald-400 font-medium' : 'text-rose-400 font-medium';
                            else if (ans.i === COL_K) cls = 'text-slate-50 font-semibold';
                            return <div key={ans.i} className={`whitespace-pre-wrap ${cls}`}>{ans.v}</div>;
                          })}
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{s.text || '—'}</div>
                      )}
                    </div>
                  ))}
                  {/* checklist */}
                  {templates.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400">ติ๊กสิ่งที่ตรวจแล้ว:</div>
                      {templates.map((t, i) => (
                        <label key={i} className="flex items-start gap-2 text-sm cursor-pointer">
                          <input type="checkbox" checked={d.checklist.has(t)} onChange={(e) => {
                            const next = new Set(d.checklist);
                            if (e.target.checked) next.add(t); else next.delete(t);
                            setDraft(a.id, { checklist: next });
                          }} className="mt-1" />
                          <span>{t}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {/* reply */}
                  <textarea value={d.reply} onChange={(e) => setDraft(a.id, { reply: e.target.value })} rows={3}
                    placeholder="ข้อความเพิ่มเติมถึงนักศึกษา..." className="w-full px-3 py-2 bg-slate-900 border border-white/10 rounded-lg text-white text-sm" />
                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={d.status} onChange={(e) => setDraft(a.id, { status: e.target.value })}
                      className="px-3 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-sm">
                      {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                    <button onClick={() => saveReply(a)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm flex items-center gap-1"><Save className="w-3.5 h-3.5" /> บันทึก</button>
                    {canManage && (
                      <button onClick={() => sendFeedback(a)} disabled={sendingId === a.id || !a.reply}
                        title={!a.reply ? 'พิมพ์ข้อความตอบกลับแล้วบันทึกก่อน' : 'โพสต์ข้อความเป็นคอมเมนต์ใน Canvas'}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm flex items-center gap-1 disabled:opacity-50">
                        <Send className="w-3.5 h-3.5" /> {sendingId === a.id ? 'กำลังส่ง...' : 'ส่งฟีดแบคเข้า Canvas'}
                      </button>
                    )}
                    {a.feedbackSentAt && <span className="text-xs text-green-400" title={fmtTs(a.feedbackSentAt)}>✓ ส่งเข้า Canvas แล้ว{fmtTs(a.feedbackSentAt) ? ` · ${fmtTs(a.feedbackSentAt)}` : ''}</span>}
                    {a.updatedByName && <span className="text-xs text-slate-500">แก้ล่าสุดโดย {a.updatedByName}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
