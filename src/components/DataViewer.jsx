// src/components/DataViewer.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { getFlaggedStudents, getFlaggedGraders } from '../utils/csvParser';
import ReviewStatusModal, { getStatusInfo, STATUS_OPTIONS } from './ReviewStatusModal';
import TAReviewSummary from './TAReviewSummary';
import { 
  Users, Search, Download, ChevronRight, AlertCircle, CheckCircle2, 
  XCircle, AlertTriangle, UserCheck, BarChart2, FileText, ClipboardList, Filter,
  MessageSquare, ChevronDown
} from 'lucide-react';

export default function DataViewer({ semesterId, taAssignment }) {
  const { isAdmin, isTA } = useAuth();
  const [data, setData] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [groupSets, setGroupSets] = useState([]);
  const [selectedGroupSet, setSelectedGroupSet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // UI state
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [selectedGrader, setSelectedGrader] = useState(null);
  
  // Pagination
  const [studentPage, setStudentPage] = useState(1);
  const [graderPage, setGraderPage] = useState(1);
  const ITEMS_PER_PAGE = 50;
  
  // Review Status state
  const [reviewStatuses, setReviewStatuses] = useState({});
  const [statusModal, setStatusModal] = useState({ isOpen: false, item: null });
  
  // Advanced Filters
  const [studentFilters, setStudentFilters] = useState({
    graderStatus: 'all', // all, complete, incomplete
    scoreRange: 'all', // all, high, medium, low
    reviewStatus: 'all', // all, pending, reviewed, fixed, escalated
    hasFlag: 'all' // all, yes, no
  });
  
  const [graderFilters, setGraderFilters] = useState({
    reviewCompletion: 'all', // all, complete, incomplete
    bonusStatus: 'all', // all, hasBonus, noBonus
    reviewStatus: 'all',
    hasFlag: 'all'
  });
  
  const [showFilters, setShowFilters] = useState(false);

  // Fetch data from Firestore
  useEffect(() => {
    async function fetchData() {
      if (!semesterId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        // Fetch metadata first
        const metaRef = doc(db, 'semesters', semesterId, 'peerReviewData', 'meta');
        const metaSnap = await getDoc(metaRef);
        
        if (!metaSnap.exists()) {
          setError('ไม่พบข้อมูล Peer Review สำหรับเทอมนี้');
          setLoading(false);
          return;
        }
        
        const meta = metaSnap.data();
        
        // Fetch all chunks from peerReviewData subcollection
        const peerReviewCol = collection(db, 'semesters', semesterId, 'peerReviewData');
        const peerReviewSnap = await getDocs(peerReviewCol);
        
        // Reconstruct data from chunks
        let students = {};
        let graders = {};
        let reviews = [];
        
        peerReviewSnap.docs.forEach(docSnap => {
          const docId = docSnap.id;
          const docData = docSnap.data();
          
          if (docId.startsWith('students_')) {
            students = { ...students, ...docData.data };
          } else if (docId.startsWith('graders_')) {
            graders = { ...graders, ...docData.data };
          } else if (docId.startsWith('reviews_')) {
            reviews = [...reviews, ...docData.data];
          }
        });
        
        setData({
          students,
          graders,
          reviews,
          stats: meta.stats
        });
        
        // Fetch student/group data
        const studentDataRef = doc(db, 'semesters', semesterId, 'studentData', 'main');
        const studentDataSnap = await getDoc(studentDataRef);
        
        if (studentDataSnap.exists()) {
          const sData = studentDataSnap.data();
          setGroupData(sData.groups);
          setGroupSets(sData.groupSets || []);
          
          if (sData.groupSets?.length === 1) {
            setSelectedGroupSet(sData.groupSets[0]);
          } else if (sData.groupSets?.length > 0) {
            setSelectedGroupSet(sData.groupSets[0]);
          }
        }
        
        // Fetch review statuses
        const statusCol = collection(db, 'semesters', semesterId, 'reviewStatuses');
        const statusSnap = await getDocs(statusCol);
        const statuses = {};
        statusSnap.docs.forEach(doc => {
          statuses[doc.id] = doc.data();
        });
        setReviewStatuses(statuses);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`เกิดข้อผิดพลาด: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [semesterId]);

  // Get student group
  const getStudentGroup = useCallback((studentId) => {
    if (!groupData || !selectedGroupSet || !studentId) return '';
    const student = groupData[studentId];
    return student ? (student[selectedGroupSet] || '') : '';
  }, [groupData, selectedGroupSet]);

  // All unique groups
  const allGroups = useMemo(() => {
    if (!groupData || !selectedGroupSet) return [];
    const groups = new Set();
    Object.values(groupData).forEach(s => {
      if (s[selectedGroupSet]) groups.add(s[selectedGroupSet]);
    });
    return Array.from(groups).sort();
  }, [groupData, selectedGroupSet]);

  // Allowed groups for TA
  const allowedGroups = useMemo(() => {
    if (isAdmin) return allGroups;
    if (!taAssignment) return [];
    if (taAssignment.canViewAll) return allGroups;
    return taAssignment.assignedGroups || [];
  }, [isAdmin, taAssignment, allGroups]);

  // Filter students by search and group
  const filteredStudents = useMemo(() => {
    if (!data) return [];
    return Object.values(data.students).filter(s => {
      const q = searchQuery.toLowerCase();
      const matchSearch = s.studentName.toLowerCase().includes(q) || 
                          s.studentId.includes(q) || 
                          s.fullName.toLowerCase().includes(q);
      
      const group = getStudentGroup(s.studentId);
      
      // Check if TA can view this group
      if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
        if (!allowedGroups.includes(group)) return false;
      }
      
      const matchGroup = !groupFilter || group === groupFilter;
      
      // Advanced filters
      const statusKey = `student_${s.studentId}`;
      const itemStatus = reviewStatuses[statusKey]?.status || 'pending';
      
      // Grader status filter
      let matchGraderStatus = true;
      if (studentFilters.graderStatus === 'complete') {
        matchGraderStatus = s.gradersCompleted === s.gradersAssigned;
      } else if (studentFilters.graderStatus === 'incomplete') {
        matchGraderStatus = s.gradersCompleted < s.gradersAssigned;
      }
      
      // Score range filter
      let matchScoreRange = true;
      const avg = s.workScore.average || 0;
      if (studentFilters.scoreRange === 'high') {
        matchScoreRange = avg >= 10;
      } else if (studentFilters.scoreRange === 'medium') {
        matchScoreRange = avg >= 6 && avg < 10;
      } else if (studentFilters.scoreRange === 'low') {
        matchScoreRange = avg < 6;
      }
      
      // Review status filter
      let matchReviewStatus = true;
      if (studentFilters.reviewStatus !== 'all') {
        matchReviewStatus = itemStatus === studentFilters.reviewStatus;
      }
      
      // Has flag filter
      let matchHasFlag = true;
      if (studentFilters.hasFlag === 'yes') {
        matchHasFlag = s.flags.length > 0;
      } else if (studentFilters.hasFlag === 'no') {
        matchHasFlag = s.flags.length === 0;
      }
      
      return matchSearch && matchGroup && matchGraderStatus && matchScoreRange && matchReviewStatus && matchHasFlag;
    }).sort((a, b) => b.workScore.average - a.workScore.average);
  }, [data, searchQuery, groupFilter, getStudentGroup, isTA, taAssignment, allowedGroups, studentFilters, reviewStatuses]);

  // Filter graders
  const filteredGraders = useMemo(() => {
    if (!data) return [];
    return Object.values(data.graders).filter(g => {
      const q = searchQuery.toLowerCase();
      const matchSearch = g.graderName.toLowerCase().includes(q) || 
                          g.graderId?.includes(q) || 
                          g.fullName.toLowerCase().includes(q);
      
      const group = getStudentGroup(g.graderId);
      
      // Check if TA can view this group
      if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
        if (!allowedGroups.includes(group)) return false;
      }
      
      const matchGroup = !groupFilter || group === groupFilter;
      
      // Advanced filters
      const statusKey = `grader_${g.graderId}`;
      const itemStatus = reviewStatuses[statusKey]?.status || 'pending';
      const pr = g.peerReviewScore;
      
      // Review completion filter
      let matchCompletion = true;
      if (graderFilters.reviewCompletion === 'complete') {
        matchCompletion = pr.reviewedCount === g.assignedReviews;
      } else if (graderFilters.reviewCompletion === 'incomplete') {
        matchCompletion = pr.reviewedCount < g.assignedReviews;
      }
      
      // Bonus status filter
      let matchBonus = true;
      if (graderFilters.bonusStatus === 'hasBonus') {
        matchBonus = pr.bonus > 0;
      } else if (graderFilters.bonusStatus === 'noBonus') {
        matchBonus = pr.bonus === 0;
      }
      
      // Review status filter
      let matchReviewStatus = true;
      if (graderFilters.reviewStatus !== 'all') {
        matchReviewStatus = itemStatus === graderFilters.reviewStatus;
      }
      
      // Has flag filter
      let matchHasFlag = true;
      if (graderFilters.hasFlag === 'yes') {
        matchHasFlag = g.flags.length > 0;
      } else if (graderFilters.hasFlag === 'no') {
        matchHasFlag = g.flags.length === 0;
      }
      
      return matchSearch && matchGroup && matchCompletion && matchBonus && matchReviewStatus && matchHasFlag;
    }).sort((a, b) => b.peerReviewScore.netScore - a.peerReviewScore.netScore);
  }, [data, searchQuery, groupFilter, getStudentGroup, isTA, taAssignment, allowedGroups, graderFilters, reviewStatuses]);

  const flaggedStudents = useMemo(() => data ? getFlaggedStudents(data.students) : [], [data]);
  const flaggedGraders = useMemo(() => data ? getFlaggedGraders(data.graders) : [], [data]);

  // Group statistics
  const groupStats = useMemo(() => {
    if (!data || !selectedGroupSet || !groupData) return null;
    
    const stats = {};
    const groupsToShow = isTA && !taAssignment?.canViewAll ? allowedGroups : allGroups;
    
    groupsToShow.forEach(group => {
      stats[group] = {
        students: [],
        graders: [],
        workScores: [],
        prScores: [],
        flaggedCount: 0
      };
    });
    
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
  }, [data, selectedGroupSet, groupData, allGroups, getStudentGroup, isTA, taAssignment, allowedGroups]);

  // Export functions
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

  const exportStudentScores = useCallback(() => {
    if (!data) return;
    const rows = filteredStudents.map((s, i) => {
      const statusKey = `student_${s.studentId}`;
      const itemStatus = reviewStatuses[statusKey];
      const statusInfo = getStatusInfo(itemStatus?.status || 'pending');
      
      const row = {
        'ลำดับ': i + 1,
        'รหัสนักศึกษา': s.studentId,
        'ชื่อ-นามสกุล': s.fullName
      };
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
        'Flags': s.flags.map(f => f.message).join('; '),
        'สถานะการตรวจ': statusInfo.label,
        'โน้ต': itemStatus?.note || '-',
        'ตรวจโดย': itemStatus?.updatedByName || '-'
      };
    });
    downloadCSV(rows, 'student-work-scores');
  }, [data, filteredStudents, selectedGroupSet, getStudentGroup, reviewStatuses]);

  const exportGraderScores = useCallback(() => {
    if (!data) return;
    const rows = filteredGraders.map((g, i) => {
      const statusKey = `grader_${g.graderId}`;
      const itemStatus = reviewStatuses[statusKey];
      const statusInfo = getStatusInfo(itemStatus?.status || 'pending');
      
      const row = {
        'ลำดับ': i + 1,
        'รหัสนักศึกษา': g.graderId,
        'ชื่อ-นามสกุล': g.fullName
      };
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
        'Flags': g.flags.map(f => f.message).join('; '),
        'สถานะการตรวจ': statusInfo.label,
        'โน้ต': itemStatus?.note || '-',
        'ตรวจโดย': itemStatus?.updatedByName || '-'
      };
    });
    downloadCSV(rows, 'grader-peer-review-scores');
  }, [data, filteredGraders, selectedGroupSet, getStudentGroup, reviewStatuses]);

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
        <div className="animate-spin w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-slate-400">กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-red-300">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-8 text-center">
        <p className="text-slate-400">ไม่พบข้อมูล</p>
      </div>
    );
  }

  const getScoreColor = (score, max) => {
    if (!score) return 'text-slate-400';
    const pct = score / max;
    if (pct >= 0.8) return 'text-green-400';
    if (pct >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-6">
      {/* Group Filter Bar */}
      {selectedGroupSet && allowedGroups.length > 0 && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 flex flex-wrap items-center gap-4">
          {groupSets.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 text-sm">Group Set:</span>
              <select
                value={selectedGroupSet}
                onChange={(e) => {
                  setSelectedGroupSet(e.target.value);
                  setGroupFilter('');
                }}
                className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm"
              >
                {groupSets.map(gs => (
                  <option key={gs} value={gs}>{gs}</option>
                ))}
              </select>
            </div>
          )}
          
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              className="bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">ทุก Group</option>
              {allowedGroups.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          
          {isTA && !taAssignment?.canViewAll && (
            <span className="text-sm text-yellow-400">
              👀 คุณดูได้เฉพาะ: {allowedGroups.join(', ')}
            </span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-slate-900/50 p-1 rounded-xl border border-white/10 overflow-x-auto">
        {[
          { id: 'overview', label: 'ภาพรวม', icon: BarChart2 },
          { id: 'students', label: 'คะแนนชิ้นงาน', icon: Users },
          { id: 'graders', label: 'คะแนน Peer Review', icon: UserCheck },
          { id: 'admin', label: 'ตรวจสอบ', icon: AlertTriangle },
          ...(isAdmin ? [{ id: 'tasummary', label: 'สรุปการตรวจสอบ', icon: MessageSquare }] : []),
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
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="นักศึกษา (เจ้าของงาน)" value={filteredStudents.length} icon={Users} color="cyan" />
            <StatCard label="Graders (คนรีวิว)" value={filteredGraders.length} icon={UserCheck} color="purple" />
            <StatCard label="รีวิวที่เสร็จ" value={data.stats.completedReviews} icon={CheckCircle2} color="green" />
            <StatCard label="รีวิวที่ยังไม่เสร็จ" value={data.stats.incompleteReviews} icon={XCircle} color="red" />
          </div>

          {/* Group Stats */}
          {groupStats && Object.keys(groupStats).length > 0 && (
            <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-green-400" /> สถิติแยกตาม Group
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
                    {Object.entries(groupStats).map(([group, stats]) => (
                      <tr key={group} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-medium">{group}</td>
                        <td className="px-4 py-3 text-center text-slate-400">{stats.students.length}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${getScoreColor(stats.avgWorkScore, 12)}`}>
                            {stats.avgWorkScore.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${getScoreColor(stats.avgPRScore, 4)}`}>
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
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Students Tab */}
      {activeTab === 'students' && (
        <div className="space-y-4">
          {/* Search & Export */}
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
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${showFilters ? 'bg-cyan-600 border-cyan-500' : 'bg-slate-800 border-white/10 hover:bg-slate-700'}`}
            >
              <Filter className="w-5 h-5" /> ตัวกรอง
              <ChevronDown className={`w-4 h-4 transition ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={exportStudentScores} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl">
              <Download className="w-5 h-5" /> Export
            </button>
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">สถานะ Grader</label>
                <select
                  value={studentFilters.graderStatus}
                  onChange={(e) => setStudentFilters(f => ({ ...f, graderStatus: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="complete">ครบแล้ว</option>
                  <option value="incomplete">ยังไม่ครบ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">ช่วงคะแนน</label>
                <select
                  value={studentFilters.scoreRange}
                  onChange={(e) => setStudentFilters(f => ({ ...f, scoreRange: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="high">สูง (≥10)</option>
                  <option value="medium">ปานกลาง (6-9)</option>
                  <option value="low">ต่ำ (&lt;6)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">สถานะการตรวจ</label>
                <select
                  value={studentFilters.reviewStatus}
                  onChange={(e) => setStudentFilters(f => ({ ...f, reviewStatus: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">มี Flag</label>
                <select
                  value={studentFilters.hasFlag}
                  onChange={(e) => setStudentFilters(f => ({ ...f, hasFlag: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="yes">มี Flag</option>
                  <option value="no">ไม่มี Flag</option>
                </select>
              </div>
            </div>
          )}

          {/* Flag Legend */}
          <div className="bg-slate-800/50 rounded-xl p-3 text-xs flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-slate-400 font-medium">ความหมาย Flag:</span>
            <span><span className="text-red-400">🔴</span> คะแนนเกิน/ต่ำกว่าช่วง (0-12)</span>
            <span><span className="text-yellow-400">🟡</span> SD สูง / คะแนนห่างกันมาก</span>
            <span><span className="text-blue-400">🔵</span> grader น้อยกว่า 2 คน</span>
            <span><span className="text-green-400">✓</span> น่าเชื่อถือ = grader≥2, SD&lt;3, คะแนนในช่วง 0-12</span>
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
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredStudents.slice(0, studentPage * ITEMS_PER_PAGE).map(student => {
                    const statusKey = `student_${student.studentId}`;
                    const itemStatus = reviewStatuses[statusKey];
                    const statusInfo = getStatusInfo(itemStatus?.status || 'pending');
                    
                    return (
                      <tr key={student.studentName} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-mono text-sm">{student.studentId}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{student.fullName}</span>
                            {student.flags.length > 0 && (
                              <FlagTooltip flags={student.flags} />
                            )}
                          </div>
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
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setStatusModal({
                            isOpen: true,
                            itemType: 'student',
                            itemId: student.studentId,
                            itemName: student.fullName,
                            currentStatus: itemStatus
                          })}
                          className={`px-2 py-1 rounded text-xs ${statusInfo.bg} ${statusInfo.color} hover:opacity-80 transition`}
                        >
                          {statusInfo.label}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Info & Load More */}
            <div className="p-4 flex items-center justify-between border-t border-white/5">
              <span className="text-slate-400 text-sm">
                แสดง {Math.min(studentPage * ITEMS_PER_PAGE, filteredStudents.length)} จาก {filteredStudents.length} รายการ
              </span>
              {studentPage * ITEMS_PER_PAGE < filteredStudents.length && (
                <button
                  onClick={() => setStudentPage(p => p + 1)}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm"
                >
                  โหลดเพิ่ม ({filteredStudents.length - studentPage * ITEMS_PER_PAGE} รายการ)
                </button>
              )}
              {filteredStudents.length > ITEMS_PER_PAGE && studentPage > 1 && (
                <button
                  onClick={() => setStudentPage(Math.ceil(filteredStudents.length / ITEMS_PER_PAGE))}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm ml-2"
                >
                  แสดงทั้งหมด
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Graders Tab */}
      {activeTab === 'graders' && (
        <div className="space-y-4">
          {/* Search & Export */}
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
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl border ${showFilters ? 'bg-cyan-600 border-cyan-500' : 'bg-slate-800 border-white/10 hover:bg-slate-700'}`}
            >
              <Filter className="w-5 h-5" /> ตัวกรอง
              <ChevronDown className={`w-4 h-4 transition ${showFilters ? 'rotate-180' : ''}`} />
            </button>
            <button onClick={exportGraderScores} className="flex items-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-500 rounded-xl">
              <Download className="w-5 h-5" /> Export
            </button>
          </div>

          {/* Advanced Filters */}
          {showFilters && (
            <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">สถานะการรีวิว</label>
                <select
                  value={graderFilters.reviewCompletion}
                  onChange={(e) => setGraderFilters(f => ({ ...f, reviewCompletion: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="complete">รีวิวครบ</option>
                  <option value="incomplete">รีวิวไม่ครบ</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">โบนัส</label>
                <select
                  value={graderFilters.bonusStatus}
                  onChange={(e) => setGraderFilters(f => ({ ...f, bonusStatus: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="hasBonus">ได้โบนัส</option>
                  <option value="noBonus">ไม่ได้โบนัส</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">สถานะการตรวจ</label>
                <select
                  value={graderFilters.reviewStatus}
                  onChange={(e) => setGraderFilters(f => ({ ...f, reviewStatus: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  {STATUS_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">มี Flag</label>
                <select
                  value={graderFilters.hasFlag}
                  onChange={(e) => setGraderFilters(f => ({ ...f, hasFlag: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="yes">มี Flag</option>
                  <option value="no">ไม่มี Flag</option>
                </select>
              </div>
            </div>
          )}

          <div className="bg-slate-800/50 rounded-xl p-3 text-sm flex flex-wrap gap-4">
            <span className="text-slate-400">เงื่อนไข:</span>
            <span>รีวิว 1 งาน = <span className="text-cyan-400">1 คะแนน</span></span>
            <span>รีวิวครบ + ทุกงานสมบูรณ์ = <span className="text-green-400">+1 โบนัส</span></span>
          </div>

          {/* Flag Legend */}
          <div className="bg-slate-800/50 rounded-xl p-3 text-xs flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-slate-400 font-medium">ความหมาย Flag:</span>
            <span><span className="text-yellow-400">🟡</span> รีวิวไม่ครบ / ไม่ได้โบนัส</span>
            <span><span className="text-blue-400">🔵</span> ได้รับงานไม่ครบ 3 งาน</span>
            <span><span className="text-slate-400">งานสมบูรณ์</span> = ขาด comment ไม่เกิน 3 ช่อง</span>
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
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">สมบูรณ์</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">คะแนน</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">โบนัส</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">รวม</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredGraders.slice(0, graderPage * ITEMS_PER_PAGE).map(grader => {
                    const pr = grader.peerReviewScore;
                    const statusKey = `grader_${grader.graderId}`;
                    const itemStatus = reviewStatuses[statusKey];
                    const statusInfo = getStatusInfo(itemStatus?.status || 'pending');
                    
                    return (
                      <tr key={grader.graderName} className="hover:bg-white/5">
                        <td className="px-4 py-3 font-mono text-sm">{grader.graderId}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span>{grader.fullName}</span>
                            {grader.flags.length > 0 && (
                              <FlagTooltip flags={grader.flags} />
                            )}
                          </div>
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
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setStatusModal({
                              isOpen: true,
                              itemType: 'grader',
                              itemId: grader.graderId,
                              itemName: grader.fullName,
                              currentStatus: itemStatus
                            })}
                            className={`px-2 py-1 rounded text-xs ${statusInfo.bg} ${statusInfo.color} hover:opacity-80 transition`}
                          >
                            {statusInfo.label}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {/* Pagination Info & Load More */}
            <div className="p-4 flex items-center justify-between border-t border-white/5">
              <span className="text-slate-400 text-sm">
                แสดง {Math.min(graderPage * ITEMS_PER_PAGE, filteredGraders.length)} จาก {filteredGraders.length} รายการ
              </span>
              {graderPage * ITEMS_PER_PAGE < filteredGraders.length && (
                <button
                  onClick={() => setGraderPage(p => p + 1)}
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm"
                >
                  โหลดเพิ่ม ({filteredGraders.length - graderPage * ITEMS_PER_PAGE} รายการ)
                </button>
              )}
              {filteredGraders.length > ITEMS_PER_PAGE && graderPage > 1 && (
                <button
                  onClick={() => setGraderPage(Math.ceil(filteredGraders.length / ITEMS_PER_PAGE))}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm ml-2"
                >
                  แสดงทั้งหมด
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Admin/Check Tab */}
      {activeTab === 'admin' && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              นักศึกษาที่ต้องตรวจสอบ
            </h3>
            {flaggedStudents.filter(s => {
              const group = getStudentGroup(s.studentId);
              if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
                return allowedGroups.includes(group);
              }
              return !groupFilter || group === groupFilter;
            }).length === 0 ? (
              <p className="text-slate-400">ไม่มีรายการ</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {flaggedStudents.filter(s => {
                  const group = getStudentGroup(s.studentId);
                  if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
                    return allowedGroups.includes(group);
                  }
                  return !groupFilter || group === groupFilter;
                }).map(s => (
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
              Graders ที่ต้องตรวจสอบ
            </h3>
            {flaggedGraders.filter(g => {
              const group = getStudentGroup(g.graderId);
              if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
                return allowedGroups.includes(group);
              }
              return !groupFilter || group === groupFilter;
            }).length === 0 ? (
              <p className="text-slate-400">ไม่มีรายการ</p>
            ) : (
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {flaggedGraders.filter(g => {
                  const group = getStudentGroup(g.graderId);
                  if (isTA && !taAssignment?.canViewAll && allowedGroups.length > 0) {
                    return allowedGroups.includes(group);
                  }
                  return !groupFilter || group === groupFilter;
                }).map(g => (
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

      {/* TA Summary Tab (Admin only) */}
      {activeTab === 'tasummary' && isAdmin && (
        <TAReviewSummary 
          semesterId={semesterId} 
          groupData={groupData}
          selectedGroupSet={selectedGroupSet}
        />
      )}

      {/* Review Status Modal */}
      <ReviewStatusModal
        isOpen={statusModal.isOpen}
        onClose={() => setStatusModal({ isOpen: false, item: null })}
        semesterId={semesterId}
        itemType={statusModal.itemType}
        itemId={statusModal.itemId}
        itemName={statusModal.itemName}
        currentStatus={statusModal.currentStatus}
        onStatusUpdate={(newStatus) => {
          const key = `${statusModal.itemType}_${statusModal.itemId}`;
          setReviewStatuses(prev => ({
            ...prev,
            [key]: { ...prev[key], ...newStatus }
          }));
        }}
      />
    </div>
  );
}

// StatCard component
function StatCard({ label, value, icon: Icon, color }) {
  const colorClasses = {
    cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20',
    purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20',
    green: 'from-green-500/20 to-green-500/5 border-green-500/20',
    red: 'from-red-500/20 to-red-500/5 border-red-500/20'
  };
  const iconColors = {
    cyan: 'text-cyan-400',
    purple: 'text-purple-400',
    green: 'text-green-400',
    red: 'text-red-400'
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} border rounded-2xl p-4`}>
      <div className="flex items-center justify-between mb-2">
        <Icon className={`w-6 h-6 ${iconColors[color]}`} />
      </div>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-slate-400 mt-1">{label}</div>
    </div>
  );
}

// FlagTooltip component - แสดง flag พร้อมคำอธิบาย
function FlagTooltip({ flags }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'alert': return 'text-red-400 bg-red-900/30 border-red-500/30';
      case 'warning': return 'text-yellow-400 bg-yellow-900/30 border-yellow-500/30';
      case 'info': return 'text-blue-400 bg-blue-900/30 border-blue-500/30';
      default: return 'text-slate-400 bg-slate-800 border-slate-600';
    }
  };
  
  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'alert': return '🔴';
      case 'warning': return '🟡';
      case 'info': return '🔵';
      default: return '⚪';
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className="p-1 hover:bg-yellow-500/20 rounded transition"
        title={flags.map(f => f.message).join('\n')}
      >
        <AlertTriangle className="w-4 h-4 text-yellow-400" />
      </button>
      
      {isOpen && (
        <div className="absolute z-50 left-0 top-full mt-1 w-72 bg-slate-900 border border-white/20 rounded-xl shadow-xl p-3 space-y-2">
          <div className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            พบ {flags.length} รายการที่ต้องตรวจสอบ
          </div>
          {flags.map((flag, i) => (
            <div 
              key={i} 
              className={`text-xs p-2 rounded-lg border ${getSeverityColor(flag.severity)}`}
            >
              <span className="mr-1">{getSeverityIcon(flag.severity)}</span>
              {flag.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
