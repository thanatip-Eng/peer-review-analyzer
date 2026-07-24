// src/firebase.js
// Firebase web config. Prefers Vite build-time env (VITE_FIREBASE_*) when
// provided, and falls back to the project's public config so the app works
// even if the Vercel env vars are not injected into the build.
// NOTE: Firebase web config values are NOT secrets — they ship to the browser
// by design. Access is protected by Firestore Security Rules + Authorized
// domains, not by hiding these values.
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, EmailAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Fallback = โปรเจกต์ที่ใช้งานจริง (peer-review-111) เพื่อไม่ให้เผลอไปต่อฐานข้อมูลว่างถ้า env หลุด
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCVtutWjDVQitg1SxV6us10b2d7ZYfswjM',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'peer-review-111.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'peer-review-111',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'peer-review-111.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '513493961083',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:513493961083:web:fe85dafc4b913c576795de'
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Secondary app for creating users without signing out admin
const secondaryApp = initializeApp(firebaseConfig, 'secondary');

// Initialize services
export const auth = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
export const emailProvider = new EmailAuthProvider();

export default app;
