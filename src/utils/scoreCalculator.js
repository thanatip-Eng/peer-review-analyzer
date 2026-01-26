// src/utils/scoreCalculator.js

export const DEFAULT_SETTINGS = {
  maxScore: 12,
  rubricMaxScore: 12,
  weights: {
    completeness: 0.4,
    quality: 0.4,
    gradeConsistency: 0.2
  },
  penaltyPerMissingComment: 0.3,
  bonusForFullComments: 0.5
};

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

  // 1. Completeness score
  result.rawScores.completeness = completenessAnalysis.completeness;
  
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

  // 2. Quality score (from AI or estimated)
  if (aiAnalysis && aiAnalysis.averageScore !== undefined) {
    result.rawScores.quality = aiAnalysis.averageScore;
  } else {
    result.rawScores.quality = completenessAnalysis.completeness * 0.8;
  }

  // 3. Grade consistency
  if (review.gradeGiven !== null) {
    const rubricMax = settings.rubricMaxScore || 12;
    const gradeRatio = review.gradeGiven / rubricMax;
    const commentRatio = completenessAnalysis.commentedCriteria / completenessAnalysis.totalCriteria;
    const consistency = 100 - Math.abs(gradeRatio - commentRatio) * 100;
    result.rawScores.gradeConsistency = Math.max(0, consistency);
  }

  // 4. Weighted score
  const weightedScore = 
    (result.rawScores.completeness * settings.weights.completeness) +
    (result.rawScores.quality * settings.weights.quality) +
    (result.rawScores.gradeConsistency * settings.weights.gradeConsistency);

  result.percentageScore = Math.round(weightedScore * 100) / 100;

  // 5. Final score
  let finalScore = (weightedScore / 100) * settings.maxScore;
  const totalPenalty = result.penalties.reduce((sum, p) => sum + (p.deduction || 0), 0);
  const totalBonus = result.bonuses.reduce((sum, b) => sum + (b.bonus || 0), 0);
  finalScore = finalScore - totalPenalty + totalBonus;
  result.finalScore = Math.max(0, Math.min(settings.maxScore, Math.round(finalScore * 100) / 100));

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
      detail: review.gradeGiven !== null ? `Grade: ${review.gradeGiven}` : 'No grade'
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

// Calculate student total score
export function calculateStudentTotalScore({ studentAnalysis, aiAnalyses = {}, settings = DEFAULT_SETTINGS }) {
  const reviewScores = [];
  let totalPercentage = 0;

  studentAnalysis.reviewAnalyses.forEach(reviewAnalysis => {
    const aiAnalysis = aiAnalyses[reviewAnalysis.reviewId];
    const score = calculateReviewScore({
      review: { gradeGiven: reviewAnalysis.gradeGiven },
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
    totalReviewsCompleted: studentAnalysis.totalReviewsCompleted,
    reviewScores,
    averagePercentage: Math.round(averagePercentage * 100) / 100,
    finalScore: Math.round(finalScore * 100) / 100,
    maxScore: settings.maxScore,
    gradeLevel: getGradeLevel(averagePercentage)
  };
}

// Calculate all students scores
export function calculateAllStudentsScores({ students, reviews, criteriaList, aiAnalyses = {}, settings = DEFAULT_SETTINGS, aggregateFunc }) {
  const results = [];

  Object.keys(students).forEach(studentName => {
    const studentAnalysis = aggregateFunc(studentName, reviews, criteriaList);
    const totalScore = calculateStudentTotalScore({ studentAnalysis, aiAnalyses, settings });
    results.push(totalScore);
  });

  results.sort((a, b) => b.finalScore - a.finalScore);
  results.forEach((result, index) => { result.rank = index + 1; });

  return results;
}

// Calculate class statistics
export function calculateClassStatistics(allStudentsScores) {
  if (allStudentsScores.length === 0) return null;

  const scores = allStudentsScores.map(s => s.averagePercentage);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const mean = sum / scores.length;

  const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / scores.length;
  const stdDev = Math.sqrt(avgSquaredDiff);

  const getPercentile = (arr, p) => {
    const index = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, index)];
  };

  const gradeDistribution = { A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 0 };
  allStudentsScores.forEach(s => { gradeDistribution[s.gradeLevel]++; });

  return {
    totalStudents: allStudentsScores.length,
    mean: Math.round(mean * 100) / 100,
    median: getPercentile(sortedScores, 50),
    stdDev: Math.round(stdDev * 100) / 100,
    min: sortedScores[0],
    max: sortedScores[sortedScores.length - 1],
    gradeDistribution
  };
}
