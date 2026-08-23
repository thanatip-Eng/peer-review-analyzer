// src/utils/canvasApi.js
// -----------------------------------------------------------------------------
// ดึงข้อมูล Peer Review จาก Canvas LMS โดยตรง (ผ่าน serverless proxy /api/canvas)
// แล้วแปลงเป็น reviewRows ป้อนเข้า buildAnalysis() ตัวเดียวกับเส้นทาง CSV
// -> ผลลัพธ์ { reviews, students, graders, stats } มีโครงสร้างเหมือนเดิมทุกอย่าง
//    ดังนั้น DataViewer / การให้คะแนน / schema Firestore ไม่ต้องแก้
// -----------------------------------------------------------------------------
import { buildAnalysis, DEFAULT_CRITERIA } from './csvParser';

export const DEFAULT_CANVAS_URL = 'https://mango-cmu.instructure.com';

// เรียก proxy ฝั่ง server ทีละหน้า -> คืน { data, next } (token อยู่ใน body ไม่ติดใน URL)
async function callProxyPage(config, bodyExtra) {
  const resp = await fetch('/api/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: config.apiKey,
      canvasUrl: config.canvasUrl,
      ...bodyExtra,
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
  return payload; // { data, next }
}

// ดึงครบทุกหน้า (วน pagination ฝั่ง browser -> แต่ละคำขอเล็ก/เร็ว ไม่ชน timeout)
// onPage(count) เรียกหลังแต่ละหน้า เพื่อรายงานความคืบหน้าสด
async function callProxy(config, resource, extra = {}, onPage) {
  const first = await callProxyPage(config, { resource, ...extra });
  // resource ที่คืน object เดี่ยว (assignment, rubric) ไม่มี pagination
  if (!Array.isArray(first.data)) return first.data;

  const all = [...first.data];
  if (onPage) onPage(all.length);
  let next = first.next;
  let guard = 0;
  while (next && guard < 2000) {
    guard++;
    const page = await callProxyPage(config, { nextUrl: next });
    if (Array.isArray(page.data)) all.push(...page.data);
    if (onPage) onPage(all.length);
    next = page.next;
  }
  return all;
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

/**
 * ดึงข้อมูลกลุ่มของคอร์สจาก Canvas แล้วสร้างโครงสร้างเดียวกับที่ studentData ใช้:
 *   groups = { [sisUserId]: { studentName, section, [groupSetName]: groupName } }
 *   groupSets = [groupSetName, ...]
 * เพื่อให้ TA เห็นเฉพาะกลุ่มตัวเองได้เหมือนตอนอัปโหลดจาก Group Exporter
 * best-effort: ถ้าคอร์สไม่มีกลุ่ม/สิทธิ์ไม่พอ จะคืน { groups:{}, groupSets:[] }
 */
async function buildGroupData(config, courseId, userInfo) {
  const categories = await callProxy(config, 'group-categories', { courseId });
  const catName = {};
  (categories || []).forEach((c) => { if (c && c.id != null) catName[c.id] = c.name || `Group Set ${c.id}`; });

  const groupsList = await callProxy(config, 'course-groups', { courseId });
  const validGroups = (groupsList || []).filter((g) => g && g.id != null);
  if (validGroups.length === 0) return { groups: {}, groupSets: [] };

  // ดึงสมาชิกแต่ละกลุ่มพร้อมกัน
  const memberships = await Promise.all(
    validGroups.map((g) =>
      callProxy(config, 'group-memberships', { groupId: g.id })
        .then((m) => ({ group: g, members: m || [] }))
        .catch(() => ({ group: g, members: [] }))
    )
  );

  const groups = {};
  const groupSetSet = new Set();
  memberships.forEach(({ group, members }) => {
    const setName = catName[group.group_category_id] || 'กลุ่ม';
    members.forEach((mem) => {
      const info = userInfo[mem.user_id];
      if (!info || !info.sisId) return;
      if (!groups[info.sisId]) groups[info.sisId] = { studentName: info.name, section: '' };
      groups[info.sisId][setName] = group.name || `กลุ่ม ${group.id}`;
      groupSetSet.add(setName);
    });
  });

  return { groups, groupSets: Array.from(groupSetSet) };
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
export async function fetchPeerReviewData(config, courseId, assignmentId, onProgress) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};

  // 1) assignment -> rubric (เกณฑ์) + rubric id  (คำขอแรก = ตรวจ token/สิทธิ์ไปในตัว)
  report('ตรวจสอบ token + ดึงข้อมูล assignment', 'running');
  const assignment = await callProxy(config, 'assignment', { courseId, assignmentId });
  report('ตรวจสอบ token + ดึงข้อมูล assignment', 'done', assignment?.name || '');

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
  report('ดึงรายชื่อนักศึกษา', 'running');
  const users = await callProxy(config, 'users', { courseId }, (n) => report('ดึงรายชื่อนักศึกษา', 'running', `${n} คน...`));
  report('ดึงรายชื่อนักศึกษา', 'done', `${(users || []).length} คน`);
  const userMap = {};
  const userInfo = {}; // userId -> { sisId, name } (ใช้สร้างข้อมูลกลุ่ม)
  (users || []).forEach((u) => {
    if (u && u.id != null) {
      userMap[u.id] = formatName(u);
      userInfo[u.id] = {
        sisId: (u.sis_user_id || u.login_id || '').toString().trim(),
        name: (u.sortable_name || u.name || '').toString().trim(),
      };
    }
  });

  // 3) submissions -> map submissionId -> owner + เก็บ submission_comments แยกตามผู้เขียน
  report('ดึงการส่งงาน (submissions)', 'running');
  const submissions = await callProxy(config, 'submissions', { courseId, assignmentId }, (n) => report('ดึงการส่งงาน (submissions)', 'running', `${n} งาน...`));
  report('ดึงการส่งงาน (submissions)', 'done', `${(submissions || []).length} งาน`);
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
  report('ดึงการมอบหมายรีวิว (peer reviews)', 'running');
  const peerReviews = await callProxy(config, 'peer-reviews', { courseId, assignmentId }, (n) => report('ดึงการมอบหมายรีวิว (peer reviews)', 'running', `${n} รายการ...`));
  report('ดึงการมอบหมายรีวิว (peer reviews)', 'done', `${(peerReviews || []).length} รายการ`);

  // 5) rubric peer assessments -> คะแนน + คอมเมนต์รายเกณฑ์
  report('ดึงคะแนนรายเกณฑ์ (rubric)', 'running');
  let rubricAssessments = [];
  if (rubricId) {
    try {
      const rubricData = await callProxy(config, 'rubric', { courseId, rubricId, heavy: true });
      rubricAssessments = Array.isArray(rubricData?.assessments) ? rubricData.assessments : [];
      report('ดึงคะแนนรายเกณฑ์ (rubric)', 'done', `${rubricAssessments.length} การประเมิน`);
    } catch (e) {
      console.warn('ดึง rubric assessments ไม่สำเร็จ:', e.message);
      report('ดึงคะแนนรายเกณฑ์ (rubric)', 'error', `ดึงไม่สำเร็จ: ${e.message.slice(0, 80)} (จะขึ้นว่ายังไม่ทำ)`);
    }
  } else {
    report('ดึงคะแนนรายเกณฑ์ (rubric)', 'error', 'ไม่พบ rubric id');
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
        ownerCanvasId: ownerId,     // Canvas user id (ไว้ลิงก์ SpeedGrader)
        graderCanvasId: assessorId,
      };
    })
    .filter(Boolean);

  if (reviewRows.length === 0) {
    throw new Error('ไม่พบข้อมูล peer review ใน assignment นี้ (ตรวจว่าเปิด peer review และมีการมอบหมายแล้ว)');
  }

  report('ประมวลผลข้อมูล', 'running');
  const analysis = buildAnalysis(reviewRows, { maxScore });
  analysis.meta = {
    courseId,
    assignmentId,
    assignmentName: assignment?.name || `Assignment ${assignmentId}`,
    maxScore,
    pointsPossible: assignment?.points_possible ?? null,
  };
  report('ประมวลผลข้อมูล', 'done', `${Object.keys(analysis.students).length} นักศึกษา, ${Object.keys(analysis.graders).length} graders`);

  // ดึงข้อมูลกลุ่มอัตโนมัติ (best-effort — ไม่ให้ล้มทั้งกระบวนการถ้ากลุ่มมีปัญหา)
  report('ดึงข้อมูลกลุ่ม', 'running');
  try {
    analysis.groupData = await buildGroupData(config, courseId, userInfo);
    const gc = Object.keys(analysis.groupData.groups || {}).length;
    report('ดึงข้อมูลกลุ่ม', gc > 0 ? 'done' : 'error', gc > 0 ? `${gc} คน (${analysis.groupData.groupSets.join(', ')})` : 'ไม่พบกลุ่ม (ข้ามได้)');
  } catch (e) {
    console.warn('ดึงข้อมูลกลุ่มไม่สำเร็จ:', e.message);
    analysis.groupData = { groups: {}, groupSets: [] };
    report('ดึงข้อมูลกลุ่ม', 'error', `ดึงไม่สำเร็จ (ข้ามได้): ${e.message.slice(0, 60)}`);
  }

  return analysis;
}
