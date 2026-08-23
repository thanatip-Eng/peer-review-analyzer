// Vercel Serverless Function — Canvas LMS API proxy
// -------------------------------------------------
// ทำหน้าที่เป็น proxy ฝั่ง server: browser -> /api/canvas -> Canvas LMS API
// เพื่อเลี่ยงปัญหา CORS (Canvas ไม่ส่ง CORS header ให้ origin ภายนอก)
// และไม่ให้ Canvas access token หลุดไปอยู่ใน URL/log ฝั่ง client
//
// แพทเทิร์นเดียวกับ canvas-group-exporter: Authorization: Bearer <token> + วน Link header pagination
// รวมทุก resource ไว้ใน endpoint เดียว (dispatch ด้วย body.resource) เพื่อไม่ชนลิมิตจำนวน function

// ให้เวลา function มากขึ้น (บาง course มีนักศึกษาเยอะ ต้องวนหลายหน้า)
export const config = { maxDuration: 60 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch พร้อม timeout ต่อคำขอ (abort ที่ 20s) + retry เมื่อเจอ 5xx/timeout/network error
// เพื่อไม่ให้คำขอที่ค้างกินเวลา function จนหมด
async function fetchWithRetry(url, apiKey, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      // 5xx = ฝั่ง Canvas ชั่วคราว -> รอแล้วลองใหม่
      if (resp.status >= 500 && resp.status < 600 && i < attempts - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      return resp;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (i < attempts - 1) {
        await sleep(500 * (i + 1));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('fetch failed');
}

// ดึงแค่ "หน้าเดียว" แล้วคืน { data, next } เพื่อให้ฝั่ง browser วน pagination เอง
// -> แต่ละ invocation ของ function เล็ก/เร็ว ไม่ชน timeout แม้ course ใหญ่
async function fetchOnePage(url, apiKey) {
  const resp = await fetchWithRetry(url, apiKey);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`Canvas API ${resp.status}: ${text.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();

  let next = null;
  const link = resp.headers.get('link') || resp.headers.get('Link');
  if (link) {
    const nextLink = link.split(',').find((l) => l.includes('rel="next"'));
    if (nextLink) {
      const m = nextLink.match(/<([^>]+)>/);
      if (m) next = m[1];
    }
  }

  return { data, next };
}

function buildPath(resource, q) {
  const { courseId, assignmentId, rubricId, groupId } = q;
  switch (resource) {
    case 'group-categories':
      return `/api/v1/courses/${courseId}/group_categories?per_page=100`;
    case 'course-groups':
      return `/api/v1/courses/${courseId}/groups?per_page=100`;
    case 'group-memberships':
      return `/api/v1/groups/${groupId}/memberships?per_page=100`;
    case 'courses':
      return `/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`;
    case 'assignments':
      return `/api/v1/courses/${courseId}/assignments?per_page=100`;
    case 'assignment':
      // object เดี่ยว — คืน rubric (เกณฑ์) + rubric_settings.id
      return `/api/v1/courses/${courseId}/assignments/${assignmentId}`;
    case 'peer-reviews':
      // ไม่ต้อง include อะไร (ใช้แค่ assessor_id/user_id/asset_id/workflow_state) -> เบา/เร็ว
      return `/api/v1/courses/${courseId}/assignments/${assignmentId}/peer_reviews?per_page=100`;
    case 'submissions':
      // ใช้แค่ owner mapping + late (ตัด submission_comments ที่หนักออก เพื่อกัน 504 กับ course ใหญ่)
      return `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&per_page=50`;
    case 'rubric':
      // object เดี่ยว — รวม peer assessments แบบ full (คะแนน+คอมเมนต์รายเกณฑ์)
      return `/api/v1/courses/${courseId}/rubrics/${rubricId}?include[]=peer_assessments&style=full`;
    case 'users':
      return `/api/v1/courses/${courseId}/users?enrollment_type[]=student&per_page=100`;
    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body =
      typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { apiKey, canvasUrl, resource, nextUrl } = body;

    if (!apiKey || !canvasUrl) {
      return res.status(400).json({ error: 'Missing required field: apiKey or canvasUrl' });
    }

    const baseUrl = String(canvasUrl).trim().replace(/\/+$/, '');

    let url;
    if (nextUrl) {
      // หน้าถัดไป (cursor จาก Link header) — ต้องเป็นโดเมนเดียวกับ canvasUrl (กัน SSRF)
      if (!String(nextUrl).startsWith(baseUrl)) {
        return res.status(400).json({ error: 'Invalid nextUrl' });
      }
      url = nextUrl;
    } else {
      if (!resource) {
        return res.status(400).json({ error: 'Missing required field: resource' });
      }
      const path = buildPath(resource, body);
      if (!path) {
        return res.status(400).json({ error: `Unknown resource: ${resource}` });
      }
      url = `${baseUrl}${path}`;
    }

    const { data, next } = await fetchOnePage(url, apiKey);
    return res.status(200).json({ data, next });
  } catch (err) {
    const status = err.status || 500;
    console.error('Canvas proxy error:', err.message);
    return res.status(status).json({ error: err.message || 'Canvas proxy error' });
  }
}
