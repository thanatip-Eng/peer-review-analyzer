// src/utils/canvasApi.js
// -----------------------------------------------------------------------------
// ดึงข้อมูล Peer Review จาก Canvas LMS โดยตรง (ผ่าน serverless proxy /api/canvas)
// แล้วแปลงเป็น reviewRows ป้อนเข้า buildAnalysis() ตัวเดียวกับเส้นทาง CSV
// -> ผลลัพธ์ { reviews, students, graders, stats } มีโครงสร้างเหมือนเดิมทุกอย่าง
//    ดังนั้น DataViewer / การให้คะแนน / schema Firestore ไม่ต้องแก้
// -----------------------------------------------------------------------------
import { buildAnalysis, DEFAULT_CRITERIA } from './csvParser';

export const DEFAULT_CANVAS_URL = 'https://mango-cmu.instructure.com';

// เรียก proxy ฝั่ง server (token อยู่ใน body ไม่ติดใน URL)
async function callProxy(config, resource, extra = {}) {
  const resp = await fetch('/api/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: config.apiKey,
      canvasUrl: config.canvasUrl,
      resource,
      ...extra,
    }),
  });

  let payload = {};
  try {
    payload = await resp.json();
  } catch {
    // ignore parse error, จะโยน error ด้านล่าง
  }

  if (!resp.ok) {
    throw new Error(payload.error || `เรียก Canvas ไม่สำเร็จ (${resp.status})`);
  }
  return payload.data;
}

// ---- ดึงรายการ course / assignment สำหรับ dropdown ----
export async function fetchCourses(config) {
  const courses = await callProxy(config, 'courses');
  return (courses || [])
    .filter((c) => c && c.id)
    .map((c) => ({ id: c.id, name: c.name || `Course ${c.id}` }))
    // เรียงคอร์สที่สร้างล่าสุดไว้บนสุด (id มากกว่า = สร้างทีหลัง)
    .sort((a, b) => Number(b.id) - Number(a.id));
}

export async function fetchAssignments(config, courseId) {
  const assignments = await callProxy(config, 'assignments', { courseId });
  return (assignments || [])
    .filter((a) => a && a.id)
    .map((a) => ({
      id: a.id,
      name: a.name || `Assignment ${a.id}`,
      hasRubric: !!(a.rubric && a.rubric.length),
      peerReviews: !!a.peer_reviews,
      pointsPossible: a.points_possible != null ? a.points_possible : null,
    }))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

// สร้างชื่อในรูปแบบ "<รหัสนักศึกษา> <ชื่อ-สกุล>" ให้ตรงกับที่ parseStudentName แยก studentId ได้
function formatName(user) {
  if (!user) return '';
  const sid = (user.sis_user_id || user.login_id || '').toString().trim();
  const name = (user.sortable_name || user.name || '').toString().trim();
  return sid ? `${sid} ${name}`.trim() : name;
}

/**
 * ดึงและประกอบข้อมูล peer review ของ assignment หนึ่ง แล้ววิเคราะห์
 * @returns ผลลัพธ์จาก buildAnalysis: { reviews, students, graders, stats }
 */
export async function fetchPeerReviewData(config, courseId, assignmentId) {
  // 1) assignment -> rubric (เกณฑ์) + rubric id
  const assignment = await callProxy(config, 'assignment', { courseId, assignmentId });
  const rubric = Array.isArray(assignment?.rubric) ? assignment.rubric : [];
  const rubricId = assignment?.rubric_settings?.id || assignment?.rubric_id || null;

  if (!rubric.length) {
    throw new Error('Assignment นี้ไม่มี Rubric — ไม่สามารถดึงคะแนนรายเกณฑ์ได้');
  }

  // map criterion_id ของ Canvas -> key เกณฑ์ของ analyzer (จับคู่ตามลำดับเกณฑ์ใน rubric)
  const critIdToKey = {};
  rubric.forEach((crit, i) => {
    const key = DEFAULT_CRITERIA[i]?.key;
    if (key) critIdToKey[crit.id] = key;
  });

  // คะแนนเต็มของงาน: ใช้ points_possible ของ assignment เป็นหลัก
  // ถ้าไม่มี ใช้ผลรวมคะแนนเต็มของ rubric แล้วค่อย fallback เป็น 12
  const rubricTotal = rubric.reduce((sum, c) => sum + (Number(c.points) || 0), 0);
  const maxScore =
    assignment?.points_possible != null && assignment.points_possible > 0
      ? Number(assignment.points_possible)
      : rubricTotal > 0
      ? rubricTotal
      : 12;

  // 2) users -> map userId -> ชื่อ (รวมทั้งเจ้าของงานและผู้รีวิว)
  const users = await callProxy(config, 'users', { courseId });
  const userMap = {};
  (users || []).forEach((u) => {
    if (u && u.id != null) userMap[u.id] = formatName(u);
  });

  // 3) submissions -> map submissionId -> owner + เก็บ submission_comments แยกตามผู้เขียน
  const submissions = await callProxy(config, 'submissions', { courseId, assignmentId });
  const submissionOwner = {}; // submissionId -> ownerUserId
  const commentsBySubAuthor = {}; // `${submissionId}_${authorId}` -> [comment,...]
  const lateByOwner = {}; // ownerUserId -> { late, secondsLate }
  (submissions || []).forEach((sub) => {
    if (!sub || sub.id == null) return;
    submissionOwner[sub.id] = sub.user_id;
    if (sub.user && sub.user_id != null && !userMap[sub.user_id]) {
      userMap[sub.user_id] = formatName(sub.user);
    }
    // เก็บสถานะส่ง late ของเจ้าของงาน (จาก Canvas: late / seconds_late)
    if (sub.user_id != null) {
      lateByOwner[sub.user_id] = {
        late: !!sub.late,
        secondsLate: Number(sub.seconds_late) || 0,
      };
    }
    (sub.submission_comments || []).forEach((cm) => {
      const key = `${sub.id}_${cm.author_id}`;
      if (!commentsBySubAuthor[key]) commentsBySubAuthor[key] = [];
      if (cm.comment) commentsBySubAuthor[key].push(cm.comment);
    });
  });

  // 4) peer reviews -> กราฟการมอบหมาย (assigned/completed) ทุกคู่ (ผู้รีวิว -> เจ้าของงาน)
  const peerReviews = await callProxy(config, 'peer-reviews', { courseId, assignmentId });

  // 5) rubric peer assessments -> คะแนน + คอมเมนต์รายเกณฑ์
  let rubricAssessments = [];
  if (rubricId) {
    try {
      const rubricData = await callProxy(config, 'rubric', { courseId, rubricId });
      rubricAssessments = Array.isArray(rubricData?.assessments) ? rubricData.assessments : [];
    } catch (e) {
      console.warn('ดึง rubric assessments ไม่สำเร็จ:', e.message);
    }
  }
  // key: `${assessorId}_${submissionId}` -> { score, perCriterion: {criterion_id: comments} }
  const assessmentMap = {};
  rubricAssessments.forEach((a) => {
    if (!a || a.assessor_id == null) return;
    if (a.artifact_type && a.artifact_type !== 'Submission') return;
    const key = `${a.assessor_id}_${a.artifact_id}`;
    const perCriterion = {};
    (a.data || []).forEach((d) => {
      if (d && d.criterion_id != null) perCriterion[d.criterion_id] = d.comments || '';
    });
    assessmentMap[key] = { score: a.score, perCriterion };
  });

  // ---- ประกอบ reviewRows ----
  const emptyComments = () =>
    DEFAULT_CRITERIA.reduce((acc, c) => ((acc[c.key] = ''), acc), {});

  const reviewRows = (peerReviews || [])
    .map((pr) => {
      const ownerId = pr.user_id;
      const assessorId = pr.assessor_id;
      const submissionId = pr.asset_id; // asset_type === 'Submission'
      if (ownerId == null || assessorId == null) return null;

      const studentName = userMap[ownerId] || `user_${ownerId}`;
      const graderName = userMap[assessorId] || `user_${assessorId}`;

      const assessment = assessmentMap[`${assessorId}_${submissionId}`];
      const comments = emptyComments();
      let gradeGiven = null;

      if (assessment) {
        gradeGiven =
          assessment.score !== null && assessment.score !== undefined
            ? assessment.score
            : null;
        Object.entries(assessment.perCriterion).forEach(([critId, cmt]) => {
          const key = critIdToKey[critId];
          if (key) comments[key] = cmt || '';
        });
      }

      // ถือว่า "ทำเสร็จ" เมื่อมีคะแนนรายเกณฑ์จริง (สอดคล้องกับ isCompleted ในเส้นทาง CSV)
      const submissionComments = (commentsBySubAuthor[`${submissionId}_${assessorId}`] || []).join(' | ');
      const ownerLate = lateByOwner[ownerId] || { late: false, secondsLate: 0 };

      return {
        studentName,
        graderName,
        gradeGiven,
        gradeAverage: null, // analyzer คำนวณ workScore.average ให้เอง
        submissionComments,
        comments,
        ownerLate: ownerLate.late,
        ownerSecondsLate: ownerLate.secondsLate,
      };
    })
    .filter(Boolean);

  if (reviewRows.length === 0) {
    throw new Error('ไม่พบข้อมูล peer review ใน assignment นี้ (ตรวจว่าเปิด peer review และมีการมอบหมายแล้ว)');
  }

  const analysis = buildAnalysis(reviewRows, { maxScore });
  analysis.meta = {
    courseId,
    assignmentId,
    assignmentName: assignment?.name || `Assignment ${assignmentId}`,
    maxScore,
    pointsPossible: assignment?.points_possible ?? null,
  };
  return analysis;
}
