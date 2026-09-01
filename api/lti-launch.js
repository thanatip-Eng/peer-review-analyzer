// api/lti-launch.js
// -----------------------------------------------------------------------------
// หน้าด่านยืนยันตัวตนด้วย Canvas LTI 1.1 (OAuth 1.0 HMAC-SHA1)
// รับ POST launch ที่ Canvas เซ็นชื่อมา -> ตรวจลายเซ็นฝั่ง server -> กัน replay
// -> เช็ค allowlist -> mint Firebase custom token (role=student) -> ส่งหน้า HTML
// ที่ signInWithCustomToken แล้วพาเข้าแอป
//
// Security invariants (ห้ามละเมิด):
// - shared secret อยู่ใน env ฝั่ง server เท่านั้น (LTI_SECRET) ไม่หลุดไป client
// - ตรวจลายเซ็นฝั่ง server เสมอ; เปิด URL ตรง (ไม่มี launch ที่เซ็น) = ไม่ได้ session
// - URL ที่ใช้คำนวณลายเซ็น = LTI_LAUNCH_URL จาก env เป๊ะ ๆ ห้าม reconstruct จาก headers
// -----------------------------------------------------------------------------
import crypto from 'crypto';
import { adminAuth, adminDb } from './_lib/firebaseAdmin.js';

export const config = { maxDuration: 30 };

// Firebase web config (ค่าสาธารณะ ไม่ใช่ความลับ — ตรงกับ src/firebase.js)
const WEB_CONFIG = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || 'AIzaSyCVtutWjDVQitg1SxV6us10b2d7ZYfswjM',
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'peer-review-111.firebaseapp.com',
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'peer-review-111',
  appId: process.env.VITE_FIREBASE_APP_ID || '1:513493961083:web:fe85dafc4b913c576795de',
};

// percent-encode ตาม RFC3986 (OAuth) — เข้ารหัสทุกตัวยกเว้น unreserved A-Za-z0-9-._~
function pe(v) {
  return encodeURIComponent(String(v)).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// สร้าง signature base string ตาม OAuth 1.0
function baseString(method, url, params) {
  const pairs = Object.keys(params)
    .filter((k) => k !== 'oauth_signature' && k !== 'realm')
    .map((k) => [pe(k), pe(params[k])])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return `${method.toUpperCase()}&${pe(url)}&${pe(pairs)}`;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function htmlPage(body) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ตรวจสอบผลอุทธรณ์คะแนน</title><style>body{font-family:system-ui,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px}.card{max-width:440px;text-align:center;background:#1e293b;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px}a{color:#38bdf8}</style></head><body><div class="card">${body}</div></body></html>`;
}

function denyPage(res, code, message) {
  res.status(code).setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(htmlPage(`<h2>ไม่สามารถเข้าใช้งานได้</h2><p>${message}</p>`));
}

async function latestSemesterId(db) {
  const snap = await db.collection('semesters').get();
  const ids = snap.docs.map((d) => d.id).sort((a, b) => b.localeCompare(a));
  return ids[0] || null;
}

export default async function handler(req, res) {
  // เปิด URL ตรง (GET) = ไม่มี launch ที่เซ็น -> ปฏิเสธ
  if (req.method !== 'POST') {
    return denyPage(res, 405, 'หน้านี้ต้องเปิดผ่าน Canvas เท่านั้น (คลิกลิงก์ในรายวิชา)');
  }

  try {
    const params =
      typeof req.body === 'string'
        ? Object.fromEntries(new URLSearchParams(req.body))
        : req.body || {};

    const LTI_KEY = process.env.LTI_KEY;
    const LTI_SECRET = process.env.LTI_SECRET;
    const LTI_LAUNCH_URL = process.env.LTI_LAUNCH_URL;
    if (!LTI_KEY || !LTI_SECRET || !LTI_LAUNCH_URL) {
      return denyPage(res, 500, 'ระบบยังตั้งค่าไม่ครบ (LTI env) — ติดต่อผู้ดูแล');
    }

    // 1) ตรวจ consumer key + วิธีเซ็น
    if (params.oauth_consumer_key !== LTI_KEY) return denyPage(res, 401, 'consumer key ไม่ถูกต้อง');
    if (params.oauth_signature_method && params.oauth_signature_method !== 'HMAC-SHA1') {
      return denyPage(res, 401, 'วิธีเซ็นไม่รองรับ');
    }

    // 2) ตรวจ timestamp (กันของเก่า/replay) ±5 นาที
    const ts = parseInt(params.oauth_timestamp, 10);
    if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) {
      return denyPage(res, 401, 'คำขอหมดอายุ (timestamp) — ลองคลิกลิงก์ใหม่');
    }

    // 3) verify signature (server-side, ใช้ URL จาก env เป๊ะ)
    const base = baseString(req.method, LTI_LAUNCH_URL, params);
    const signingKey = `${pe(LTI_SECRET)}&`; // ไม่มี token secret ใน LTI 1.1
    const expected = crypto.createHmac('sha1', signingKey).update(base).digest('base64');
    if (!params.oauth_signature || !safeEqual(expected, params.oauth_signature)) {
      return denyPage(res, 401, 'ลายเซ็นไม่ถูกต้อง (คำขออาจถูกปลอมหรือ Launch URL ตั้งไม่ตรง)');
    }

    const db = adminDb();

    // 4) กัน replay ด้วย nonce (เขียนครั้งเดียว)
    const nonce = String(params.oauth_nonce || '');
    if (!nonce) return denyPage(res, 401, 'ไม่มี nonce');
    const nonceRef = db.collection('ltiNonces').doc(nonce.replace(/[/]/g, '_'));
    const nonceSnap = await nonceRef.get();
    if (nonceSnap.exists) return denyPage(res, 401, 'คำขอถูกใช้ไปแล้ว (replay)');
    await nonceRef.set({ ts: Date.now() });

    // 5) อ่านอีเมลที่ Canvas ยืนยัน -> รหัส นศ.
    const email = String(params.lis_person_contact_email_primary || '').trim().toLowerCase();
    if (!email) {
      return denyPage(res, 403, 'Canvas ไม่ได้ส่งอีเมล — ตั้งค่า Privacy ของ External App เป็น "Public"');
    }
    const sisId = email.split('@')[0];
    if (!/^\d{9,10}$/.test(sisId)) {
      return denyPage(res, 403, `อีเมล ${email} ไม่ใช่รูปแบบอีเมลนักศึกษา (รหัส@cmu.ac.th)`);
    }

    // 6) allowlist: การ launch ผ่าน LTI สำเร็จ = Canvas ยืนยันว่าเป็นสมาชิกคอร์สนี้แล้ว
    // (Canvas ยิง launch ให้เฉพาะคนในคอร์ส) + อีเมลเป็นรูปแบบรหัส นศ. -> อนุญาตให้เข้ายื่น/ดูคำร้อง
    // ถ้ามี denylist ในอนาคตค่อยเสริม; ตอนนี้ enrollment คือด่านหลัก
    const semesterId = params.custom_semester || (await latestSemesterId(db));
    if (!semesterId) return denyPage(res, 500, 'ยังไม่มีข้อมูลเทอมในระบบ');
    const denySnap = await db.collection('semesters').doc(semesterId).collection('appealDenylist').doc(sisId).get();
    if (denySnap.exists) return denyPage(res, 403, `บัญชี ${email} ถูกระงับการเข้าถึง — ติดต่ออาจารย์`);

    // 7) mint custom token (uid = รหัส นศ., claim role=student)
    const token = await adminAuth().createCustomToken(sisId, {
      role: 'student',
      email,
      semesterId,
    });

    // 8) ส่งหน้า HTML ที่ sign in แล้วพาเข้าแอป (same origin -> session ติดไปกับ SPA)
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(
      htmlPage(
        `<div style="width:40px;height:40px;border:4px solid #38bdf8;border-top-color:transparent;border-radius:50%;margin:0 auto 16px;animation:spin 1s linear infinite"></div>
<p>กำลังเข้าสู่ระบบ...</p>
<noscript><p>ต้องเปิด JavaScript</p></noscript>
<style>@keyframes spin{to{transform:rotate(360deg)}}</style>
<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
<script>
  firebase.initializeApp(${JSON.stringify(WEB_CONFIG)});
  firebase.auth().signInWithCustomToken(${JSON.stringify(token)})
    .then(function(){ window.location.replace('/'); })
    .catch(function(e){ document.querySelector('.card').innerHTML = '<h2>เข้าสู่ระบบไม่สำเร็จ</h2><p>'+(e && e.message ? e.message : e)+'</p>'; });
</script>`,
      ),
    );
  } catch (err) {
    console.error('LTI launch error:', err);
    return denyPage(res, 500, `เกิดข้อผิดพลาด: ${err.message || err}`);
  }
}
