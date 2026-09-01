// api/_lib/firebaseAdmin.js
// -----------------------------------------------------------------------------
// เริ่ม Firebase Admin SDK ฝั่ง server (สำหรับ mint custom token + อ่าน/เขียน Firestore
// แบบข้าม security rules) โดยอ่าน service account จาก env `FIREBASE_ADMIN_KEY`
// (เป็น JSON string หรือ base64 ของ JSON). ห้าม commit ค่า key ลง repo.
// -----------------------------------------------------------------------------
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let ready = false;

function init() {
  if (ready || getApps().length) { ready = true; return; }
  const raw = process.env.FIREBASE_ADMIN_KEY;
  if (!raw) throw new Error('FIREBASE_ADMIN_KEY env is not set');
  let sa;
  try {
    sa = JSON.parse(raw);
  } catch {
    // เผื่อเก็บเป็น base64 (กันปัญหา newline ใน env UI)
    sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
  if (sa.private_key && sa.private_key.includes('\\n')) {
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  }
  initializeApp({ credential: cert(sa) });
  ready = true;
}

export function adminAuth() { init(); return getAuth(); }
export function adminDb() { init(); return getFirestore(); }
