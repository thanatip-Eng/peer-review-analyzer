// src/utils/csvParser.js
import Papa from 'papaparse';

// Criteria ตาม Rubric Assignment #1 (รวม 12 คะแนน)
export const DEFAULT_CRITERIA = [
  { key: 'criteria_1', name: '1. การเข้าถึงไฟล์', description: 'ลิงค์อยู่ใน OneDrive เปิดได้', maxPoints: 2 },
  { key: 'criteria_2', name: '2. ข้อมูลผู้จัดทำ', description: 'มีชื่อ-นามสกุล และคณะ', maxPoints: 1 },
  { key: 'criteria_3', name: '3. ความยาวคลิป', description: 'ไม่เกิน 5 นาที', maxPoints: 1 },
  { key: 'criteria_5', name: '5. การปรากฏตัว', description: 'เห็นผู้จัดทำในคลิป', maxPoints: 1 },
  { key: 'criteria_6', name: '6. การสาธิต', description: 'มี Capture หน้าจอ', maxPoints: 1 },
  { key: 'criteria_7', name: '7. ประโยชน์', description: 'ระบุประโยชน์ชัดเจน', maxPoints: 1 },
  { key: 'criteria_10', name: '10. จุดด้อย', description: 'ระบุจุดด้อยอย่างน้อย 2 ข้อ', maxPoints: 2 },
  { key: 'criteria_11', name: '11. เครื่องมือใกล้เคียง', description: 'ยกตัวอย่างเครื่องมืออื่น', maxPoints: 2 },
  { key: 'criteria_8', name: '8. คุณภาพภาพเสียง', description: 'ภาพและเสียงชัดเจน', maxPoints: 1 }
];

// คำที่ถือว่า comment ไม่มีคุณภาพ
export const LOW_QUALITY_PATTERNS = [
  /^-+$/,
  /^ไม่มี$/i,
  /^ไม่$/i,
  /^ดี$/i,
  /^ได้$/i,
  /^ok$/i,
  /^ครับ$/i,
  /^ค่ะ$/i,
  /^ผ่าน$/i,
  /^\.+$/,
  /^n\/a$/i,
  /^none$/i,
  /^good$/i,
  /^yes$/i,
  /^no$/i,
  /^ใช่$/i,
  /^โอเค$/i,
  /^เยี่ยม$/i,
  /^สุดยอด$/i,
];

const MIN_QUALITY_LENGTH = 5;

function parseStudentName(nameString) {
  if (!nameString) return { studentId: '', fullName: '', displayName: '' };
  const parts = nameString.trim().split(' ');
  const studentId = parts[0] || '';
  const fullName = parts.slice(1).join(' ') || '';
  return { studentId, fullName, displayName: nameString.trim() };
}

function cleanHeader(header) {
  if (!header) return '';
  return header.replace(/^\uFEFF/, '').replace(/\ufeff/g, '').trim();
}

export function checkCommentQuality(comment) {
  if (!comment || typeof comment !== 'string') {
    return { hasComment: false, isQuality: false, reason: 'ไม่มี comment' };
  }
  
  const trimmed = comment.trim();
  
  if (trimmed === '') {
    return { hasComment: false, isQuality: false, reason: 'ไม่มี comment' };
  }
  
  // "-" หรือ "---" นับว่าไม่ใส่ comment
  if (/^-+$/.test(trimmed)) {
    return { hasComment: false, isQuality: false, reason: 'ใส่แค่ "-" นับว่าไม่มี comment' };
  }
  
  // มี comment แล้ว (ไม่ว่าจะสั้นหรือยาว ถือว่าใส่แล้ว)
  return { hasComment: true, isQuality: true, reason: null };
}

export function extractKeywords(comment) {
  if (!comment || typeof comment !== 'string') return [];
  const trimmed = comment.trim();
  if (trimmed.length < 3) return [];
  
  const thaiStopwords = ['ที่', 'และ', 'ของ', 'ใน', 'มี', 'ได้', 'ไม่', 'เป็น', 'จะ', 'ก็', 'แต่', 'หรือ', 'ว่า', 'ให้', 'นี้', 'กับ', 'จาก', 'แล้ว', 'ซึ่ง', 'อยู่', 'คือ', 'ไป', 'มา', 'กัน', 'ถ้า', 'เพราะ', 'ครับ', 'ค่ะ', 'นะ', 'จ้า'];
  const words = trimmed.split(/[\s,.\-\/\\]+/).filter(w => w.length >= 3);
  const keywords = words.filter(w => !thaiStopwords.includes(w.toLowerCase()));
  return keywords.slice(0, 5);
}

export function parseCSV(input) {
  return new Promise((resolve, reject) => {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      transformHeader: cleanHeader,
      complete: (results) => {
        try {
          if (!results.data || results.data.length === 0) {
            reject(new Error('ไม่พบข้อมูลในไฟล์ CSV'));
            return;
          }
          
          const headers = Object.keys(results.data[0] || {});
          console.log('=== CSV Debug ===');
          console.log('Total rows:', results.data.length);
          console.log('Headers:', headers);
          
          const parsedData = processCSVData(results.data, headers);
          resolve(parsedData);
        } catch (err) {
          console.error('Parse error:', err);
          reject(err);
        }
      },
      error: (error) => reject(error)
    });
  });
}

function processCSVData(rawData, headers) {
  const reviews = [];
  const students = {};  // เจ้าของงาน (Student Name)
  const graders = {};   // คนรีวิว (Review assigned)
  
  const colIndex = detectColumns(headers);
  console.log('Column mapping:', colIndex);
  
  // Debug: แสดงตัวอย่างข้อมูลแถวแรก
  if (rawData.length > 0) {
    const firstRow = rawData[0];
    console.log('=== Debug First Row ===');
    console.log('Student Name (owner):', firstRow[colIndex.studentName]);
    console.log('Review Assigned (grader):', firstRow[colIndex.reviewAssigned]);
    console.log('Review Completed (grade):', firstRow[colIndex.reviewCompleted]);
  }

  rawData.forEach((row, index) => {
    // *** ความเข้าใจใหม่ตาม Canvas ***
    // Student Name = เจ้าของงาน (คนที่ถูกรีวิว)
    // Review assigned = ชื่อ Grader ที่ถูก assign มารีวิวงานของ Student
    const studentName = (row[colIndex.studentName] || '').trim();
    const graderName = (row[colIndex.reviewAssigned] || '').trim();
    
    const gradeGivenStr = row[colIndex.reviewCompleted] || '';
    const gradeAverageStr = row[colIndex.gradeAverage] || '';
    const submissionComments = row[colIndex.submissionComments] || '';
    
    if (!studentName) return;

    const studentInfo = parseStudentName(studentName);
    const graderInfo = parseStudentName(graderName);
    
    const gradeGiven = gradeGivenStr !== '' ? parseFloat(gradeGivenStr) : null;
    const gradeAverage = gradeAverageStr !== '' ? parseFloat(gradeAverageStr) : null;
    const isCompleted = gradeGiven !== null && !isNaN(gradeGiven);

    const comments = {
      criteria_1: (row[colIndex.criteria1] || '').trim(),
      criteria_2: (row[colIndex.criteria2] || '').trim(),
      criteria_3: (row[colIndex.criteria3] || '').trim(),
      criteria_5: (row[colIndex.criteria5] || '').trim(),
      criteria_6: (row[colIndex.criteria6] || '').trim(),
      criteria_7: (row[colIndex.criteria7] || '').trim(),
      criteria_10: (row[colIndex.criteria10] || '').trim(),
      criteria_11: (row[colIndex.criteria11] || '').trim(),
      criteria_8: (row[colIndex.criteria8] || '').trim()
    };

    const commentAnalysis = {};
    let qualityCommentCount = 0;
    let hasCommentCount = 0;
    const allKeywords = [];
    
    DEFAULT_CRITERIA.forEach(criteria => {
      const comment = comments[criteria.key];
      const quality = checkCommentQuality(comment);
      const keywords = extractKeywords(comment);
      
      commentAnalysis[criteria.key] = { ...quality, keywords, originalComment: comment };
      
      if (quality.hasComment) hasCommentCount++;
      if (quality.isQuality) qualityCommentCount++;
      allKeywords.push(...keywords);
    });

    const review = {
      id: `review_${index}`,
      studentName,
      studentId: studentInfo.studentId,
      studentFullName: studentInfo.fullName,
      graderName,
      graderId: graderInfo.studentId,
      graderFullName: graderInfo.fullName,
      gradeGiven: isNaN(gradeGiven) ? null : gradeGiven,
      gradeAverage: isNaN(gradeAverage) ? null : gradeAverage,
      isCompleted,
      comments,
      commentAnalysis,
      submissionComments,
      totalCriteria: DEFAULT_CRITERIA.length,
      hasCommentCount,
      qualityCommentCount,
      allKeywords: [...new Set(allKeywords)],
      hasAllQualityComments: qualityCommentCount === DEFAULT_CRITERIA.length,
      hasGradeButNoQualityComment: isCompleted && qualityCommentCount < DEFAULT_CRITERIA.length
    };

    reviews.push(review);

    // ===== Students (เจ้าของงาน) =====
    if (!students[studentName]) {
      students[studentName] = {
        studentId: studentInfo.studentId,
        studentName,
        fullName: studentInfo.fullName,
        gradersAssigned: 0,
        gradersCompleted: 0,
        gradesReceived: [],
        reviewsReceived: [],
        workScore: { average: 0, min: null, max: null, stdDev: 0, grades: [], graderCount: 0, isReliable: false },
        flags: []
      };
    }
    
    students[studentName].gradersAssigned++;
    students[studentName].reviewsReceived.push(review.id);
    
    if (isCompleted) {
      students[studentName].gradersCompleted++;
      students[studentName].gradesReceived.push(gradeGiven);
    }

    // ===== Graders (คนรีวิว) =====
    if (graderName && graderName !== '') {
      if (!graders[graderName]) {
        graders[graderName] = {
          oderId: graderInfo.studentId,
          graderId: graderInfo.studentId,
          graderName,
          fullName: graderInfo.fullName,
          assignedReviews: 0,
          completedReviews: 0,
          reviewsMade: [],
          peerReviewScore: { fullScore: 0, earnedScore: 0, penalty: 0, netScore: 0, details: [] },
          allKeywords: [],
          flags: []
        };
      }
      
      graders[graderName].assignedReviews++;
      graders[graderName].reviewsMade.push(review.id);
      graders[graderName].peerReviewScore.fullScore++;
      
      if (isCompleted) {
        graders[graderName].completedReviews++;
        
        // นับจำนวน comment ที่ใส่จริง (ไม่นับ "-" เป็นการใส่)
        const validCommentCount = review.hasCommentCount; // จำนวน comment ที่มี (ไม่รวม "-")
        const missingComments = review.totalCriteria - validCommentCount;
        
        // งาน "สมบูรณ์" = ให้คะแนนแล้ว + คอมเมนต์ขาดไม่เกิน 3 ช่อง
        const isComplete = missingComments <= 3;
        
        graders[graderName].peerReviewScore.details.push({
          reviewId: review.id,
          studentReviewed: studentName,
          studentId: studentInfo.studentId,
          gradeGiven: gradeGiven,
          validCommentCount: validCommentCount,
          missingComments: missingComments,
          isComplete: isComplete,
          totalCriteria: review.totalCriteria,
          keywords: review.allKeywords,
          comments: review.comments // เก็บไว้สำหรับตรวจสอบ G
        });
        graders[graderName].allKeywords.push(...review.allKeywords);
      }
    }
  });

  // Post-process: Students work score
  Object.values(students).forEach(student => {
    const grades = student.gradesReceived.filter(g => g !== null && !isNaN(g));
    
    if (grades.length > 0) {
      const sum = grades.reduce((a, b) => a + b, 0);
      const avg = sum / grades.length;
      const min = Math.min(...grades);
      const max = Math.max(...grades);
      const squaredDiffs = grades.map(g => Math.pow(g - avg, 2));
      const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / grades.length;
      const stdDev = Math.sqrt(avgSquaredDiff);
      
      // เกณฑ์ความน่าเชื่อถือ:
      // 1. มี grader อย่างน้อย 2 คน
      // 2. SD ต้องไม่สูงเกินไป (< 3)
      // 3. คะแนนต่ำสุดต้อง >= 0
      // 4. คะแนนสูงสุดต้อง <= 12
      const isScoreInValidRange = min >= 0 && max <= 12;
      const isReliable = grades.length >= 2 && stdDev < 3 && isScoreInValidRange;
      
      student.workScore = {
        average: Math.round(avg * 100) / 100,
        min, max,
        range: max - min,
        stdDev: Math.round(stdDev * 100) / 100,
        grades,
        graderCount: grades.length,
        isReliable,
        // เหตุผลที่ไม่น่าเชื่อถือ (สำหรับ debug)
        reliabilityIssues: !isReliable ? [
          grades.length < 2 ? 'grader < 2' : null,
          stdDev >= 3 ? `SD สูง (${stdDev.toFixed(2)})` : null,
          min < 0 ? `คะแนนต่ำกว่า 0 (${min})` : null,
          max > 12 ? `คะแนนเกิน 12 (${max})` : null
        ].filter(Boolean) : []
      };
      
      // เพิ่ม flag สำหรับคะแนนเกิน 12
      const overMaxGrades = grades.filter(g => g > 12);
      if (overMaxGrades.length > 0) {
        student.flags.push({ 
          type: 'score_over_max', 
          message: `⚠️ มีคะแนนเกิน 12: ${overMaxGrades.join(', ')}`, 
          severity: 'alert' 
        });
      }
      
      // เพิ่ม flag สำหรับคะแนนต่ำกว่า 0
      const underMinGrades = grades.filter(g => g < 0);
      if (underMinGrades.length > 0) {
        student.flags.push({ 
          type: 'score_under_min', 
          message: `⚠️ มีคะแนนต่ำกว่า 0: ${underMinGrades.join(', ')}`, 
          severity: 'alert' 
        });
      }
      
      if (stdDev >= 3) {
        student.flags.push({ type: 'high_variance', message: `คะแนนแตกต่างมาก (SD=${stdDev.toFixed(2)})`, severity: 'warning' });
      }
      if (max - min >= 6) {
        student.flags.push({ type: 'extreme_range', message: `คะแนนห่างกันมาก: ${min}-${max}`, severity: 'warning' });
      }
      if (avg < 6) {
        student.flags.push({ type: 'low_score', message: `คะแนนเฉลี่ยต่ำ: ${avg.toFixed(2)}/12`, severity: 'alert' });
      }
      if (grades.length < 2) {
        student.flags.push({ type: 'insufficient_graders', message: `มี grader แค่ ${grades.length} คน`, severity: 'info' });
      }
    }
  });

  // Post-process: Graders peer review score (เงื่อนไขใหม่)
  Object.values(graders).forEach(grader => {
    const pr = grader.peerReviewScore;
    const details = pr.details;
    
    // นับงานที่รีวิวแล้ว
    const reviewedCount = details.length;
    
    // นับงานที่ "สมบูรณ์" (ขาด comment ไม่เกิน 3 ช่อง)
    const completeCount = details.filter(d => d.isComplete).length;
    
    // คำนวณคะแนน
    // - ทุกงานที่รีวิว = 1 คะแนน
    // - โบนัส +1 ถ้ารีวิวครบตามที่ได้รับ AND ทุกงานสมบูรณ์
    const baseScore = reviewedCount; // 1 คะแนนต่องานที่รีวิว
    
    // โบนัส: ต้องรีวิวครบตามที่ได้รับ + ทุกงานต้องสมบูรณ์
    const reviewedAll = reviewedCount === grader.assignedReviews && grader.assignedReviews > 0;
    const allComplete = completeCount === reviewedCount && reviewedCount > 0;
    const bonus = (reviewedAll && allComplete) ? 1 : 0;
    
    pr.baseScore = baseScore;
    pr.bonus = bonus;
    pr.netScore = baseScore + bonus;
    pr.reviewedCount = reviewedCount;
    pr.completeCount = completeCount;
    pr.fullScore = grader.assignedReviews + (grader.assignedReviews > 0 ? 1 : 0); // คะแนนเต็ม = จำนวนงาน + 1 โบนัส
    
    grader.allKeywords = [...new Set(grader.allKeywords)];
    
    // Flags
    if (grader.completedReviews === 0 && grader.assignedReviews > 0) {
      grader.flags.push({ type: 'no_review_done', message: `ได้รับ ${grader.assignedReviews} งานแต่ยังไม่รีวิวเลย`, severity: 'alert' });
    }
    if (reviewedAll && !allComplete) {
      grader.flags.push({ type: 'incomplete_comments', message: `รีวิวครบแต่คอมเมนต์ไม่สมบูรณ์ (${completeCount}/${reviewedCount} งานสมบูรณ์) - ไม่ได้โบนัส`, severity: 'warning' });
    }
    if (!reviewedAll && grader.assignedReviews > 0) {
      grader.flags.push({ type: 'incomplete_review', message: `รีวิวไม่ครบ (${reviewedCount}/${grader.assignedReviews} งาน)`, severity: 'warning' });
    }
    // Flag: ได้รับงานไม่เท่ากับ 3
    if (grader.assignedReviews !== 3 && grader.assignedReviews > 0) {
      grader.flags.push({ 
        type: 'unusual_assignment', 
        message: `ได้รับงาน ${grader.assignedReviews} งาน (ไม่ใช่ 3)`, 
        severity: 'info' 
      });
    }
    // Flag: ให้คะแนนเกิน 12
    const overMaxGrades = details.filter(d => d.gradeGiven > 12);
    if (overMaxGrades.length > 0) {
      const overGradesList = overMaxGrades.map(d => `${d.studentReviewed}: ${d.gradeGiven}`).join(', ');
      grader.flags.push({ 
        type: 'gave_score_over_max', 
        message: `⚠️ ให้คะแนนเกิน 12: ${overGradesList}`, 
        severity: 'alert' 
      });
    }
  });

  const stats = {
    totalReviews: reviews.length,
    totalStudents: Object.keys(students).length,
    totalGraders: Object.keys(graders).length,
    completedReviews: reviews.filter(r => r.isCompleted).length,
    incompleteReviews: reviews.filter(r => !r.isCompleted).length,
    reviewsWithQualityComments: reviews.filter(r => r.hasAllQualityComments).length,
    reviewsWithPenalty: reviews.filter(r => r.hasGradeButNoQualityComment).length
  };

  console.log('Parsed stats:', stats);

  return { reviews, students, graders, stats };
}

function detectColumns(headers) {
  // ใช้ index โดยตรงตาม Canvas export format
  // Headers: Student Name, Review assigned, Review completed, Grade Average, Submission Comments, ...
  console.log('Raw headers:', headers);
  
  // สร้าง mapping จาก header name (case-insensitive)
  const headerMap = {};
  headers.forEach((h, i) => {
    const normalized = h.toLowerCase().replace(/\s+/g, ' ').trim();
    headerMap[normalized] = h;
  });
  
  console.log('Header map:', headerMap);
  
  return {
    // ใช้ตำแหน่ง index โดยตรงเพื่อความแน่นอน
    studentName: headers[0],      // Student Name = เจ้าของงาน
    reviewAssigned: headers[1],   // Review assigned = Grader (คนรีวิว)
    reviewCompleted: headers[2],  // Review completed = คะแนนที่ให้
    gradeAverage: headers[3],     // Grade Average
    submissionComments: headers[4], // Submission Comments
    criteria1: headers[5],        // Comments for Criteria #1
    criteria2: headers[6],        // Comments for Criteria #0
    criteria3: headers[7],        // Column1
    criteria5: headers[8],        // _1
    criteria6: headers[9],        // _2
    criteria7: headers[10],       // _3
    criteria10: headers[11],      // _4
    criteria11: headers[12],      // _5
    criteria8: headers[13]        // _6
  };
}

export function getFlaggedStudents(students) {
  return Object.values(students).filter(s => s.flags.length > 0).sort((a, b) => {
    const severityOrder = { alert: 0, warning: 1, info: 2 };
    const aMax = Math.min(...a.flags.map(f => severityOrder[f.severity] || 3));
    const bMax = Math.min(...b.flags.map(f => severityOrder[f.severity] || 3));
    return aMax - bMax;
  });
}

export function getFlaggedGraders(graders) {
  return Object.values(graders).filter(g => g.flags.length > 0).sort((a, b) => {
    const severityOrder = { alert: 0, warning: 1, info: 2 };
    const aMax = Math.min(...a.flags.map(f => severityOrder[f.severity] || 3));
    const bMax = Math.min(...b.flags.map(f => severityOrder[f.severity] || 3));
    return aMax - bMax;
  });
}

export function getKeywordsForVerification(graders) {
  const keywordMap = {};
  Object.values(graders).forEach(grader => {
    grader.peerReviewScore.details.forEach(detail => {
      detail.keywords.forEach(keyword => {
        if (!keywordMap[keyword]) keywordMap[keyword] = { keyword, count: 0, graders: [], verified: null };
        keywordMap[keyword].count++;
        if (!keywordMap[keyword].graders.includes(grader.graderName)) {
          keywordMap[keyword].graders.push(grader.graderName);
        }
      });
    });
  });
  return Object.values(keywordMap).sort((a, b) => b.count - a.count);
}
