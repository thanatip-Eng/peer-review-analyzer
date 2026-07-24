// src/components/TAReviewSummary.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Users, CheckCircle2, AlertTriangle, Clock, Send, 
  Download, ChevronDown, ChevronRight, MessageSquare, Filter 
} from 'lucide-react';
import { STATUS_OPTIONS, getStatusInfo } from './ReviewStatusModal';

export default function TAReviewSummary({ semesterId, groupData, selectedGroupSet }) {
  const [reviewStatuses, setReviewStatuses] = useState([]);
  const [taAssignments, setTAAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [statusFilter, setStatusFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      if (!semesterId) return;
      setLoading(true);
      
      try {
        // Fetch review statuses
        const statusCol = collection(db, 'semesters', semesterId, 'reviewStatuses');
        const statusSnap = await getDocs(statusCol);
        const statuses = statusSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setReviewStatuses(statuses);
        
        // Fetch TA assignments for this semester
        const taQuery = query(collection(db, 'taAssignments'), where('semesterId', '==', semesterId));
        const taSnap = await getDocs(taQuery);
        const tas = taSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setTAAssignments(tas);
        
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [semesterId]);

  // Get student's group — โครงสร้าง groupData: { [studentId]: { studentName, section, [groupSet]: groupName } }
  const getStudentGroup = (studentId) => {
    if (!groupData || !selectedGroupSet || !studentId) return null;
    const student = groupData[studentId];
    return student ? (student[selectedGroupSet] || null) : null;
  };

  // Get all unique groups
  const allGroups = useMemo(() => {
    if (!groupData || !selectedGroupSet) return [];
    const groups = new Set();
    Object.values(groupData).forEach(s => {
      if (s && s[selectedGroupSet]) groups.add(s[selectedGroupSet]);
    });
    return Array.from(groups).sort();
  }, [groupData, selectedGroupSet]);

  // Summary by group
  const groupSummary = useMemo(() => {
    const summary = {};
    
    // Initialize groups
    allGroups.forEach(group => {
      summary[group] = {
        group,
        total: 0,
        pending: 0,
        reviewed: 0,
        fixed: 0,
        escalated: 0,
        items: []
      };
    });
    
    // Add "ไม่มีกลุ่ม" for items without group
    summary['__nogroup__'] = {
      group: 'ไม่มีกลุ่ม',
      total: 0,
      pending: 0,
      reviewed: 0,
      fixed: 0,
      escalated: 0,
      items: []
    };
    
    // Count statuses
    reviewStatuses.forEach(status => {
      const group = getStudentGroup(status.itemId) || '__nogroup__';
      if (!summary[group]) {
        summary[group] = {
          group,
          total: 0,
          pending: 0,
          reviewed: 0,
          fixed: 0,
          escalated: 0,
          items: []
        };
      }
      
      summary[group].total++;
      summary[group][status.status]++;
      summary[group].items.push(status);
    });
    
    return Object.values(summary).filter(g => g.total > 0);
  }, [reviewStatuses, allGroups, groupData, selectedGroupSet]);

  // Filter items
  const filteredItems = useMemo(() => {
    let items = reviewStatuses;
    
    if (statusFilter !== 'all') {
      items = items.filter(s => s.status === statusFilter);
    }
    
    if (groupFilter !== 'all') {
      items = items.filter(s => {
        const group = getStudentGroup(s.itemId) || '__nogroup__';
        return group === groupFilter;
      });
    }
    
    return items.sort((a, b) => {
      // Sort by status priority: escalated > fixed > reviewed > pending
      const priority = { escalated: 0, fixed: 1, reviewed: 2, pending: 3 };
      return (priority[a.status] || 4) - (priority[b.status] || 4);
    });
  }, [reviewStatuses, statusFilter, groupFilter]);

  // Export function
  const exportSummary = () => {
    const rows = [
      ['ประเภท', 'รหัส', 'ชื่อ', 'กลุ่ม', 'สถานะ', 'โน้ต', 'อัปเดตโดย', 'วันที่อัปเดต']
    ];
    
    filteredItems.forEach(item => {
      const statusInfo = getStatusInfo(item.status);
      const group = getStudentGroup(item.itemId) || '-';
      rows.push([
        item.itemType === 'student' ? 'นักศึกษา' : 'ผู้รีวิว',
        item.itemId,
        item.itemName,
        group,
        statusInfo.label,
        item.note || '-',
        item.updatedByName || item.updatedByEmail,
        item.updatedAt?.toDate ? item.updatedAt.toDate().toLocaleString('th-TH') : '-'
      ]);
    });
    
    const csvContent = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `review-summary-${semesterId}.csv`;
    link.click();
  };

  const toggleGroup = (group) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-cyan-400" />
          สรุปการตรวจสอบของ TA
        </h3>
        <button
          onClick={exportSummary}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm"
        >
          <Download className="w-4 h-4" /> Export สรุป
        </button>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4 text-center">
          <div className="text-2xl font-bold text-white">{reviewStatuses.length}</div>
          <div className="text-slate-400 text-sm">ทั้งหมด</div>
        </div>
        {STATUS_OPTIONS.map(opt => {
          const count = reviewStatuses.filter(s => s.status === opt.value).length;
          return (
            <div key={opt.value} className={`${opt.bg} border border-white/10 rounded-xl p-4 text-center`}>
              <div className={`text-2xl font-bold ${opt.color}`}>{count}</div>
              <div className="text-slate-400 text-sm">{opt.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm"
          >
            <option value="all">ทุกสถานะ</option>
            {STATUS_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-sm"
        >
          <option value="all">ทุกกลุ่ม</option>
          {allGroups.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* Group Summary */}
      {groupSummary.length > 0 ? (
        <div className="space-y-3">
          {groupSummary.map(group => (
            <div key={group.group} className="bg-slate-900/50 border border-white/10 rounded-xl overflow-hidden">
              {/* Group Header */}
              <button
                onClick={() => toggleGroup(group.group)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition"
              >
                <div className="flex items-center gap-3">
                  {expandedGroups[group.group] ? (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-400" />
                  )}
                  <span className="font-medium">{group.group}</span>
                  <span className="text-slate-400 text-sm">({group.total} รายการ)</span>
                </div>
                <div className="flex gap-3 text-sm">
                  {group.escalated > 0 && (
                    <span className="text-yellow-400 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" /> {group.escalated}
                    </span>
                  )}
                  {group.fixed > 0 && (
                    <span className="text-cyan-400">{group.fixed} แก้ไข</span>
                  )}
                  {group.reviewed > 0 && (
                    <span className="text-green-400">{group.reviewed} ตรวจแล้ว</span>
                  )}
                  {group.pending > 0 && (
                    <span className="text-slate-400">{group.pending} รอ</span>
                  )}
                </div>
              </button>

              {/* Group Items */}
              {expandedGroups[group.group] && (
                <div className="border-t border-white/5">
                  <table className="w-full">
                    <thead className="bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs text-slate-400">ประเภท</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400">รหัส/ชื่อ</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400">สถานะ</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400">โน้ต</th>
                        <th className="px-4 py-2 text-left text-xs text-slate-400">อัปเดตโดย</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {group.items.map(item => {
                        const statusInfo = getStatusInfo(item.status);
                        return (
                          <tr key={item.id} className="hover:bg-white/5">
                            <td className="px-4 py-2 text-sm">
                              {item.itemType === 'student' ? '📚 นักศึกษา' : '✍️ ผู้รีวิว'}
                            </td>
                            <td className="px-4 py-2">
                              <div className="font-mono text-xs text-slate-400">{item.itemId}</div>
                              <div className="text-sm">{item.itemName}</div>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-1 rounded text-xs ${statusInfo.bg} ${statusInfo.color}`}>
                                {statusInfo.label}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-sm text-slate-300 max-w-xs truncate">
                              {item.note || '-'}
                            </td>
                            <td className="px-4 py-2 text-xs text-slate-400">
                              {item.updatedByName || item.updatedByEmail}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-8 text-center">
          <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">ยังไม่มีการอัปเดตสถานะการตรวจสอบ</p>
        </div>
      )}

      {/* Filtered Items List */}
      {filteredItems.length > 0 && (statusFilter !== 'all' || groupFilter !== 'all') && (
        <div className="bg-slate-900/50 border border-white/10 rounded-xl p-4">
          <h4 className="font-medium mb-3">
            ผลการกรอง: {filteredItems.length} รายการ
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs text-slate-400">ประเภท</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400">รหัส/ชื่อ</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400">กลุ่ม</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400">สถานะ</th>
                  <th className="px-4 py-2 text-left text-xs text-slate-400">โน้ต</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredItems.slice(0, 50).map(item => {
                  const statusInfo = getStatusInfo(item.status);
                  const group = getStudentGroup(item.itemId) || '-';
                  return (
                    <tr key={item.id} className="hover:bg-white/5">
                      <td className="px-4 py-2 text-sm">
                        {item.itemType === 'student' ? '📚' : '✍️'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-sm">{item.itemName}</div>
                        <div className="font-mono text-xs text-slate-500">{item.itemId}</div>
                      </td>
                      <td className="px-4 py-2 text-sm">{group}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded text-xs ${statusInfo.bg} ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-sm text-slate-300 max-w-xs truncate">
                        {item.note || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredItems.length > 50 && (
              <p className="text-center text-slate-400 text-sm py-2">
                แสดง 50 จาก {filteredItems.length} รายการ
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
