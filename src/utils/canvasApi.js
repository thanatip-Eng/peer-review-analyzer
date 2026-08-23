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

// เรียก Canvas GraphQL ผ่าน proxy (สำหรับดึงข้อมูลก้อนใหญ่แบบแบ่งหน้า cursor)
async function callGraphQL(config, query, variables) {
  const resp = await fetch('/api/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      apiKey: config.apiKey,
      canvasUrl: config.canvasUrl,
      graphql: { query, variables },
    }),
  });
  let payload = {};
  try {
    payload = await resp.json();
  } catch {
    // ignore
  }
  if (!resp.ok) {
    throw new Error(payload.error || `เรียก Canvas (GraphQL) ไม่สำเร็จ (${resp.status})`);
  }
  if (payload.errors && payload.errors.length) {
    throw new Error('GraphQL: ' + payload.errors.map((e) => e.message).join('; ').slice(0, 160));
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
// GraphQL query: ดึง submissions ทีละหน้า (cursor) พร้อมคะแนน peer rubric ในคำขอเดียว
const PEER_QUERY = `
query PeerReview($aid: ID!, $after: String) {
  assignment(id: $aid) {
    _id
    name
    pointsPossible
    rubric { criteria { _id description points } }
    submissionsConnection(first: 40, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        _id
        late
        secondsLate
        user { _id name sortableName sisId }
        rubricAssessmentsConnection(first: 25) {
          nodes {
            assessmentType
            score
            assessor { _id name sortableName sisId }
            assessmentRatings { criterion { _id } points comments }
          }
        }
      }
    }
  }
}`;

const graphName = (u) => {
  if (!u) return '';
  const sid = (u.sisId || '').toString().trim();
  const name = (u.sortableName || u.name || '').toString().trim();
  return sid ? `${sid} ${name}`.trim() : name;
};

/**
 * ดึงและประกอบข้อมูล peer review ของ assignment หนึ่งด้วย Canvas GraphQL (รองรับ course ใหญ่)
 * แบ่งหน้าแบบ cursor -> แต่ละคำขอเล็ก/เร็ว ไม่ชน timeout
 * หมายเหตุ: GraphQL ให้เฉพาะรีวิวที่ "ทำเสร็จ" (มี rubric assessment) จึงกำหนด assignedPerGrader=3
 * @returns ผลลัพธ์จาก buildAnalysis: { reviews, students, graders, stats, meta, groupData }
 */
export async function fetchPeerReviewData(config, courseId, assignmentId, onProgress) {
  const report = typeof onProgress === 'function' ? onProgress : () => {};

  // หน้าแรก = ตรวจ token/สิทธิ์ + ได้ข้อมูล assignment/rubric ไปในตัว
  report('ตรวจสอบ token + ดึงข้อมูล assignment', 'running');
  let data = await callGraphQL(config, PEER_QUERY, { aid: String(assignmentId), after: null });
  const assignment = data && data.assignment;
  if (!assignment) {
    throw new Error('ไม่พบ assignment (ตรวจ token/สิทธิ์ หรือหมายเลข assignment)');
  }
  report('ตรวจสอบ token + ดึงข้อมูล assignment', 'done', assignment.name || '');

  const rubricCriteria = (assignment.rubric && assignment.rubric.criteria) || [];
  if (!rubricCriteria.length) {
    throw new Error('Assignment นี้ไม่มี Rubric — ไม่สามารถดึงคะแนนรายเกณฑ์ได้');
  }
  // map criterion _id -> key ของ analyzer (ตามลำดับเกณฑ์)
  const critIdToKey = {};
  rubricCriteria.forEach((c, i) => {
    const key = DEFAULT_CRITERIA[i] && DEFAULT_CRITERIA[i].key;
    if (key) critIdToKey[c._id] = key;
  });
  const rubricTotal = rubricCriteria.reduce((s, c) => s + (Number(c.points) || 0), 0);
  const maxScore =
    assignment.pointsPossible != null && assignment.pointsPossible > 0
      ? Number(assignment.pointsPossible)
      : rubricTotal > 0
      ? rubricTotal
      : 12;

  const reviewRows = [];
  const userInfo = {}; // userId -> { sisId, name } (ไว้สร้างข้อมูลกลุ่ม)
  const recordUser = (u) => {
    if (u && u._id != null && !userInfo[u._id]) {
      userInfo[u._id] = { sisId: (u.sisId || '').toString().trim(), name: (u.sortableName || u.name || '').toString().trim() };
    }
  };

  report('ดึง submissions + คะแนน peer', 'running', '0 งาน...');
  let conn = assignment.submissionsConnection;
  let processed = 0;
  let guard = 0;
  while (conn) {
    (conn.nodes || []).forEach((sub) => {
      const owner = sub.user;
      if (!owner) return;
      recordUser(owner);
      const ownerName = graphName(owner);
      (sub.rubricAssessmentsConnection && sub.rubricAssessmentsConnection.nodes || []).forEach((a) => {
        if (a.assessmentType !== 'peer_review') return; // เฉพาะ peer review
        const assessor = a.assessor;
        if (!assessor) return;
        recordUser(assessor);
        const comments = DEFAULT_CRITERIA.reduce((acc, c) => ((acc[c.key] = ''), acc), {});
        (a.assessmentRatings || []).forEach((r) => {
          const key = r.criterion && critIdToKey[r.criterion._id];
          if (key) comments[key] = r.comments || '';
        });
        reviewRows.push({
          studentName: ownerName,
          graderName: graphName(assessor),
          gradeGiven: a.score != null ? Number(a.score) : null,
          gradeAverage: null,
          submissionComments: '',
          comments,
          ownerLate: !!sub.late,
          ownerSecondsLate: Number(sub.secondsLate) || 0,
          ownerCanvasId: owner._id,
          graderCanvasId: assessor._id,
        });
      });
      processed++;
    });
    report('ดึง submissions + คะแนน peer', 'running', `${processed} งาน...`);

    if (!(conn.pageInfo && conn.pageInfo.hasNextPage)) break;
    guard++;
    if (guard > 1000) break;
    const d = await callGraphQL(config, PEER_QUERY, { aid: String(assignmentId), after: conn.pageInfo.endCursor });
    conn = d && d.assignment && d.assignment.submissionsConnection;
  }
  report('ดึง submissions + คะแนน peer', 'done', `${processed} งาน, ${reviewRows.length} รีวิว`);

  if (reviewRows.length === 0) {
    throw new Error('ไม่พบ peer review ที่ทำเสร็จใน assignment นี้ (ยังไม่มีใครรีวิว หรือยังไม่ได้ให้คะแนน rubric)');
  }

  report('ประมวลผลข้อมูล', 'running');
  const analysis = buildAnalysis(reviewRows, { maxScore, assignedPerGrader: 3 });
  analysis.meta = {
    courseId,
    assignmentId,
    assignmentName: assignment.name || `Assignment ${assignmentId}`,
    maxScore,
    pointsPossible: assignment.pointsPossible != null ? assignment.pointsPossible : null,
  };
  report('ประมวลผลข้อมูล', 'done', `${Object.keys(analysis.students).length} นักศึกษา, ${Object.keys(analysis.graders).length} graders`);

  // ดึงข้อมูลกลุ่มอัตโนมัติ (REST — เบา; best-effort)
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
