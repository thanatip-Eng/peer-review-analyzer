// src/App.jsx
import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Users, BarChart2, Settings, Search, Download, ChevronRight, AlertCircle, CheckCircle2, XCircle, FileText } from 'lucide-react';
import { parseCSV, DEFAULT_CRITERIA, analyzeCommentCompleteness, aggregateStudentAnalysis } from './utils/csvParser';
import { calculateAllStudentsScores, calculateClassStatistics, DEFAULT_SETTINGS } from './utils/scoreCalculator';

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, maxScore: 12, rubricMaxScore: 12 });
  const [criteriaList] = useState(DEFAULT_CRITERIA);

  // CSV Upload Handler
  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      console.log('Parsing CSV file:', file.name);
      const result = await parseCSV(file);
      console.log('Parse result:', result.stats);
      
      const allScores = calculateAllStudentsScores({
        students: result.students,
        reviews: result.reviews,
        criteriaList,
        aiAnalyses: {},
        settings,
        aggregateFunc: aggregateStudentAnalysis
      });
      console.log('Scores calculated, sample:', allScores[0]);
      
      const classStats = calculateClassStatistics(allScores);
      setData({ ...result, allScores, classStats });
      setActiveTab('overview');
    } catch (err) {
      console.error('Error:', err);
      setError(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [criteriaList, settings]);

  // Export to CSV
  const exportToCSV = useCallback(() => {
    if (!data) return;
    const exportData = data.allScores.map(student => ({
      'ลำดับ': student.rank,
      'รหัสนักศึกษา': data.students[student.studentName]?.studentId || '',
      'ชื่อ-นามสกุล': data.students[student.studentName]?.fullName || '',
      'งานที่ได้รับ': data.students[student.studentName]?.reviewsAssigned || 0,
      'งานที่รีวิว': student.totalReviewsCompleted,
      'คะแนนเฉลี่ย (%)': student.averagePercentage,
      'คะแนนที่ได้': student.finalScore,
      'คะแนนเต็ม': student.maxScore,
      'เกรด': student.gradeLevel
    }));

    const headers = Object.keys(exportData[0]).join(',');
    const rows = exportData.map(row => Object.values(row).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `peer-review-scores-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  }, [data]);

  // Recalculate scores
  const recalculateScores = useCallback(() => {
    if (!data) return;
    const allScores = calculateAllStudentsScores({
      students: data.students,
      reviews: data.reviews,
      criteriaList,
      aiAnalyses: {},
      settings,
      aggregateFunc: aggregateStudentAnalysis
    });
    const classStats = calculateClassStatistics(allScores);
    setData(prev => ({ ...prev, allScores, classStats }));
  }, [data, criteriaList, settings]);

  // Filtered students
  const filteredStudents = useMemo(() => {
    if (!data) return [];
    return data.allScores.filter(student => {
      const search = searchQuery.toLowerCase();
      const studentData = data.students[student.studentName];
      return student.studentName.toLowerCase().includes(search) ||
             studentData?.studentId?.includes(search) ||
             studentData?.fullName?.toLowerCase().includes(search);
    });
  }, [data, searchQuery]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-900 via-purple-900 to-slate-900 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400">
              Peer Review Analyzer
            </span>
          </h1>
          <p className="text-slate-400 mt-1">ระบบวิเคราะห์คุณภาพการทำ Peer Review สำหรับ Canvas LMS</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Upload Section */}
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
                  <Upload className="w-5 h-5" />
                  เลือกไฟล์ CSV
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
            <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-lg">กำลังประมวลผล...</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <span className="text-red-300">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300 text-xl">×</button>
          </div>
        )}

        {/* Main Content */}
        {data && !loading && (
          <>
            {/* Tabs */}
            <div className="flex gap-2 mb-6 bg-slate-900/50 p-1 rounded-xl border border-white/10">
              {[
                { id: 'overview', label: 'ภาพรวม', icon: BarChart2 },
                { id: 'students', label: 'รายบุคคล', icon: Users },
                { id: 'settings', label: 'ตั้งค่า', icon: Settings }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-white/10'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="นักศึกษาทั้งหมด" value={data.stats.totalStudents} icon={Users} color="cyan" />
                  <StatCard label="การรีวิวทั้งหมด" value={data.stats.totalReviews} icon={FileText} color="purple" />
                  <StatCard label="รีวิวที่เสร็จ" value={data.stats.completedReviews} icon={CheckCircle2} color="green" />
                  <StatCard label="รีวิวที่ไม่เสร็จ" value={data.stats.incompleteReviews} icon={XCircle} color="red" />
                </div>

                {data.classStats && (
                  <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <BarChart2 className="w-5 h-5 text-cyan-400" />
                      สถิติคะแนนของชั้นเรียน
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-2xl font-bold text-cyan-400">{data.classStats.mean}%</div>
                        <div className="text-sm text-slate-400">คะแนนเฉลี่ย</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-2xl font-bold text-purple-400">{data.classStats.median}%</div>
                        <div className="text-sm text-slate-400">Median</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-2xl font-bold text-green-400">{data.classStats.max}%</div>
                        <div className="text-sm text-slate-400">สูงสุด</div>
                      </div>
                      <div className="bg-slate-800/50 rounded-xl p-4">
                        <div className="text-2xl font-bold text-red-400">{data.classStats.min}%</div>
                        <div className="text-sm text-slate-400">ต่ำสุด</div>
                      </div>
                    </div>

                    <div className="mt-6">
                      <h4 className="text-sm font-medium text-slate-400 mb-3">การกระจายเกรด</h4>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(data.classStats.gradeDistribution).map(([grade, count]) => (
                          <div key={grade} className="bg-slate-800/50 rounded-lg px-4 py-2">
                            <div className="text-lg font-bold">{grade}</div>
                            <div className="text-sm text-slate-400">{count} คน</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-4 flex-wrap">
                  <button onClick={exportToCSV} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition">
                    <Download className="w-5 h-5" />
                    Export CSV
                  </button>
                  <label className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition cursor-pointer">
                    <Upload className="w-5 h-5" />
                    อัปโหลดไฟล์ใหม่
                    <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
              </div>
            )}

            {/* Students Tab */}
            {activeTab === 'students' && (
              <div className="space-y-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="ค้นหาด้วยรหัส หรือชื่อนักศึกษา..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="bg-slate-900/50 border border-white/10 rounded-2xl overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">#</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                          <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รีวิว</th>
                          <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนน (%)</th>
                          <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">เกรด</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {filteredStudents.slice(0, 100).map((student) => {
                          const studentData = data.students[student.studentName];
                          return (
                            <tr key={student.studentName} className="hover:bg-white/5 transition">
                              <td className="px-4 py-3 text-slate-500">{student.rank}</td>
                              <td className="px-4 py-3 font-mono text-sm">{studentData?.studentId}</td>
                              <td className="px-4 py-3">{studentData?.fullName}</td>
                              <td className="px-4 py-3 text-center">
                                <span className="text-cyan-400">{student.totalReviewsCompleted}</span>
                                <span className="text-slate-500">/{studentData?.reviewsAssigned}</span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`font-semibold ${getScoreColor(student.averagePercentage)}`}>
                                  {student.averagePercentage}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded text-sm font-medium ${getGradeStyle(student.gradeLevel)}`}>
                                  {student.gradeLevel}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <button onClick={() => setSelectedStudent(student)} className="p-2 hover:bg-white/10 rounded-lg transition">
                                  <ChevronRight className="w-5 h-5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {filteredStudents.length > 100 && (
                    <div className="px-4 py-3 bg-slate-800/30 text-center text-slate-400 text-sm">
                      แสดง 100 จาก {filteredStudents.length} รายการ - ใช้การค้นหาเพื่อกรอง
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === 'settings' && (
              <div className="space-y-6">
                <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-cyan-400" />
                    การตั้งค่าคะแนน
                  </h3>
                  
                  <div className="grid gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-2">คะแนนเต็มที่ต้องการ</label>
                      <input
                        type="number"
                        value={settings.maxScore}
                        onChange={(e) => setSettings(s => ({ ...s, maxScore: parseFloat(e.target.value) || 12 }))}
                        className="w-32 px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">น้ำหนัก: ความครบถ้วน (%)</label>
                        <input
                          type="number"
                          value={settings.weights.completeness * 100}
                          onChange={(e) => setSettings(s => ({ ...s, weights: { ...s.weights, completeness: parseFloat(e.target.value) / 100 || 0.5 }}))}
                          className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">น้ำหนัก: คุณภาพ (%)</label>
                        <input
                          type="number"
                          value={settings.weights.quality * 100}
                          onChange={(e) => setSettings(s => ({ ...s, weights: { ...s.weights, quality: parseFloat(e.target.value) / 100 || 0.3 }}))}
                          className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">น้ำหนัก: ความสอดคล้อง (%)</label>
                        <input
                          type="number"
                          value={settings.weights.gradeConsistency * 100}
                          onChange={(e) => setSettings(s => ({ ...s, weights: { ...s.weights, gradeConsistency: parseFloat(e.target.value) / 100 || 0.2 }}))}
                          className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <button onClick={recalculateScores} className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl font-medium hover:opacity-90 transition">
                  คำนวณคะแนนใหม่
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Student Detail Modal */}
      {selectedStudent && data && (
        <StudentDetailModal
          student={selectedStudent}
          studentData={data.students[selectedStudent.studentName]}
          reviews={data.reviews.filter(r => r.reviewerName === selectedStudent.studentName)}
          criteriaList={criteriaList}
          onClose={() => setSelectedStudent(null)}
        />
      )}
    </div>
  );
}

// StatCard Component
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

// StudentDetailModal Component
function StudentDetailModal({ student, studentData, reviews, criteriaList, onClose }) {
  if (!student || !studentData) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-cyan-900/50 to-purple-900/50 p-6 border-b border-white/10">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold">{studentData.fullName}</h2>
              <p className="text-slate-400 font-mono">{studentData.studentId}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-2xl leading-none">×</button>
          </div>
          <div className="flex gap-6 mt-4">
            <div>
              <div className="text-3xl font-bold text-cyan-400">{student.averagePercentage}%</div>
              <div className="text-sm text-slate-400">คะแนนเฉลี่ย</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">{student.totalReviewsCompleted}/{student.totalReviewsAssigned}</div>
              <div className="text-sm text-slate-400">รีวิวที่ทำ</div>
            </div>
            <div>
              <div className={`text-3xl font-bold ${getGradeTextColor(student.gradeLevel)}`}>{student.gradeLevel}</div>
              <div className="text-sm text-slate-400">เกรด</div>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <h3 className="text-lg font-semibold mb-4">รายละเอียดการรีวิว ({reviews.length} งาน)</h3>
          {reviews.map((review) => {
            const completeness = analyzeCommentCompleteness(review, criteriaList);
            return (
              <div key={review.id} className="bg-slate-800/50 rounded-xl p-4 mb-4">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className="text-sm text-slate-400">รีวิวงานของ:</span>
                    <div className="font-medium">{review.revieweeFullName || review.revieweeName}</div>
                    <div className="text-sm text-slate-500 font-mono">{review.revieweeId}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-cyan-400">
                      {review.gradeGiven !== null ? review.gradeGiven : '-'}/12
                    </div>
                    <div className="text-sm text-slate-400">คะแนนที่ให้</div>
                  </div>
                </div>

                {review.gradeGiven !== null && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      {completeness.completeness === 100 ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                      )}
                      <span className={completeness.completeness === 100 ? 'text-green-400' : 'text-yellow-400'}>
                        คอมเมนต์: {completeness.commentedCriteria}/{completeness.totalCriteria} criteria ({Math.round(completeness.completeness)}%)
                      </span>
                    </div>

                    {completeness.missingCriteria.length > 0 && (
                      <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 mb-3">
                        <div className="text-sm text-red-400 font-medium mb-1">ขาดคอมเมนต์ใน criteria:</div>
                        <div className="flex flex-wrap gap-2">
                          {completeness.missingCriteria.map(c => (
                            <span key={c.key} className="px-2 py-1 bg-red-900/30 rounded text-xs text-red-300">{c.name}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      {criteriaList.map(criteria => {
                        const comment = review.comments[criteria.key];
                        if (!comment || comment.trim() === '' || comment.trim() === '-') return null;
                        return (
                          <div key={criteria.key} className="bg-slate-900/50 rounded-lg p-3">
                            <div className="text-xs text-slate-500 mb-1">{criteria.name}</div>
                            <div className="text-sm">{comment}</div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {review.gradeGiven === null && (
                  <div className="text-yellow-400 text-sm">⚠️ ยังไม่ได้ทำรีวิวนี้</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Helper functions
function getScoreColor(score) {
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-cyan-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function getGradeStyle(grade) {
  const styles = {
    'A': 'bg-green-500/20 text-green-400',
    'B+': 'bg-cyan-500/20 text-cyan-400',
    'B': 'bg-cyan-500/20 text-cyan-400',
    'C+': 'bg-yellow-500/20 text-yellow-400',
    'C': 'bg-yellow-500/20 text-yellow-400',
    'D+': 'bg-orange-500/20 text-orange-400',
    'D': 'bg-orange-500/20 text-orange-400',
    'F': 'bg-red-500/20 text-red-400'
  };
  return styles[grade] || 'bg-slate-500/20 text-slate-400';
}

function getGradeTextColor(grade) {
  const colors = {
    'A': 'text-green-400', 'B+': 'text-cyan-400', 'B': 'text-cyan-400',
    'C+': 'text-yellow-400', 'C': 'text-yellow-400',
    'D+': 'text-orange-400', 'D': 'text-orange-400', 'F': 'text-red-400'
  };
  return colors[grade] || 'text-slate-400';
}
