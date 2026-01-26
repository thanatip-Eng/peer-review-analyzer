// src/utils/csvParser.js
import Papa from 'papaparse';

// Mapping ชื่อคอลัมน์จาก Canvas
const COLUMN_MAPPING = {
  'Student Name': 'reviewerName',
  'Review  assigned': 'revieweeName',
  'Review assigned': 'revieweeName',
  'Review completed': 'gradeGiven',
  'Grade Average': 'gradeAverage',
  'Submission Comments': 'submissionComments',
  'Comments for Criteria #0': 'criteria_1_file_access',
  'Comments for Criteria #1': 'criteria_2_creator_info',
  'Column1': 'criteria_3_duration',
  '_1': 'criteria_5_appearance',
  '_2': 'criteria_6_demo',
  '_3': 'criteria_7_benefits',
  '_4': 'criteria_10_weaknesses',
  '_5': 'criteria_11_similar_tools',
  '_6': 'criteria_8_quality',
  '_7': 'extra_comments'
};

// Criteria ตาม Rubric Assignment #1
export const DEFAULT_CRITERIA = [
  { 
    key: 'criteria_1_file_access', 
    name: '1. การเข้าถึงไฟล์และความสอดคล้องกับโจทย์', 
    description: 'ลิงค์อยู่ใน OneDrive เปิดได้ ดูคลิปได้จนจบ',
    maxPoints: 2
  },
  { 
    key: 'criteria_2_creator_info', 
    name: '2. ข้อมูลผู้จัดทำ', 
    description: 'มีชื่อ-นามสกุล และคณะ ปรากฏให้เห็นในคลิป',
    maxPoints: 1
  },
  { 
    key: 'criteria_3_duration', 
    name: '3. ความยาวคลิป', 
    description: 'ความยาวคลิปไม่เกิน 5 นาที',
    maxPoints: 1
  },
  { 
    key: 'criteria_5_appearance', 
    name: '5. การปรากฏตัว', 
    description: 'เห็นผู้จัดทำนำเสนออยู่ในคลิปอย่างน้อย 1 ครั้ง',
    maxPoints: 1
  },
  { 
    key: 'criteria_6_demo', 
    name: '6. การสาธิต', 
    description: 'มีการ Capture หน้าจอ หรือโชว์การใช้งาน',
    maxPoints: 1
  },
  { 
    key: 'criteria_7_benefits', 
    name: '7. ประโยชน์การใช้งาน', 
    description: 'มีการพูดระบุชัดเจนว่าเครื่องมือนี้ใช้ทำอะไร',
    maxPoints: 1
  },
  { 
    key: 'criteria_10_weaknesses', 
    name: '10. จุดด้อย/ข้อสังเกต', 
    description: 'มีการระบุจุดด้อยหรือข้อจำกัดอย่างน้อย 2 ข้อ',
    maxPoints: 2
  },
  { 
    key: 'criteria_11_similar_tools', 
    name: '11. เครื่องมือใกล้เคียง', 
    description: 'ยกตัวอย่างเครื่องมืออื่นที่ใกล้เคียงกัน',
    maxPoints: 2
  },
  { 
    key: 'criteria_8_quality', 
    name: '8. คุณภาพภาพและเสียง', 
    description: 'ภาพและเสียงบรรยายชัดเจน',
    maxPoints: 1
  }
];

// Parse student name: "681510314 ARREERAT WISETMUEN"
function parseStudentName(nameString) {
  if (!nameString) return { studentId: '', fullName: '' };
  const parts = nameString.trim().split(' ');
  const studentId = parts[0] || '';
  const fullName = parts.slice(1).join(' ') || '';
  return { studentId, fullName };
}

// Parse CSV file
export function parseCSV(input) {
  return new Promise((resolve, reject) => {
    Papa.parse(input, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const parsedData = processCSVData(results.data);
          resolve(parsedData);
        } catch (err) {
          reject(err);
        }
      },
      error: (error) => reject(error)
    });
  });
}

function processCSVData(rawData) {
  const reviews = [];
  const students = {};

  rawData.forEach((row, index) => {
    // Map columns
    const mappedRow = {};
    Object.entries(row).forEach(([key, value]) => {
      const mappedKey = COLUMN_MAPPING[key] || key;
      mappedRow[mappedKey] = value;
    });

    const reviewerName = mappedRow.reviewerName?.trim() || '';
    const revieweeName = mappedRow.revieweeName?.trim() || '';
    
    if (!reviewerName) return;

    const reviewerInfo = parseStudentName(reviewerName);
    const revieweeInfo = parseStudentName(revieweeName);

    const review = {
      id: `review_${index}`,
      reviewerName,
      reviewerId: reviewerInfo.studentId,
      reviewerFullName: reviewerInfo.fullName,
      revieweeName,
      revieweeId: revieweeInfo.studentId,
      revieweeFullName: revieweeInfo.fullName,
      gradeGiven: parseFloat(mappedRow.gradeGiven) || null,
      gradeAverage: parseFloat(mappedRow.gradeAverage) || null,
      submissionComments: mappedRow.submissionComments || '',
      comments: {
        criteria_1_file_access: mappedRow.criteria_1_file_access || '',
        criteria_2_creator_info: mappedRow.criteria_2_creator_info || '',
        criteria_3_duration: mappedRow.criteria_3_duration || '',
        criteria_5_appearance: mappedRow.criteria_5_appearance || '',
        criteria_6_demo: mappedRow.criteria_6_demo || '',
        criteria_7_benefits: mappedRow.criteria_7_benefits || '',
        criteria_10_weaknesses: mappedRow.criteria_10_weaknesses || '',
        criteria_11_similar_tools: mappedRow.criteria_11_similar_tools || '',
        criteria_8_quality: mappedRow.criteria_8_quality || ''
      }
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
    if (review.gradeGiven !== null) {
      students[reviewerName].reviewsCompleted++;
      students[reviewerName].totalGradeGiven += review.gradeGiven;
    }
    students[reviewerName].reviewsMade.push(review.id);
  });

  // Calculate averages
  Object.values(students).forEach(student => {
    if (student.reviewsCompleted > 0) {
      student.averageGradeGiven = student.totalGradeGiven / student.reviewsCompleted;
    }
  });

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

// Analyze comment completeness
export function analyzeCommentCompleteness(review, criteriaList = DEFAULT_CRITERIA) {
  const results = {
    totalCriteria: criteriaList.length,
    commentedCriteria: 0,
    missingCriteria: [],
    completeness: 0
  };

  criteriaList.forEach(criteria => {
    const comment = review.comments[criteria.key];
    if (comment && comment.trim() !== '' && comment.trim() !== '-') {
      results.commentedCriteria++;
    } else {
      results.missingCriteria.push(criteria);
    }
  });

  results.completeness = (results.commentedCriteria / results.totalCriteria) * 100;
  return results;
}

// Aggregate student analysis
export function aggregateStudentAnalysis(studentName, reviews, criteriaList = DEFAULT_CRITERIA) {
  const studentReviews = reviews.filter(r => r.reviewerName === studentName);
  
  let totalCommentedCriteria = 0;
  let totalPossibleCriteria = 0;
  const reviewAnalyses = [];

  studentReviews.forEach(review => {
    if (review.gradeGiven !== null) {
      const analysis = analyzeCommentCompleteness(review, criteriaList);
      reviewAnalyses.push({
        reviewId: review.id,
        revieweeName: review.revieweeName,
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
    totalReviewsCompleted: studentReviews.filter(r => r.gradeGiven !== null).length,
    totalCommentedCriteria,
    totalPossibleCriteria,
    overallCompletenessPercent: totalPossibleCriteria > 0 
      ? (totalCommentedCriteria / totalPossibleCriteria) * 100 
      : 0,
    reviewAnalyses
  };
}
