// src/App.jsx
import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Users, BarChart2, Settings, Search, Download, ChevronRight, AlertCircle, CheckCircle2, XCircle, FileText, AlertTriangle, Eye, UserCheck, ClipboardList } from 'lucide-react';
import { parseCSV, DEFAULT_CRITERIA, getFlaggedStudents, getFlaggedGraders, getKeywordsForVerification } from './utils/csvParser';

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGrader, setSelectedGrader] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [verifiedKeywords, setVerifiedKeywords] = useState({});

  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const result = await parseCSV(file);
      setData(result);
      setActiveTab('overview');
    } catch (err) {
      console.error('Error:', err);
      setError(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const exportStudentScores = useCallback(() => {
    if (!data) return;
    const rows = Object.values(data.students).map((s, i) => ({
      'ลำดับ': i + 1,
      'รหัสนักศึกษา': s.studentId,
      'ชื่อ-นามสกุล': s.fullName,
      'จำนวน Grader ที่ Assign': s.gradersAssigned,
      'จำนวน Grader ที่รีวิวแล้ว': s.gradersCompleted,
      'คะแนนเฉลี่ย': s.workScore.average,
      'คะแนนต่ำสุด': s.workScore.min || '-',
      'คะแนนสูงสุด': s.workScore.max || '-',
      'SD': s.workScore.stdDev,
      'เชื่อถือได้': s.workScore.isReliable ? 'ใช่' : 'ไม่',
      'Flags': s.flags.map(f => f.message).join('; ')
    }));
    downloadCSV(rows, 'student-work-scores');
  }, [data]);

  const exportGraderScores = useCallback(() => {
    if (!data) return;
    const rows = Object.values(data.graders).map((g, i) => ({
      'ลำดับ': i + 1,
      'รหัสนักศึกษา': g.graderId,
      'ชื่อ-นามสกุล': g.fullName,
      'งานที่ได้รับ': g.assignedReviews,
      'งานที่รีวิวแล้ว': g.completedReviews,
      'คะแนนเต็ม': g.peerReviewScore.fullScore,
      'คะแนนที่ได้': g.peerReviewScore.earnedScore,
      'คะแนนหัก': g.peerReviewScore.penalty,
      'คะแนนสุทธิ': g.peerReviewScore.netScore,
      'Flags': g.flags.map(f => f.message).join('; ')
    }));
    downloadCSV(rows, 'grader-peer-review-scores');
  }, [data]);

  const downloadCSV = (rows, filename) => {
    if (rows.length === 0) return;
    const headers = Object.keys(rows[0]).join(',');
    const csvRows = rows.map(row => Object.values(row).map(v => `"${v}"`).join(','));
    const csvContent = [headers, ...csvRows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const filteredStudents = useMemo(() => {
    if (!data) return [];
    return Object.values(data.students).filter(s => {
      const q = searchQuery.toLowerCase();
      return s.studentName.toLowerCase().includes(q) || s.studentId.includes(q) || s.fullName.toLowerCase().includes(q);
    }).sort((a, b) => b.workScore.average - a.workScore.average);
  }, [data, searchQuery]);

  const filteredGraders = useMemo(() => {
    if (!data) return [];
    return Object.values(data.graders).filter(g => {
      const q = searchQuery.toLowerCase();
      return g.graderName.toLowerCase().includes(q) || g.graderId?.includes(q) || g.fullName.toLowerCase().includes(q);
    }).sort((a, b) => b.peerReviewScore.netScore - a.peerReviewScore.netScore);
  }, [data, searchQuery]);

  const flaggedStudents = useMemo(() => data ? getFlaggedStudents(data.students) : [], [data]);
  const flaggedGraders = useMemo(() => data ? getFlaggedGraders(data.graders) : [], [data]);
  const keywords = useMemo(() => data ? getKeywordsForVerification(data.graders) : [], [data]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400">
              Peer Review Analyzer v2
            </span>
          </h1>
          <p className="text-slate-400 mt-1">วิเคราะห์คะแนนชิ้นงาน + คะแนน Peer Review</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {!data && !loading && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-semibold mb-2">อัปโหลดไฟล์ CSV</h2>
              <p className="text-slate-400 mb-6">นำเข้าข้อมูล Peer Review จาก Canvas</p>
              <label className="cursor-pointer">
                <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                <div className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl font-medium hover:opacity-90 transition inline-flex items-center gap-2">
                  <Upload className="w-5 h-5" /> เลือกไฟล์ CSV
                </div>
              </label>
            </div>
          </div>
        )}

        {loading && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>กำลังประมวลผล...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-300">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300 text-xl">×</button>
          </div>
        )}

        {data && !loading && (
          <>
            <div className="flex gap-2 mb-6 bg-slate-900/50 p-1 rounded-xl border border-white/10 overflow-x-auto">
              {[
                { id: 'overview', label: 'ภาพรวม', icon: BarChart2 },
                { id: 'students', label: 'คะแนนชิ้นงาน', icon: Users },
                { id: 'graders', label: 'คะแนน Peer Review', icon: UserCheck },
                { id: 'admin', label: 'Admin', icon: AlertTriangle },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg transition whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-white/10'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <tab.icon className="w-5 h-5" /> {tab.label}
                  {tab.id === 'admin' && (flaggedStudents.length + flaggedGraders.length) > 0 && (
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {flaggedStudents.length + flaggedGraders.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {activeTab === 'overview' && <OverviewTab data={data} />}
            {activeTab === 'students' && (
              <StudentsTab 
                students={filteredStudents} 
                searchQuery={searchQuery} 
                setSearchQuery={setSearchQuery}
                onSelect={setSelectedStudent}
                onExport={exportStudentScores}
              />
            )}
            {activeTab === 'graders' && (
              <GradersTab 
                graders={filteredGraders}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelect={setSelectedGrader}
                onExport={exportGraderScores}
              />
            )}
            {activeTab === 'admin' && (
              <AdminTab 
                flaggedStudents={flaggedStudents}
                flaggedGraders={flaggedGraders}
                keywords={keywords}
                verifiedKeywords={verifiedKeywords}
                setVerifiedKeywords={setVerifiedKeywords}
                data={data}
              />
            )}
          </>
        )}
      </div>

      {selectedStudent && data && (
        <StudentModal student={selectedStudent} reviews={data.reviews} onClose={() => setSelectedStudent(null)} />
      )}
      {selectedGrader && data && (
        <GraderModal grader={selectedGrader} reviews={data.reviews} onClose={() => setSelectedGrader(null)} />
      )}
    </div>
  );
}

function OverviewTab({ data }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="นักศึกษา (เจ้าของงาน)" value={data.stats.totalStudents} icon={Users} color="cyan" />
        <StatCard label="Graders (คนรีวิว)" value={data.stats.totalGraders} icon={UserCheck} color="purple" />
        <StatCard label="รีวิวที่เสร็จ" value={data.stats.completedReviews} icon={CheckCircle2} color="green" />
        <StatCard label="รีวิวที่ยังไม่เสร็จ" value={data.stats.incompleteReviews} icon={XCircle} color="red" />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" /> สถิติคะแนนชิ้นงาน
          </h3>
          <WorkScoreStats students={data.students} />
        </div>

        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-purple-400" /> สถิติการทำ Peer Review
          </h3>
          <PeerReviewStats graders={data.graders} stats={data.stats} />
        </div>
      </div>
    </div>
  );
}

function WorkScoreStats({ students }) {
  const studentList = Object.values(students);
  const withScores = studentList.filter(s => s.workScore.graderCount > 0);
  const scores = withScores.map(s => s.workScore.average);
  
  if (scores.length === 0) return <p className="text-slate-400">ไม่มีข้อมูล</p>;
  
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const reliable = withScores.filter(s => s.workScore.isReliable).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-cyan-400">{avg.toFixed(2)}</div>
          <div className="text-sm text-slate-400">คะแนนเฉลี่ย</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-400">{max}</div>
          <div className="text-sm text-slate-400">สูงสุด</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-400">{min}</div>
          <div className="text-sm text-slate-400">ต่ำสุด</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-purple-400">{reliable}/{withScores.length}</div>
          <div className="text-sm text-slate-400">คะแนนเชื่อถือได้</div>
        </div>
      </div>
      <p className="text-xs text-slate-500">* คะแนนเชื่อถือได้ = มี grader ≥2 คน และ SD &lt; 3</p>
    </div>
  );
}

function PeerReviewStats({ graders, stats }) {
  const graderList = Object.values(graders);
  const withReviews = graderList.filter(g => g.completedReviews > 0);
  const avgScore = withReviews.length > 0 
    ? withReviews.reduce((sum, g) => sum + g.peerReviewScore.netScore, 0) / withReviews.length 
    : 0;
  const totalPenalty = graderList.reduce((sum, g) => sum + g.peerReviewScore.penalty, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-cyan-400">{stats.reviewsWithQualityComments}</div>
          <div className="text-sm text-slate-400">รีวิวที่มี comment คุณภาพ</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-yellow-400">{stats.reviewsWithPenalty}</div>
          <div className="text-sm text-slate-400">รีวิวที่ถูกหักคะแนน</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-green-400">{avgScore.toFixed(2)}</div>
          <div className="text-sm text-slate-400">คะแนน PR เฉลี่ย</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3">
          <div className="text-2xl font-bold text-red-400">-{totalPenalty.toFixed(1)}</div>
          <div className="text-sm text-slate-400">คะแนนที่ถูกหักรวม</div>
        </div>
      </div>
      <p className="text-xs text-slate-500">* หักงานละ 0.2 ถ้า comment ไม่ครบ/ไม่มีคุณภาพ</p>
    </div>
  );
}

function StudentsTab({ students, searchQuery, setSearchQuery, onSelect, onExport }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัส หรือชื่อ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500"
          />
        </div>
        <button onClick={onExport} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl">
          <Download className="w-5 h-5" /> Export
        </button>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">Graders</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนเฉลี่ย</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">Min-Max</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">SD</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">เชื่อถือได้</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {students.slice(0, 100).map(student => (
                <tr key={student.studentName} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-sm">{student.studentId}</td>
                  <td className="px-4 py-3">
                    {student.fullName}
                    {student.flags.length > 0 && <AlertTriangle className="inline w-4 h-4 text-yellow-400 ml-2" />}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-cyan-400">{student.gradersCompleted}</span>
                    <span className="text-slate-500">/{student.gradersAssigned}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${getScoreColor(student.workScore.average, 12)}`}>
                      {student.workScore.average || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-slate-400">
                    {student.workScore.min !== null ? `${student.workScore.min}-${student.workScore.max}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center text-sm">
                    <span className={student.workScore.stdDev >= 3 ? 'text-red-400' : 'text-slate-400'}>
                      {student.workScore.stdDev || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {student.workScore.isReliable 
                      ? <CheckCircle2 className="w-5 h-5 text-green-400 mx-auto" />
                      : <XCircle className="w-5 h-5 text-slate-500 mx-auto" />
                    }
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => onSelect(student)} className="p-2 hover:bg-white/10 rounded-lg">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function GradersTab({ graders, searchQuery, setSearchQuery, onSelect, onExport }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัส หรือชื่อ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500"
          />
        </div>
        <button onClick={onExport} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl">
          <Download className="w-5 h-5" /> Export
        </button>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">งานที่ได้รับ</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รีวิวแล้ว</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนได้</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">หัก</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">สุทธิ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {graders.slice(0, 100).map(grader => (
                <tr key={grader.graderName} className="hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-sm">{grader.graderId}</td>
                  <td className="px-4 py-3">
                    {grader.fullName}
                    {grader.flags.length > 0 && <AlertTriangle className="inline w-4 h-4 text-yellow-400 ml-2" />}
                  </td>
                  <td className="px-4 py-3 text-center text-slate-400">{grader.assignedReviews}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={grader.completedReviews === grader.assignedReviews ? 'text-green-400' : 'text-yellow-400'}>
                      {grader.completedReviews}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-cyan-400">{grader.peerReviewScore.earnedScore}</td>
                  <td className="px-4 py-3 text-center text-red-400">
                    {grader.peerReviewScore.penalty > 0 ? `-${grader.peerReviewScore.penalty}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-semibold ${getScoreColor(grader.peerReviewScore.netScore, grader.assignedReviews)}`}>
                      {grader.peerReviewScore.netScore}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => onSelect(grader)} className="p-2 hover:bg-white/10 rounded-lg">
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminTab({ flaggedStudents, flaggedGraders, keywords, verifiedKeywords, setVerifiedKeywords }) {
  const [showKeywords, setShowKeywords] = useState(false);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            นักศึกษาที่ต้องตรวจสอบ ({flaggedStudents.length})
          </h3>
          {flaggedStudents.length === 0 ? (
            <p className="text-slate-400">ไม่มีรายการที่ต้องตรวจสอบ</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {flaggedStudents.map(s => (
                <div key={s.studentName} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="font-medium">{s.fullName}</div>
                  <div className="text-sm text-slate-400 font-mono">{s.studentId}</div>
                  <div className="mt-2 space-y-1">
                    {s.flags.map((f, i) => (
                      <div key={i} className={`text-sm px-2 py-1 rounded ${
                        f.severity === 'alert' ? 'bg-red-900/30 text-red-300' :
                        f.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                        'bg-slate-700 text-slate-300'
                      }`}>
                        {f.message}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            Graders ที่ต้องตรวจสอบ ({flaggedGraders.length})
          </h3>
          {flaggedGraders.length === 0 ? (
            <p className="text-slate-400">ไม่มีรายการที่ต้องตรวจสอบ</p>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {flaggedGraders.map(g => (
                <div key={g.graderName} className="bg-slate-800/50 rounded-lg p-3">
                  <div className="font-medium">{g.fullName}</div>
                  <div className="text-sm text-slate-400 font-mono">{g.graderId}</div>
                  <div className="mt-2 space-y-1">
                    {g.flags.map((f, i) => (
                      <div key={i} className={`text-sm px-2 py-1 rounded ${
                        f.severity === 'alert' ? 'bg-red-900/30 text-red-300' :
                        f.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                        'bg-slate-700 text-slate-300'
                      }`}>
                        {f.message}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Eye className="w-5 h-5 text-cyan-400" />
            Keywords สำหรับ Verify ({keywords.length})
          </h3>
          <button 
            onClick={() => setShowKeywords(!showKeywords)}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
          >
            {showKeywords ? 'ซ่อน' : 'แสดง'}
          </button>
        </div>
        
        {showKeywords && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-96 overflow-y-auto">
            {keywords.slice(0, 100).map(kw => (
              <div key={kw.keyword} className="bg-slate-800/50 rounded-lg p-2 flex items-center justify-between">
                <div>
                  <div className="text-sm">{kw.keyword}</div>
                  <div className="text-xs text-slate-400">ใช้ {kw.count} ครั้ง</div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setVerifiedKeywords(v => ({ ...v, [kw.keyword]: true }))}
                    className={`p-1 rounded ${verifiedKeywords[kw.keyword] === true ? 'bg-green-600' : 'bg-slate-700'}`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setVerifiedKeywords(v => ({ ...v, [kw.keyword]: false }))}
                    className={`p-1 rounded ${verifiedKeywords[kw.keyword] === false ? 'bg-red-600' : 'bg-slate-700'}`}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StudentModal({ student, reviews, onClose }) {
  const studentReviews = reviews.filter(r => r.studentName === student.studentName);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-cyan-900/50 to-purple-900/50 p-6 border-b border-white/10">
          <div className="flex justify-between">
            <div>
              <h2 className="text-xl font-bold">{student.fullName}</h2>
              <p className="text-slate-400 font-mono">{student.studentId}</p>
            </div>
            <button onClick={onClose} className="text-2xl hover:bg-white/10 rounded-lg px-3">×</button>
          </div>
          <div className="flex gap-6 mt-4">
            <div>
              <div className="text-3xl font-bold text-cyan-400">{student.workScore.average}/12</div>
              <div className="text-sm text-slate-400">คะแนนเฉลี่ย</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">{student.gradersCompleted}/{student.gradersAssigned}</div>
              <div className="text-sm text-slate-400">Graders</div>
            </div>
            <div>
              <div className={`text-3xl font-bold ${student.workScore.isReliable ? 'text-green-400' : 'text-yellow-400'}`}>
                {student.workScore.isReliable ? '✓' : '?'}
              </div>
              <div className="text-sm text-slate-400">เชื่อถือได้</div>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <h3 className="font-semibold mb-3">รายละเอียดคะแนนจาก Graders</h3>
          <div className="space-y-3">
            {studentReviews.map(review => (
              <div key={review.id} className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-sm text-slate-400">Grader:</div>
                    <div className="font-medium">{review.graderFullName || review.graderName}</div>
                    <div className="text-sm text-slate-500 font-mono">{review.graderId}</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${review.isCompleted ? 'text-cyan-400' : 'text-slate-500'}`}>
                      {review.isCompleted ? review.gradeGiven : '-'}/12
                    </div>
                  </div>
                </div>
                {review.isCompleted && (
                  <div className="mt-3 text-sm">
                    <span className={review.hasAllQualityComments ? 'text-green-400' : 'text-yellow-400'}>
                      Comments: {review.qualityCommentCount}/{review.totalCriteria} มีคุณภาพ
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {student.flags.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-3 text-yellow-400">⚠️ Flags</h3>
              <div className="space-y-2">
                {student.flags.map((f, i) => (
                  <div key={i} className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 text-sm">
                    {f.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GraderModal({ grader, reviews, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-purple-900/50 to-cyan-900/50 p-6 border-b border-white/10">
          <div className="flex justify-between">
            <div>
              <h2 className="text-xl font-bold">{grader.fullName}</h2>
              <p className="text-slate-400 font-mono">{grader.graderId}</p>
            </div>
            <button onClick={onClose} className="text-2xl hover:bg-white/10 rounded-lg px-3">×</button>
          </div>
          <div className="flex gap-6 mt-4">
            <div>
              <div className="text-3xl font-bold text-cyan-400">{grader.peerReviewScore.netScore}</div>
              <div className="text-sm text-slate-400">คะแนน Peer Review</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">{grader.completedReviews}/{grader.assignedReviews}</div>
              <div className="text-sm text-slate-400">งานที่รีวิว</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-red-400">-{grader.peerReviewScore.penalty}</div>
              <div className="text-sm text-slate-400">คะแนนที่ถูกหัก</div>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <h3 className="font-semibold mb-3">รายละเอียดการรีวิว</h3>
          <div className="space-y-3">
            {grader.peerReviewScore.details.map((detail, i) => {
              const review = reviews.find(r => r.id === detail.reviewId);
              return (
                <div key={i} className="bg-slate-800/50 rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm text-slate-400">รีวิวงานของ:</div>
                      <div className="font-medium">{detail.studentReviewed}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-cyan-400">{detail.gradeGiven}/12</div>
                      {detail.penalty > 0 && (
                        <div className="text-sm text-red-400">หัก {detail.penalty}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {detail.hasAllQualityComments ? (
                      <span className="text-green-400 text-sm flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Comments มีคุณภาพครบ
                      </span>
                    ) : (
                      <span className="text-yellow-400 text-sm flex items-center gap-1">
                        <AlertCircle className="w-4 h-4" /> Comments: {detail.qualityCommentCount}/{detail.totalCriteria}
                      </span>
                    )}
                  </div>
                  {review && (
                    <div className="mt-3 space-y-2">
                      {DEFAULT_CRITERIA.map(c => {
                        const analysis = review.commentAnalysis[c.key];
                        return (
                          <div key={c.key} className="text-sm">
                            <span className={analysis?.isQuality ? 'text-green-400' : 'text-red-400'}>
                              {analysis?.isQuality ? '✓' : '✗'}
                            </span>
                            <span className="text-slate-400 ml-2">{c.name}:</span>
                            <span className="text-slate-300 ml-2">
                              {analysis?.originalComment || '-'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }) {
  const colors = {
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    green: 'from-green-500/20 to-green-600/10 border-green-500/30',
    red: 'from-red-500/20 to-red-600/10 border-red-500/30'
  };
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4`}>
      <div className="flex items-center gap-3">
        <Icon className="w-6 h-6" />
        <div>
          <div className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</div>
          <div className="text-sm text-slate-400">{label}</div>
        </div>
      </div>
    </div>
  );
}

function getScoreColor(score, max) {
  const pct = (score / max) * 100;
  if (pct >= 80) return 'text-green-400';
  if (pct >= 60) return 'text-cyan-400';
  if (pct >= 40) return 'text-yellow-400';
  return 'text-red-400';
}
