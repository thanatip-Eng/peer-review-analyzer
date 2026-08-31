// src/components/DataViewer.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { getFlaggedStudents, getFlaggedGraders } from '../utils/csvParser';
import ReviewStatusModal, { getStatusInfo, STATUS_OPTIONS } from './ReviewStatusModal';
import TAReviewSummary from './TAReviewSummary';
import { 
  Users, Search, Download, ChevronRight, AlertCircle, CheckCircle2,
  XCircle, AlertTriangle, UserCheck, BarChart2, FileText, ClipboardList, Filter,
  MessageSquare, ChevronDown, ExternalLink, X, Eye, Play
} from 'lucide-react';

// เหตุผลที่ "ไม่พบคำถามต้นฉบับ" (จาก computeQA.reason)
const QA_REASON_LABEL = {
  owner_not_submitted: 'เจ้าของไม่ส่งฟอร์ม',
  bad_clipcode: 'รหัสคลิปผิดรูปแบบ',
  linked_no_question: 'ส่งฟอร์มแต่ลิงก์ไม่ได้',
};

export default function DataViewer({ semesterId, taAssignment }) {
  const { isAdmin, isTA, currentUser, userData } = useAuth();
  const [data, setData] = useState(null);
  const [groupData, setGroupData] = useState(null);
  const [groupSets, setGroupSets] = useState([]);
  const [selectedGroupSet, setSelectedGroupSet] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [semesterMeta, setSemesterMeta] = useState(null); // ข้อมูลรายการ (canvasUrl/courseId/assignmentId ไว้สร้างลิงก์)
  const [qaByGrader, setQaByGrader] = useState(null);     // sisId -> { agg, reviews[] } คะแนน Q&A (ถ้ามี)
  const [qaDetail, setQaDetail] = useState(null);         // { graderName, agg, reviews[] } เปิดดูรายคลิป Q&A
  const [qaThreshold, setQaThreshold] = useState(0.35);   // เกณฑ์ความคล้ายคำถามที่ใช้ตอนประมวลผล
  const [qaByOwner, setQaByOwner] = useState(null);       // sisId -> คะแนนเจ้าของคลิป (ตั้งคำถาม/ตอบเอง)
  const [reviewsByClip, setReviewsByClip] = useState(null); // sisId(เจ้าของ) -> [{reviewerName, transcribedQ}]
  const [qaOverrides, setQaOverrides] = useState({});     // `${reviewerId}__${clipCode}` -> { score:0|1, ... } TA แก้คะแนนรีวิว
  const [notice, setNotice] = useState(null);             // { text, type:'success'|'error' } toast ยืนยันการบันทึก
  const [clipOverrides, setClipOverrides] = useState({}); // studentId -> { taScore, ... } คะแนนคลิปที่ TA ให้
  const [clipModal, setClipModal] = useState(null);       // { student } เปิดให้ TA ใส่คะแนนคลิป
  const [canvasExportOpen, setCanvasExportOpen] = useState(false); // modal ส่งออก Canvas
  
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
    hasFlag: 'all', // all, yes, no
    qaOwner: 'all', // all, 2, 1, 0, notSubmitted (คะแนนตอบคำถามท้ายคลิป)
    clipReview: 'all' // all, needsTA, auto, pending (คะแนนคลิปสิ้นสุด)
  });

  const [graderFilters, setGraderFilters] = useState({
    reviewCompletion: 'all', // all, complete, incomplete
    reviewStatus: 'all',
    hasFlag: 'all',
    qaTotal: 'all' // all, 3, 2, 1, 0, noMatch (คะแนนรวม Q&A)
  });
  
  const [showFilters, setShowFilters] = useState(false);

  // Fetch data from Firestore
  useEffect(() => {
    async function fetchData() {
      if (!semesterId) return;
      
      setLoading(true);
      setError(null);
      
      try {
        // Fetch รายการ (semester doc) เพื่อเอา canvasUrl/courseId/assignmentId ไว้สร้างลิงก์
        try {
          const semRef = doc(db, 'semesters', semesterId);
          const semSnap = await getDoc(semRef);
          setSemesterMeta(semSnap.exists() ? semSnap.data() : null);
        } catch { setSemesterMeta(null); }

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

        // ตัด flag เก่าที่เลิกใช้แล้วออก (incomplete_comments / เกี่ยวกับโบนัส) จากข้อมูลที่บันทึกไว้
        Object.values(graders).forEach((g) => {
          if (Array.isArray(g.flags)) g.flags = g.flags.filter((f) => f.type !== 'incomplete_comments');
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

        // คะแนน Q&A (ถ้ามีการอัปโหลด MS Form) — จับคู่กับ grader ด้วย reviewerId (sisId)
        try {
          const qaSnap = await getDocs(collection(db, 'semesters', semesterId, 'peerQAData'));
          let reviewers = {};
          let reviewsArr = [];
          let owners = {};
          qaSnap.docs.forEach((ds) => {
            if (ds.id.startsWith('reviewers_')) reviewers = { ...reviewers, ...ds.data().data };
            else if (ds.id.startsWith('reviews_')) reviewsArr = [...reviewsArr, ...ds.data().data];
            else if (ds.id.startsWith('owners_')) owners = { ...owners, ...ds.data().data };
            else if (ds.id === 'meta') {
              const th = ds.data()?.stats?.threshold;
              if (typeof th === 'number') setQaThreshold(th);
            }
          });
          if (Object.keys(reviewers).length > 0) {
            const byId = {};
            Object.values(reviewers).forEach((rv) => {
              if (rv.reviewerId) byId[rv.reviewerId] = { agg: rv, reviews: [] };
            });
            reviewsArr.forEach((r) => {
              if (r.reviewerId && byId[r.reviewerId]) byId[r.reviewerId].reviews.push(r);
            });
            setQaByGrader(byId);
          } else {
            setQaByGrader(null);
          }
          // คะแนนเจ้าของคลิป + จัดกลุ่มรีวิวตามรหัสคลิป (เจ้าของ) ไว้ทำ tooltip หน้าคะแนนชิ้นงาน
          setQaByOwner(Object.keys(owners).length > 0 ? owners : null);
          if (reviewsArr.length > 0) {
            const byClip = {};
            reviewsArr.forEach((r) => {
              if (!r.clipCode) return;
              (byClip[r.clipCode] = byClip[r.clipCode] || []).push({ reviewerName: r.reviewerName, transcribedQ: r.transcribedQ });
            });
            setReviewsByClip(byClip);
          } else {
            setReviewsByClip(null);
          }
        } catch {
          setQaByGrader(null);
          setQaByOwner(null);
          setReviewsByClip(null);
        }

        // หมายเหตุ: คะแนนที่ TA แก้ (qaReviewOverrides / clipScoreOverrides) โหลดแบบ realtime
        // ใน useEffect แยกด้านล่าง (onSnapshot) เพื่อให้เห็นการอัปเดตข้าม TA/แท็บ ทันที
      } catch (err) {
        console.error('Error fetching data:', err);
        setError(`เกิดข้อผิดพลาด: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, [semesterId]);

  // Realtime: คะแนนที่ TA แก้ (0/1 รายรีวิว + คะแนนคลิป) — อัปเดตสด ข้าม TA/แท็บ ไม่ต้อง refresh
  useEffect(() => {
    if (!semesterId) return;
    const unsubQa = onSnapshot(
      collection(db, 'semesters', semesterId, 'qaReviewOverrides'),
      (snap) => { const ov = {}; snap.docs.forEach((d) => { ov[d.id] = d.data(); }); setQaOverrides(ov); },
      () => {}
    );
    const unsubClip = onSnapshot(
      collection(db, 'semesters', semesterId, 'clipScoreOverrides'),
      (snap) => { const cov = {}; snap.docs.forEach((d) => { cov[d.id] = d.data(); }); setClipOverrides(cov); },
      () => {}
    );
    return () => { unsubQa(); unsubClip(); };
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

  // ลิงก์ไปดูงานของนักศึกษาใน Canvas (SpeedGrader) — ใช้ได้เมื่อดึงจาก Canvas
  const getCanvasLink = useCallback((canvasUserId) => {
    const m = semesterMeta;
    if (!m?.canvasUrl || !m.canvasCourseId || !m.canvasAssignmentId || !canvasUserId) return null;
    return `${m.canvasUrl.replace(/\/+$/, '')}/courses/${m.canvasCourseId}/gradebook/speed_grader?assignment_id=${m.canvasAssignmentId}&student_id=${canvasUserId}`;
  }, [semesterMeta]);

  // ลิงก์หน้า Peer Review ของ assignment ใน Canvas (ไว้เช็คว่ารีวิวครบไหม)
  const getCanvasPeerReviewLink = useCallback(() => {
    const m = semesterMeta;
    if (!m?.canvasUrl || !m.canvasCourseId || !m.canvasAssignmentId) return null;
    return `${m.canvasUrl.replace(/\/+$/, '')}/courses/${m.canvasCourseId}/assignments/${m.canvasAssignmentId}/peer_reviews`;
  }, [semesterMeta]);

  // ===== Q&A per-review override (TA แก้คะแนน 0/1) =====
  const qaReviewKey = (reviewerId, clipCode) => `${reviewerId}__${clipCode}`;

  // คะแนน effective ของรีวิว 1 คลิป (override ถ้ามี ไม่งั้นใช้ full?1:0)
  const reviewEffScore = useCallback((r) => {
    const ov = qaOverrides[qaReviewKey(r.reviewerId, r.clipCode)];
    if (ov && (ov.score === 0 || ov.score === 1)) return ov.score;
    return r.full ? 1 : 0;
  }, [qaOverrides]);

  // คะแนนรวม Q&A ของ grader (รวม override) cap 3 — null ถ้าไม่มี record
  const graderQaTotal = useCallback((graderId) => {
    const qa = qaByGrader?.[graderId];
    if (!qa) return null;
    const sum = (qa.reviews || []).reduce((acc, r) => acc + reviewEffScore(r), 0);
    return Math.min(sum, 3);
  }, [qaByGrader, reviewEffScore]);

  // แผนที่ sisId(เจ้าของ) -> canvasUserId (ไว้ทำลิงก์เปิดคลิปเจ้าของใน modal)
  const studentIdToCanvasId = useMemo(() => {
    const m = {};
    if (data?.students) Object.values(data.students).forEach(s => { if (s.studentId) m[s.studentId] = s.canvasUserId; });
    return m;
  }, [data]);

  // toast ยืนยันการบันทึก (auto-hide)
  const showNotice = useCallback((text, type = 'success') => {
    setNotice({ text, type });
    setTimeout(() => setNotice((n) => (n && n.text === text ? null : n)), 3500);
  }, []);

  // บันทึก override คะแนนรีวิว (TA/Admin) — โยน error ต่อถ้าบันทึกไม่สำเร็จ
  const saveQaOverride = useCallback(async (reviewerId, clipCode, score) => {
    if (!semesterId || !reviewerId || !clipCode) return;
    const key = qaReviewKey(reviewerId, clipCode);
    const payload = {
      reviewerId, clipCode, score,
      updatedBy: currentUser?.uid || '',
      updatedByName: userData?.displayName || currentUser?.email || '',
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'qaReviewOverrides', key), payload, { merge: true });
      setQaOverrides(prev => ({ ...prev, [key]: { ...prev[key], ...payload } }));
      showNotice(`บันทึกคะแนนรีวิว (${score}) แล้ว`, 'success');
    } catch (err) {
      showNotice(`บันทึกไม่สำเร็จ: ${err?.message || err} (ตรวจสิทธิ์ Firestore rules)`, 'error');
      throw err;
    }
  }, [semesterId, currentUser, userData, showNotice]);

  // คะแนนเต็มชิ้นงาน (rubric) — admin ตั้งได้ต่อรายการ (semesterMeta.workMaxScore) ไม่งั้นใช้ค่าจาก Canvas
  const workMax = Number(semesterMeta?.workMaxScore) > 0 ? Number(semesterMeta.workMaxScore) : (data?.stats?.maxScore || 12);

  // ===== คะแนนคลิป "สิ้นสุด" (เกณฑ์: กระจาย = max−min > 2) =====
  const SPREAD_LIMIT = 2;
  const clipFinal = useCallback((student) => {
    const ws = student.workScore || {};
    const grades = (ws.grades || []).filter(g => g != null && !isNaN(g));
    const n = grades.length;
    const range = n ? (ws.range ?? (Math.max(...grades) - Math.min(...grades))) : 0;
    const overMax = grades.some(g => g > workMax); // ผู้รีวิวให้เกินคะแนนเต็ม → ต้องให้ TA ตรวจ ห้าม auto
    const taScore = clipOverrides[student.studentId]?.taScore;
    const hasTa = taScore != null && !isNaN(taScore);
    const autoEligible = n >= 3 && range <= SPREAD_LIMIT && !overMax;
    // คะแนน TA ชนะ auto เสมอ (ถ้า TA กรอกคะแนนแล้ว ใช้ของ TA)
    if (hasTa) {
      if (n === 2) {
        const combined = [...grades, Number(taScore)];
        const cRange = Math.max(...combined) - Math.min(...combined);
        return { status: 'ta', final: cRange <= SPREAD_LIMIT ? Math.max(...combined) : Number(taScore), needsTA: true, hasTa: true, overMax };
      }
      // 1 รีวิว หรือ 3+ (รวมกระจาย/เกินเต็ม) → ใช้คะแนน TA
      return { status: 'ta', final: Number(taScore), needsTA: true, hasTa: true, overMax };
    }
    // ยังไม่มีคะแนน TA
    if (autoEligible) return { status: 'auto', final: ws.max, needsTA: false, hasTa: false, overMax: false };
    return { status: 'pending', final: null, needsTA: true, hasTa: false, overMax }; // รวมเคส overMax → รอตรวจ (แดง)
  }, [clipOverrides, workMax]);

  // คะแนนผู้รีวิวรายคน + ชื่อ (จาก graders' details) ของ นศ. เจ้าของงาน
  const reviewerScoresFor = useCallback((student) => {
    if (!data?.graders) return [];
    const out = [];
    Object.values(data.graders).forEach(g => {
      (g.peerReviewScore?.details || []).forEach(d => {
        if (d.studentId === student.studentId || d.studentReviewed === student.studentName) {
          out.push({ graderName: g.fullName || g.graderName, graderId: g.graderId, gradeGiven: d.gradeGiven });
        }
      });
    });
    return out;
  }, [data]);

  const saveClipOverride = useCallback(async (studentId, taScore, note) => {
    if (!semesterId || !studentId) return;
    const cleared = taScore == null || taScore === '';
    const payload = {
      studentId,
      taScore: cleared ? null : Number(taScore),
      note: note || '',
      updatedBy: currentUser?.uid || '',
      updatedByName: userData?.displayName || currentUser?.email || '',
      updatedAt: serverTimestamp(),
    };
    try {
      await setDoc(doc(db, 'semesters', semesterId, 'clipScoreOverrides', studentId), payload, { merge: true });
      setClipOverrides(prev => ({ ...prev, [studentId]: { ...prev[studentId], ...payload } }));
      showNotice(cleared ? 'ล้างคะแนน TA แล้ว' : `บันทึกคะแนนรูบริค (${payload.taScore}) แล้ว`, 'success');
    } catch (err) {
      showNotice(`บันทึกไม่สำเร็จ: ${err?.message || err} (ตรวจสิทธิ์ Firestore rules)`, 'error');
      throw err;
    }
  }, [semesterId, currentUser, userData, showNotice]);

  // student object ตาม sisId (data.students คีย์ด้วย "sisId ชื่อ")
  const studentsById = useMemo(() => {
    const m = {};
    if (data?.students) Object.values(data.students).forEach(s => { if (s.studentId) m[s.studentId] = s; });
    return m;
  }, [data]);

  // จำนวนงานที่ TA ส่งต่อ Admin (ยังไม่ปิด) — ไว้โชว์ badge
  const escalatedCount = useMemo(
    () => Object.values(reviewStatuses).filter(s => s?.status === 'escalated').length,
    [reviewStatuses]
  );

  // Allowed groups for TA
  const allowedGroups = useMemo(() => {
    if (isAdmin) return allGroups;
    if (!taAssignment) return [];
    if (taAssignment.canViewAll) return allGroups;
    return taAssignment.assignedGroups || [];
  }, [isAdmin, taAssignment, allGroups]);

  // รวมคนสำหรับ export Canvas (union students∪graders by sisId) + คะแนน 3 อย่าง (เคารพขอบเขต TA)
  // ต้องอยู่หลัง allowedGroups (อ้างถึง) เพื่อเลี่ยง temporal-dead-zone
  const exportPeople = useMemo(() => {
    if (!data) return [];
    const map = {};
    const add = (id, name, canvasId) => {
      id = String(id || '').trim(); if (!id) return;
      if (!map[id]) map[id] = { sisId: id, name: name || '', canvasUserId: canvasId ?? null };
      else { if (!map[id].name && name) map[id].name = name; if (map[id].canvasUserId == null && canvasId != null) map[id].canvasUserId = canvasId; }
    };
    Object.values(data.students).forEach(s => add(s.studentId, s.fullName, s.canvasUserId));
    Object.values(data.graders).forEach(g => add(g.graderId, g.fullName, g.canvasUserId));
    const inScope = (id) => {
      if (isAdmin || taAssignment?.canViewAll || !isTA) return true;
      if (allowedGroups.length === 0) return true;
      return allowedGroups.includes(getStudentGroup(id));
    };
    return Object.values(map)
      .filter(p => inScope(p.sisId))
      .map(p => {
        const st = studentsById[p.sisId];
        const clip = st ? clipFinal(st).final : null;
        return {
          ...p,
          clip: clip == null ? '' : clip,
          ownerQa: qaByOwner?.[p.sisId]?.score ?? '',
          peer: graderQaTotal(p.sisId) ?? '',
        };
      })
      .sort((a, b) => a.sisId.localeCompare(b.sisId));
  }, [data, studentsById, clipFinal, qaByOwner, graderQaTotal, isAdmin, isTA, taAssignment, allowedGroups, getStudentGroup]);

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

      // คะแนนตอบคำถามท้ายคลิป (owner Q&A) filter
      let matchQaOwner = true;
      if (studentFilters.qaOwner !== 'all' && qaByOwner) {
        const qa = qaByOwner[s.studentId];
        if (studentFilters.qaOwner === 'notSubmitted') {
          matchQaOwner = !qa;
        } else {
          matchQaOwner = !!qa && qa.score === Number(studentFilters.qaOwner);
        }
      }

      // คะแนนคลิปสิ้นสุด filter
      let matchClip = true;
      if (studentFilters.clipReview !== 'all') {
        const cf = clipFinal(s);
        if (studentFilters.clipReview === 'needsTA') matchClip = cf.needsTA;
        else if (studentFilters.clipReview === 'auto') matchClip = cf.status === 'auto';
        else if (studentFilters.clipReview === 'pending') matchClip = cf.status === 'pending';
      }

      return matchSearch && matchGroup && matchGraderStatus && matchScoreRange && matchReviewStatus && matchHasFlag && matchQaOwner && matchClip;
    }).sort((a, b) => b.workScore.average - a.workScore.average);
  }, [data, searchQuery, groupFilter, getStudentGroup, isTA, taAssignment, allowedGroups, studentFilters, reviewStatuses, qaByOwner, clipFinal]);

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

      // คะแนนรวม Q&A filter (รวม override ของ TA)
      let matchQaTotal = true;
      if (graderFilters.qaTotal !== 'all' && qaByGrader) {
        const agg = qaByGrader[g.graderId]?.agg;
        if (graderFilters.qaTotal === 'noMatch') {
          matchQaTotal = !!agg?.flags?.includes('qa_no_match');
        } else {
          matchQaTotal = (graderQaTotal(g.graderId) ?? 0) === Number(graderFilters.qaTotal);
        }
      }

      return matchSearch && matchGroup && matchCompletion && matchReviewStatus && matchHasFlag && matchQaTotal;
    }).sort((a, b) => {
      // เรียงตามคะแนนรวม = Q&A (ถ้ามี) มิฉะนั้น fallback คะแนนรีวิวเดิม
      const qs = (g) => qaByGrader ? (graderQaTotal(g.graderId) ?? -1) : g.peerReviewScore.netScore;
      return qs(b) - qs(a);
    });
  }, [data, searchQuery, groupFilter, getStudentGroup, isTA, taAssignment, allowedGroups, graderFilters, reviewStatuses, qaByGrader, graderQaTotal]);

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
        // คะแนน PR = Q&A (รวม override, ถ้ามี) มิฉะนั้น fallback คะแนนรีวิวเดิม
        const prScore = qaByGrader ? (graderQaTotal(g.graderId) ?? 0) : g.peerReviewScore.netScore;
        stats[group].prScores.push(prScore);
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
  }, [data, selectedGroupSet, groupData, allGroups, getStudentGroup, isTA, taAssignment, allowedGroups, qaByGrader, graderQaTotal]);

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
        ...(() => {
          const cf = clipFinal(s);
          return {
            'คะแนนรูบริค': cf.final == null ? 'รอ TA' : cf.final,
            'ที่มาคะแนนคลิป': cf.status === 'auto' ? 'อัตโนมัติ(Max)' : cf.status === 'ta' ? 'TA' : 'รอตรวจ',
          };
        })(),
        ...(qaByOwner ? (() => {
          const qa = qaByOwner[s.studentId];
          return {
            'ตอบคำถามท้ายคลิป (x/2)': qa ? qa.score : 'ไม่ส่งฟอร์ม',
            'ตั้งคำถาม': qa ? (qa.posed ? 'ใช่' : 'ไม่') : '-',
            'ตอบเอง': qa ? (qa.answered ? 'ใช่' : 'ไม่') : '-',
          };
        })() : {}),
        'Flags': s.flags.map(f => f.message).join('; '),
        'สถานะการตรวจ': statusInfo.label,
        'โน้ต': itemStatus?.note || '-',
        'ตรวจโดย': itemStatus?.updatedByName || '-'
      };
    });
    downloadCSV(rows, 'student-work-scores');
  }, [data, filteredStudents, selectedGroupSet, getStudentGroup, reviewStatuses, qaByOwner, clipFinal]);

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
        'งานสมบูรณ์ (ให้คะแนนแล้ว)': g.peerReviewScore.reviewedCount,
        'คะแนนพื้นฐาน (รีวิว)': g.peerReviewScore.baseScore,
        ...(() => {
          // คะแนนรวม = คุณภาพ Q&A (1/คลิป, เต็ม 3, รวม override ของ TA)
          if (!qaByGrader) return { 'คะแนนรวม (Q&A)': 'รอข้อมูล Q&A', 'คะแนนเต็ม': 3 };
          const a = qaByGrader[g.graderId]?.agg;
          const total = graderQaTotal(g.graderId);
          return {
            'คะแนนรวม (Q&A)': total == null ? 0 : total,
            'คะแนนเต็ม': 3,
            'Q&A ดูจริง': a ? a.watched : '-',
            'Q&A ตั้งใจตอบ': a ? a.answered : '-',
            'Q&A รีวิวที่ส่ง': a ? a.submitted : '-',
          };
        })(),
        'Flags': g.flags.map(f => f.message).join('; '),
        'สถานะการตรวจ': statusInfo.label,
        'โน้ต': itemStatus?.note || '-',
        'ตรวจโดย': itemStatus?.updatedByName || '-'
      };
    });
    downloadCSV(rows, 'grader-peer-review-scores');
  }, [data, filteredGraders, selectedGroupSet, getStudentGroup, reviewStatuses, qaByGrader, graderQaTotal]);

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
          { id: 'admin', label: 'ตรวจสอบ', icon: AlertTriangle, badge: escalatedCount },
          ...(isAdmin ? [{ id: 'tasummary', label: 'สรุปการตรวจสอบ', icon: MessageSquare, badge: escalatedCount }] : []),
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex items-center gap-2 px-4 py-3 rounded-lg transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-5 h-5" /> {tab.label}
            {tab.badge > 0 && (
              <span className="ml-1 min-w-5 h-5 px-1.5 inline-flex items-center justify-center bg-yellow-500 text-black text-xs font-bold rounded-full">
                {tab.badge}
              </span>
            )}
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

          {/* ส่งออกคะแนนเข้า Canvas */}
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2"><Download className="w-5 h-5 text-green-400" /> ส่งออกคะแนนเข้า Canvas</h3>
              <p className="text-sm text-slate-400 mt-1">รวมคะแนนรูบริค + Q&amp;A เจ้าของ + Peer Review เป็นไฟล์ CSV สำหรับ import กลับ Canvas ({exportPeople.length} คน)</p>
            </div>
            <button
              onClick={() => setCanvasExportOpen(true)}
              className="px-4 py-2.5 bg-green-600 hover:bg-green-500 rounded-xl font-medium flex items-center gap-2"
            >
              <Download className="w-5 h-5" /> ส่งออกเข้า Canvas (CSV)
            </button>
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
                          <span className={`font-semibold ${getScoreColor(stats.avgWorkScore, workMax)}`}>
                            {stats.avgWorkScore.toFixed(2)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-semibold ${getScoreColor(stats.avgPRScore, 3)}`}>
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
            <span className="text-sm text-slate-400 whitespace-nowrap">
              พบ <span className="text-cyan-400 font-semibold">{filteredStudents.length}</span> รายการ
            </span>
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
              {qaByOwner && (
                <div>
                  <label className="block text-xs text-amber-400 mb-1">ตอบคำถามท้ายคลิป</label>
                  <select
                    value={studentFilters.qaOwner}
                    onChange={(e) => setStudentFilters(f => ({ ...f, qaOwner: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                  >
                    <option value="all">ทั้งหมด</option>
                    <option value="2">ครบ 2/2</option>
                    <option value="1">ได้ 1</option>
                    <option value="0">0 คะแนน</option>
                    <option value="notSubmitted">ไม่ส่งฟอร์ม</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs text-purple-300 mb-1">คะแนนรูบริค</label>
                <select
                  value={studentFilters.clipReview}
                  onChange={(e) => setStudentFilters(f => ({ ...f, clipReview: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                >
                  <option value="all">ทั้งหมด</option>
                  <option value="needsTA">ต้องให้ TA ตรวจ</option>
                  <option value="pending">รอ TA ใส่คะแนน</option>
                  <option value="auto">อัตโนมัติ (Max)</option>
                </select>
              </div>
            </div>
          )}

          {/* Flag Legend */}
          <div className="bg-slate-800/50 rounded-xl p-3 text-xs flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-slate-400 font-medium">ความหมาย Flag:</span>
            <span><span className="text-red-400">🔴</span> คะแนนเกิน/ต่ำกว่าช่วง (0-{workMax})</span>
            <span><span className="text-yellow-400">🟡</span> SD สูง / คะแนนห่างกันมาก</span>
            <span><span className="text-blue-400">🔵</span> grader น้อยกว่า 2 คน</span>
            <span><span className="text-green-400">✓</span> น่าเชื่อถือ = grader≥2, SD&lt;3, คะแนนในช่วง 0-{workMax}</span>
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
                    <th className="px-4 py-3 text-center text-sm font-medium text-purple-300">คะแนนรูบริค</th>
                    {qaByOwner && <th className="px-4 py-3 text-center text-sm font-medium text-amber-400">ตอบคำถามท้ายคลิป (x/2)</th>}
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
                        <span className={`font-semibold ${getScoreColor(student.workScore.average, workMax)}`}>
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
                      {(() => {
                        const cf = clipFinal(student);
                        const maxSc = workMax;
                        if (cf.status === 'pending') {
                          return (
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => (isAdmin || isTA) && setClipModal({ student })}
                                className="px-2 py-1 rounded text-xs bg-red-900/40 text-red-300 hover:bg-red-800/50 transition"
                                title={cf.overMax ? `มีผู้รีวิวให้คะแนนเกินเต็ม ${maxSc} — คลิกเพื่อให้ TA ตรวจ` : 'คะแนนกระจาย/รีวิวไม่ครบ 3 — คลิกเพื่อให้ TA ใส่คะแนน'}
                              >
                                {cf.overMax ? '⚠️ รอตรวจ' : 'รอตรวจ'}
                              </button>
                            </td>
                          );
                        }
                        const color = cf.status === 'auto' ? 'text-green-400' : 'text-purple-300';
                        return (
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => (isAdmin || isTA) && setClipModal({ student })}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/10 transition"
                              title={cf.status === 'auto' ? 'อัตโนมัติ (Max) — คลิกเพื่อดู/แก้' : 'คะแนนจาก TA — คลิกเพื่อดู/แก้'}
                            >
                              <span className={`font-semibold ${color}`}>{cf.final}/{maxSc}</span>
                              {cf.status === 'ta' && <span title="คะแนนจาก TA">✏️</span>}
                            </button>
                          </td>
                        );
                      })()}
                      {qaByOwner && (
                        <td className="px-4 py-3 text-center">
                          <OwnerQATooltip
                            qa={qaByOwner[student.studentId]}
                            reviews={(reviewsByClip && reviewsByClip[student.studentId]) || []}
                            ownerSheetUrl={semesterMeta?.qaOwnerSheetUrl || ''}
                            ownerId={student.studentId}
                            ownerName={student.fullName}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
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
                          {getCanvasLink(student.canvasUserId) && (
                            <a
                              href={getCanvasLink(student.canvasUserId)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="เปิดงานใน Canvas (SpeedGrader)"
                              className="text-cyan-400 hover:text-cyan-300"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </div>
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
            <span className="text-sm text-slate-400 whitespace-nowrap">
              พบ <span className="text-cyan-400 font-semibold">{filteredGraders.length}</span> รายการ
            </span>
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
              {qaByGrader && (
                <div>
                  <label className="block text-xs text-amber-400 mb-1">รวม Q&amp;A</label>
                  <select
                    value={graderFilters.qaTotal}
                    onChange={(e) => setGraderFilters(f => ({ ...f, qaTotal: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-sm"
                  >
                    <option value="all">ทั้งหมด</option>
                    <option value="3">ครบ 3/3</option>
                    <option value="2">ได้ 2</option>
                    <option value="1">ได้ 1</option>
                    <option value="0">0 คะแนน</option>
                    <option value="noMatch">⚠️ ตอบแต่คำถามไม่ตรง</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-800/50 rounded-xl p-3 text-sm flex flex-wrap gap-4">
            <span className="text-slate-400">เงื่อนไขคะแนนรวม (Q&amp;A):</span>
            <span><span className="text-green-400">1 คะแนน/คลิป</span> เมื่อถอดคำถามตรง + ตั้งใจตอบ (เต็ม 3)</span>
            <span className="text-slate-500">คลิกที่คะแนนรวมเพื่อดูรายคลิป</span>
          </div>

          {/* Flag Legend */}
          <div className="bg-slate-800/50 rounded-xl p-3 text-xs flex flex-wrap gap-x-6 gap-y-2">
            <span className="text-slate-400 font-medium">ความหมาย Flag:</span>
            <span><span className="text-yellow-400">🟡</span> รีวิวไม่ครบตามที่ได้รับ</span>
            <span><span className="text-blue-400">🔵</span> ได้รับงานไม่ครบ 3 งาน</span>
            <span><span className="text-slate-400">งานสมบูรณ์</span> = ให้คะแนนแล้วในแคนวาส (ข้อมูลประกอบ)</span>
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
                    <th className="px-4 py-3 text-center text-sm font-medium text-amber-400">รวม (Q&amp;A)</th>
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
                            {getCanvasLink(grader.canvasUserId) && (
                              <a
                                href={getCanvasLink(grader.canvasUserId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="เปิดงาน/คลิปของผู้รีวิวคนนี้ใน Canvas (SpeedGrader)"
                                className="text-cyan-400 hover:text-cyan-300"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
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
                          {/* สมบูรณ์ = ให้คะแนนแล้วในแคนวาส (จำนวนที่ให้คะแนน / งานที่ได้รับ) */}
                          <span className={pr.reviewedCount === grader.assignedReviews ? 'text-green-400' : 'text-yellow-400'}>
                            {pr.reviewedCount}/{grader.assignedReviews}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-cyan-400">{pr.baseScore}</td>
                        {(() => {
                          // คะแนนรวม = คุณภาพ Q&A (1/คลิป, รวม override ของ TA). ทั้งเทอมยังไม่มี Q&A -> รอข้อมูล
                          if (!qaByGrader) {
                            return <td className="px-4 py-3 text-center text-slate-500 text-xs">— รอข้อมูล Q&amp;A</td>;
                          }
                          const qa = qaByGrader[grader.graderId];
                          if (!qa) {
                            // มี Q&A ของเทอมแล้ว แต่คนนี้ไม่มี record = ไม่ได้ส่ง MS Form
                            return <td className="px-4 py-3 text-center"><span className="font-semibold text-red-400">0/3</span></td>;
                          }
                          const a = qa.agg;
                          const total = graderQaTotal(grader.graderId);
                          const color = total >= 3 ? 'text-green-400' : total > 0 ? 'text-amber-400' : 'text-red-400';
                          const edited = (qa.reviews || []).some(r => qaOverrides[`${r.reviewerId}__${r.clipCode}`]);
                          const title = `รีวิว ${a.submitted} คลิป · ดูจริง(คำถามตรง) ${a.watched} · ตั้งใจตอบ ${a.answered} · ผ่านครบ ${a.full}${edited ? ' · TA แก้แล้ว' : ''} — คลิกดู/แก้รายคลิป`;
                          return (
                            <td className="px-4 py-3 text-center" title={title}>
                              <button
                                onClick={() => setQaDetail({ graderName: grader.fullName, graderId: grader.graderId, agg: a, reviews: qa.reviews || [] })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-white/10 transition"
                              >
                                <span className={`font-semibold ${color}`}>{total}/3</span>
                                {edited && <span title="TA ปรับคะแนนแล้ว">✏️</span>}
                                {a.flags && a.flags.includes('qa_no_match') && (
                                  <span title="ตอบแต่คำถามไม่ตรง — อาจไม่ได้ดู">⚠️</span>
                                )}
                                <Search className="w-3.5 h-3.5 text-slate-500" />
                              </button>
                            </td>
                          );
                        })()}
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

      {/* Q&A Per-Clip Detail Modal */}
      {qaDetail && (
        <QADetailModal
          detail={qaDetail}
          threshold={qaThreshold}
          canEdit={isAdmin || isTA}
          qaOverrides={qaOverrides}
          reviewEffScore={reviewEffScore}
          onOverride={saveQaOverride}
          getClipLink={(clipCode) => getCanvasLink(studentIdToCanvasId[clipCode])}
          peerReviewLink={getCanvasPeerReviewLink()}
          reviewerSheetUrl={semesterMeta?.qaReviewerSheetUrl || ''}
          onClose={() => setQaDetail(null)}
        />
      )}

      {/* Clip Score Modal (TA ใส่คะแนนคลิป) */}
      {clipModal && (
        <ClipScoreModal
          student={clipModal.student}
          maxScore={workMax}
          canEdit={isAdmin || isTA}
          info={clipFinal(clipModal.student)}
          reviewerScores={reviewerScoresFor(clipModal.student)}
          currentTa={clipOverrides[clipModal.student.studentId]}
          clipLink={getCanvasLink(clipModal.student.canvasUserId)}
          onSave={saveClipOverride}
          onClose={() => setClipModal(null)}
        />
      )}

      {/* Canvas Export Modal */}
      {canvasExportOpen && (
        <CanvasExportModal
          semesterId={semesterId}
          semesterMeta={semesterMeta}
          maxScore={workMax}
          people={exportPeople}
          onClose={() => setCanvasExportOpen(false)}
        />
      )}

      {/* Toast ยืนยันการบันทึก / แจ้ง error */}
      {notice && (
        <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-3 rounded-xl shadow-2xl border text-sm flex items-center gap-2 max-w-[90vw] ${
          notice.type === 'error' ? 'bg-red-900/90 border-red-500/40 text-red-100' : 'bg-green-900/90 border-green-500/40 text-green-100'
        }`}>
          {notice.type === 'error' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
          <span className="break-words">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-1 opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
        </div>
      )}
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

// QADetailModal - หน้าต่างดูรายคลิป Q&A ให้ TA ตรวจคู่ที่ก้ำกึ่งด้วยตา + แก้คะแนน 0/1
function QADetailModal({ detail, threshold, canEdit, qaOverrides = {}, reviewEffScore, onOverride, getClipLink, peerReviewLink, reviewerSheetUrl, onClose }) {
  const { graderName, agg, reviews } = detail;
  const effScore = (r) => (reviewEffScore ? reviewEffScore(r) : (r.full ? 1 : 0));
  const liveTotal = Math.min((reviews || []).reduce((acc, r) => acc + effScore(r), 0), 3);
  // ก้ำกึ่ง = matchScore อยู่ในแถบ ±0.1 รอบเกณฑ์ (ควรให้คนตรวจดูเอง)
  const BORDER_BAND = 0.1;
  const isBorderline = (m) => m != null && Math.abs(m - threshold) <= BORDER_BAND;

  // เรียง: ก้ำกึ่งก่อน แล้วตามด้วย matchScore น้อย->มาก เพื่อให้ตรวจตัวที่น่าสงสัยก่อน
  const sorted = [...(reviews || [])].sort((a, b) => {
    const ab = isBorderline(a.matchScore) ? 0 : 1;
    const bb = isBorderline(b.matchScore) ? 0 : 1;
    if (ab !== bb) return ab - bb;
    return (a.matchScore ?? -1) - (b.matchScore ?? -1);
  });

  const matchColor = (m) => {
    if (m == null) return 'text-slate-500';
    if (m >= threshold + BORDER_BAND) return 'text-green-400';
    if (m >= threshold) return 'text-lime-400';
    if (m >= threshold - BORDER_BAND) return 'text-amber-400';
    return 'text-red-400';
  };
  const barColor = (m) => {
    if (m == null) return 'bg-slate-600';
    if (m >= threshold + BORDER_BAND) return 'bg-green-500';
    if (m >= threshold) return 'bg-lime-500';
    if (m >= threshold - BORDER_BAND) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Eye className="w-5 h-5 text-amber-400" />
              ตรวจ Q&amp;A รายคลิป — {graderName}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <span>
                คะแนนรวม:{' '}
                <span className={`font-semibold ${liveTotal >= 3 ? 'text-green-400' : liveTotal > 0 ? 'text-amber-400' : 'text-red-400'}`}>
                  {liveTotal}/3
                </span>
              </span>
              <span className="text-slate-400">ส่งรีวิว {agg.submitted}</span>
              <span className="text-slate-400">ดูจริง(คำถามตรง) {agg.watched}</span>
              <span className="text-slate-400">ตั้งใจตอบ {agg.answered}</span>
              <span className="text-slate-400">ผ่านครบ {agg.full}</span>
              <span className="text-slate-500 text-xs">เกณฑ์คำถามตรง ≥ {threshold}</span>
            </div>
            {peerReviewLink && (
              <a href={peerReviewLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300">
                <ExternalLink className="w-4 h-4" /> เปิดหน้า Peer Review ของ assignment ใน Canvas (เช็ครีวิวครบไหม)
              </a>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Legend */}
        <div className="px-5 py-3 border-b border-white/5 text-xs flex flex-wrap gap-x-5 gap-y-2 text-slate-400">
          <span><span className="text-green-400">■</span> คำถามตรงชัดเจน</span>
          <span><span className="text-amber-400">■</span> ก้ำกึ่ง (ควรตรวจด้วยตา)</span>
          <span><span className="text-red-400">■</span> คำถามไม่ตรง</span>
          <span className="text-slate-500">เรียงตัวก้ำกึ่ง/น่าสงสัยขึ้นก่อน</span>
          {canEdit && <span className="text-purple-300">TA ปรับคะแนนรีวิวได้ (0/1) — เปิดคลิปเทียบก่อนตัดสิน</span>}
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 space-y-3">
          {sorted.length === 0 && (
            <p className="text-slate-400 text-center py-8">ไม่มีข้อมูลรายคลิป</p>
          )}
          {sorted.map((r, i) => {
            const border = isBorderline(r.matchScore);
            const pct = r.matchScore == null ? 0 : Math.round(r.matchScore * 100);
            const eff = effScore(r);
            const ovKey = `${r.reviewerId}__${r.clipCode}`;
            const isOverridden = !!qaOverrides[ovKey];
            const clipLink = getClipLink ? getClipLink(r.clipCode) : null;
            return (
              <div
                key={i}
                className={`rounded-xl border p-4 ${
                  border ? 'border-amber-500/50 bg-amber-500/5' : 'border-white/10 bg-slate-800/40'
                }`}
              >
                {/* row header */}
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Play className="w-4 h-4 text-cyan-400" />
                    <span className="font-mono text-slate-300">คลิป {r.clipCode || '-'}</span>
                    {clipLink && (
                      <a href={clipLink} target="_blank" rel="noopener noreferrer" title="เปิดคลิป/งานของเจ้าของใน Canvas (SpeedGrader)" className="text-cyan-400 hover:text-cyan-300">
                        <ExternalLink className="w-3.5 h-3.5 inline" />
                      </a>
                    )}
                    {r.ownerName && <span className="text-slate-400">· เจ้าของ: {r.ownerName}</span>}
                    {border && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        ก้ำกึ่ง
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {r.watched
                      ? <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-300">✓ คำถามตรง</span>
                      : <span className="text-xs px-2 py-0.5 rounded bg-red-900/40 text-red-300">✗ คำถามไม่ตรง</span>}
                    {r.answered
                      ? <span className="text-xs px-2 py-0.5 rounded bg-green-900/40 text-green-300">✓ ตั้งใจตอบ</span>
                      : <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">✗ ไม่ได้ตอบ</span>}
                    {r.full && <span className="text-xs px-2 py-0.5 rounded bg-cyan-900/40 text-cyan-300">ผ่านครบ</span>}
                  </div>
                </div>

                {/* per-review score + TA edit 0/1 */}
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2 bg-slate-900/50 rounded-lg px-3 py-2">
                  <div className="text-sm flex items-center gap-2">
                    <span className="text-slate-400">คะแนนรีวิวนี้:</span>
                    <span className={`font-bold ${eff >= 1 ? 'text-green-400' : 'text-red-400'}`}>{eff}/1</span>
                    {isOverridden && (
                      <span className="text-xs text-purple-300" title={`แก้โดย ${qaOverrides[ovKey]?.updatedByName || 'TA'}`}>
                        ✏️ TA ปรับ (อัตโนมัติ {r.full ? 1 : 0})
                      </span>
                    )}
                    {!r.watched && r.answered && (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-900/40 text-amber-300">⚠️ ตอบแต่คำถามไม่ตรง — ควรเช็คคลิป</span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500 mr-1">TA ตั้งคะแนน:</span>
                      {[0, 1].map((v) => (
                        <button
                          key={v}
                          onClick={() => { if (onOverride) Promise.resolve(onOverride(r.reviewerId, r.clipCode, v)).catch(() => {}); }}
                          disabled={!r.reviewerId || !r.clipCode}
                          className={`px-3 py-1 rounded-lg text-sm font-semibold transition disabled:opacity-40 ${
                            eff === v ? (v === 1 ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* match score bar */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs text-slate-400 w-24 shrink-0">คำถามตรงกัน</span>
                  <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor(r.matchScore)}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-sm font-mono w-14 text-right ${matchColor(r.matchScore)}`}>
                    {r.matchScore == null ? 'N/A' : r.matchScore.toFixed(2)}
                  </span>
                </div>

                {/* questions compare */}
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">คำถามต้นฉบับ (เจ้าของคลิป)</div>
                    <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                      {r.ownerQuestion || <span className="text-slate-500 italic">— ไม่พบคำถามต้นฉบับ ({QA_REASON_LABEL[r.reason] || 'ลิงก์ไม่ได้'}) —</span>}
                    </div>
                  </div>
                  <div className="bg-slate-900/60 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">คำถามที่ผู้รีวิวถอดมา</div>
                    <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                      {r.transcribedQ || <span className="text-slate-500 italic">— ว่าง —</span>}
                    </div>
                  </div>
                </div>

                {/* สำเนาคำตอบดิบจาก MS Form (ไฟล์ที่อัปโหลด) — ให้ TA ยืนยัน; ต้นทางจริง = xlsx แถว N */}
                <div className="mt-3 bg-slate-950/60 border border-white/10 rounded-lg p-3">
                  <div className="text-xs mb-2 flex items-center justify-between flex-wrap gap-1">
                    <span className="text-slate-400 font-medium">สำเนาคำตอบจาก MS Form (ไฟล์ผู้รีวิว)</span>
                    {reviewerSheetUrl ? (
                      <a href={reviewerSheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300">
                        <ExternalLink className="w-3.5 h-3.5" /> เปิดชีตออนไลน์ (Ctrl+F ค้น {r.reviewerEmail || 'อีเมล'})
                      </a>
                    ) : (
                      r.rowNumber != null && <span className="text-slate-500">ไฟล์ที่ดาวน์โหลด แถวที่ {r.rowNumber}</span>
                    )}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {(() => {
                      const blank = <span className="text-red-300 italic">— เว้นว่าง —</span>;
                      const Field = ({ label, value, mono }) => (
                        <div className="grid grid-cols-[7rem_1fr] gap-2">
                          <span className="text-slate-500">{label}</span>
                          <span className={`text-slate-200 whitespace-pre-wrap break-words ${mono ? 'font-mono' : ''}`}>{value ? value : blank}</span>
                        </div>
                      );
                      return (
                        <>
                          <Field label="อีเมลผู้รีวิว" value={r.reviewerEmail} mono />
                          <Field label="ลำดับคลิป" value={r.order} />
                          <Field label="รหัสคลิป" value={r.clipCode} mono />
                          <Field label="คำถามที่ถอด" value={r.transcribedQ} />
                          <Field label="คำตอบ" value={r.myAnswer} />
                          <Field label="ควรเผยแพร่" value={r.publish} />
                          <Field label="เหตุผล" value={r.publishReason} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">* นี่คือสำเนาที่ระบบอ่านจากไฟล์ — หากสงสัยว่าอ่านตกหล่น เปิดชีตออนไลน์แล้ว Ctrl+F ค้นด้วยอีเมลเทียบต้นทางได้</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

// OwnerQATooltip - คะแนน "ตอบคำถามท้ายคลิป" ของเจ้าของ (กดเปิด modal ดูคำถาม/ผู้รีวิว)
function OwnerQATooltip({ qa, reviews, ownerSheetUrl, ownerId, ownerName }) {
  const [open, setOpen] = useState(false);
  const score = qa ? qa.score : 0;
  const scoreColor = !qa ? 'text-red-400' : score >= 2 ? 'text-green-400' : score === 1 ? 'text-amber-400' : 'text-red-400';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-2 py-1 rounded-lg hover:bg-white/10 transition"
        title="กดดูรายละเอียด"
      >
        {qa ? (
          <span className={`font-semibold ${scoreColor}`}>{score}/2</span>
        ) : (
          <span className="text-xs text-red-400">ไม่ส่งฟอร์ม</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl text-left" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between p-4 border-b border-white/10">
              <div>
                <h3 className="font-semibold">ตอบคำถามท้ายคลิป</h3>
                <div className="text-sm text-slate-400 mt-0.5">{ownerName || ownerId} · <span className="font-mono">{ownerId}</span></div>
                <div className="flex flex-wrap gap-2 text-xs mt-2">
                  <span className={`px-2 py-0.5 rounded ${qa?.posed ? 'bg-green-900/40 text-green-300' : 'bg-slate-700 text-slate-400'}`}>
                    {qa?.posed ? '✓' : '✗'} ตั้งคำถาม
                  </span>
                  <span className={`px-2 py-0.5 rounded ${qa?.answered ? 'bg-green-900/40 text-green-300' : 'bg-red-900/40 text-red-300'}`}>
                    {qa?.answered ? '✓ ตอบเอง' : 'ไม่ตอบ'}
                  </span>
                  <span className={`px-2 py-0.5 rounded ${scoreColor} bg-slate-800`}>รวม {score}/2</span>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-4 space-y-3">
              {/* คำถามท้ายคลิป */}
              <div>
                <div className="text-xs text-slate-500 mb-0.5 flex items-center justify-between gap-2">
                  <span>คำถามท้ายคลิป (เจ้าของระบุ)</span>
                  {ownerSheetUrl ? (
                    <a href={ownerSheetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 shrink-0">
                      <ExternalLink className="w-3 h-3" /> เปิดชีต (ค้น {ownerId})
                    </a>
                  ) : (
                    qa?.rowNumber != null && <span className="text-slate-500 shrink-0">ไฟล์เจ้าของ แถวที่ {qa.rowNumber}</span>
                  )}
                </div>
                <div className="text-sm text-slate-200 whitespace-pre-wrap break-words bg-slate-800/40 rounded-lg p-2">
                  {qa?.question || <span className="text-slate-500 italic">— ไม่ได้ตั้งคำถาม / ไม่ส่งฟอร์ม —</span>}
                </div>
              </div>

              {/* คำตอบเจ้าของ */}
              {qa && (
                <div>
                  <div className="text-xs text-slate-500 mb-0.5">คำตอบของเจ้าของ</div>
                  <div className="text-sm text-slate-200 whitespace-pre-wrap break-words bg-slate-800/40 rounded-lg p-2">
                    {qa.answered ? qa.ownAnswer : <span className="text-red-300 italic">ไม่ตอบ</span>}
                  </div>
                </div>
              )}

              {/* ผู้รีวิว */}
              <div>
                <div className="text-xs text-slate-500 mb-1">ผู้รีวิวคลิปนี้ ({reviews.length} คน)</div>
                {reviews.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">ยังไม่มีผู้รีวิว</div>
                ) : (
                  <div className="space-y-1">
                    {reviews.map((r, i) => (
                      <div key={i} className="text-xs bg-slate-800/60 rounded p-2">
                        <div className="text-slate-300">{r.reviewerName || '(ไม่ทราบชื่อ)'}</div>
                        <div className="text-slate-400">ถอดคำถาม: {r.transcribedQ || <span className="italic text-slate-500">— ว่าง —</span>}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-white/10 flex justify-end">
              <button onClick={() => setOpen(false)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </>
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

// ClipScoreModal - ให้ TA ดูคะแนนผู้รีวิว + ใส่คะแนนคลิป (คะแนนรูบริค)
function ClipScoreModal({ student, maxScore, canEdit, info, reviewerScores, currentTa, clipLink, onSave, onClose }) {
  const [val, setVal] = useState(currentTa?.taScore != null ? String(currentTa.taScore) : '');
  const [note, setNote] = useState(currentTa?.note || '');
  const [saving, setSaving] = useState(false);

  const doSave = async () => {
    setSaving(true);
    try { await onSave(student.studentId, val, note); onClose(); }
    catch { /* บันทึกไม่สำเร็จ — เปิด modal ค้างไว้ (มี toast แจ้ง error แล้ว) */ }
    finally { setSaving(false); }
  };

  const doClear = async () => {
    setSaving(true);
    try { setVal(''); await onSave(student.studentId, '', note); onClose(); }
    catch { /* toast แจ้ง error แล้ว */ }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2"><Eye className="w-5 h-5 text-purple-300" /> ตรวจคะแนนคลิป</h3>
            <div className="text-sm text-slate-400 mt-1">{student.fullName} · <span className="font-mono">{student.studentId}</span></div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          {/* สถานะ */}
          <div className="bg-slate-800/50 rounded-lg p-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
            <span>คะแนนรูบริค: <span className={`font-semibold ${info.final == null ? 'text-red-400' : info.status === 'auto' ? 'text-green-400' : 'text-purple-300'}`}>{info.final == null ? 'รอ TA' : `${info.final}/${maxScore}`}</span></span>
            <span className="text-slate-400">รีวิว {reviewerScores.length} คน</span>
            {info.status === 'auto' && <span className="text-green-400 text-xs">สอดคล้อง → ใช้ Max อัตโนมัติ</span>}
            {info.needsTA && !info.overMax && <span className="text-amber-300 text-xs">ต้องให้ TA ตรวจ (คะแนนกระจาย/รีวิวไม่ครบ 3)</span>}
          </div>
          {info.overMax && (
            <div className="bg-red-500/15 border border-red-500/40 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
              <span>⚠️</span><span>มีผู้รีวิวให้คะแนนเกินคะแนนเต็ม ({maxScore}) — ต้องให้ TA ตรวจและกรอกคะแนนรูบริคที่ถูกต้อง (ไม่ใช้ Max อัตโนมัติ)</span>
            </div>
          )}

          {/* คะแนนผู้รีวิวรายคน */}
          <div>
            <div className="text-xs text-slate-500 mb-1 flex items-center justify-between">
              <span>คะแนนจากผู้รีวิว</span>
              {clipLink && <a href={clipLink} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5" /> เปิดคลิปใน Canvas</a>}
            </div>
            {reviewerScores.length === 0 ? (
              <div className="text-sm text-slate-500 italic">ไม่มีผู้รีวิว</div>
            ) : (
              <div className="space-y-1">
                {reviewerScores.map((rs, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-slate-800/40 rounded px-3 py-1.5">
                    <span className="text-slate-300">{rs.graderName}</span>
                    <span className={`font-mono font-semibold ${rs.gradeGiven != null && rs.gradeGiven > maxScore ? 'text-red-400' : 'text-cyan-400'}`} title={rs.gradeGiven != null && rs.gradeGiven > maxScore ? `เกินคะแนนเต็ม ${maxScore}` : undefined}>{rs.gradeGiven == null ? '-' : rs.gradeGiven}/{maxScore}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ช่องกรอกคะแนน TA */}
          {canEdit ? (
            <div className="space-y-2">
              <label className="block text-sm text-slate-300">คะแนนของ TA (0–{maxScore}) — ใช้เป็นคะแนนรูบริค</label>
              <input
                type="number" min="0" max={maxScore} step="0.5" value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="ใส่คะแนนหลังดูคลิป"
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
              />
              <input
                type="text" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="โน้ต (ถ้ามี)"
                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
              />
              {currentTa?.updatedByName && (
                <div className="text-xs text-slate-500">
                  ✓ บันทึกล่าสุดโดย {currentTa.updatedByName}
                  {currentTa.updatedAt?.toDate && ` · ${currentTa.updatedAt.toDate().toLocaleString('th-TH')}`}
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-400">เฉพาะ TA/Admin เท่านั้นที่ใส่คะแนนได้</div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          {canEdit && val !== '' && (
            <button onClick={doClear} disabled={saving} className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm disabled:opacity-50">ล้างคะแนน TA</button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">ปิด</button>
          {canEdit && <button onClick={doSave} disabled={saving} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium disabled:opacity-50">{saving ? 'กำลังบันทึก...' : 'บันทึกคะแนน'}</button>}
        </div>
      </div>
    </div>
  );
}

// CanvasExportModal - ตั้งชื่อคอลัมน์ assignment แล้วดาวน์โหลด CSV รูปแบบ Canvas Gradebook Import
function CanvasExportModal({ semesterId, semesterMeta, maxScore, people, onClose }) {
  const LS_KEY = `canvasExportHeaders_${semesterId}`;
  // ปลายทางที่ admin ตั้งไว้ในหน้าจัดการ (A1.1/A1.2/A1.3) มาก่อน localStorage แล้วค่อยว่าง
  const cfg = {
    clip: semesterMeta?.exportClipHeader || '',
    owner: semesterMeta?.exportOwnerHeader || '',
    peer: semesterMeta?.exportPeerHeader || '',
  };
  const [headers, setHeaders] = useState(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { /* ignore */ }
    return {
      clip: cfg.clip || saved?.clip || '',
      owner: cfg.owner || saved?.owner || '',
      peer: cfg.peer || saved?.peer || '',
    };
  });

  const csvEscape = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const download = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(headers)); } catch { /* ignore */ }
    // เลือกเฉพาะคอลัมน์ที่มีชื่อหัว
    const cols = [];
    if (headers.clip.trim()) cols.push({ key: 'clip', header: headers.clip.trim(), pp: maxScore });
    if (headers.owner.trim()) cols.push({ key: 'ownerQa', header: headers.owner.trim(), pp: 2 });
    if (headers.peer.trim()) cols.push({ key: 'peer', header: headers.peer.trim(), pp: 3 });

    const fixed = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section'];
    const headerRow = [...fixed, ...cols.map(c => c.header)];
    const ppRow = ['Points Possible', '', '', '', '', '', ...cols.map(c => c.pp)];
    const dataRows = people.map(p => ([
      p.name, p.canvasUserId ?? '', p.sisId, '', '', '',
      ...cols.map(c => (p[c.key] === '' || p[c.key] == null ? '' : p[c.key])),
    ]));
    const all = [headerRow, ppRow, ...dataRows];
    const csv = all.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `canvas-import-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/15 rounded-2xl w-full max-w-lg shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2"><Download className="w-5 h-5 text-green-400" /> ส่งออกเข้า Canvas</h3>
            <p className="text-sm text-slate-400 mt-1">ตั้งชื่อคอลัมน์ assignment ให้ตรงกับ Canvas ({people.length} คน)</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm text-purple-300 mb-1">คอลัมน์คะแนนคลิป (เต็ม {maxScore})</label>
            <input value={headers.clip} onChange={(e) => setHeaders(h => ({ ...h, clip: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm" />
            <p className="text-xs text-slate-500 mt-1">ใส่ "ชื่อ (id)" = อัปเดต assignment เดิม · ใส่ชื่อเปล่า = สร้างใหม่</p>
          </div>
          <div>
            <label className="block text-sm text-amber-400 mb-1">คอลัมน์ Q&amp;A เจ้าของ (เต็ม 2)</label>
            <input value={headers.owner} onChange={(e) => setHeaders(h => ({ ...h, owner: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm" />
          </div>
          <div>
            <label className="block text-sm text-amber-400 mb-1">คอลัมน์ Peer Review (เต็ม 3)</label>
            <input value={headers.peer} onChange={(e) => setHeaders(h => ({ ...h, peer: e.target.value }))} className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm" />
          </div>
          <div className="bg-slate-800/50 rounded-lg p-3 text-xs text-slate-400">
            รูปแบบ: หัวตาราง Canvas (Student, ID, SIS User ID, …) + แถว Points Possible + 1 แถว/คน ·
            Canvas จับคู่นักศึกษาด้วย ID/SIS User ID · เว้นชื่อคอลัมน์ว่างไว้ถ้าไม่ต้องการส่งคะแนนนั้น
          </div>
        </div>

        <div className="p-4 border-t border-white/10 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">ยกเลิก</button>
          <button onClick={download} className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium flex items-center gap-2"><Download className="w-4 h-4" /> ดาวน์โหลด CSV</button>
        </div>
      </div>
    </div>
  );
}
