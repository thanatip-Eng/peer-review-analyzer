// src/components/StudentPortal.jsx
// -----------------------------------------------------------------------------
// พอร์ทัลสำหรับนักศึกษา (เข้าผ่าน Canvas LTI เท่านั้น) — ดูคะแนนจริง + กำหนดการ
// + ยื่นขอตรวจสอบคะแนน (1 ครั้ง) หรือกดรับทราบคะแนน + ติดตามสถานะ/ข้อความตอบกลับ
// แสดงเฉพาะข้อมูลของ uid (รหัส นศ.) ตัวเอง (Firestore rules บังคับ)
// -----------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, CheckCircle2, Clock, Search, MessageSquare, Send, Award, CalendarClock, ThumbsUp } from 'lucide-react';

const CATEGORIES = ['คะแนนคลิป', 'คะแนนตอบคำถามท้ายคลิป', 'คะแนน peer review', 'อื่น ๆ'];

const STATUS = {
  received: { label: 'รับเรื่องแล้ว', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: Clock },
  in_review: { label: 'กำลังตรวจสอบ', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: Search },
  resolved: { label: 'ตรวจสอบเสร็จสิ้น', cls: 'bg-green-500/20 text-green-300 border-green-500/30', icon: CheckCircle2 },
};

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}
function thDate(s) {
  if (!s) return '';
  try { return new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { dateStyle: 'long' }); } catch { return s; }
}

export default function StudentPortal() {
  const { currentUser, userData, logout } = useAuth();
  const sisId = currentUser?.uid;
  const semesterId = userData?.semesterId;
  const ref = sisId && semesterId ? doc(db, 'semesters', semesterId, 'appeals', sisId) : null;

  const [appeal, setAppeal] = useState(undefined); // undefined=loading, null=ไม่มี
  const [scores, setScores] = useState(undefined);
  const [cfg, setCfg] = useState(null); // null=loading
  const [error, setError] = useState('');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    if (!sisId || !semesterId) { setAppeal(null); setScores(null); return; }
    const unsub = onSnapshot(ref,
      (snap) => setAppeal(snap.exists() ? snap.data() : null),
      (err) => { console.error(err); setError('โหลดข้อมูลไม่สำเร็จ'); setAppeal(null); });
    getDoc(doc(db, 'semesters', semesterId, 'studentScores', sisId))
      .then((s) => setScores(s.exists() ? s.data() : null)).catch(() => setScores(null));
    getDoc(doc(db, 'semesters', semesterId, 'portalConfig', 'info'))
      .then((s) => {
        const d = s.exists() ? s.data() : {};
        setCfg({ appealDeadline: d.appealDeadline || '', scoreAnnounceDate: d.scoreAnnounceDate || '', appealsClosed: !!d.appealsClosed, testMode: !!d.testMode, testAllowlist: Array.isArray(d.testAllowlist) ? d.testAllowlist.map(String) : [] });
      }).catch(() => setCfg({}));
    return unsub;
  }, [sisId, semesterId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmt = (ts) => {
    try { const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null; return d ? d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''; } catch { return ''; }
  };

  const hasSubmitted = !!(appeal?.submissions && appeal.submissions.length > 0);
  const deadlinePassed = cfg?.appealDeadline && todayStr() > cfg.appealDeadline;
  const closed = cfg?.appealsClosed || deadlinePassed;
  const testBlocked = cfg?.testMode && !(cfg.testAllowlist || []).includes(String(sisId));
  const st = STATUS[appeal?.status] || STATUS.received;
  const StatusIcon = st.icon;

  const submit = async () => {
    if (!detail.trim() || !ref || appeal === undefined || hasSubmitted || closed) return;
    setSubmitting(true); setError('');
    try {
      const newSub = { text: detail.trim(), category: category || 'อื่น ๆ', ts: new Date(), source: 'portal' };
      const payload = appeal
        ? { submissions: [newSub], updatedAt: serverTimestamp() }
        : { sisId, email: userData?.email || '', submissions: [newSub], status: 'received', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      await setDoc(ref, payload, { merge: true });
      setDetail(''); setCategory('');
    } catch (e) { console.error(e); setError('ส่งคำร้องไม่สำเร็จ: ' + (e.message || e)); }
    finally { setSubmitting(false); }
  };

  const acknowledge = async () => {
    if (!ref) return;
    setAcking(true); setError('');
    try {
      const payload = appeal
        ? { acknowledged: true, acknowledgedAt: serverTimestamp(), updatedAt: serverTimestamp() }
        : { sisId, email: userData?.email || '', acknowledged: true, acknowledgedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      await setDoc(ref, payload, { merge: true });
    } catch (e) { console.error(e); setError('บันทึกไม่สำเร็จ: ' + (e.message || e)); }
    finally { setAcking(false); }
  };

  const scoreRow = (label, val, max) => (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-slate-300 text-sm">{label}</span>
      <span className="font-semibold">{val == null ? <span className="text-slate-500">—</span> : `${val}`}<span className="text-slate-500 text-sm"> / {max}</span></span>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">คะแนนและการขอตรวจสอบ</h1>
            <p className="text-slate-400 text-sm">{userData?.email || sisId}</p>
          </div>
          <button onClick={() => logout()} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="ออกจากระบบ">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {(appeal === undefined || scores === undefined || cfg === null) && (
          <div className="flex justify-center py-16"><div className="animate-spin w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full" /></div>
        )}

        {error && <div className="bg-red-900/40 border border-red-500/30 rounded-xl p-4 text-red-200">{error}</div>}

        {cfg !== null && testBlocked && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <h2 className="text-lg font-semibold mb-2">🧪 ระบบอยู่ระหว่างทดสอบ</h2>
            <p className="text-slate-400 text-sm">ยังไม่เปิดให้บริการ — กรุณารอประกาศจากอาจารย์</p>
          </div>
        )}

        {appeal !== undefined && scores !== undefined && cfg !== null && !testBlocked && (
          <>
            {/* กำหนดการ */}
            {(cfg.appealDeadline || cfg.scoreAnnounceDate) && (
              <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-4 text-sm flex items-start gap-3">
                <CalendarClock className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {cfg.appealDeadline && <div>ยื่นขอตรวจสอบได้ถึง: <span className="font-medium">{thDate(cfg.appealDeadline)}</span> {closed && <span className="text-red-400">(ปิดรับแล้ว)</span>}</div>}
                  {cfg.scoreAnnounceDate && <div className="text-slate-400">ประกาศคะแนนจริงใน Canvas: <span className="text-slate-200">{thDate(cfg.scoreAnnounceDate)}</span></div>}
                </div>
              </div>
            )}

            {/* คะแนน */}
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-1"><Award className="w-5 h-5 text-cyan-400" /><span className="font-semibold">คะแนนของคุณ</span></div>
              <p className="text-xs text-cyan-300/80 mb-3">นี่คือ<span className="font-medium">คะแนนจริง</span>ที่จะประกาศ{cfg.scoreAnnounceDate ? ` วันที่ ${thDate(cfg.scoreAnnounceDate)}` : ''} · ถ้าเห็นว่าไม่ถูกต้อง ยื่นขอตรวจสอบด้านล่างได้</p>
              {scores ? (
                <>
                  {scoreRow('คะแนนคลิป (รูบริค)', scores.clip, scores.clipMax ?? 11)}
                  {scoreRow('คะแนนตอบคำถามท้ายคลิป', scores.ownerQa, scores.ownerQaMax ?? 2)}
                  {scoreRow('คะแนน peer review', scores.peer, scores.peerMax ?? 3)}
                  <div className="flex items-center justify-between pt-3 mt-1 border-t border-white/10">
                    <span className="font-medium">รวม</span>
                    <span className="text-lg font-bold text-cyan-300">{scores.total ?? 0}<span className="text-slate-500 text-sm"> / {(scores.clipMax ?? 11) + (scores.ownerQaMax ?? 2) + (scores.peerMax ?? 3)}</span></span>
                  </div>
                </>
              ) : (
                <p className="text-slate-500 italic text-sm">ยังไม่ประกาศคะแนน — กรุณากลับมาดูอีกครั้ง</p>
              )}
            </div>

            {/* สถานะคำร้อง + ข้อความตอบกลับ (ถ้ายื่นแล้ว) */}
            {hasSubmitted && (
              <>
                <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5 flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <div className="text-sm text-slate-400">สถานะคำร้อง</div>
                    <span className={`inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full border text-sm ${st.cls}`}><StatusIcon className="w-4 h-4" /> {st.label}</span>
                  </div>
                  {appeal.updatedAt && <div className="text-xs text-slate-500 text-right">อัปเดตล่าสุด<br />{fmt(appeal.updatedAt)}</div>}
                </div>

                <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5">
                  <div className="flex items-center gap-2 text-sm text-slate-400 mb-3"><MessageSquare className="w-4 h-4" /> ข้อความจากผู้ตรวจสอบ</div>
                  {appeal.checklist && appeal.checklist.length > 0 && (
                    <ul className="space-y-1.5 mb-3">
                      {appeal.checklist.map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm"><CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" /><span>{c}</span></li>
                      ))}
                    </ul>
                  )}
                  {appeal.reply ? <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{appeal.reply}</p>
                    : <p className="text-slate-500 italic">ยังไม่มีข้อความตอบกลับ — อยู่ระหว่างการตรวจสอบ</p>}
                </div>

                <div className="bg-slate-900/30 border border-white/5 rounded-2xl p-5">
                  <div className="text-sm text-slate-400 mb-3">คำร้องที่คุณยื่น</div>
                  <div className="space-y-3">
                    {appeal.submissions.map((s, i) => (
                      <div key={i} className="bg-slate-800/50 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-1 flex items-center gap-2">
                          {s.category && <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{s.category}</span>}
                          {s.ts && <span>{fmt(s.ts)}</span>}
                        </div>
                        <p className="text-sm text-slate-300 whitespace-pre-wrap">{s.text || '—'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* ยังไม่ยื่น: ฟอร์มยื่น (1 ครั้ง) + ปุ่มรับทราบ */}
            {!hasSubmitted && (
              <>
                {appeal?.acknowledged ? (
                  <div className="bg-green-900/30 border border-green-500/30 rounded-2xl p-5 flex items-center gap-3 text-green-200">
                    <ThumbsUp className="w-5 h-5" /> คุณรับทราบและยอมรับคะแนนนี้แล้ว (เมื่อ {fmt(appeal.acknowledgedAt)})
                  </div>
                ) : closed ? (
                  <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5 text-slate-400 text-sm">
                    หมดเขตยื่นขอตรวจสอบคะแนนแล้ว — คะแนนด้านบนคือคะแนนที่จะประกาศ
                  </div>
                ) : (
                  <>
                    <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5">
                      <div className="text-sm text-slate-200 mb-1 font-medium">ยื่นขอตรวจสอบคะแนน (ได้ครั้งเดียว)</div>
                      <p className="text-xs text-slate-500 mb-3">ยื่นได้เฉพาะกรณีเห็นว่าคะแนนไม่ถูกต้อง · ถ้าไม่กดปุ่มใด ๆ ถือว่ายอมรับคะแนนนี้</p>
                      <label className="block text-xs text-slate-400 mb-1">ส่วนที่ต้องการให้ตรวจสอบ</label>
                      <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full mb-3 px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm">
                        <option value="">— เลือก —</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <label className="block text-xs text-slate-400 mb-1">รายละเอียด / เหตุผล</label>
                      <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} placeholder="อธิบายว่าต้องการให้ตรวจสอบอะไร เพราะอะไร..." className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm" />
                      <button onClick={submit} disabled={submitting || !detail.trim()} className="mt-3 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                        <Send className="w-4 h-4" /> {submitting ? 'กำลังส่ง...' : 'ยื่นขอตรวจสอบคะแนน'}
                      </button>
                    </div>
                    <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
                      <span>หรือถ้าคะแนนถูกต้องแล้ว</span>
                      <button onClick={acknowledge} disabled={acking} className="px-4 py-2 bg-green-700 hover:bg-green-600 rounded-lg text-white flex items-center gap-2 disabled:opacity-50">
                        <ThumbsUp className="w-4 h-4" /> {acking ? 'กำลังบันทึก...' : 'โอเคกับคะแนนนี้แล้ว'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-white/10 mt-8">
        <div className="max-w-3xl mx-auto px-4 py-4 text-center text-xs text-slate-500">
          261111 Internet and Online Community in the Age of AI
        </div>
      </footer>
    </div>
  );
}
