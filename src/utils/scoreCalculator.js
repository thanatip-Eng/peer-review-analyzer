// src/utils/scoreCalculator.js

export const DEFAULT_SETTINGS = {
  maxScore: 12,
  rubricMaxScore: 12,
  weights: {
    completeness: 0.5,    // 50% - ความครบถ้วนของคอมเมนต์
    quality: 0.3,         // 30% - คุณภาพ (ประเมินจากความยาว)
    gradeConsistency: 0.2 // 20% - ความสอดคล้องของคะแนน
  },
  penaltyPerMissingComment: 0.2,
  bonusForFullComments: 0.5
};

// Quick quality estimate based on comment length
function estimateQuality(comments) {
  const allComments = Object.values(comments).filter(c => c && c.trim() !== '' && c.trim() !== '-');
  if (allComments.length === 0) return 0;
  
  let totalScore = 0;
  allComments.forEach(comment => {
    const len = comment.trim().length;
    if (len >= 50) totalScore += 100;      // ยาวมาก = 100%
    else if (len >= 30) totalScore += 80;   // ยาวปานกลาง = 80%
    else if (len >= 15) totalScore += 60;   // สั้น = 60%
    else if (len >= 5) totalScore += 40;    // สั้นมาก = 40%
    else totalScore += 20;                   // แค่คำ = 20%
  });
  
  return totalScore / allComments.length;
}

// Calculate score for single review
export function calculateReviewScore({ review, completenessAnalysis, aiAnalysis = null, settings = DEFAULT_SETTINGS }) {
  const result = {
    rawScores: { completeness: 0, quality: 0, gradeConsistency: 0 },
    penalties: [],
    bonuses: [],
    percentageScore: 0,
    finalScore: 0,
    maxScore: settings.maxScore,
    breakdown: {}
  };

  // 1. Completeness score (0-100)
  result.rawScores.completeness = completenessAnalysis.completeness;
  
  // Track missing comments
  if (completenessAnalysis.missingCriteria.length > 0) {
    result.penalties.push({
      type: 'missing_comments',
      count: completenessAnalysis.missingCriteria.length,
      criteria: completenessAnalysis.missingCriteria.map(c => c.name),
      deduction: completenessAnalysis.missingCriteria.length * settings.penaltyPerMissingComment
    });
  } else {
    result.bonuses.push({ type: 'full_comments', bonus: settings.bonusForFullComments });
  }

  // 2. Quality score (from AI or estimated from comment length)
  if (aiAnalysis && typeof aiAnalysis.averageScore === 'number') {
    result.rawScores.quality = aiAnalysis.averageScore;
  } else if (review && review.comments) {
    result.rawScores.quality = estimateQuality(review.comments);
  } else {
    result.rawScores.quality = completenessAnalysis.completeness * 0.7;
  }

  // 3. Grade consistency (compare grade given vs comment effort)
  if (review && review.gradeGiven !== null && review.gradeGiven !== undefined) {
    const rubricMax = settings.rubricMaxScore || 12;
    const gradeRatio = review.gradeGiven / rubricMax;
    const commentRatio = completenessAnalysis.commentedCriteria / completenessAnalysis.totalCriteria;
    
    // Less difference = more consistent
    const diff = Math.abs(gradeRatio - commentRatio);
    const consistency = Math.max(0, 100 - (diff * 100));
    result.rawScores.gradeConsistency = consistency;
  } else {
    result.rawScores.gradeConsistency = 50; // Default
  }

  // 4. Calculate weighted score
  const weightedScore = 
    (result.rawScores.completeness * settings.weights.completeness) +
    (result.rawScores.quality * settings.weights.quality) +
    (result.rawScores.gradeConsistency * settings.weights.gradeConsistency);

  result.percentageScore = Math.round(weightedScore * 100) / 100;

  // 5. Calculate final score
  let finalScore = (weightedScore / 100) * settings.maxScore;
  
  // Apply penalties and bonuses
  const totalPenalty = result.penalties.reduce((sum, p) => sum + (p.deduction || 0), 0);
  const totalBonus = result.bonuses.reduce((sum, b) => sum + (b.bonus || 0), 0);
  finalScore = finalScore - totalPenalty + totalBonus;
  
  // Clamp to valid range
  result.finalScore = Math.max(0, Math.min(settings.maxScore, Math.round(finalScore * 100) / 100));

  // Breakdown for display
  result.breakdown = {
    completeness: {
      score: result.rawScores.completeness,
      weight: settings.weights.completeness,
      detail: `${completenessAnalysis.commentedCriteria}/${completenessAnalysis.totalCriteria}`
    },
    quality: {
      score: result.rawScores.quality,
      weight: settings.weights.quality,
      detail: aiAnalysis ? 'AI analyzed' : 'Estimated'
    },
    consistency: {
      score: result.rawScores.gradeConsistency,
      weight: settings.weights.gradeConsistency,
      detail: review && review.gradeGiven !== null ? `Grade: ${review.gradeGiven}` : 'N/A'
    }
  };

  return result;
}

// Get grade level from percentage
function getGradeLevel(percentage) {
  if (percentage >= 90) return 'A';
  if (percentage >= 80) return 'B+';
  if (percentage >= 70) return 'B';
  if (percentage >= 60) return 'C+';
  if (percentage >= 50) return 'C';
  if (percentage >= 40) return 'D+';
  if (percentage >= 30) return 'D';
  return 'F';
}

// Calculate total score for a student
export function calculateStudentTotalScore({ studentAnalysis, aiAnalyses = {}, settings = DEFAULT_SETTINGS, reviews = [] }) {
  const reviewScores = [];
  let totalPercentage = 0;

  studentAnalysis.reviewAnalyses.forEach(reviewAnalysis => {
    // Find the original review to get comments
    const originalReview = reviews.find(r => r.id === reviewAnalysis.reviewId);
    const aiAnalysis = aiAnalyses[reviewAnalysis.reviewId];
    
    const score = calculateReviewScore({
      review: originalReview || { gradeGiven: reviewAnalysis.gradeGiven, comments: {} },
      completenessAnalysis: reviewAnalysis,
      aiAnalysis,
      settings
    });

    reviewScores.push({
      reviewId: reviewAnalysis.reviewId,
      revieweeName: reviewAnalysis.revieweeName,
      ...score
    });

    totalPercentage += score.percentageScore;
  });

  const averagePercentage = reviewScores.length > 0 ? totalPercentage / reviewScores.length : 0;
  const finalScore = (averagePercentage / 100) * settings.maxScore;

  return {
    studentName: studentAnalysis.studentName,
    totalReviewsAssigned: studentAnalysis.totalReviewsAssigned,
    totalReviewsCompleted: studentAnalysis.totalReviewsCompleted,
    reviewScores,
    averagePercentage: Math.round(averagePercentage * 100) / 100,
    finalScore: Math.round(finalScore * 100) / 100,
    maxScore: settings.maxScore,
    gradeLevel: getGradeLevel(averagePercentage)
  };
}

// Calculate scores for all students
export function calculateAllStudentsScores({ students, reviews, criteriaList, aiAnalyses = {}, settings = DEFAULT_SETTINGS, aggregateFunc }) {
  const results = [];

  Object.keys(students).forEach(studentName => {
    const studentAnalysis = aggregateFunc(studentName, reviews, criteriaList);
    const totalScore = calculateStudentTotalScore({ 
      studentAnalysis, 
      aiAnalyses, 
      settings,
      reviews 
    });
    results.push(totalScore);
  });

  // Sort by finalScore descending
  results.sort((a, b) => b.finalScore - a.finalScore);
  
  // Add rank
  results.forEach((result, index) => { 
    result.rank = index + 1; 
  });

  return results;
}

// Calculate class statistics
export function calculateClassStatistics(allStudentsScores) {
  if (!allStudentsScores || allStudentsScores.length === 0) return null;

  const scores = allStudentsScores.map(s => s.averagePercentage);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / scores.length;

  // Standard deviation
  const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / scores.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Percentile helper
  const getPercentile = (arr, p) => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  // Grade distribution
  const gradeDistribution = { A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 0 };
  allStudentsScores.forEach(s => { 
    if (gradeDistribution[s.gradeLevel] !== undefined) {
      gradeDistribution[s.gradeLevel]++; 
    }
  });

  return {
    totalStudents: allStudentsScores.length,
    mean: Math.round(mean * 100) / 100,
    median: getPercentile(sortedScores, 50),
    stdDev: Math.round(stdDev * 100) / 100,
    min: sortedScores[0] || 0,
    max: sortedScores[sortedScores.length - 1] || 0,
    gradeDistribution
  };
}
