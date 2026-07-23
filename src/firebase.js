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

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyAaI0tzBul3syokJVMpubHjcppdWSVsCOE',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'peer-review-analyzer.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'peer-review-analyzer',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'peer-review-analyzer.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '365548948350',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:365548948350:web:dfb87c679c94683c60812f'
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
