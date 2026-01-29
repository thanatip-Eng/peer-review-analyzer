// src/components/ReviewStatusModal.jsx
import React, { useState, useEffect } from 'react';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { X, CheckCircle2, AlertTriangle, Send, MessageSquare, Save } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'pending', label: 'รอตรวจสอบ', color: 'text-slate-400', bg: 'bg-slate-700' },
  { value: 'reviewed', label: 'ตรวจสอบแล้ว', color: 'text-green-400', bg: 'bg-green-900/30' },
  { value: 'fixed', label: 'แก้ไขแล้ว', color: 'text-cyan-400', bg: 'bg-cyan-900/30' },
  { value: 'escalated', label: 'ส่งต่อ Admin', color: 'text-yellow-400', bg: 'bg-yellow-900/30' },
];

export function getStatusInfo(status) {
  return STATUS_OPTIONS.find(s => s.value === status) || STATUS_OPTIONS[0];
}

export { STATUS_OPTIONS };

export default function ReviewStatusModal({ 
  isOpen, 
  onClose, 
  semesterId,
  itemType, // 'student' or 'grader'
  itemId,
  itemName,
  currentStatus,
  onStatusUpdate
}) {
  const { currentUser, userData } = useAuth();
  const [status, setStatus] = useState(currentStatus?.status || 'pending');
  const [note, setNote] = useState(currentStatus?.note || '');
  const [loading, setSaving] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    if (isOpen && currentStatus) {
      setStatus(currentStatus.status || 'pending');
      setNote(currentStatus.note || '');
      setHistory(currentStatus.history || []);
    }
  }, [isOpen, currentStatus]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const statusRef = doc(db, 'semesters', semesterId, 'reviewStatuses', `${itemType}_${itemId}`);
      
      // Get existing data
      const existingSnap = await getDoc(statusRef);
      const existingData = existingSnap.exists() ? existingSnap.data() : {};
      const existingHistory = existingData.history || [];
      
      // Add to history if status changed
      const newHistoryEntry = {
        status,
        note,
        updatedBy: currentUser.uid,
        updatedByEmail: currentUser.email,
        updatedByName: userData?.displayName || currentUser.email,
        updatedAt: new Date().toISOString()
      };
      
      const newHistory = [...existingHistory, newHistoryEntry].slice(-10); // Keep last 10 entries
      
      await setDoc(statusRef, {
        itemType,
        itemId,
        itemName,
        status,
        note,
        history: newHistory,
        updatedBy: currentUser.uid,
        updatedByEmail: currentUser.email,
        updatedByName: userData?.displayName || currentUser.email,
        updatedAt: serverTimestamp()
      });
      
      onStatusUpdate && onStatusUpdate({
        status,
        note,
        history: newHistory,
        updatedByName: userData?.displayName || currentUser.email
      });
      
      onClose();
    } catch (error) {
      console.error('Error saving status:', error);
      alert('เกิดข้อผิดพลาดในการบันทึก');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-cyan-400" />
              สถานะการตรวจสอบ
            </h2>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-slate-400 text-sm mt-1">
            {itemType === 'student' ? 'นักศึกษา' : 'ผู้รีวิว'}: <span className="text-white">{itemName}</span>
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Status Selection */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">สถานะ</label>
            <div className="grid grid-cols-2 gap-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={`px-4 py-3 rounded-xl text-sm font-medium transition ${
                    status === opt.value 
                      ? `${opt.bg} ${opt.color} ring-2 ring-white/20` 
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm text-slate-400 mb-2">
              โน้ตถึง Admin {(status === 'fixed' || status === 'escalated') && <span className="text-yellow-400">*</span>}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={status === 'escalated' ? 'อธิบายสิ่งที่ต้องการให้ Admin ช่วยพิจารณา...' : 'เพิ่มโน้ต (ถ้ามี)...'}
              rows={3}
              className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* History */}
          {history.length > 0 && (
            <div>
              <label className="block text-sm text-slate-400 mb-2">ประวัติการอัปเดต</label>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {history.slice().reverse().map((h, i) => (
                  <div key={i} className="bg-slate-800/50 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={getStatusInfo(h.status).color}>{getStatusInfo(h.status).label}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">{h.updatedByName}</span>
                    </div>
                    {h.note && <p className="text-slate-300 text-xs">{h.note}</p>}
                    <p className="text-slate-500 text-xs mt-1">
                      {new Date(h.updatedAt).toLocaleString('th-TH')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={loading || ((status === 'escalated') && !note.trim())}
            className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Save className="w-5 h-5" />
                บันทึก
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
