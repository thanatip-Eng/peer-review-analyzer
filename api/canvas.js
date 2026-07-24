// Vercel Serverless Function — Canvas LMS API proxy
// -------------------------------------------------
// ทำหน้าที่เป็น proxy ฝั่ง server: browser -> /api/canvas -> Canvas LMS API
// เพื่อเลี่ยงปัญหา CORS (Canvas ไม่ส่ง CORS header ให้ origin ภายนอก)
// และไม่ให้ Canvas access token หลุดไปอยู่ใน URL/log ฝั่ง client
//
// แพทเทิร์นเดียวกับ canvas-group-exporter: Authorization: Bearer <token> + วน Link header pagination
// รวมทุก resource ไว้ใน endpoint เดียว (dispatch ด้วย body.resource) เพื่อไม่ชนลิมิตจำนวน function

async function canvasFetch(baseUrl, path, apiKey) {
  const results = [];
  let single = null;
  let nextUrl = `${baseUrl}${path}`;

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      const err = new Error(`Canvas API ${resp.status}: ${text.slice(0, 300)}`);
      err.status = resp.status;
      throw err;
    }

    const data = await resp.json();

    // Endpoint ที่คืน object เดี่ยว (เช่น assignment, rubric) จะไม่มี pagination
    if (Array.isArray(data)) {
      results.push(...data);
    } else {
      single = data;
      break;
    }

    const link = resp.headers.get('link') || resp.headers.get('Link');
    nextUrl = null;
    if (link) {
      const next = link.split(',').find((l) => l.includes('rel="next"'));
      if (next) {
        const m = next.match(/<([^>]+)>/);
        if (m) nextUrl = m[1];
      }
    }
  }

  return single !== null ? single : results;
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
      return `/api/v1/courses/${courseId}/assignments/${assignmentId}/peer_reviews?include[]=user&include[]=submission_comments&per_page=100`;
    case 'submissions':
      return `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions?include[]=user&include[]=submission_comments&include[]=rubric_assessment&per_page=100`;
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
    const { apiKey, canvasUrl, resource } = body;

    if (!apiKey || !canvasUrl || !resource) {
      return res
        .status(400)
        .json({ error: 'Missing required field: apiKey, canvasUrl, or resource' });
    }

    const baseUrl = String(canvasUrl).trim().replace(/\/+$/, '');
    const path = buildPath(resource, body);
    if (!path) {
      return res.status(400).json({ error: `Unknown resource: ${resource}` });
    }

    const data = await canvasFetch(baseUrl, path, apiKey);
    return res.status(200).json({ data });
  } catch (err) {
    const status = err.status || 500;
    console.error('Canvas proxy error:', err.message);
    return res.status(status).json({ error: err.message || 'Canvas proxy error' });
  }
}
