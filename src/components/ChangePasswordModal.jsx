// src/components/ChangePasswordModal.jsx
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { X, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ChangePasswordModal({ isOpen, onClose }) {
  const { changePassword, userData } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    
    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('กรุณากรอกข้อมูลให้ครบ');
      return;
    }
    
    if (newPassword.length < 6) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setError('รหัสผ่านใหม่ไม่ตรงกัน');
      return;
    }
    
    if (currentPassword === newPassword) {
      setError('รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านเดิม');
      return;
    }
    
    setLoading(true);
    
    const result = await changePassword(currentPassword, newPassword);
    
    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        onClose();
        setSuccess(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      }, 2000);
    } else {
      setError(result.error);
    }
    
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Lock className="w-5 h-5 text-cyan-400" />
            เปลี่ยนรหัสผ่าน
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Message */}
        {success && (
          <div className="bg-green-900/30 border border-green-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <span className="text-green-300">เปลี่ยนรหัสผ่านสำเร็จ!</span>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-300">{error}</span>
          </div>
        )}

        {/* Form */}
        {!success && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Current Password */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">รหัสผ่านปัจจุบัน</label>
              <div className="relative">
                <input
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showCurrentPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* New Password */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">รหัสผ่านใหม่</label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 pr-12 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm text-slate-400 mb-2">ยืนยันรหัสผ่านใหม่</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-xl text-white focus:outline-none focus:border-cyan-500"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-red-400 text-sm mt-1">รหัสผ่านไม่ตรงกัน</p>
              )}
            </div>

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl transition"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 rounded-xl transition disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
                ) : (
                  'บันทึก'
                )}
              </button>
            </div>
          </form>
        )}

        {/* Note for first-time users */}
        {!userData?.passwordChanged && (
          <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-500/30 rounded-lg">
            <p className="text-yellow-300 text-sm">
              💡 แนะนำให้เปลี่ยนรหัสผ่านจากที่ Admin ตั้งให้เป็นรหัสผ่านของคุณเอง
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
