// src/components/AdminPanel.jsx
import React, { useState, useEffect, useCallback } from 'react';
import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  setDoc,
  query, 
  where,
  serverTimestamp,
  getDoc
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, secondaryAuth } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { parseCSV } from '../utils/csvParser';
import { fetchCourses, fetchAssignments, fetchPeerReviewData, DEFAULT_CANVAS_URL } from '../utils/canvasApi';
import ConfirmModal from './ConfirmModal';
import Papa from 'papaparse';
import { Upload, Users, UserPlus, Settings, Trash2, Edit, Save, X, ChevronRight, CheckCircle2, AlertTriangle, Eye, EyeOff, Mail, Lock, Key, Cloud, Download, RefreshCw } from 'lucide-react';

export default function AdminPanel({ onViewData }) {
  const { currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('semesters');
  
  // Semesters state
  const [semesters, setSemesters] = useState([]);
  const [loadingSemesters, setLoadingSemesters] = useState(true);
  const [newSemester, setNewSemester] = useState({ name: '', courseCode: '', courseName: '' });
  
  // TAs state
  const [tas, setTAs] = useState([]);
  const [loadingTAs, setLoadingTAs] = useState(true);
  const [newTA, setNewTA] = useState({ 
    email: '', 
    password: '', 
    displayName: '',
    assignedGroups: '', 
    canViewAll: false,
    role: 'ta',
    authType: 'email' // 'email' หรือ 'google'
  });
  const [showPassword, setShowPassword] = useState(false);
  const [selectedSemester, setSelectedSemester] = useState('');
  
  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  // Available groups (from uploaded data)
  const [availableGroups, setAvailableGroups] = useState([]);

  // ===== Canvas direct-fetch state =====
  const [peerReviewMode, setPeerReviewMode] = useState('canvas'); // 'canvas' | 'csv'
  const [canvasUrl, setCanvasUrl] = useState(DEFAULT_CANVAS_URL);
  const [canvasApiKey, setCanvasApiKey] = useState('');
  const [savedCanvasConfig, setSavedCanvasConfig] = useState(false);
  const [showCanvasKey, setShowCanvasKey] = useState(false);
  const [canvasCourses, setCanvasCourses] = useState([]);
  const [canvasAssignments, setCanvasAssignments] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [canvasLoading, setCanvasLoading] = useState('');   // '' | 'courses' | 'assignments' | 'fetch' | 'save'
  const [canvasPreview, setCanvasPreview] = useState(null); // ผลจาก fetchPeerReviewData ก่อนบันทึก

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  // Fetch semesters
  const fetchSemesters = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'semesters'));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // เรียงรายการที่สร้าง/ดึงล่าสุดไว้บนสุด (ตาม createdAt; ถ้าไม่มีค่อย fallback เป็น id)
      const ts = (x) => (x.createdAt?.seconds ?? x.createdAt?._seconds ?? 0);
      setSemesters(data.sort((a, b) => (ts(b) - ts(a)) || b.id.localeCompare(a.id)));
      
      if (data.length > 0 && !selectedSemester) {
        setSelectedSemester(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching semesters:', error);
    } finally {
      setLoadingSemesters(false);
    }
  }, [selectedSemester]);

  // Fetch TAs for selected semester
  const fetchTAs = useCallback(async () => {
    if (!selectedSemester) {
      setTAs([]);
      setLoadingTAs(false);
      return;
    }
    
    try {
      const q = query(
        collection(db, 'taAssignments'),
        where('semesterId', '==', selectedSemester)
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTAs(data);
    } catch (error) {
      console.error('Error fetching TAs:', error);
    } finally {
      setLoadingTAs(false);
    }
  }, [selectedSemester]);

  // Fetch available groups from semester data
  const fetchAvailableGroups = useCallback(async () => {
    if (!selectedSemester) return;
    
    try {
      const studentDataRef = doc(db, 'semesters', selectedSemester, 'studentData', 'main');
      const studentDataSnap = await getDoc(studentDataRef);
      
      if (studentDataSnap.exists()) {
        const data = studentDataSnap.data();
        if (data.groupSets && data.groupSets.length > 0) {
          // Get unique groups from the first group set
          const groups = data.groups || {};
          const uniqueGroups = [...new Set(Object.values(groups).map(g => g[data.groupSets[0]]).filter(Boolean))];
          setAvailableGroups(uniqueGroups.sort());
        }
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
  }, [selectedSemester]);

  useEffect(() => {
    fetchSemesters();
  }, [fetchSemesters]);

  useEffect(() => {
    fetchTAs();
    fetchAvailableGroups();
  }, [fetchTAs, fetchAvailableGroups]);

  // Create new semester
  const handleCreateSemester = async () => {
    if (!newSemester.name) return;
    
    try {
      const semesterId = newSemester.name.replace(/\//g, '-').replace(/\s+/g, '');
      await setDoc(doc(db, 'semesters', semesterId), {
        name: newSemester.name,
        courseCode: newSemester.courseCode,
        courseName: newSemester.courseName,
        createdAt: serverTimestamp(),
        createdBy: currentUser.uid
      });
      
      setNewSemester({ name: '', courseCode: '', courseName: '' });
      fetchSemesters();
    } catch (error) {
      console.error('Error creating semester:', error);
    }
  };

  // Delete semester
  const handleDeleteSemester = (semesterId) => {
    setConfirmModal({
      isOpen: true,
      title: 'ลบเทอม',
      message: 'ต้องการลบเทอมนี้หรือไม่? ข้อมูลทั้งหมดจะถูกลบและไม่สามารถกู้คืนได้',
      type: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'semesters', semesterId));
          fetchSemesters();
          if (selectedSemester === semesterId) {
            setSelectedSemester('');
          }
          setUploadSuccess('ลบเทอมสำเร็จ');
        } catch (error) {
          console.error('Error deleting semester:', error);
          setUploadError('เกิดข้อผิดพลาดในการลบเทอม');
        }
      }
    });
  };

  // Upload Peer Review CSV
  // บันทึกผลวิเคราะห์ลง Firestore แบบ chunk — ใช้ร่วมทั้งเส้นทาง CSV และ Canvas
  const savePeerReviewResult = async (result, semesterId, sourceName) => {
    // แบ่งข้อมูลออกเป็น chunks เพื่อหลีกเลี่ยง Firestore 1MB limit
    const CHUNK_SIZE = 100; // จำนวน students/graders ต่อ chunk

    // 1. Save metadata และ stats
    const metaRef = doc(db, 'semesters', semesterId, 'peerReviewData', 'meta');
    await setDoc(metaRef, {
      stats: result.stats,
      uploadedAt: serverTimestamp(),
      uploadedBy: currentUser.uid,
      fileName: sourceName,
      totalStudents: Object.keys(result.students).length,
      totalGraders: Object.keys(result.graders).length
    });

    // 2. Save students in chunks
    const studentEntries = Object.entries(result.students);
    for (let i = 0; i < studentEntries.length; i += CHUNK_SIZE) {
      const chunk = studentEntries.slice(i, i + CHUNK_SIZE);
      const chunkObj = Object.fromEntries(chunk);
      const chunkRef = doc(db, 'semesters', semesterId, 'peerReviewData', `students_${Math.floor(i/CHUNK_SIZE)}`);
      await setDoc(chunkRef, { data: chunkObj, chunkIndex: Math.floor(i/CHUNK_SIZE) });
    }

    // 3. Save graders in chunks
    const graderEntries = Object.entries(result.graders);
    for (let i = 0; i < graderEntries.length; i += CHUNK_SIZE) {
      const chunk = graderEntries.slice(i, i + CHUNK_SIZE);
      const chunkObj = Object.fromEntries(chunk);
      const chunkRef = doc(db, 'semesters', semesterId, 'peerReviewData', `graders_${Math.floor(i/CHUNK_SIZE)}`);
      await setDoc(chunkRef, { data: chunkObj, chunkIndex: Math.floor(i/CHUNK_SIZE) });
    }

    // 4. Save reviews in chunks (reviews อาจใหญ่มาก)
    const reviewChunkSize = 200;
    for (let i = 0; i < result.reviews.length; i += reviewChunkSize) {
      const chunk = result.reviews.slice(i, i + reviewChunkSize);
      const chunkRef = doc(db, 'semesters', semesterId, 'peerReviewData', `reviews_${Math.floor(i/reviewChunkSize)}`);
      await setDoc(chunkRef, { data: chunk, chunkIndex: Math.floor(i/reviewChunkSize) });
    }
  };

  const handlePeerReviewUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSemester) return;

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const result = await parseCSV(file);
      await savePeerReviewResult(result, selectedSemester, file.name);
      setUploadSuccess(`อัปโหลดข้อมูล Peer Review สำเร็จ! (${Object.keys(result.students).length} นักศึกษา, ${Object.keys(result.graders).length} graders)`);
    } catch (error) {
      console.error('Upload error:', error);
      setUploadError(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  // ===== Canvas: โหลด config ที่เคยบันทึกไว้ (ต่อ user) =====
  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const cfgSnap = await getDoc(doc(db, 'canvasConfigs', currentUser.uid));
        if (cfgSnap.exists()) {
          const cfg = cfgSnap.data();
          if (cfg.canvasUrl) setCanvasUrl(cfg.canvasUrl);
          if (cfg.canvasApiKey) {
            setCanvasApiKey(cfg.canvasApiKey);
            setSavedCanvasConfig(true);
          }
        }
      } catch (err) {
        console.error('โหลด Canvas config ไม่สำเร็จ:', err);
      }
    })();
  }, [currentUser]);

  const canvasConfig = () => ({
    apiKey: canvasApiKey.trim(),
    canvasUrl: (canvasUrl || DEFAULT_CANVAS_URL).trim().replace(/\/+$/, ''),
  });

  const handleSaveCanvasConfig = async () => {
    if (!canvasApiKey.trim() || !canvasUrl.trim()) {
      setUploadError('กรุณากรอก Canvas URL และ Access Token');
      return;
    }
    setUploadError(null);
    try {
      await setDoc(doc(db, 'canvasConfigs', currentUser.uid), {
        canvasUrl: canvasUrl.trim().replace(/\/+$/, ''),
        canvasApiKey: canvasApiKey.trim(),
        updatedAt: serverTimestamp(),
      });
      setSavedCanvasConfig(true);
      setUploadSuccess('บันทึกการตั้งค่า Canvas แล้ว');
    } catch (err) {
      setUploadError(`บันทึก config ไม่สำเร็จ: ${err.message}`);
    }
  };

  const handleLoadCourses = async () => {
    setUploadError(null);
    setCanvasLoading('courses');
    try {
      const courses = await fetchCourses(canvasConfig());
      setCanvasCourses(courses);
      if (courses.length === 0) setUploadError('ไม่พบวิชาที่คุณเป็นผู้สอน (ตรวจ token/สิทธิ์)');
    } catch (err) {
      setUploadError(`ดึงรายวิชาไม่สำเร็จ: ${err.message}`);
    } finally {
      setCanvasLoading('');
    }
  };

  const handleSelectCourse = async (courseId) => {
    setSelectedCourseId(courseId);
    setSelectedAssignmentId('');
    setCanvasAssignments([]);
    setCanvasPreview(null);
    if (!courseId) return;
    setUploadError(null);
    setCanvasLoading('assignments');
    try {
      const assignments = await fetchAssignments(canvasConfig(), courseId);
      setCanvasAssignments(assignments);
    } catch (err) {
      setUploadError(`ดึง assignment ไม่สำเร็จ: ${err.message}`);
    } finally {
      setCanvasLoading('');
    }
  };

  const handleCanvasFetch = async () => {
    if (!selectedCourseId || !selectedAssignmentId) {
      setUploadError('กรุณาเลือกวิชาและ assignment');
      return;
    }
    setUploadError(null);
    setUploadSuccess(null);
    setCanvasPreview(null);
    setCanvasLoading('fetch');
    try {
      const result = await fetchPeerReviewData(canvasConfig(), selectedCourseId, selectedAssignmentId);
      setCanvasPreview(result);
    } catch (err) {
      console.error('Canvas fetch error:', err);
      setUploadError(`ดึงข้อมูลจาก Canvas ไม่สำเร็จ: ${err.message}`);
    } finally {
      setCanvasLoading('');
    }
  };

  const handleCanvasSave = async () => {
    if (!canvasPreview) {
      setUploadError('กรุณาดึงข้อมูลก่อนบันทึก');
      return;
    }
    setUploadError(null);
    setCanvasLoading('save');
    try {
      const meta = canvasPreview.meta || {};
      const course = canvasCourses.find(c => String(c.id) === String(selectedCourseId));
      const courseName = course ? course.name : `Course ${selectedCourseId}`;
      const assignment = canvasAssignments.find(a => String(a.id) === String(selectedAssignmentId));
      const assignmentName = meta.assignmentName || (assignment ? assignment.name : `Assignment ${selectedAssignmentId}`);

      // สร้าง/อัปเดตรายการอัตโนมัติจาก Canvas — 1 assignment = 1 รายการ
      // id คงที่ตาม course+assignment เพื่อให้ดึงซ้ำแล้วเขียนทับรายการเดิม (ไม่สร้างซ้ำ)
      const semesterId = `canvas_${selectedCourseId}_${selectedAssignmentId}`;
      const semesterName = `${courseName} · ${assignmentName}`;

      await setDoc(doc(db, 'semesters', semesterId), {
        name: semesterName,
        courseCode: '',
        courseName,
        assignmentName,
        source: 'canvas',
        canvasCourseId: String(selectedCourseId),
        canvasAssignmentId: String(selectedAssignmentId),
        maxScore: meta.maxScore ?? null,
        createdAt: serverTimestamp(),
      }, { merge: true });

      await savePeerReviewResult(canvasPreview, semesterId, `Canvas: ${assignmentName}`);

      await fetchSemesters();
      setSelectedSemester(semesterId);
      setUploadSuccess(`บันทึกจาก Canvas สำเร็จ! สร้างรายการ "${semesterName}" (${Object.keys(canvasPreview.students).length} นักศึกษา, ${Object.keys(canvasPreview.graders).length} graders)`);
      setCanvasPreview(null);
    } catch (err) {
      setUploadError(`บันทึกไม่สำเร็จ: ${err.message}`);
    } finally {
      setCanvasLoading('');
    }
  };

  // Upload Student/Group CSV
  const handleStudentDataUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedSemester) return;
    
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const headers = Object.keys(results.data[0] || {});
          const fixedColumns = ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Integration ID', 'Section'];
          const groupSetColumns = headers.filter(h => !fixedColumns.includes(h) && h.trim() !== '');
          
          const groups = {};
          results.data.forEach(row => {
            const studentId = row['SIS User ID'] || row['ID'] || '';
            if (!studentId) return;
            
            groups[studentId] = {
              studentName: row['Student'] || '',
              section: row['Section'] || ''
            };
            
            groupSetColumns.forEach(gs => {
              groups[studentId][gs] = row[gs] || '';
            });
          });
          
          // Save to Firestore
          const dataRef = doc(db, 'semesters', selectedSemester, 'studentData', 'main');
          await setDoc(dataRef, {
            groups: groups,
            groupSets: groupSetColumns,
            uploadedAt: serverTimestamp(),
            uploadedBy: currentUser.uid,
            fileName: file.name
          });
          
          setUploadSuccess('อัปโหลดข้อมูลนักศึกษาสำเร็จ!');
          fetchAvailableGroups();
        } catch (error) {
          console.error('Upload error:', error);
          setUploadError(`เกิดข้อผิดพลาด: ${error.message}`);
        } finally {
          setUploading(false);
        }
      },
      error: (err) => {
        setUploadError(`เกิดข้อผิดพลาด: ${err.message}`);
        setUploading(false);
      }
    });
    
    event.target.value = '';
  };

  // Add TA
  const handleAddTA = async () => {
    if (!newTA.email || !selectedSemester) {
      setUploadError('กรุณากรอกอีเมลและเลือกเทอม');
      return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newTA.email)) {
      setUploadError('รูปแบบอีเมลไม่ถูกต้อง');
      return;
    }
    
    // Debug: แสดง authType ที่เลือก
    console.log('=== Creating User ===');
    console.log('Auth Type:', newTA.authType);
    console.log('Email:', newTA.email);
    console.log('Password length:', newTA.password?.length || 0);
    
    // For email auth, password is required
    if (newTA.authType === 'email') {
      if (!newTA.password || newTA.password.length < 6) {
        setUploadError('กรุณากรอกรหัสผ่าน (อย่างน้อย 6 ตัวอักษร) สำหรับ Email/Password Login');
        return;
      }
    }
    
    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);
    
    try {
      let userId = null;
      let userCreatedInAuth = false;
      
      // Check if user already exists in Firestore
      const usersQuery = query(collection(db, 'users'), where('email', '==', newTA.email));
      const usersSnapshot = await getDocs(usersQuery);
      
      if (!usersSnapshot.empty) {
        // User exists - update role
        userId = usersSnapshot.docs[0].id;
        const existingUserData = usersSnapshot.docs[0].data();
        console.log('User already exists in Firestore:', userId, existingUserData);
        
        if (existingUserData.role === 'pending') {
          await updateDoc(doc(db, 'users', userId), { role: newTA.role });
        }
        
        // ตรวจสอบว่ามีใน Firebase Auth หรือไม่
        if (!existingUserData.authProvider) {
          setUploadError('พบ user นี้ใน Firestore แต่ไม่มีข้อมูล authProvider กรุณาลบ user นี้ใน Firestore แล้วสร้างใหม่');
          setUploading(false);
          return;
        }
      } else if (newTA.authType === 'email') {
        // Create new user with Email/Password
        console.log('Creating user with EMAIL/PASSWORD...');
        
        try {
          const userCredential = await createUserWithEmailAndPassword(
            secondaryAuth, 
            newTA.email, 
            newTA.password
          );
          userId = userCredential.user.uid;
          userCreatedInAuth = true;
          console.log('✅ User created in Firebase Auth:', userId);
          
          // Sign out from secondary auth immediately
          await signOut(secondaryAuth);
          
          // Create user document in Firestore with same UID
          await setDoc(doc(db, 'users', userId), {
            email: newTA.email,
            displayName: newTA.displayName || newTA.email.split('@')[0],
            role: newTA.role,
            authProvider: 'email',
            passwordChanged: false,
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid
          });
          console.log('✅ User document created in Firestore with UID:', userId);
          
        } catch (authError) {
          console.error('❌ Firebase Auth Error:', authError.code, authError.message);
          
          let errorMsg = '';
          switch (authError.code) {
            case 'auth/email-already-in-use':
              errorMsg = 'อีเมลนี้มีบัญชีอยู่แล้วใน Firebase Auth (อาจใช้ Google Login หรือสร้างไว้แล้ว)';
              break;
            case 'auth/weak-password':
              errorMsg = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
              break;
            case 'auth/invalid-email':
              errorMsg = 'รูปแบบอีเมลไม่ถูกต้องสำหรับ Firebase Auth';
              break;
            case 'auth/operation-not-allowed':
              errorMsg = '❌ Email/Password sign-in ยังไม่ได้เปิดใช้งานใน Firebase Console! กรุณาไปเปิดที่ Authentication > Sign-in method > Email/Password';
              break;
            case 'auth/network-request-failed':
              errorMsg = 'เครือข่ายมีปัญหา กรุณาลองใหม่';
              break;
            default:
              errorMsg = `Firebase Auth Error: ${authError.code} - ${authError.message}`;
          }
          
          setUploadError(errorMsg);
          setUploading(false);
          return; // ❌ หยุดทำงาน ไม่สร้าง Firestore document
        }
      } else {
        // Google auth - สร้าง document ใน Firestore เท่านั้น (user จะถูกสร้างเมื่อ login ด้วย Google)
        console.log('Creating user for GOOGLE auth (no Firebase Auth user created)...');
        
        // Generate a temporary ID for the user document
        const tempUserRef = doc(collection(db, 'users'));
        userId = tempUserRef.id;
        
        await setDoc(tempUserRef, {
          email: newTA.email,
          displayName: newTA.displayName || newTA.email.split('@')[0],
          role: newTA.role,
          authProvider: 'google',
          createdAt: serverTimestamp(),
          createdBy: currentUser.uid
        });
        console.log('✅ User document created for Google auth:', userId);
      }
      
      // Verify userId exists before creating TA assignment
      if (!userId) {
        throw new Error('ไม่สามารถสร้าง User ID ได้');
      }
      
      // Create TA assignment
      const assignedGroups = newTA.assignedGroups
        .split(',')
        .map(g => g.trim())
        .filter(g => g);
      
      await addDoc(collection(db, 'taAssignments'), {
        odcId: userId,
        email: newTA.email,
        semesterId: selectedSemester,
        assignedGroups: assignedGroups,
        canViewAll: newTA.canViewAll,
        createdAt: serverTimestamp()
      });
      console.log('TA assignment created');
      
      // เก็บค่าก่อน reset
      const createdEmail = newTA.email;
      const createdPassword = newTA.password;
      const createdRole = newTA.role;
      const createdAuthType = newTA.authType;
      
      setNewTA({ 
        email: '', 
        password: '', 
        displayName: '',
        assignedGroups: '', 
        canViewAll: false,
        role: 'ta',
        authType: 'email'
      });
      fetchTAs();
      
      // แสดงข้อมูลสำหรับ copy ไปบอก TA
      if (createdAuthType === 'email') {
        setUploadSuccess(
          `✅ เพิ่ม ${createdRole === 'admin' ? 'Admin' : 'TA'} สำเร็จ!\n\n` +
          `📧 Email: ${createdEmail}\n` +
          `🔑 Password: ${createdPassword}\n\n` +
          `กรุณาแจ้งข้อมูลนี้ให้ผู้ใช้`
        );
      } else {
        setUploadSuccess(`✅ เพิ่ม ${createdRole === 'admin' ? 'Admin' : 'TA'} สำเร็จ! (ใช้ Google Login กับ ${createdEmail})`);
      };
    } catch (error) {
      console.error('Error adding TA:', error);
      setUploadError(`เกิดข้อผิดพลาด: ${error.message}`);
    } finally {
      setUploading(false);
    }
  };

  // Update TA
  const handleUpdateTA = async (taId, updates) => {
    try {
      await updateDoc(doc(db, 'taAssignments', taId), updates);
      fetchTAs();
    } catch (error) {
      console.error('Error updating TA:', error);
    }
  };

  // Delete TA assignment
  const handleDeleteTA = (taId, taEmail) => {
    setConfirmModal({
      isOpen: true,
      title: 'ลบผู้ใช้งาน',
      message: `ต้องการลบ ${taEmail || 'ผู้ใช้นี้'} ออกจากเทอมนี้หรือไม่?`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'taAssignments', taId));
          fetchTAs();
          setUploadSuccess('ลบผู้ใช้สำเร็จ');
        } catch (error) {
          console.error('Error deleting TA:', error);
          setUploadError('เกิดข้อผิดพลาดในการลบผู้ใช้');
        }
      }
    });
  };

  // Close confirm modal
  const closeConfirmModal = () => {
    setConfirmModal(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-2 bg-slate-900/50 p-1 rounded-xl border border-white/10">
        {[
          { id: 'semesters', label: 'จัดการเทอม', icon: Settings },
          { id: 'upload', label: 'อัปโหลดข้อมูล', icon: Upload },
          { id: 'tas', label: 'จัดการ TA', icon: Users },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg transition flex-1 justify-center ${
              activeTab === tab.id
                ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 text-white border border-white/10'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <tab.icon className="w-5 h-5" /> {tab.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      {uploadError && (
        <div className="bg-red-900/30 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
          <span className="text-red-300">{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="ml-auto text-red-400 hover:text-red-300">×</button>
        </div>
      )}
      
      {uploadSuccess && (
        <div className="bg-green-900/30 border border-green-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <pre className="text-green-300 whitespace-pre-wrap font-sans text-sm">{uploadSuccess}</pre>
              {uploadSuccess.includes('Password:') && (
                <button
                  onClick={() => {
                    // Extract credentials from message
                    const emailMatch = uploadSuccess.match(/Email: (.+)/);
                    const passMatch = uploadSuccess.match(/Password: (.+)/);
                    if (emailMatch && passMatch) {
                      const text = `Email: ${emailMatch[1].trim()}\nPassword: ${passMatch[1].trim()}`;
                      navigator.clipboard.writeText(text);
                      alert('คัดลอกข้อมูลแล้ว!');
                    }
                  }}
                  className="mt-3 px-3 py-1.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm flex items-center gap-2"
                >
                  📋 Copy ข้อมูล Login
                </button>
              )}
            </div>
            <button onClick={() => setUploadSuccess(null)} className="text-green-400 hover:text-green-300">×</button>
          </div>
        </div>
      )}

      {/* Semesters Tab */}
      {activeTab === 'semesters' && (
        <div className="space-y-6">
          {/* Create new semester */}
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">สร้างเทอมใหม่</h3>
            <div className="grid md:grid-cols-4 gap-4">
              <input
                type="text"
                placeholder="ชื่อเทอม (เช่น 1/2567)"
                value={newSemester.name}
                onChange={(e) => setNewSemester({ ...newSemester, name: e.target.value })}
                className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
              />
              <input
                type="text"
                placeholder="รหัสวิชา"
                value={newSemester.courseCode}
                onChange={(e) => setNewSemester({ ...newSemester, courseCode: e.target.value })}
                className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
              />
              <input
                type="text"
                placeholder="ชื่อวิชา"
                value={newSemester.courseName}
                onChange={(e) => setNewSemester({ ...newSemester, courseName: e.target.value })}
                className="px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
              />
              <button
                onClick={handleCreateSemester}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium"
              >
                สร้างเทอม
              </button>
            </div>
          </div>

          {/* Semester list */}
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">รายการเทอม</h3>
            {loadingSemesters ? (
              <p className="text-slate-400">กำลังโหลด...</p>
            ) : semesters.length === 0 ? (
              <p className="text-slate-400">ยังไม่มีเทอม</p>
            ) : (
              <div className="space-y-3">
                {semesters.map(sem => (
                  <div key={sem.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-4">
                    <div>
                      <div className="font-medium">{sem.name}</div>
                      <div className="text-sm text-slate-400">
                        {sem.courseCode} - {sem.courseName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setSelectedSemester(sem.id);
                          onViewData(sem.id);
                        }}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 rounded text-sm"
                      >
                        ดูข้อมูล
                      </button>
                      <button
                        onClick={() => handleDeleteSemester(sem.id)}
                        className="p-2 text-red-400 hover:bg-red-900/30 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="space-y-6">
          {/* Select semester */}
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">เลือกเทอมที่จะอัปโหลด</h3>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-white"
            >
              <option value="">-- เลือกเทอม --</option>
              {semesters.map(sem => (
                <option key={sem.id} value={sem.id}>
                  {sem.name} - {sem.courseCode} {sem.courseName}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-6">
              {/* ===== Peer Review: ดึงจาก Canvas โดยตรง / อัปโหลด CSV ===== */}
              {/* การ์ดนี้แสดงเสมอ: โหมด Canvas สร้างรายการให้อัตโนมัติ (ไม่ต้องเลือกเทอมก่อน) */}
              <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-purple-600 rounded-xl flex items-center justify-center">
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">ข้อมูล Peer Review</h3>
                    <p className="text-slate-400 text-sm">ดึงจาก Canvas โดยตรง (สร้างรายการอัตโนมัติ) หรืออัปโหลดไฟล์ CSV</p>
                  </div>
                </div>

                {/* Mode toggle */}
                <div className="inline-flex bg-slate-800 rounded-lg p-1 mb-5">
                  <button
                    onClick={() => setPeerReviewMode('canvas')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${peerReviewMode === 'canvas' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    ดึงจาก Canvas
                  </button>
                  <button
                    onClick={() => setPeerReviewMode('csv')}
                    className={`px-4 py-2 rounded-md text-sm font-medium ${peerReviewMode === 'csv' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}`}
                  >
                    อัปโหลด CSV
                  </button>
                </div>

                {peerReviewMode === 'canvas' && (
                  <div className="space-y-5">
                    {/* 1) ตั้งค่า Canvas */}
                    <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Key className="w-4 h-4 text-cyan-400" /> ตั้งค่า Canvas
                        </span>
                        {savedCanvasConfig && (
                          <span className="text-xs text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4" /> บันทึกแล้ว
                          </span>
                        )}
                      </div>
                      <label className="block text-xs text-slate-400 mb-1">Canvas URL</label>
                      <input
                        type="text"
                        value={canvasUrl}
                        onChange={(e) => setCanvasUrl(e.target.value)}
                        placeholder={DEFAULT_CANVAS_URL}
                        className="w-full px-3 py-2 mb-3 bg-slate-900 border border-white/10 rounded-lg text-white text-sm"
                      />
                      <label className="block text-xs text-slate-400 mb-1">Access Token</label>
                      <div className="relative mb-2">
                        <input
                          type={showCanvasKey ? 'text' : 'password'}
                          value={canvasApiKey}
                          onChange={(e) => setCanvasApiKey(e.target.value)}
                          placeholder="วาง Canvas Access Token ที่นี่"
                          className="w-full px-3 py-2 pr-10 bg-slate-900 border border-white/10 rounded-lg text-white text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => setShowCanvasKey(!showCanvasKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showCanvasKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <a
                          href={`${(canvasUrl || DEFAULT_CANVAS_URL).replace(/\/+$/, '')}/profile/settings`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-cyan-400 hover:text-cyan-300"
                        >
                          🔑 สร้าง Access Token (Account &gt; Settings)
                        </a>
                        <button
                          onClick={handleSaveCanvasConfig}
                          className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs flex items-center gap-1"
                        >
                          <Save className="w-3 h-3" /> บันทึก
                        </button>
                      </div>
                    </div>

                    {/* 2) เลือกวิชา + assignment */}
                    <div>
                      <button
                        onClick={handleLoadCourses}
                        disabled={canvasLoading === 'courses' || !canvasApiKey.trim()}
                        className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50 mb-3"
                      >
                        <RefreshCw className={`w-4 h-4 ${canvasLoading === 'courses' ? 'animate-spin' : ''}`} />
                        {canvasCourses.length ? 'โหลดรายวิชาอีกครั้ง' : 'โหลดรายวิชา'}
                      </button>

                      {canvasCourses.length > 0 && (
                        <div className="grid md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">วิชา</label>
                            <select
                              value={selectedCourseId}
                              onChange={(e) => handleSelectCourse(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm"
                            >
                              <option value="">-- เลือกวิชา --</option>
                              {canvasCourses.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-slate-400 mb-1">
                              Assignment {canvasLoading === 'assignments' && '(กำลังโหลด...)'}
                            </label>
                            <select
                              value={selectedAssignmentId}
                              onChange={(e) => { setSelectedAssignmentId(e.target.value); setCanvasPreview(null); }}
                              disabled={!selectedCourseId || canvasLoading === 'assignments'}
                              className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white text-sm disabled:opacity-50"
                            >
                              <option value="">-- เลือก assignment --</option>
                              {canvasAssignments.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.name}{a.hasRubric ? '' : ' (ไม่มี rubric)'}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 3) ดึงข้อมูล */}
                    {selectedAssignmentId && (
                      <button
                        onClick={handleCanvasFetch}
                        disabled={canvasLoading === 'fetch'}
                        className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                      >
                        <Download className={`w-4 h-4 ${canvasLoading === 'fetch' ? 'animate-pulse' : ''}`} />
                        {canvasLoading === 'fetch' ? 'กำลังดึงข้อมูลจาก Canvas...' : 'ดึงข้อมูล Peer Review'}
                      </button>
                    )}

                    {/* 4) Preview + บันทึก */}
                    {canvasPreview && (
                      <div className="bg-slate-800/50 border border-cyan-500/30 rounded-xl p-4">
                        <p className="text-sm font-medium mb-1 text-cyan-300">
                          ผลที่ดึงมา (ยังไม่บันทึก){canvasPreview.meta?.assignmentName ? ` — ${canvasPreview.meta.assignmentName}` : ''}
                        </p>
                        {canvasPreview.meta?.maxScore != null && (
                          <p className="text-xs text-slate-400 mb-3">คะแนนเต็มงาน: {canvasPreview.meta.maxScore}</p>
                        )}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-3">
                          <div><span className="text-slate-400">นักศึกษา:</span> {Object.keys(canvasPreview.students).length}</div>
                          <div><span className="text-slate-400">Graders:</span> {Object.keys(canvasPreview.graders).length}</div>
                          <div><span className="text-slate-400">Reviews:</span> {canvasPreview.stats.totalReviews}</div>
                          <div><span className="text-slate-400">ทำเสร็จ:</span> {canvasPreview.stats.completedReviews}</div>
                        </div>
                        {/* เตือนเรื่องได้รับงานไม่ครบ 3 / ส่ง late */}
                        {(canvasPreview.stats.gradersNotAssigned3Count > 0 || canvasPreview.stats.lateStudentsCount > 0) && (
                          <div className="text-xs space-y-1 mb-3">
                            {canvasPreview.stats.gradersNotAssigned3Count > 0 && (
                              <p className="text-amber-400">⚠️ ได้รับงานรีวิวไม่ครบ 3: {canvasPreview.stats.gradersNotAssigned3Count} คน</p>
                            )}
                            {canvasPreview.stats.lateStudentsCount > 0 && (
                              <p className="text-amber-400">⏰ ส่งงาน late: {canvasPreview.stats.lateStudentsCount} คน</p>
                            )}
                          </div>
                        )}
                        <button
                          onClick={handleCanvasSave}
                          disabled={canvasLoading === 'save'}
                          className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50"
                        >
                          <Save className="w-4 h-4" />
                          {canvasLoading === 'save' ? 'กำลังบันทึก...' : 'บันทึก (สร้างรายการอัตโนมัติ)'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {peerReviewMode === 'csv' && (
                  !selectedSemester ? (
                    <p className="text-amber-400 text-sm">⚠️ โหมด CSV ต้อง "เลือกเทอม" ด้านล่างก่อน (โหมดดึงจาก Canvas สร้างรายการให้อัตโนมัติ)</p>
                  ) : (
                    <label className="cursor-pointer block max-w-md">
                      <input
                        type="file"
                        accept=".csv"
                        onChange={handlePeerReviewUpload}
                        className="hidden"
                        disabled={uploading}
                      />
                      <div className={`px-4 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-center ${uploading ? 'opacity-50' : ''}`}>
                        {uploading ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ Peer Review (CSV)'}
                      </div>
                    </label>
                  )
                )}
              </div>

              {/* Student Data Upload — ยังใช้ระบบเลือกเทอมเดิม */}
              {selectedSemester && (
              <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6 max-w-md">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-teal-600 rounded-xl flex items-center justify-center mb-4">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold mb-2">อัปโหลดข้อมูลนักศึกษา</h3>
                <p className="text-slate-400 text-sm mb-4">ไฟล์ CSV ที่มีข้อมูล Group</p>

                {/* Link to Group Exporter */}
                <a
                  href="https://canvas-group-exporter.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 text-sm mb-4"
                >
                  🔗 สร้างไฟล์จาก Canvas Group Exporter
                </a>

                <label className="cursor-pointer block">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleStudentDataUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <div className={`px-4 py-3 bg-green-600 hover:bg-green-500 rounded-lg text-center ${uploading ? 'opacity-50' : ''}`}>
                    {uploading ? 'กำลังอัปโหลด...' : 'เลือกไฟล์ข้อมูลนักศึกษา'}
                  </div>
                </label>
              </div>
              )}
          </div>
        </div>
      )}

      {/* TAs Tab */}
      {activeTab === 'tas' && (
        <div className="space-y-6">
          {/* Select semester */}
          <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
            <h3 className="text-lg font-semibold mb-4">เลือกเทอม</h3>
            <select
              value={selectedSemester}
              onChange={(e) => setSelectedSemester(e.target.value)}
              className="w-full px-4 py-3 bg-slate-800 border border-white/10 rounded-lg text-white"
            >
              <option value="">-- เลือกเทอม --</option>
              {semesters.map(sem => (
                <option key={sem.id} value={sem.id}>
                  {sem.name} - {sem.courseCode} {sem.courseName}
                </option>
              ))}
            </select>
          </div>

          {selectedSemester && (
            <>
              {/* Add TA/Admin */}
              <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <UserPlus className="w-5 h-5" /> เพิ่มผู้ใช้งาน
                </h3>
                
                {/* Role & Auth Type Selection */}
                <div className="grid md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">บทบาท</label>
                    <select
                      value={newTA.role}
                      onChange={(e) => setNewTA({ ...newTA, role: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                    >
                      <option value="ta">TA</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">ประเภทการ Login</label>
                    <select
                      value={newTA.authType}
                      onChange={(e) => setNewTA({ ...newTA, authType: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                    >
                      <option value="email">Email / Password</option>
                      <option value="google">Google (Gmail/CMU)</option>
                    </select>
                  </div>
                </div>
                
                {/* User Info */}
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">
                      <Mail className="w-4 h-4 inline mr-1" /> อีเมล *
                    </label>
                    <input
                      type="email"
                      placeholder="example@email.com"
                      value={newTA.email}
                      onChange={(e) => setNewTA({ ...newTA, email: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                    />
                  </div>
                  
                  {newTA.authType === 'email' && (
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">
                        <Key className="w-4 h-4 inline mr-1" /> รหัสผ่านเริ่มต้น *
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="อย่างน้อย 6 ตัวอักษร"
                          value={newTA.password}
                          onChange={(e) => setNewTA({ ...newTA, password: e.target.value })}
                          className="w-full px-4 py-2 pr-10 bg-slate-800 border border-white/10 rounded-lg text-white"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm text-slate-400 mb-2">ชื่อที่แสดง</label>
                    <input
                      type="text"
                      placeholder="ชื่อ-นามสกุล (ไม่บังคับ)"
                      value={newTA.displayName}
                      onChange={(e) => setNewTA({ ...newTA, displayName: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                    />
                  </div>
                </div>
                
                {/* Group Assignment (for TA only) */}
                {newTA.role === 'ta' && (
                  <div className="grid md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <label className="block text-sm text-slate-400 mb-2">กลุ่มที่ดูแล</label>
                      <input
                        type="text"
                        placeholder="คั่นด้วย , (เช่น Group A, Group B)"
                        value={newTA.assignedGroups}
                        onChange={(e) => setNewTA({ ...newTA, assignedGroups: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-800 border border-white/10 rounded-lg text-white"
                      />
                      {availableGroups.length > 0 && (
                        <div className="text-xs text-slate-500 mt-1">
                          กลุ่มที่มี: {availableGroups.join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newTA.canViewAll}
                          onChange={(e) => setNewTA({ ...newTA, canViewAll: e.target.checked })}
                          className="w-5 h-5 rounded"
                        />
                        ดูได้ทุกกลุ่ม
                      </label>
                    </div>
                  </div>
                )}
                
                {/* Submit Button */}
                <button
                  onClick={handleAddTA}
                  disabled={uploading}
                  className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-lg font-medium transition disabled:opacity-50 flex items-center gap-2"
                >
                  {uploading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <UserPlus className="w-5 h-5" />
                  )}
                  เพิ่ม {newTA.role === 'admin' ? 'Admin' : 'TA'}
                </button>
                
                {/* Info */}
                {newTA.authType === 'email' && (
                  <div className="mt-4 p-3 bg-blue-900/30 border border-blue-500/30 rounded-lg">
                    <p className="text-blue-300 text-sm">
                      💡 ผู้ใช้จะได้รับรหัสผ่านเริ่มต้นที่คุณกำหนด และสามารถเปลี่ยนรหัสผ่านได้หลัง Login
                    </p>
                  </div>
                )}
                
                {newTA.authType === 'google' && (
                  <div className="mt-4 p-3 bg-yellow-900/30 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-300 text-sm">
                      ⚠️ ผู้ใช้ต้อง Login ด้วย Google ที่ใช้อีเมลตรงกับที่ระบุเท่านั้น
                    </p>
                  </div>
                )}
              </div>

              {/* TA List */}
              <div className="bg-slate-900/50 border border-white/10 rounded-2xl p-6">
                <h3 className="text-lg font-semibold mb-4">รายชื่อผู้ใช้งาน</h3>
                {loadingTAs ? (
                  <p className="text-slate-400">กำลังโหลด...</p>
                ) : tas.length === 0 ? (
                  <p className="text-slate-400">ยังไม่มีผู้ใช้งาน</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-800/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">อีเมล</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-slate-400">กลุ่มที่ดูแล</th>
                          <th className="px-4 py-3 text-center text-sm font-medium text-slate-400">ดูได้ทุกกลุ่ม</th>
                          <th className="px-4 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {tas.map(ta => (
                          <TARow 
                            key={ta.id} 
                            ta={ta} 
                            availableGroups={availableGroups}
                            onUpdate={handleUpdateTA}
                            onDelete={(id) => handleDeleteTA(id, ta.email)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
        confirmText="ยืนยันลบ"
        cancelText="ยกเลิก"
      />
    </div>
  );
}

// TA Row component with edit functionality
function TARow({ ta, availableGroups, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    assignedGroups: ta.assignedGroups?.join(', ') || '',
    canViewAll: ta.canViewAll || false
  });

  const handleSave = () => {
    const assignedGroups = editData.assignedGroups
      .split(',')
      .map(g => g.trim())
      .filter(g => g);
    
    onUpdate(ta.id, {
      assignedGroups,
      canViewAll: editData.canViewAll
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <tr className="bg-slate-800/30">
        <td className="px-4 py-3">{ta.email}</td>
        <td className="px-4 py-3">
          <input
            type="text"
            value={editData.assignedGroups}
            onChange={(e) => setEditData({ ...editData, assignedGroups: e.target.value })}
            className="w-full px-2 py-1 bg-slate-700 rounded text-sm"
          />
        </td>
        <td className="px-4 py-3 text-center">
          <input
            type="checkbox"
            checked={editData.canViewAll}
            onChange={(e) => setEditData({ ...editData, canViewAll: e.target.checked })}
            className="w-5 h-5 rounded"
          />
        </td>
        <td className="px-4 py-3">
          <div className="flex gap-2 justify-end">
            <button onClick={handleSave} className="p-1 text-green-400 hover:bg-green-900/30 rounded">
              <Save className="w-4 h-4" />
            </button>
            <button onClick={() => setEditing(false)} className="p-1 text-slate-400 hover:bg-slate-700 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-white/5">
      <td className="px-4 py-3">{ta.email}</td>
      <td className="px-4 py-3">
        {ta.assignedGroups?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {ta.assignedGroups.map((g, i) => (
              <span key={i} className="bg-slate-700 px-2 py-0.5 rounded text-xs">{g}</span>
            ))}
          </div>
        ) : (
          <span className="text-slate-500">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        {ta.canViewAll ? (
          <CheckCircle2 className="w-5 h-5 text-green-400 mx-auto" />
        ) : (
          <span className="text-slate-500">-</span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-2 justify-end">
          <button onClick={() => setEditing(true)} className="p-1 text-cyan-400 hover:bg-cyan-900/30 rounded">
            <Edit className="w-4 h-4" />
          </button>
          <button onClick={() => onDelete(ta.id)} className="p-1 text-red-400 hover:bg-red-900/30 rounded">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
