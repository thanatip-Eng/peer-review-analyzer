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
import { Upload, Save, Search, MessageSquare, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';

const STATUS_OPTS = [
  { v: 'received', label: 'รับเรื่องแล้ว' },
  { v: 'in_review', label: 'กำลังตรวจสอบ' },
  { v: 'resolved', label: 'ตรวจสอบเสร็จสิ้น' },
];

// parse ไฟล์ MS Form คำร้อง -> [{ sisId, email, name, text }]
function parseAppeals(rows) {
  if (!rows || !rows.length) return [];
  const hdr = (rows[0] || []).map((h) => String(h || ''));
  const emailIdx = hdr.findIndex((h) => /email/i.test(h));
  const nameIdx = hdr.findIndex((h) => /name|ชื่อ/i.test(h));
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const email = String((emailIdx >= 0 ? row[emailIdx] : '') || '').trim().toLowerCase();
    if (!email) continue;
    const sisId = email.split('@')[0];
    if (!/^\d{9,10}$/.test(sisId)) continue;
    const name = String((nameIdx >= 0 ? row[nameIdx] : '') || '').trim();
    const parts = [];
    hdr.forEach((h, i) => {
      if (i === emailIdx || i === nameIdx) return;
      if (/^(id|start time|completion time|last modified|เวลาเริ่ม|เวลาที่ทำ)/i.test(h)) return;
      const v = String(row[i] == null ? '' : row[i]).trim();
      if (v) parts.push(`${h}: ${v}`);
    });
    out.push({ sisId, email, name, text: parts.join('\n') });
  }
  return out;
}

export default function AppealManager({ semesterId }) {
  const { currentUser, userData } = useAuth();
  const [appeals, setAppeals] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateText, setTemplateText] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [drafts, setDrafts] = useState({}); // sisId -> { reply, checklist:Set, status }
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');

  // โหลด appeals (realtime) + templates
  useEffect(() => {
    if (!semesterId) { setAppeals([]); setTemplates([]); setTemplateText(''); return; }
    const unsub = onSnapshot(collection(db, 'semesters', semesterId, 'appeals'), (snap) => {
      setAppeals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (e) => console.error('appeals load', e));
    getDoc(doc(db, 'semesters', semesterId)).then((s) => {
      const t = (s.exists() && s.data().appealTemplates) || [];
      setTemplates(t); setTemplateText(t.join('\n'));
    }).catch(() => {});
    return unsub;
  }, [semesterId]);

  const flash = (m) => { setNotice(m); setTimeout(() => setNotice((n) => (n === m ? '' : n)), 3000); };

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
        if (!byId[a.sisId]) byId[a.sisId] = { sisId: a.sisId, email: a.email, name: a.name, submissions: [] };
        byId[a.sisId].submissions.push({ text: a.text });
        if (a.name && !byId[a.sisId].name) byId[a.sisId].name = a.name;
      }
      const entries = Object.values(byId);
      for (const en of entries) {
        await setDoc(doc(db, 'semesters', semesterId, 'appeals', en.sisId), {
          sisId: en.sisId, email: en.email, name: en.name, submissions: en.submissions,
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
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (a.id || '').includes(q) || (a.name || '').toLowerCase().includes(q) || (a.email || '').toLowerCase().includes(q);
  });

  const statusCount = STATUS_OPTS.map((s) => ({ ...s, n: appeals.filter((a) => (a.status || 'received') === s.v).length }));

  if (!semesterId) return null;

  return (
    <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-1 flex items-center gap-2"><MessageSquare className="w-5 h-5 text-amber-400" /> จัดการอุทธรณ์คะแนน</h3>
      <p className="text-slate-400 text-sm mb-4">อัปโหลดคำร้องจาก MS Form แล้วตอบกลับให้นักศึกษาเห็นผ่านพอร์ทัล (login ผ่าน Canvas)</p>

      {notice && <div className="mb-3 text-sm px-3 py-2 rounded-lg bg-cyan-900/40 text-cyan-200">{notice}</div>}

      {/* import */}
      <div className="mb-4">
        <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg text-sm font-medium disabled:opacity-50">
          <Upload className="w-4 h-4" /> {importing ? 'กำลังนำเข้า...' : 'อัปโหลดคำร้อง MS Form (.xlsx)'}
          <input type="file" accept=".xlsx,.xls" multiple className="hidden" onChange={handleImport} disabled={importing} />
        </label>
        <span className="ml-3 text-xs text-slate-500">
          รวม {appeals.length} คำร้อง · {statusCount.map((s) => `${s.label} ${s.n}`).join(' · ')}
        </span>
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

      {/* search */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นรหัส / ชื่อ / อีเมล"
          className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm" />
      </div>

      {/* list */}
      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.length === 0 && <div className="text-sm text-slate-500 italic py-6 text-center">ยังไม่มีคำร้อง (อัปโหลดไฟล์ MS Form ด้านบน)</div>}
        {filtered.map((a) => {
          const open = expanded === a.id;
          const d = draftFor(a);
          const stLabel = STATUS_OPTS.find((s) => s.v === (a.status || 'received'))?.label;
          return (
            <div key={a.id} className="bg-slate-800/40 rounded-lg border border-white/5">
              <button onClick={() => setExpanded(open ? null : a.id)} className="w-full flex items-center justify-between px-3 py-2 text-left">
                <span className="flex items-center gap-2 text-sm">
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span className="font-mono text-cyan-400">{a.id}</span>
                  <span className="text-slate-300">{a.name || a.email || ''}</span>
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
                      <div className="whitespace-pre-wrap">{s.text || '—'}</div>
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
                    <button onClick={() => saveReply(a)} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm flex items-center gap-1"><Save className="w-3.5 h-3.5" /> บันทึก + ส่งให้ นศ.</button>
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
