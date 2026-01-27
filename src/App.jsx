// src/App.jsx
import React, { useState, useCallback, useMemo } from 'react';
import { Upload, Users, Search, Download, ChevronRight, AlertCircle, CheckCircle2, XCircle, AlertTriangle, UserCheck, BarChart2, FileText, ClipboardList, Filter } from 'lucide-react';
import { parseCSV, DEFAULT_CRITERIA, getFlaggedStudents, getFlaggedGraders } from './utils/csvParser';
import Papa from 'papaparse';

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGrader, setSelectedGrader] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  
  // Group management
  const [groupData, setGroupData] = useState(null); // ข้อมูล group จากไฟล์
  const [groupSets, setGroupSets] = useState([]); // รายชื่อ group sets ทั้งหมด
  const [selectedGroupSet, setSelectedGroupSet] = useState(''); // group set ที่เลือกใช้
  const [groupFilter, setGroupFilter] = useState(''); // filter สำหรับหน้า admin

  // Parse student/group file
  const handleGroupFileUpload = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const headers = Object.keys(results.data[0] || {});
          console.log('Group file headers:', headers);
          
          // หา group set columns (column 7 เป็นต้นไป = index 6+)
          // Column A-F: Student, ID, SIS User ID, SIS Login ID, Integration ID, Section
          const fixedColumns = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section'];
          const groupSetColumns = headers.filter(h => !fixedColumns.includes(h) && h.trim() !== '');
          
          console.log('Found group sets:', groupSetColumns);
          
          // สร้าง mapping: studentId -> { groupSet1: groupName, groupSet2: groupName, ... }
          const studentGroups = {};
          results.data.forEach(row => {
            const studentId = row['SIS User ID'] || row['ID'] || '';
            if (!studentId) return;
            
            studentGroups[studentId] = {
              studentName: row['Student'] || '',
              section: row['Section'] || ''
            };
            
            groupSetColumns.forEach(gs => {
              studentGroups[studentId][gs] = row[gs] || '';
            });
          });
          
          setGroupData(studentGroups);
          setGroupSets(groupSetColumns);
          
          // ถ้ามี group set เดียว ให้เลือกอัตโนมัติ
          if (groupSetColumns.length === 1) {
            setSelectedGroupSet(groupSetColumns[0]);
          } else if (groupSetColumns.length > 1) {
            setSelectedGroupSet(''); // ให้ user เลือก
          }
          
          console.log('Parsed group data:', Object.keys(studentGroups).length, 'students');
          
        } catch (err) {
          console.error('Error parsing group file:', err);
          setError(`เกิดข้อผิดพลาดในการอ่านไฟล์ group: ${err.message}`);
        }
      },
      error: (err) => {
        setError(`เกิดข้อผิดพลาด: ${err.message}`);
      }
    });
  }, []);

  // Get group for a student
  const getStudentGroup = useCallback((studentId) => {
    if (!groupData || !selectedGroupSet || !studentId) return '';
    const student = groupData[studentId];
    return student ? (student[selectedGroupSet] || '') : '';
  }, [groupData, selectedGroupSet]);

  // Get all unique groups in selected group set
  const allGroups = useMemo(() => {
    if (!groupData || !selectedGroupSet) return [];
    const groups = new Set();
    Object.values(groupData).forEach(s => {
      if (s[selectedGroupSet]) groups.add(s[selectedGroupSet]);
    });
    return Array.from(groups).sort();
  }, [groupData, selectedGroupSet]);

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
    const rows = Object.values(data.students).map((s, i) => {
      const row = {
        'ลำดับ': i + 1,
        'รหัสนักศึกษา': s.studentId,
        'ชื่อ-นามสกุล': s.fullName
      };
      // เพิ่ม group ถ้ามี
      if (selectedGroupSet) {
        row['Group'] = getStudentGroup(s.studentId);
      }
      return {
        ...row,
        'จำนวน Grader ที่ Assign': s.gradersAssigned,
        'จำนวน Grader ที่รีวิวแล้ว': s.gradersCompleted,
        'คะแนนเฉลี่ย': s.workScore.average,
        'คะแนนต่ำสุด': s.workScore.min || '-',
        'คะแนนสูงสุด': s.workScore.max || '-',
        'SD': s.workScore.stdDev,
        'เชื่อถือได้': s.workScore.isReliable ? 'ใช่' : 'ไม่',
        'Flags': s.flags.map(f => f.message).join('; ')
      };
    });
    downloadCSV(rows, 'student-work-scores');
  }, [data, selectedGroupSet, getStudentGroup]);

  const exportGraderScores = useCallback(() => {
    if (!data) return;
    const rows = Object.values(data.graders).map((g, i) => {
      const row = {
        'ลำดับ': i + 1,
        'รหัสนักศึกษา': g.graderId,
        'ชื่อ-นามสกุล': g.fullName
      };
      // เพิ่ม group ถ้ามี
      if (selectedGroupSet) {
        row['Group'] = getStudentGroup(g.graderId);
      }
      return {
        ...row,
        'งานที่ได้รับ': g.assignedReviews,
        'งานที่รีวิวแล้ว': g.peerReviewScore.reviewedCount,
        'งานสมบูรณ์': g.peerReviewScore.completeCount,
        'คะแนนพื้นฐาน': g.peerReviewScore.baseScore,
        'โบนัส': g.peerReviewScore.bonus,
        'คะแนนรวม': g.peerReviewScore.netScore,
        'คะแนนเต็ม': g.peerReviewScore.fullScore,
        'Flags': g.flags.map(f => f.message).join('; ')
      };
    });
    downloadCSV(rows, 'grader-peer-review-scores');
  }, [data, selectedGroupSet, getStudentGroup]);

  // Export รวมทั้งสองคะแนน
  const exportCombinedScores = useCallback(() => {
    if (!data) return;
    
    // รวมข้อมูลจาก students และ graders โดยใช้ studentId เป็น key
    const combined = {};
    
    // เพิ่มข้อมูลจาก students (เจ้าของงาน)
    Object.values(data.students).forEach(s => {
      const key = s.studentId;
      if (!combined[key]) {
        combined[key] = {
          studentId: s.studentId,
          fullName: s.fullName,
          // คะแนนชิ้นงาน
          work_gradersAssigned: 0,
          work_gradersCompleted: 0,
          work_average: '-',
          work_min: '-',
          work_max: '-',
          work_sd: '-',
          work_reliable: '-',
          // คะแนน Peer Review
          pr_assigned: 0,
          pr_reviewed: 0,
          pr_complete: 0,
          pr_base: 0,
          pr_bonus: 0,
          pr_netScore: 0,
          pr_fullScore: 0,
          // Flags
          flags: []
        };
      }
      combined[key].work_gradersAssigned = s.gradersAssigned;
      combined[key].work_gradersCompleted = s.gradersCompleted;
      combined[key].work_average = s.workScore.average || '-';
      combined[key].work_min = s.workScore.min !== null ? s.workScore.min : '-';
      combined[key].work_max = s.workScore.max !== null ? s.workScore.max : '-';
      combined[key].work_sd = s.workScore.stdDev || '-';
      combined[key].work_reliable = s.workScore.isReliable ? 'ใช่' : 'ไม่';
      combined[key].flags.push(...s.flags.map(f => `[งาน] ${f.message}`));
    });
    
    // เพิ่มข้อมูลจาก graders (คนรีวิว)
    Object.values(data.graders).forEach(g => {
      const key = g.graderId;
      const pr = g.peerReviewScore;
      if (!combined[key]) {
        combined[key] = {
          studentId: g.graderId,
          fullName: g.fullName,
          work_gradersAssigned: 0,
          work_gradersCompleted: 0,
          work_average: '-',
          work_min: '-',
          work_max: '-',
          work_sd: '-',
          work_reliable: '-',
          pr_assigned: 0,
          pr_reviewed: 0,
          pr_complete: 0,
          pr_base: 0,
          pr_bonus: 0,
          pr_netScore: 0,
          pr_fullScore: 0,
          flags: []
        };
      }
      combined[key].pr_assigned = g.assignedReviews;
      combined[key].pr_reviewed = pr.reviewedCount || 0;
      combined[key].pr_complete = pr.completeCount || 0;
      combined[key].pr_base = pr.baseScore || 0;
      combined[key].pr_bonus = pr.bonus || 0;
      combined[key].pr_netScore = pr.netScore || 0;
      combined[key].pr_fullScore = pr.fullScore || 0;
      combined[key].flags.push(...g.flags.map(f => `[PR] ${f.message}`));
    });
    
    // สร้าง rows สำหรับ export
    const rows = Object.values(combined)
      .sort((a, b) => a.studentId.localeCompare(b.studentId))
      .map((c, i) => {
        const row = {
          'ลำดับ': i + 1,
          'รหัสนักศึกษา': c.studentId,
          'ชื่อ-นามสกุล': c.fullName
        };
        // เพิ่ม group ถ้ามี
        if (selectedGroupSet) {
          row['Group'] = getStudentGroup(c.studentId);
        }
        return {
          ...row,
          // คะแนนชิ้นงาน
          '[ชิ้นงาน] Grader Assigned': c.work_gradersAssigned,
          '[ชิ้นงาน] Grader รีวิวแล้ว': c.work_gradersCompleted,
          '[ชิ้นงาน] คะแนนเฉลี่ย': c.work_average,
          '[ชิ้นงาน] Min': c.work_min,
          '[ชิ้นงาน] Max': c.work_max,
          '[ชิ้นงาน] SD': c.work_sd,
          '[ชิ้นงาน] เชื่อถือได้': c.work_reliable,
          // คะแนน Peer Review
          '[PR] งานที่ได้รับ': c.pr_assigned,
          '[PR] รีวิวแล้ว': c.pr_reviewed,
          '[PR] งานสมบูรณ์': c.pr_complete,
          '[PR] คะแนนพื้นฐาน': c.pr_base,
          '[PR] โบนัส': c.pr_bonus,
          '[PR] คะแนนรวม': c.pr_netScore,
          '[PR] คะแนนเต็ม': c.pr_fullScore,
          // Flags
          'หมายเหตุ': c.flags.join('; ')
        };
      });
    
    downloadCSV(rows, 'combined-scores');
  }, [data, selectedGroupSet, getStudentGroup]);

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
      const matchSearch = s.studentName.toLowerCase().includes(q) || s.studentId.includes(q) || s.fullName.toLowerCase().includes(q);
      // ถ้ามี group filter ในหน้า students ก็ใช้ได้
      const group = getStudentGroup(s.studentId);
      const matchGroup = !groupFilter || group === groupFilter;
      return matchSearch && matchGroup;
    }).sort((a, b) => b.workScore.average - a.workScore.average);
  }, [data, searchQuery, groupFilter, getStudentGroup]);

  const filteredGraders = useMemo(() => {
    if (!data) return [];
    return Object.values(data.graders).filter(g => {
      const q = searchQuery.toLowerCase();
      const matchSearch = g.graderName.toLowerCase().includes(q) || g.graderId?.includes(q) || g.fullName.toLowerCase().includes(q);
      const group = getStudentGroup(g.graderId);
      const matchGroup = !groupFilter || group === groupFilter;
      return matchSearch && matchGroup;
    }).sort((a, b) => b.peerReviewScore.netScore - a.peerReviewScore.netScore);
  }, [data, searchQuery, groupFilter, getStudentGroup]);

  const flaggedStudents = useMemo(() => data ? getFlaggedStudents(data.students) : [], [data]);
  const flaggedGraders = useMemo(() => data ? getFlaggedGraders(data.graders) : [], [data]);

  // Group statistics
  const groupStats = useMemo(() => {
    if (!data || !selectedGroupSet || !groupData) return null;
    
    const stats = {};
    allGroups.forEach(group => {
      stats[group] = {
        students: [],
        graders: [],
        workScores: [],
        prScores: [],
        flaggedCount: 0
      };
    });
    
    // Add students to groups
    Object.values(data.students).forEach(s => {
      const group = getStudentGroup(s.studentId);
      if (group && stats[group]) {
        stats[group].students.push(s);
        if (s.workScore.average) {
          stats[group].workScores.push(s.workScore.average);
        }
        if (s.flags.length > 0) {
          stats[group].flaggedCount++;
        }
      }
    });
    
    // Add graders to groups
    Object.values(data.graders).forEach(g => {
      const group = getStudentGroup(g.graderId);
      if (group && stats[group]) {
        stats[group].graders.push(g);
        stats[group].prScores.push(g.peerReviewScore.netScore);
        if (g.flags.length > 0) {
          stats[group].flaggedCount++;
        }
      }
    });
    
    // Calculate averages
    Object.keys(stats).forEach(group => {
      const s = stats[group];
      s.avgWorkScore = s.workScores.length > 0 
        ? Math.round(s.workScores.reduce((a, b) => a + b, 0) / s.workScores.length * 100) / 100 
        : 0;
      s.avgPRScore = s.prScores.length > 0 
        ? Math.round(s.prScores.reduce((a, b) => a + b, 0) / s.prScores.length * 100) / 100 
        : 0;
    });
    
    return stats;
  }, [data, selectedGroupSet, groupData, allGroups, getStudentGroup]);

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
          <div className="space-y-6">
            {/* Upload Peer Review CSV */}
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-semibold mb-2">1. อัปโหลดไฟล์ Peer Review CSV</h2>
                <p className="text-slate-400 mb-6">นำเข้าข้อมูล Peer Review จาก Canvas</p>
                <label className="cursor-pointer">
                  <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                  <div className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl font-medium hover:opacity-90 transition inline-flex items-center gap-2">
                    <Upload className="w-5 h-5" /> เลือกไฟล์ Peer Review CSV
                  </div>
                </label>
              </div>
            </div>

            {/* Upload Group CSV (Optional) */}
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
              <div className="max-w-md mx-auto">
                <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Users className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-semibold mb-2">2. อัปโหลดไฟล์ข้อมูลนักศึกษา (ไม่บังคับ)</h2>
                <p className="text-slate-400 mb-4">นำเข้าข้อมูล Group จาก Canvas เพื่อดูสรุปแยกตาม Group</p>
                <label className="cursor-pointer">
                  <input type="file" accept=".csv" onChange={handleGroupFileUpload} className="hidden" />
                  <div className="px-6 py-3 bg-gradient-to-r from-green-500 to-teal-600 rounded-xl font-medium hover:opacity-90 transition inline-flex items-center gap-2">
                    <Users className="w-5 h-5" /> เลือกไฟล์ข้อมูลนักศึกษา
                  </div>
                </label>
                {groupData && (
                  <div className="mt-4 p-3 bg-green-900/30 border border-green-500/30 rounded-lg text-left">
                    <div className="text-green-400 font-medium">✓ โหลดข้อมูล Group แล้ว</div>
                    <div className="text-sm text-slate-400 mt-1">
                      {Object.keys(groupData).length} นักศึกษา, {groupSets.length} Group Set(s)
                    </div>
                    {groupSets.length > 0 && (
                      <div className="mt-2 text-sm text-slate-400">
                        Group Sets: {groupSets.join(', ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
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
            {/* Group Management Bar */}
            {(groupSets.length > 1 || groupData) && (
              <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                  {/* Group file upload (ถ้ายังไม่มี) */}
                  {!groupData && (
                    <label className="cursor-pointer">
                      <input type="file" accept=".csv" onChange={handleGroupFileUpload} className="hidden" />
                      <div className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm flex items-center gap-2">
                        <Users className="w-4 h-4" /> อัปโหลดไฟล์ Group
                      </div>
                    </label>
                  )}
                  
                  {/* Group Set Selector */}
                  {groupSets.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-sm">Group Set:</span>
                      <select
                        value={selectedGroupSet}
                        onChange={(e) => {
                          setSelectedGroupSet(e.target.value);
                          setGroupFilter(''); // Reset filter
                        }}
                        className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">-- เลือก Group Set --</option>
                        {groupSets.map(gs => (
                          <option key={gs} value={gs}>{gs}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  {/* Group Filter */}
                  {selectedGroupSet && allGroups.length > 0 && (
                    <div className="flex items-center gap-2">
                      <Filter className="w-4 h-4 text-slate-400" />
                      <select
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                        className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm"
                      >
                        <option value="">ทุก Group</option>
                        {allGroups.map(g => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  {/* Group Info */}
                  {groupData && (
                    <div className="text-sm text-slate-400 ml-auto">
                      ✓ โหลด Group แล้ว ({Object.keys(groupData).length} คน)
                      {selectedGroupSet && ` | ${selectedGroupSet}: ${allGroups.length} groups`}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Upload Group File ถ้ายังไม่มี */}
            {!groupData && (
              <div className="bg-slate-900/50 border border-dashed border-white/20 rounded-xl p-4 mb-6 text-center">
                <label className="cursor-pointer">
                  <input type="file" accept=".csv" onChange={handleGroupFileUpload} className="hidden" />
                  <div className="text-slate-400 text-sm flex items-center justify-center gap-2 hover:text-white transition">
                    <Users className="w-4 h-4" /> 
                    คลิกเพื่ออัปโหลดไฟล์ข้อมูลนักศึกษา (Group) - ไม่บังคับ
                  </div>
                </label>
              </div>
            )}

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

            {activeTab === 'overview' && (
              <OverviewTab 
                data={data} 
                onExportCombined={exportCombinedScores}
                groupStats={groupStats}
                selectedGroupSet={selectedGroupSet}
                allGroups={allGroups}
              />
            )}
            {activeTab === 'students' && (
              <StudentsTab 
                students={filteredStudents} 
                searchQuery={searchQuery} 
                setSearchQuery={setSearchQuery}
                onSelect={setSelectedStudent}
                onExport={exportStudentScores}
                getStudentGroup={getStudentGroup}
                selectedGroupSet={selectedGroupSet}
                allGroups={allGroups}
                groupFilter={groupFilter}
                setGroupFilter={setGroupFilter}
              />
            )}
            {activeTab === 'graders' && (
              <GradersTab 
                graders={filteredGraders}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                onSelect={setSelectedGrader}
                onExport={exportGraderScores}
                getStudentGroup={getStudentGroup}
                selectedGroupSet={selectedGroupSet}
                allGroups={allGroups}
                groupFilter={groupFilter}
                setGroupFilter={setGroupFilter}
              />
            )}
            {activeTab === 'admin' && (
              <AdminTab 
                flaggedStudents={flaggedStudents}
                flaggedGraders={flaggedGraders}
                data={data}
                getStudentGroup={getStudentGroup}
                selectedGroupSet={selectedGroupSet}
                allGroups={allGroups}
                groupFilter={groupFilter}
                setGroupFilter={setGroupFilter}
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

function OverviewTab({ data, onExportCombined, groupStats, selectedGroupSet, allGroups }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="นักศึกษา (เจ้าของงาน)" value={data.stats.totalStudents} icon={Users} color="cyan" />
        <StatCard label="Graders (คนรีวิว)" value={data.stats.totalGraders} icon={UserCheck} color="purple" />
        <StatCard label="รีวิวที่เสร็จ" value={data.stats.completedReviews} icon={CheckCircle2} color="green" />
        <StatCard label="รีวิวที่ยังไม่เสร็จ" value={data.stats.incompleteReviews} icon={XCircle} color="red" />
      </div>

      {/* ปุ่ม Export รวม */}
      <div className="flex justify-center">
        <button 
          onClick={onExportCombined} 
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-medium transition shadow-lg"
        >
          <Download className="w-5 h-5" /> 
          Export รวมทุกคะแนน (CSV)
        </button>
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

      {/* Group Statistics */}
      {groupStats && selectedGroupSet && allGroups.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-green-400" /> สถิติแยกตาม Group ({selectedGroupSet})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Group</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">จำนวนคน</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนชิ้นงานเฉลี่ย</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนน PR เฉลี่ย</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">มี Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {allGroups.map(group => {
                  const stats = groupStats[group];
                  if (!stats) return null;
                  return (
                    <tr key={group} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-medium">{group}</td>
                      <td className="px-4 py-3 text-center text-slate-400">{stats.students.length}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${stats.avgWorkScore >= 9 ? 'text-green-400' : stats.avgWorkScore >= 6 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {stats.avgWorkScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-semibold ${stats.avgPRScore >= 3.5 ? 'text-green-400' : stats.avgPRScore >= 2.5 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {stats.avgPRScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {stats.flaggedCount > 0 ? (
                          <span className="text-yellow-400">{stats.flaggedCount}</span>
                        ) : (
                          <span className="text-green-400">0</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
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

function StudentsTab({ students, searchQuery, setSearchQuery, onSelect, onExport, getStudentGroup, selectedGroupSet, allGroups, groupFilter, setGroupFilter }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัส หรือชื่อ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500"
          />
        </div>
        {selectedGroupSet && allGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2"
            >
              <option value="">ทุก Group</option>
              {allGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        )}
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
                {selectedGroupSet && (
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Group</th>
                )}
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
                  {selectedGroupSet && (
                    <td className="px-4 py-3 text-sm">
                      <span className="bg-slate-700 px-2 py-1 rounded text-xs">
                        {getStudentGroup(student.studentId) || '-'}
                      </span>
                    </td>
                  )}
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

function GradersTab({ graders, searchQuery, setSearchQuery, onSelect, onExport, getStudentGroup, selectedGroupSet, allGroups, groupFilter, setGroupFilter }) {
  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาด้วยรหัส หรือชื่อ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-slate-900/50 border border-white/10 rounded-xl text-white placeholder-slate-500"
          />
        </div>
        {selectedGroupSet && allGroups.length > 0 && (
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2"
            >
              <option value="">ทุก Group</option>
              {allGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={onExport} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl">
          <Download className="w-5 h-5" /> Export
        </button>
      </div>

      {/* Legend */}
      <div className="bg-slate-800/50 rounded-xl p-3 text-sm flex flex-wrap gap-4">
        <span className="text-slate-400">เงื่อนไข:</span>
        <span>รีวิว 1 งาน = <span className="text-cyan-400">1 คะแนน</span></span>
        <span>รีวิวครบ + ทุกงานสมบูรณ์ = <span className="text-green-400">+1 โบนัส</span></span>
        <span>สมบูรณ์ = ขาด comment ไม่เกิน 3 ช่อง</span>
      </div>

      <div className="bg-slate-900/50 border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                {selectedGroupSet && (
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">Group</th>
                )}
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">งานที่ได้รับ</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รีวิวแล้ว</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">งานสมบูรณ์</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนน</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">โบนัส</th>
                <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รวม</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {graders.slice(0, 100).map(grader => {
                const pr = grader.peerReviewScore;
                return (
                  <tr key={grader.graderName} className="hover:bg-white/5">
                    <td className="px-4 py-3 font-mono text-sm">{grader.graderId}</td>
                    <td className="px-4 py-3">
                      {grader.fullName}
                      {grader.flags.length > 0 && <AlertTriangle className="inline w-4 h-4 text-yellow-400 ml-2" />}
                    </td>
                    {selectedGroupSet && (
                      <td className="px-4 py-3 text-sm">
                        <span className="bg-slate-700 px-2 py-1 rounded text-xs">
                          {getStudentGroup(grader.graderId) || '-'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <span className={grader.assignedReviews !== 3 ? 'text-yellow-400' : 'text-slate-400'}>
                        {grader.assignedReviews}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={pr.reviewedCount === grader.assignedReviews ? 'text-green-400' : 'text-yellow-400'}>
                        {pr.reviewedCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={pr.completeCount === pr.reviewedCount ? 'text-green-400' : 'text-yellow-400'}>
                        {pr.completeCount}/{pr.reviewedCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-cyan-400">{pr.baseScore}</td>
                    <td className="px-4 py-3 text-center">
                      {pr.bonus > 0 ? (
                        <span className="text-green-400">+{pr.bonus}</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-semibold ${pr.netScore === pr.fullScore ? 'text-green-400' : pr.netScore > 0 ? 'text-cyan-400' : 'text-red-400'}`}>
                        {pr.netScore}/{pr.fullScore}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => onSelect(grader)} className="p-2 hover:bg-white/10 rounded-lg">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminTab({ flaggedStudents, flaggedGraders, data, getStudentGroup, selectedGroupSet, allGroups, groupFilter, setGroupFilter }) {
  const [activeSection, setActiveSection] = useState('overmax'); // overmax, unusual, flagged, inconsistent

  // กรณีคะแนนเกิน 12
  const overMaxScores = useMemo(() => {
    if (!data) return { students: [], graders: [] };
    
    // Students ที่ได้รับคะแนนเกิน 12
    let studentsOver = Object.values(data.students)
      .filter(s => s.workScore.grades && s.workScore.grades.some(g => g > 12))
      .map(s => ({
        ...s,
        overGrades: s.workScore.grades.filter(g => g > 12)
      }));
    
    // Apply group filter
    if (groupFilter) {
      studentsOver = studentsOver.filter(s => getStudentGroup(s.studentId) === groupFilter);
    }
    
    // Graders ที่ให้คะแนนเกิน 12
    let gradersOver = [];
    Object.values(data.graders).forEach(g => {
      // Apply group filter
      if (groupFilter && getStudentGroup(g.graderId) !== groupFilter) return;
      
      g.peerReviewScore.details.forEach(d => {
        if (d.gradeGiven > 12) {
          gradersOver.push({
            graderId: g.graderId,
            graderFullName: g.fullName,
            studentReviewed: d.studentReviewed,
            gradeGiven: d.gradeGiven
          });
        }
      });
    });
    
    return { students: studentsOver, graders: gradersOver };
  }, [data, groupFilter, getStudentGroup]);

  // กรณีพิเศษ: ได้รับงานไม่เท่ากับ 3
  const unusualAssignments = useMemo(() => {
    if (!data) return [];
    let result = Object.values(data.graders)
      .filter(g => g.assignedReviews !== 3 && g.assignedReviews > 0);
    
    // Apply group filter
    if (groupFilter) {
      result = result.filter(g => getStudentGroup(g.graderId) === groupFilter);
    }
    
    return result.sort((a, b) => a.assignedReviews - b.assignedReviews);
  }, [data, groupFilter, getStudentGroup]);

  // กรณี G: คะแนนไม่สอดคล้องกับคอมเมนต์
  const inconsistentReviews = useMemo(() => {
    if (!data) return [];
    const results = [];
    
    Object.values(data.graders).forEach(grader => {
      // Apply group filter
      if (groupFilter && getStudentGroup(grader.graderId) !== groupFilter) return;
      
      grader.peerReviewScore.details.forEach(detail => {
        const review = data.reviews.find(r => r.id === detail.reviewId);
        if (!review) return;
        
        // ตรวจสอบความไม่สอดคล้อง
        const grade = detail.gradeGiven;
        const comments = detail.comments || {};
        const allComments = Object.values(comments).join(' ').toLowerCase();
        
        let issue = null;
        
        // ให้คะแนนเต็ม (11-12) แต่คอมเมนต์บอกว่ามีปัญหา
        if (grade >= 11) {
          const negativeWords = ['ไม่', 'ขาด', 'บกพร่อง', 'ปรับปรุง', 'แก้ไข', 'ไม่มี', 'ไม่ได้', 'ไม่ครบ', 'ไม่ชัด'];
          const hasNegative = negativeWords.some(w => allComments.includes(w));
          if (hasNegative && allComments.length > 20) {
            issue = 'ให้คะแนนสูง (≥11) แต่คอมเมนต์มีคำเชิงลบ';
          }
        }
        
        // ให้คะแนนต่ำ (≤6) แต่คอมเมนต์บอกว่าดี
        if (grade <= 6) {
          const positiveWords = ['ดีมาก', 'ครบถ้วน', 'สมบูรณ์', 'ยอดเยี่ยม', 'เยี่ยม', 'ชัดเจน', 'ดี'];
          const hasPositive = positiveWords.some(w => allComments.includes(w));
          if (hasPositive && !allComments.includes('ไม่')) {
            issue = 'ให้คะแนนต่ำ (≤6) แต่คอมเมนต์เป็นเชิงบวก';
          }
        }
        
        if (issue) {
          results.push({
            graderName: grader.graderName,
            graderId: grader.graderId,
            graderFullName: grader.fullName,
            studentReviewed: detail.studentReviewed,
            grade: grade,
            comments: comments,
            issue: issue
          });
        }
      });
    });
    
    return results;
  }, [data, groupFilter, getStudentGroup]);

  // Filter flagged lists by group
  const filteredFlaggedStudents = useMemo(() => {
    if (!groupFilter) return flaggedStudents;
    return flaggedStudents.filter(s => getStudentGroup(s.studentId) === groupFilter);
  }, [flaggedStudents, groupFilter, getStudentGroup]);

  const filteredFlaggedGraders = useMemo(() => {
    if (!groupFilter) return flaggedGraders;
    return flaggedGraders.filter(g => getStudentGroup(g.graderId) === groupFilter);
  }, [flaggedGraders, groupFilter, getStudentGroup]);

  const totalOverMax = overMaxScores.students.length + overMaxScores.graders.length;

  return (
    <div className="space-y-6">
      {/* Group Filter */}
      {selectedGroupSet && allGroups.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 flex items-center gap-4">
          <Filter className="w-5 h-5 text-slate-400" />
          <span className="text-slate-400">กรองตาม Group:</span>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-slate-800 border border-white/10 rounded-lg px-4 py-2"
          >
            <option value="">ทุก Group</option>
            {allGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          {groupFilter && (
            <span className="text-green-400 text-sm">กำลังแสดงเฉพาะ: {groupFilter}</span>
          )}
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-2 bg-slate-800/50 p-1 rounded-xl flex-wrap">
        <button
          onClick={() => setActiveSection('overmax')}
          className={`flex-1 px-4 py-2 rounded-lg transition ${activeSection === 'overmax' ? 'bg-red-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          🚫 คะแนนเกิน 12 ({totalOverMax})
        </button>
        <button
          onClick={() => setActiveSection('unusual')}
          className={`flex-1 px-4 py-2 rounded-lg transition ${activeSection === 'unusual' ? 'bg-yellow-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          ⚠️ งานไม่เท่ากับ 3 ({unusualAssignments.length})
        </button>
        <button
          onClick={() => setActiveSection('flagged')}
          className={`flex-1 px-4 py-2 rounded-lg transition ${activeSection === 'flagged' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          🚨 รายการผิดปกติ ({filteredFlaggedStudents.length + filteredFlaggedGraders.length})
        </button>
        <button
          onClick={() => setActiveSection('inconsistent')}
          className={`flex-1 px-4 py-2 rounded-lg transition ${activeSection === 'inconsistent' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          🔍 คะแนน-คอมเมนต์ไม่สอดคล้อง ({inconsistentReviews.length})
        </button>
      </div>

      {/* Over Max Score Section */}
      {activeSection === 'overmax' && (
        <div className="space-y-6">
          {/* Students ที่ได้รับคะแนนเกิน 12 */}
          <div className="bg-slate-900/50 border border-red-500/30 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
              🚫 นักศึกษาที่ได้รับคะแนนเกิน 12 ({overMaxScores.students.length} คน)
            </h3>
            
            {overMaxScores.students.length === 0 ? (
              <div className="text-center py-8 text-green-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                ไม่มีนักศึกษาที่ได้รับคะแนนเกิน 12
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนที่ได้รับ</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนเกิน 12</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {overMaxScores.students.map(s => (
                      <tr key={s.studentName} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-mono text-sm">{s.studentId}</td>
                        <td className="px-4 py-3">{s.fullName}</td>
                        <td className="px-4 py-3 text-center text-slate-400">
                          {s.workScore.grades.join(', ')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-red-400 font-bold">{s.overGrades.join(', ')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Graders ที่ให้คะแนนเกิน 12 */}
          <div className="bg-slate-900/50 border border-red-500/30 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
              🚫 Graders ที่ให้คะแนนเกิน 12 ({overMaxScores.graders.length} รายการ)
            </h3>
            
            {overMaxScores.graders.length === 0 ? (
              <div className="text-center py-8 text-green-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
                ไม่มี Grader ที่ให้คะแนนเกิน 12
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-800/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส Grader</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ Grader</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รีวิวงานของ</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนนที่ให้</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {overMaxScores.graders.map((g, i) => (
                      <tr key={i} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-mono text-sm">{g.graderId}</td>
                        <td className="px-4 py-3">{g.graderFullName}</td>
                        <td className="px-4 py-3 text-slate-400">{g.studentReviewed}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-red-400 font-bold">{g.gradeGiven}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unusual Assignments Section */}
      {activeSection === 'unusual' && (
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            ⚠️ นักศึกษาที่ได้รับงานไม่เท่ากับ 3 ({unusualAssignments.length} คน)
          </h3>
          <p className="text-slate-400 text-sm mb-4">
            รายชื่อนักศึกษาที่ได้รับมอบหมายงาน peer review ไม่ใช่ 3 งาน (อาจเป็นเพราะระบบจัดสรร หรือ TA เพิ่มเติม)
          </p>
          
          {unusualAssignments.length === 0 ? (
            <div className="text-center py-8 text-green-400">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
              ทุกคนได้รับงาน 3 งานตามปกติ
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">รหัส</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">ชื่อ-นามสกุล</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">งานที่ได้รับ</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รีวิวแล้ว</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนน</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {unusualAssignments.map(g => (
                    <tr key={g.graderName} className="hover:bg-white/5">
                      <td className="px-4 py-3 font-mono text-sm">{g.graderId}</td>
                      <td className="px-4 py-3">{g.fullName}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${g.assignedReviews < 3 ? 'text-red-400' : 'text-yellow-400'}`}>
                          {g.assignedReviews}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-cyan-400">
                        {g.peerReviewScore.reviewedCount}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {g.peerReviewScore.netScore}/{g.peerReviewScore.fullScore}
                      </td>
                      <td className="px-4 py-3 text-center text-sm">
                        {g.assignedReviews < 3 ? (
                          <span className="text-red-400">น้อยกว่าปกติ</span>
                        ) : (
                          <span className="text-yellow-400">มากกว่าปกติ (อาจมี TA เพิ่ม)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Flagged Section */}
      {activeSection === 'flagged' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              นักศึกษาที่ต้องตรวจสอบ ({filteredFlaggedStudents.length})
            </h3>
            {filteredFlaggedStudents.length === 0 ? (
              <p className="text-slate-400">ไม่มีรายการ</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredFlaggedStudents.map(s => (
                  <div key={s.studentName} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="font-medium">{s.fullName}</div>
                    <div className="text-sm text-slate-400 font-mono">{s.studentId}</div>
                    {selectedGroupSet && (
                      <div className="text-xs text-green-400 mt-1">
                        Group: {getStudentGroup(s.studentId) || '-'}
                      </div>
                    )}
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
              Graders ที่ต้องตรวจสอบ ({filteredFlaggedGraders.length})
            </h3>
            {filteredFlaggedGraders.length === 0 ? (
              <p className="text-slate-400">ไม่มีรายการ</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredFlaggedGraders.map(g => (
                  <div key={g.graderName} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="font-medium">{g.fullName}</div>
                    <div className="text-sm text-slate-400 font-mono">{g.graderId}</div>
                    {selectedGroupSet && (
                      <div className="text-xs text-green-400 mt-1">
                        Group: {getStudentGroup(g.graderId) || '-'}
                      </div>
                    )}
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
      )}

      {/* Inconsistent Reviews Section (กรณี G) */}
      {activeSection === 'inconsistent' && (
        <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            🔍 คะแนนไม่สอดคล้องกับคอมเมนต์ ({inconsistentReviews.length} รายการ)
          </h3>
          <p className="text-slate-400 text-sm mb-4">
            รายการรีวิวที่คะแนนและคอมเมนต์อาจไม่สอดคล้องกัน ควรตรวจสอบเพิ่มเติม
          </p>
          
          {inconsistentReviews.length === 0 ? (
            <div className="text-center py-8 text-green-400">
              <CheckCircle2 className="w-12 h-12 mx-auto mb-2" />
              ไม่พบความไม่สอดคล้องที่ชัดเจน
            </div>
          ) : (
            <div className="space-y-4 max-h-[600px] overflow-y-auto">
              {inconsistentReviews.map((item, idx) => (
                <div key={idx} className="bg-slate-800/50 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-sm text-slate-400">Grader:</div>
                      <div className="font-medium">{item.graderFullName}</div>
                      <div className="text-sm text-slate-500 font-mono">{item.graderId}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-400">รีวิวงานของ:</div>
                      <div className="text-sm">{item.studentReviewed}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 mb-3">
                    <div className="bg-slate-700 px-3 py-1 rounded">
                      <span className="text-slate-400 text-sm">คะแนน: </span>
                      <span className={`font-bold ${item.grade >= 11 ? 'text-green-400' : item.grade <= 6 ? 'text-red-400' : 'text-yellow-400'}`}>
                        {item.grade}/12
                      </span>
                    </div>
                    <div className="text-yellow-400 text-sm">
                      ⚠️ {item.issue}
                    </div>
                  </div>
                  
                  <div className="text-sm">
                    <div className="text-slate-400 mb-1">ตัวอย่าง Comments:</div>
                    <div className="bg-slate-900 rounded p-2 text-slate-300 text-xs max-h-20 overflow-y-auto">
                      {Object.entries(item.comments || {}).slice(0, 3).map(([key, val]) => (
                        val && val.trim() && val.trim() !== '-' ? (
                          <div key={key} className="mb-1">• {val}</div>
                        ) : null
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  const pr = grader.peerReviewScore;
  
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
              <div className="text-3xl font-bold text-cyan-400">{pr.netScore}/{pr.fullScore}</div>
              <div className="text-sm text-slate-400">คะแนน Peer Review</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">{pr.reviewedCount}/{grader.assignedReviews}</div>
              <div className="text-sm text-slate-400">งานที่รีวิว</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-green-400">{pr.completeCount}/{pr.reviewedCount}</div>
              <div className="text-sm text-slate-400">งานสมบูรณ์</div>
            </div>
            <div>
              <div className={`text-3xl font-bold ${pr.bonus > 0 ? 'text-green-400' : 'text-slate-500'}`}>
                {pr.bonus > 0 ? `+${pr.bonus}` : '0'}
              </div>
              <div className="text-sm text-slate-400">โบนัส</div>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <div className="mb-4 p-3 bg-slate-800/50 rounded-lg text-sm">
            <div className="text-slate-400">เงื่อนไขคะแนน:</div>
            <div>• รีวิว 1 งาน = 1 คะแนน</div>
            <div>• รีวิวครบ + ทุกงานสมบูรณ์ = +1 โบนัส</div>
            <div>• สมบูรณ์ = ขาด comment ไม่เกิน 3 ช่อง (จาก 9 ช่อง)</div>
          </div>
          
          <h3 className="font-semibold mb-3">รายละเอียดการรีวิว</h3>
          <div className="space-y-3">
            {pr.details.map((detail, i) => {
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
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-4">
                    <span className={`text-sm ${detail.isComplete ? 'text-green-400' : 'text-yellow-400'}`}>
                      {detail.isComplete ? '✓ สมบูรณ์' : '⚠️ ไม่สมบูรณ์'}
                    </span>
                    <span className="text-sm text-slate-400">
                      ใส่ comment {detail.validCommentCount}/9 ช่อง (ขาด {detail.missingComments})
                    </span>
                  </div>
                  {review && (
                    <div className="mt-3 space-y-1 text-sm">
                      {DEFAULT_CRITERIA.map(c => {
                        const comment = review.comments[c.key];
                        const hasComment = comment && comment.trim() && !/^-+$/.test(comment.trim());
                        return (
                          <div key={c.key} className="flex items-start gap-2">
                            <span className={hasComment ? 'text-green-400' : 'text-red-400'}>
                              {hasComment ? '✓' : '✗'}
                            </span>
                            <span className="text-slate-400 w-32 flex-shrink-0">{c.name}:</span>
                            <span className="text-slate-300 truncate">
                              {hasComment ? comment : <span className="text-slate-500">ไม่ได้ใส่</span>}
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

          {grader.flags.length > 0 && (
            <div className="mt-6">
              <h3 className="font-semibold mb-3 text-yellow-400">⚠️ Flags</h3>
              <div className="space-y-2">
                {grader.flags.map((f, i) => (
                  <div key={i} className={`text-sm px-3 py-2 rounded ${
                    f.severity === 'alert' ? 'bg-red-900/30 text-red-300' :
                    f.severity === 'warning' ? 'bg-yellow-900/30 text-yellow-300' :
                    'bg-slate-700 text-slate-300'
                  }`}>
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
