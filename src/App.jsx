// src/App.jsx
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import DataViewer from './components/DataViewer';
import ChangePasswordModal from './components/ChangePasswordModal';
import { LogOut, Settings, BarChart2, User, Clock, Key } from 'lucide-react';

function AppContent() {
  const { currentUser, userRole, userData, logout, isAdmin, isTA, isPending, isEmailAuth } = useAuth();
  const [activeView, setActiveView] = useState('data'); // 'data' or 'admin'
  const [selectedSemester, setSelectedSemester] = useState('');
  const [semesters, setSemesters] = useState([]);
  const [taAssignments, setTAAssignments] = useState({}); // semesterId -> assignment (TA อาจดูแลหลายรายการ)
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);

  // Fetch available semesters and TA assignment
  useEffect(() => {
    async function fetchData() {
      if (!currentUser || !userRole || userRole === 'pending') {
        setLoading(false);
        return;
      }

      try {
        // Fetch semesters
        const semSnapshot = await getDocs(collection(db, 'semesters'));
        const semData = semSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSemesters(semData.sort((a, b) => b.id.localeCompare(a.id)));

        // If TA, fetch ALL assignments (TA อาจดูแลหลายรายการ/หลาย assignment)
        if (isTA) {
          const taQuery = query(
            collection(db, 'taAssignments'),
            where('email', '==', currentUser.email)
          );
          const taSnapshot = await getDocs(taQuery);

          const map = {};
          taSnapshot.docs.forEach(d => {
            const a = d.data();
            if (a.semesterId) map[a.semesterId] = a;
          });
          setTAAssignments(map);

          // เลือกรายการแรกที่ TA ดูแล (เรียงตามลำดับ semesters = ใหม่สุดก่อน)
          const firstAssigned = semData.map(s => s.id).find(id => map[id]) || Object.keys(map)[0];
          if (firstAssigned) setSelectedSemester(firstAssigned);
        } else if (semData.length > 0) {
          setSelectedSemester(semData[0].id);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [currentUser, userRole, isTA]);

  const handleLogout = async () => {
    await logout();
  };

  // รายการที่แสดงใน dropdown: Admin เห็นทุกอัน, TA เห็นเฉพาะรายการที่ตัวเองดูแล
  const visibleSemesters = isAdmin ? semesters : semesters.filter(s => taAssignments[s.id]);
  // assignment ของ TA สำหรับรายการที่เลือกอยู่ (จำกัดกลุ่มตามรายการนั้น)
  const currentTAAssignment = taAssignments[selectedSemester] || null;

  // Not logged in
  if (!currentUser) {
    return <LoginPage />;
  }

  // Pending approval
  if (isPending) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">รอการอนุมัติ</h2>
          <p className="text-slate-400 mb-6">
            บัญชีของคุณกำลังรอการอนุมัติจาก Admin<br />
            กรุณาติดต่ออาจารย์ผู้สอนเพื่อขอสิทธิ์เข้าใช้งาน
          </p>
          <div className="bg-slate-800 rounded-lg p-3 mb-6">
            <div className="text-sm text-slate-400">อีเมลที่ใช้ลงทะเบียน:</div>
            <div className="text-white">{currentUser.email}</div>
          </div>
          <button
            onClick={handleLogout}
            className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-xl text-white transition"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl font-bold">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400">
                  Peer Review Analyzer
                </span>
              </h1>
              <p className="text-slate-400 text-sm">
                {isAdmin ? '👑 Admin' : '📋 TA'} - {currentUser.email}
              </p>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              {/* Semester/รายการ selector — TA เห็นเฉพาะรายการที่ดูแล */}
              {(isAdmin || visibleSemesters.length > 0) && (
                <select
                  value={selectedSemester}
                  onChange={(e) => setSelectedSemester(e.target.value)}
                  className="bg-slate-800 border border-white/10 rounded-lg px-4 py-2 text-sm max-w-xs"
                >
                  <option value="">-- เลือกรายการ --</option>
                  {visibleSemesters.map(sem => (
                    <option key={sem.id} value={sem.id}>
                      {sem.name}{sem.courseCode ? ` - ${sem.courseCode}` : ''}
                    </option>
                  ))}
                </select>
              )}

              {/* View toggle for Admin */}
              {isAdmin && (
                <div className="flex bg-slate-800 rounded-lg p-1">
                  <button
                    onClick={() => setActiveView('data')}
                    className={`px-4 py-2 rounded-md text-sm transition ${
                      activeView === 'data' 
                        ? 'bg-cyan-600 text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <BarChart2 className="w-4 h-4 inline mr-2" />
                    ดูข้อมูล
                  </button>
                  <button
                    onClick={() => setActiveView('admin')}
                    className={`px-4 py-2 rounded-md text-sm transition ${
                      activeView === 'admin' 
                        ? 'bg-purple-600 text-white' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Settings className="w-4 h-4 inline mr-2" />
                    จัดการ
                  </button>
                </div>
              )}

              {/* User menu */}
              <div className="flex items-center gap-2">
                {currentUser.photoURL && (
                  <img 
                    src={currentUser.photoURL} 
                    alt="Profile" 
                    className="w-8 h-8 rounded-full"
                  />
                )}
                
                {/* Change Password Button (only for email auth users) */}
                {userData?.authProvider === 'email' && (
                  <button
                    onClick={() => setShowChangePassword(true)}
                    className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                    title="เปลี่ยนรหัสผ่าน"
                  >
                    <Key className="w-5 h-5" />
                  </button>
                )}
                
                <button
                  onClick={handleLogout}
                  className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                  title="ออกจากระบบ"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Admin Panel */}
        {isAdmin && activeView === 'admin' && (
          <AdminPanel 
            onViewData={(semId) => {
              setSelectedSemester(semId);
              setActiveView('data');
            }}
          />
        )}

        {/* Data Viewer */}
        {(activeView === 'data' || isTA) && selectedSemester && (
          <DataViewer
            semesterId={selectedSemester}
            taAssignment={currentTAAssignment}
          />
        )}

        {/* No semester selected */}
        {(activeView === 'data' || isTA) && !selectedSemester && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <BarChart2 className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-xl font-semibold mb-2">เลือกเทอมที่ต้องการดู</h2>
            <p className="text-slate-400">
              {isAdmin 
                ? 'กรุณาเลือกเทอมจาก dropdown ด้านบน หรือไปที่ "จัดการ" เพื่อสร้างเทอมใหม่'
                : 'ติดต่อ Admin เพื่อขอสิทธิ์เข้าถึงข้อมูล'
              }
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-auto">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-500">
            <span>Peer Review Analyzer · ดึงข้อมูลจาก Canvas โดยตรง</span>
          </div>
        </div>
      </footer>

      {/* Password Change Reminder for first-time email users */}
      {userData?.authProvider === 'email' && !userData?.passwordChanged && (
        <div className="fixed bottom-4 right-4 max-w-sm bg-yellow-900/90 border border-yellow-500/30 rounded-xl p-4 shadow-lg z-40">
          <div className="flex items-start gap-3">
            <Key className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-yellow-200 font-medium">แนะนำให้เปลี่ยนรหัสผ่าน</p>
              <p className="text-yellow-300/70 text-sm mt-1">คุณกำลังใช้รหัสผ่านที่ Admin ตั้งให้ แนะนำให้เปลี่ยนเป็นรหัสผ่านของคุณเอง</p>
              <button
                onClick={() => setShowChangePassword(true)}
                className="mt-3 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg transition"
              >
                เปลี่ยนรหัสผ่าน
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      <ChangePasswordModal 
        isOpen={showChangePassword} 
        onClose={() => setShowChangePassword(false)} 
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
