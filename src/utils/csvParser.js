// src/utils/csvParser.js
import Papa from 'papaparse';

// Criteria ตาม Rubric Assignment #1 (รวม 12 คะแนน)
export const DEFAULT_CRITERIA = [
  { key: 'criteria_1', name: '1. การเข้าถึงไฟล์และความสอดคล้องกับโจทย์', description: 'ลิงค์อยู่ใน OneDrive เปิดได้ ดูคลิปได้จนจบ', maxPoints: 2 },
  { key: 'criteria_2', name: '2. ข้อมูลผู้จัดทำ', description: 'มีชื่อ-นามสกุล และคณะ ปรากฏให้เห็นในคลิป', maxPoints: 1 },
  { key: 'criteria_3', name: '3. ความยาวคลิป', description: 'ความยาวคลิปไม่เกิน 5 นาที', maxPoints: 1 },
  { key: 'criteria_5', name: '5. การปรากฏตัว', description: 'เห็นผู้จัดทำนำเสนออยู่ในคลิปอย่างน้อย 1 ครั้ง', maxPoints: 1 },
  { key: 'criteria_6', name: '6. การสาธิต', description: 'มีการ Capture หน้าจอ หรือโชว์การใช้งาน', maxPoints: 1 },
  { key: 'criteria_7', name: '7. ประโยชน์การใช้งาน', description: 'มีการพูดระบุชัดเจนว่าเครื่องมือนี้ใช้ทำอะไร', maxPoints: 1 },
  { key: 'criteria_10', name: '10. จุดด้อย/ข้อสังเกต', description: 'มีการระบุจุดด้อยหรือข้อจำกัดอย่างน้อย 2 ข้อ', maxPoints: 2 },
  { key: 'criteria_11', name: '11. เครื่องมือใกล้เคียง', description: 'ยกตัวอย่างเครื่องมืออื่นที่ใกล้เคียงกัน', maxPoints: 2 },
  { key: 'criteria_8', name: '8. คุณภาพภาพและเสียง', description: 'ภาพและเสียงบรรยายชัดเจน', maxPoints: 1 }
];

// Parse student name: "681510314 ARREERAT WISETMUEN"
function parseStudentName(nameString) {
  if (!nameString) return { studentId: '', fullName: '' };
  const parts = nameString.trim().split(' ');
  const studentId = parts[0] || '';
  const fullName = parts.slice(1).join(' ') || '';
  return { studentId, fullName };
}

// Safe parse number - handle 0 correctly
function safeParseNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

// Clean header - ลบ BOM และ whitespace
function cleanHeader(header) {
  if (!header) return '';
  return header.replace(/^\uFEFF/, '').replace(/\ufeff/g, '').trim();
}

// Normalize header for matching
function normalizeHeader(header) {
  return cleanHeader(header).toLowerCase().replace(/\s+/g, ' ');
}

// Parse CSV file
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
          
          // Log for debugging
          const headers = Object.keys(results.data[0] || {});
          console.log('=== CSV Debug ===');
          console.log('Total rows:', results.data.length);
          console.log('Headers found:', headers);
          console.log('First row:', results.data[0]);
          
          const parsedData = processCSVData(results.data, headers);
          console.log('Parsed stats:', parsedData.stats);
          
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
  const students = {};
  
  // Auto-detect column indices based on headers
  const colIndex = detectColumns(headers);
  console.log('Column mapping:', colIndex);

  rawData.forEach((row, index) => {
    // Get values using detected column names
    const reviewerName = (row[colIndex.studentName] || '').trim();
    const revieweeName = (row[colIndex.reviewAssigned] || '').trim();
    const gradeGivenStr = row[colIndex.reviewCompleted] || '';
    const gradeAverageStr = row[colIndex.gradeAverage] || '';
    const submissionComments = row[colIndex.submissionComments] || '';
    
    if (!reviewerName) return;

    const reviewerInfo = parseStudentName(reviewerName);
    const revieweeInfo = parseStudentName(revieweeName);
    
    // Parse grade - handle 0 correctly
    const gradeGiven = safeParseNumber(gradeGivenStr);
    const gradeAverage = safeParseNumber(gradeAverageStr);

    // Get comments from criteria columns
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

    const review = {
      id: `review_${index}`,
      reviewerName,
      reviewerId: reviewerInfo.studentId,
      reviewerFullName: reviewerInfo.fullName,
      revieweeName,
      revieweeId: revieweeInfo.studentId,
      revieweeFullName: revieweeInfo.fullName,
      gradeGiven,
      gradeAverage,
      submissionComments,
      comments
    };

    reviews.push(review);

    // Aggregate student data
    if (!students[reviewerName]) {
      students[reviewerName] = {
        studentId: reviewerInfo.studentId,
        studentName: reviewerName,
        fullName: reviewerInfo.fullName,
        reviewsAssigned: 0,
        reviewsCompleted: 0,
        reviewsMade: [],
        totalGradeGiven: 0,
        averageGradeGiven: 0
      };
    }
    
    students[reviewerName].reviewsAssigned++;
    if (gradeGiven !== null) {
      students[reviewerName].reviewsCompleted++;
      students[reviewerName].totalGradeGiven += gradeGiven;
    }
    students[reviewerName].reviewsMade.push(review.id);
  });

  // Calculate averages
  Object.values(students).forEach(student => {
    if (student.reviewsCompleted > 0) {
      student.averageGradeGiven = student.totalGradeGiven / student.reviewsCompleted;
    }
  });

  // Log sample for verification
  const sampleReview = reviews.find(r => r.gradeGiven !== null);
  if (sampleReview) {
    console.log('Sample completed review:', sampleReview);
  }

  return {
    reviews,
    students,
    stats: {
      totalReviews: reviews.length,
      totalStudents: Object.keys(students).length,
      completedReviews: reviews.filter(r => r.gradeGiven !== null).length,
      incompleteReviews: reviews.filter(r => r.gradeGiven === null).length
    }
  };
}

// Auto-detect column names from headers
function detectColumns(headers) {
  const normalized = headers.map(h => normalizeHeader(h));
  
  const findHeader = (patterns) => {
    for (const pattern of patterns) {
      const idx = normalized.findIndex(h => h.includes(pattern));
      if (idx !== -1) return headers[idx];
    }
    return null;
  };

  // ตรวจจับ columns อัตโนมัติ
  return {
    studentName: findHeader(['student name']) || headers[0],
    reviewAssigned: findHeader(['review', 'assigned']) || headers[1],
    reviewCompleted: findHeader(['review', 'completed']) || headers[2],
    gradeAverage: findHeader(['grade average', 'average']) || headers[3],
    submissionComments: findHeader(['submission comment']) || headers[4],
    // Criteria columns - ลำดับตาม Canvas export (Criteria #1 มาก่อน #0)
    criteria1: findHeader(['criteria #1']) || headers[5],  // 1. การเข้าถึงไฟล์
    criteria2: findHeader(['criteria #0']) || headers[6],  // 2. ข้อมูลผู้จัดทำ
    criteria3: headers[7] || 'Column1',                     // 3. ความยาวคลิป
    criteria5: headers[8] || '_1',                          // 5. การปรากฏตัว
    criteria6: headers[9] || '_2',                          // 6. การสาธิต
    criteria7: headers[10] || '_3',                         // 7. ประโยชน์การใช้งาน
    criteria10: headers[11] || '_4',                        // 10. จุดด้อย
    criteria11: headers[12] || '_5',                        // 11. เครื่องมือใกล้เคียง
    criteria8: headers[13] || '_6'                          // 8. คุณภาพภาพและเสียง
  };
}

// Analyze comment completeness for a review
export function analyzeCommentCompleteness(review, criteriaList = DEFAULT_CRITERIA) {
  const results = {
    totalCriteria: criteriaList.length,
    commentedCriteria: 0,
    missingCriteria: [],
    completeness: 0
  };

  criteriaList.forEach(criteria => {
    const comment = review.comments[criteria.key];
    const hasComment = comment && comment.trim() !== '' && comment.trim() !== '-';
    
    if (hasComment) {
      results.commentedCriteria++;
    } else {
      results.missingCriteria.push(criteria);
    }
  });

  results.completeness = results.totalCriteria > 0 
    ? (results.commentedCriteria / results.totalCriteria) * 100 
    : 0;
    
  return results;
}

// Aggregate student analysis
export function aggregateStudentAnalysis(studentName, reviews, criteriaList = DEFAULT_CRITERIA) {
  const studentReviews = reviews.filter(r => r.reviewerName === studentName);
  
  let totalCommentedCriteria = 0;
  let totalPossibleCriteria = 0;
  const reviewAnalyses = [];

  studentReviews.forEach(review => {
    // Include reviews with grade (including grade = 0)
    if (review.gradeGiven !== null) {
      const analysis = analyzeCommentCompleteness(review, criteriaList);
      reviewAnalyses.push({
        reviewId: review.id,
        revieweeName: review.revieweeName,
        revieweeFullName: review.revieweeFullName,
        gradeGiven: review.gradeGiven,
        ...analysis
      });
      
      totalCommentedCriteria += analysis.commentedCriteria;
      totalPossibleCriteria += analysis.totalCriteria;
    }
  });

  return {
    studentName,
    totalReviewsAssigned: studentReviews.length,
    totalReviewsCompleted: reviewAnalyses.length,
    totalCommentedCriteria,
    totalPossibleCriteria,
    overallCompletenessPercent: totalPossibleCriteria > 0 
      ? (totalCommentedCriteria / totalPossibleCriteria) * 100 
      : 0,
    reviewAnalyses
  };
}
