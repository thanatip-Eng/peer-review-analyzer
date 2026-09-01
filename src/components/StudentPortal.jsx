// src/components/StudentPortal.jsx
// -----------------------------------------------------------------------------
// พอร์ทัลสำหรับนักศึกษา (เข้าผ่าน Canvas LTI เท่านั้น) — ติดตามสถานะ + ข้อความตอบกลับ
// ของการอุทธรณ์คะแนน แสดงเฉพาะข้อมูลของ uid (รหัส นศ.) ตัวเอง (Firestore rules บังคับ)
// -----------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, CheckCircle2, Clock, Search, FileText, MessageSquare } from 'lucide-react';

const STATUS = {
  received: { label: 'รับเรื่องแล้ว', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30', icon: Clock },
  in_review: { label: 'กำลังตรวจสอบ', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30', icon: Search },
  resolved: { label: 'ตรวจสอบเสร็จสิ้น', cls: 'bg-green-500/20 text-green-300 border-green-500/30', icon: CheckCircle2 },
};

export default function StudentPortal() {
  const { currentUser, userData, logout } = useAuth();
  const sisId = currentUser?.uid;
  const semesterId = userData?.semesterId;
  const [appeal, setAppeal] = useState(undefined); // undefined = loading, null = ไม่มีคำร้อง
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sisId || !semesterId) { setAppeal(null); return; }
    const ref = doc(db, 'semesters', semesterId, 'appeals', sisId);
    const unsub = onSnapshot(
      ref,
      (snap) => setAppeal(snap.exists() ? snap.data() : null),
      (err) => { console.error(err); setError('โหลดข้อมูลไม่สำเร็จ'); setAppeal(null); },
    );
    return unsub;
  }, [sisId, semesterId]);

  const st = STATUS[appeal?.status] || STATUS.received;
  const StatusIcon = st.icon;

  const fmt = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : ts ? new Date(ts) : null;
      return d ? d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    } catch { return ''; }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">ตรวจสอบผลอุทธรณ์คะแนน</h1>
            <p className="text-slate-400 text-sm">{userData?.email || sisId}</p>
          </div>
          <button
            onClick={() => logout()}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
            title="ออกจากระบบ"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {appeal === undefined && (
          <div className="flex justify-center py-16">
            <div className="animate-spin w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className="bg-red-900/40 border border-red-500/30 rounded-xl p-4 text-red-200">{error}</div>
        )}

        {appeal === null && !error && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <FileText className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-lg font-semibold mb-2">ยังไม่มีการยื่นอุทธรณ์</h2>
            <p className="text-slate-400 text-sm">
              ระบบยังไม่พบคำร้องอุทธรณ์คะแนนของคุณ<br />
              ถ้าเพิ่งยื่นแบบฟอร์ม กรุณารอเจ้าหน้าที่บันทึกคำร้อง แล้วกลับมาดูอีกครั้ง
            </p>
          </div>
        )}

        {appeal && (
          <>
            {/* สถานะ */}
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-sm text-slate-400">สถานะคำร้อง</div>
                  <span className={`inline-flex items-center gap-2 mt-1 px-3 py-1 rounded-full border text-sm ${st.cls}`}>
                    <StatusIcon className="w-4 h-4" /> {st.label}
                  </span>
                </div>
                {appeal.updatedAt && (
                  <div className="text-xs text-slate-500 text-right">อัปเดตล่าสุด<br />{fmt(appeal.updatedAt)}</div>
                )}
              </div>
            </div>

            {/* ข้อความตอบกลับ */}
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5">
              <div className="flex items-center gap-2 text-sm text-slate-400 mb-3">
                <MessageSquare className="w-4 h-4" /> ข้อความจากผู้ตรวจสอบ
              </div>
              {(appeal.checklist && appeal.checklist.length > 0) ? (
                <ul className="space-y-1.5 mb-3">
                  {appeal.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {appeal.reply ? (
                <p className="text-slate-200 whitespace-pre-wrap leading-relaxed">{appeal.reply}</p>
              ) : (
                <p className="text-slate-500 italic">ยังไม่มีข้อความตอบกลับ — อยู่ระหว่างการตรวจสอบ</p>
              )}
            </div>

            {/* คำร้องเดิม (อ้างอิง) */}
            {appeal.submissions && appeal.submissions.length > 0 && (
              <div className="bg-slate-900/30 border border-white/5 rounded-2xl p-5">
                <div className="text-sm text-slate-400 mb-3">คำร้องที่คุณยื่น</div>
                <div className="space-y-3">
                  {appeal.submissions.map((s, i) => (
                    <div key={i} className="bg-slate-800/50 rounded-lg p-3">
                      {s.ts && <div className="text-xs text-slate-500 mb-1">{fmt(s.ts)}</div>}
                      <p className="text-sm text-slate-300 whitespace-pre-wrap">{s.text || '—'}</p>
                    </div>
                  ))}
                </div>
              </div>
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
