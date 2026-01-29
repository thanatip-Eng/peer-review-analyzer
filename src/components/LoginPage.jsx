// src/components/LoginPage.jsx
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { loginWithGoogle, loginWithEmail } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Email/Password state
  const [loginMode, setLoginMode] = useState('select'); // 'select', 'email', 'google'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    
    const result = await loginWithGoogle();
    
    if (!result.success) {
      setError(result.error);
    }
    
    setLoading(false);
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    
    if (!email || !password) {
      setError('กรุณากรอกอีเมลและรหัสผ่าน');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    const result = await loginWithEmail(email, password);
    
    if (!result.success) {
      setError(result.error);
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
          {/* Logo */}
          <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-2xl font-bold text-white mb-2">
            Peer Review Analyzer
          </h1>
          <p className="text-slate-400 mb-8">
            ระบบวิเคราะห์คะแนน Peer Review สำหรับ Canvas LMS
          </p>

          {/* Error Message */}
          {error && (
            <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 mb-6 text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Login Options */}
          {loginMode === 'select' && (
            <div className="space-y-4">
              {/* Google Login */}
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full px-6 py-4 bg-white hover:bg-gray-100 text-gray-800 rounded-xl font-medium transition flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="w-6 h-6 border-2 border-gray-400 border-t-gray-800 rounded-full animate-spin"></div>
                ) : (
                  <>
                    <svg className="w-6 h-6" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    เข้าสู่ระบบด้วย Google
                  </>
                )}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-px bg-white/10"></div>
                <span className="text-slate-500 text-sm">หรือ</span>
                <div className="flex-1 h-px bg-white/10"></div>
              </div>

              {/* Email Login Button */}
              <button
                onClick={() => setLoginMode('email')}
                className="w-full px-6 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium transition flex items-center justify-center gap-3"
              >
                <Mail className="w-5 h-5" />
                เข้าสู่ระบบด้วย Email
              </button>
            </div>
          )}

          {/* Email Login Form */}
          {loginMode === 'email' && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              {/* Email Input */}
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="email"
                  placeholder="อีเมล"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  autoFocus
                />
              </div>

              {/* Password Input */}
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="รหัสผ่าน"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-4 bg-slate-800 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full px-6 py-4 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white rounded-xl font-medium transition disabled:opacity-50"
              >
                {loading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>
                ) : (
                  'เข้าสู่ระบบ'
                )}
              </button>

              {/* Back Button */}
              <button
                type="button"
                onClick={() => {
                  setLoginMode('select');
                  setError(null);
                }}
                className="w-full text-slate-400 hover:text-white transition"
              >
                ← กลับ
              </button>
            </form>
          )}

          {/* Info */}
          <p className="text-slate-500 text-sm mt-6">
            สำหรับอาจารย์และ TA เท่านั้น
          </p>
        </div>

        {/* Footer Links */}
        <div className="mt-6 text-center text-sm text-slate-500">
          <p>เครื่องมือเสริม:</p>
          <div className="flex justify-center gap-4 mt-2">
            <a 
              href="http://10.110.3.252:8000/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300"
            >
              ระบบดึงคะแนน (มช.)
            </a>
            <span className="text-slate-600">|</span>
            <a 
              href="https://canvas-group-exporter.vercel.app/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300"
            >
              Canvas Group Exporter
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
