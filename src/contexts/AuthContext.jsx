// src/contexts/AuthContext.jsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  signInWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../firebase';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Login with Google
  async function loginWithGoogle() {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      
      // Check if user exists in Firestore
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      
      if (!userSnap.exists()) {
        // Create new user document with pending role
        await setDoc(userRef, {
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          role: 'pending',
          authProvider: 'google',
          createdAt: serverTimestamp()
        });
      }
      
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  }

  // Login with Email/Password
  async function loginWithEmail(email, password) {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: result.user };
    } catch (error) {
      console.error('Login error:', error);
      let errorMessage = 'เข้าสู่ระบบไม่สำเร็จ';
      
      switch (error.code) {
        case 'auth/user-not-found':
          errorMessage = 'ไม่พบบัญชีผู้ใช้นี้';
          break;
        case 'auth/wrong-password':
          errorMessage = 'รหัสผ่านไม่ถูกต้อง';
          break;
        case 'auth/invalid-email':
          errorMessage = 'รูปแบบอีเมลไม่ถูกต้อง';
          break;
        case 'auth/too-many-requests':
          errorMessage = 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่';
          break;
        case 'auth/invalid-credential':
          errorMessage = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
          break;
        default:
          errorMessage = error.message;
      }
      
      return { success: false, error: errorMessage };
    }
  }

  // Change password
  async function changePassword(currentPassword, newPassword) {
    try {
      const user = auth.currentUser;
      
      // Re-authenticate user first
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      
      // Update password
      await updatePassword(user, newPassword);
      
      // Update Firestore to mark password as changed
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, { 
        passwordChanged: true,
        passwordChangedAt: serverTimestamp()
      }, { merge: true });
      
      return { success: true };
    } catch (error) {
      console.error('Change password error:', error);
      let errorMessage = 'เปลี่ยนรหัสผ่านไม่สำเร็จ';
      
      switch (error.code) {
        case 'auth/wrong-password':
          errorMessage = 'รหัสผ่านปัจจุบันไม่ถูกต้อง';
          break;
        case 'auth/weak-password':
          errorMessage = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร';
          break;
        default:
          errorMessage = error.message;
      }
      
      return { success: false, error: errorMessage };
    }
  }

  // Logout
  async function logout() {
    try {
      await signOut(auth);
      setUserRole(null);
      setUserData(null);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Fetch user data from Firestore
  async function fetchUserData(uid) {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      
      if (userSnap.exists()) {
        const data = userSnap.data();
        setUserRole(data.role);
        setUserData(data);
        return data;
      } else {
        setUserRole('pending');
        setUserData(null);
        return null;
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      setUserRole(null);
      setUserData(null);
      return null;
    }
  }

  // Listen for auth state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (user) {
        await fetchUserData(user.uid);
      } else {
        setUserRole(null);
        setUserData(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userRole,
    userData,
    loading,
    loginWithGoogle,
    loginWithEmail,
    changePassword,
    logout,
    fetchUserData,
    isAdmin: userRole === 'admin',
    isTA: userRole === 'ta',
    isPending: userRole === 'pending',
    isEmailAuth: userData?.authProvider === 'email'
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
