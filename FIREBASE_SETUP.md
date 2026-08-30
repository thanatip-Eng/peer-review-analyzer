# 🔥 คู่มือตั้งค่า Firebase สำหรับ Peer Review Analyzer

## สารบัญ
1. [สร้าง Firebase Project](#1-สร้าง-firebase-project)
2. [เปิดใช้ Authentication](#2-เปิดใช้-authentication)
3. [สร้าง Firestore Database](#3-สร้าง-firestore-database)
4. [ตั้งค่า Security Rules](#4-ตั้งค่า-security-rules)
5. [เพิ่ม Web App และ Config](#5-เพิ่ม-web-app-และ-config)
6. [ตั้งค่า Environment Variables](#6-ตั้งค่า-environment-variables)
7. [เพิ่ม Admin คนแรก](#7-เพิ่ม-admin-คนแรก)

---

## 1. สร้าง Firebase Project

### Step 1.1: เข้า Firebase Console
1. ไปที่ [console.firebase.google.com](https://console.firebase.google.com)
2. Login ด้วย Google Account

### Step 1.2: สร้าง Project ใหม่
1. คลิก **"Create a project"** หรือ **"Add project"**

2. **Step 1 - Project name:**
   ```
   Project name: peer-review-cmu
   ```
   - ชื่อ Project ID จะถูกสร้างอัตโนมัติ (เช่น `peer-review-cmu-xxxxx`)
   - คลิก **"Continue"**

3. **Step 2 - Google Analytics:**
   - เลือก **"Disable Google Analytics"** (ไม่จำเป็นต้องใช้)
   - คลิก **"Create project"**

4. รอประมาณ 30 วินาที → คลิก **"Continue"**

---

## 2. เปิดใช้ Authentication

### Step 2.1: เข้าหน้า Authentication
1. ในเมนูซ้าย คลิก **"Build"** → **"Authentication"**
2. คลิก **"Get started"**

### Step 2.2: เปิด Google Sign-In
1. ไปที่ Tab **"Sign-in method"**
2. คลิก **"Google"** ในรายการ Sign-in providers

3. ตั้งค่า:
   ```
   ☑ Enable (เปิด toggle)
   Project public-facing name: Peer Review Analyzer
   Project support email: [เลือกอีเมลของคุณ]
   ```

4. คลิก **"Save"**

### Step 2.3: เปิด Email/Password Sign-In
1. ไปที่ Tab **"Sign-in method"**
2. คลิก **"Email/Password"** ในรายการ Sign-in providers
3. ตั้งค่า:
   ```
   ☑ Enable (เปิด toggle ตัวแรก)
   ☐ Email link (passwordless sign-in) - ไม่ต้องเปิด
   ```
4. คลิก **"Save"**

### Step 2.4: เพิ่ม Authorized Domain (สำหรับ Vercel)
1. ไปที่ Tab **"Settings"** → **"Authorized domains"**
2. คลิก **"Add domain"**
3. เพิ่ม domain ของ Vercel:
   ```
   your-app-name.vercel.app
   ```
   (แทนที่ด้วยชื่อจริงของคุณ)

---

## 3. สร้าง Firestore Database

### Step 3.1: สร้าง Database
1. ในเมนูซ้าย คลิก **"Build"** → **"Firestore Database"**
2. คลิก **"Create database"**

### Step 3.2: ตั้งค่า Location
1. เลือก Location:
   ```
   ☑ asia-southeast1 (Singapore)
   ```
   ⚠️ **สำคัญ:** เลือกแล้วเปลี่ยนไม่ได้!

2. คลิก **"Next"**

### Step 3.3: Security Rules
1. เลือก **"Start in test mode"** (จะแก้ทีหลัง)
2. คลิก **"Create"**

---

## 4. ตั้งค่า Security Rules

### Step 4.1: เข้าหน้า Rules
1. ไปที่ **Firestore Database** → Tab **"Rules"**

### Step 4.2: วาง Rules นี้
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ฟังก์ชันตรวจสอบว่าเป็น Admin หรือไม่
    function isAdmin() {
      return request.auth != null && 
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    // ฟังก์ชันตรวจสอบว่าเป็น TA หรือไม่
    function isTA() {
      return request.auth != null && 
             get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'ta';
    }
    
    // ฟังก์ชันตรวจสอบว่า login แล้วหรือไม่
    function isLoggedIn() {
      return request.auth != null;
    }
    
    // Collection: users
    // เก็บข้อมูลผู้ใช้ (admin, ta, pending)
    match /users/{userId} {
      // อ่านได้เฉพาะ: ตัวเอง หรือ admin
      allow read: if isLoggedIn() && (request.auth.uid == userId || isAdmin());
      // ผู้ใช้ใหม่สร้าง doc ตัวเองเป็น pending ได้ (ตอน login ด้วย Google ครั้งแรก)
      allow create: if request.auth.uid == userId && request.resource.data.role == 'pending';
      // แก้ข้อมูลตัวเองได้ แต่ห้ามเปลี่ยน role (กันยกระดับสิทธิ์เอง) — admin แก้ได้ทุกอย่าง
      allow update: if isAdmin() || (request.auth.uid == userId && request.resource.data.role == resource.data.role);
      allow delete: if isAdmin();
    }
    
    // Collection: semesters
    // เก็บข้อมูลเทอมและไฟล์ที่อัปโหลด
    match /semesters/{semesterId} {
      // อ่านได้: admin และ ta ที่ได้รับสิทธิ์
      allow read: if isLoggedIn() && (isAdmin() || isTA());
      // เขียนได้เฉพาะ: admin
      allow write: if isAdmin();
      
      // Sub-collection: peerReviewData
      match /peerReviewData/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin();
      }
      
      // Sub-collection: studentData
      match /studentData/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin();
      }

      // Sub-collection: peerQAData (คะแนน Q&A จาก MS Form)
      match /peerQAData/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin();
      }

      // Sub-collection: reviewStatuses (สถานะ/โน้ตการตรวจของ TA)
      match /reviewStatuses/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin() || isTA();
      }

      // Sub-collection: qaReviewOverrides (TA แก้คะแนนรีวิว Q&A 0/1)
      match /qaReviewOverrides/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin() || isTA();
      }

      // Sub-collection: clipScoreOverrides (TA ใส่คะแนนคลิปสิ้นสุด)
      match /clipScoreOverrides/{docId} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin() || isTA();
      }

      // เผื่อ subcollection อื่น ๆ ในอนาคต: อ่านได้ (admin/ta), เขียนได้เฉพาะ admin
      match /{document=**} {
        allow read: if isLoggedIn() && (isAdmin() || isTA());
        allow write: if isAdmin();
      }
    }
    
    // Collection: taAssignments
    // เก็บข้อมูลว่า TA ดูแลกลุ่มไหน
    match /taAssignments/{odcId} {
      allow read: if isLoggedIn() && (isAdmin() || isTA());
      allow write: if isAdmin();
    }

    // Collection: canvasConfigs
    // เก็บ Canvas API token ของแต่ละคน (คีย์ด้วย uid) — เจ้าของอ่าน/เขียนของตัวเองได้
    match /canvasConfigs/{userId} {
      allow read, write: if isLoggedIn() && request.auth.uid == userId;
    }
    
    // Collection: settings
    // เก็บ settings ของระบบ
    match /settings/{docId} {
      allow read: if isLoggedIn();
      allow write: if isAdmin();
    }
  }
}
```

3. คลิก **"Publish"**

---

## 5. เพิ่ม Web App และ Config

### Step 5.1: เพิ่ม Web App
1. ไปที่ **Project Overview** (หน้าแรก)
2. คลิกไอคอน **"</>"** (Web)

3. กรอกข้อมูล:
   ```
   App nickname: peer-review-web
   ☐ Also set up Firebase Hosting (ไม่ต้องติ๊ก)
   ```

4. คลิก **"Register app"**

### Step 5.2: คัดลอก Config
จะเห็น Firebase Config แบบนี้:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "peer-review-cmu.firebaseapp.com",
  projectId: "peer-review-cmu",
  storageBucket: "peer-review-cmu.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

**เก็บค่าเหล่านี้ไว้!** จะใช้ในขั้นตอนถัดไป

5. คลิก **"Continue to console"**

---

## 6. ตั้งค่า Environment Variables

### สำหรับ Local Development
สร้างไฟล์ `.env.local` ใน root ของ project:

```env
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=peer-review-cmu.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=peer-review-cmu
VITE_FIREBASE_STORAGE_BUCKET=peer-review-cmu.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

### สำหรับ Vercel
1. ไปที่ [vercel.com](https://vercel.com) → Project ของคุณ
2. คลิก **"Settings"** → **"Environment Variables"**
3. เพิ่มทีละตัว:

| Name | Value |
|------|-------|
| `VITE_FIREBASE_API_KEY` | AIzaSy... |
| `VITE_FIREBASE_AUTH_DOMAIN` | peer-review-cmu.firebaseapp.com |
| `VITE_FIREBASE_PROJECT_ID` | peer-review-cmu |
| `VITE_FIREBASE_STORAGE_BUCKET` | peer-review-cmu.appspot.com |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | 123456789012 |
| `VITE_FIREBASE_APP_ID` | 1:123456789012:web:abcdef123456 |

4. คลิก **"Save"** ทุกตัว
5. ไปที่ **"Deployments"** → คลิก **"Redeploy"**

---

## 7. เพิ่ม Admin คนแรก

### วิธีที่ 1: ผ่าน Firebase Console (แนะนำ)

1. **Login ครั้งแรก:**
   - เปิดเว็บ Peer Review Analyzer
   - Login ด้วย Google (อีเมลที่จะเป็น Admin)
   - ระบบจะสร้าง user document อัตโนมัติ

2. **ตั้งค่าเป็น Admin:**
   - ไปที่ Firebase Console → Firestore Database
   - เปิด Collection **"users"**
   - หา document ที่มี email ของคุณ
   - แก้ไข field **"role"** จาก `"pending"` เป็น `"admin"`

### วิธีที่ 2: สร้าง Document โดยตรง

1. ไปที่ Firebase Console → Firestore Database
2. คลิก **"Start collection"**
3. Collection ID: `users`
4. Document ID: (คัดลอก UID จาก Authentication → Users)
5. เพิ่ม Fields:

| Field | Type | Value |
|-------|------|-------|
| email | string | your-email@gmail.com |
| displayName | string | ชื่อของคุณ |
| role | string | admin |
| createdAt | timestamp | (คลิก timestamp แล้วเลือกวันที่) |

---

## 📊 โครงสร้าง Database

```
firestore/
├── users/                          # ข้อมูลผู้ใช้
│   └── {userId}/
│       ├── email: string
│       ├── displayName: string
│       ├── photoURL: string
│       ├── role: "admin" | "ta" | "pending"
│       └── createdAt: timestamp
│
├── semesters/                      # ข้อมูลแต่ละเทอม
│   └── {semesterId}/               # เช่น "2567-1"
│       ├── name: string            # "ภาคเรียนที่ 1/2567"
│       ├── courseCode: string      # "261xxx"
│       ├── courseName: string
│       ├── createdAt: timestamp
│       ├── createdBy: string (uid)
│       ├── peerReviewData/         # Sub-collection
│       │   └── {docId}/
│       │       ├── students: object
│       │       ├── graders: object
│       │       ├── reviews: array
│       │       └── stats: object
│       └── studentData/            # Sub-collection
│           └── {docId}/
│               ├── groups: object
│               └── groupSets: array
│
├── taAssignments/                  # การกำหนด TA
│   └── {odcId}/
│       ├── odcId: string           # UID ของ TA
│       ├── email: string
│       ├── semesterId: string
│       ├── assignedGroups: array   # ["Group A", "Group B"]
│       ├── canViewAll: boolean     # ดูได้ทุกกลุ่มหรือไม่
│       └── createdAt: timestamp
│
└── settings/                       # ตั้งค่าระบบ
    └── general/
        ├── currentSemester: string
        └── allowTARegistration: boolean
```

---

## ✅ Checklist

- [ ] สร้าง Firebase Project
- [ ] เปิด Google Authentication
- [ ] เพิ่ม Authorized Domain (Vercel)
- [ ] สร้าง Firestore Database
- [ ] ตั้งค่า Security Rules
- [ ] สร้าง Web App และคัดลอก Config
- [ ] ตั้งค่า Environment Variables ใน Vercel
- [ ] Redeploy บน Vercel
- [ ] เพิ่ม Admin คนแรก

---

## ❓ FAQ

**Q: เข้าเว็บแล้ว Login ไม่ได้?**
> ตรวจสอบว่าเพิ่ม Domain ใน Authorized domains แล้วหรือยัง

**Q: Login ได้แต่เห็นหน้าว่าง?**
> ตรวจสอบว่า user document มี role = "admin" หรือ "ta" แล้ว

**Q: TA เข้าไม่ได้?**
> Admin ต้องเพิ่ม TA ในระบบก่อน และกำหนด semesterId ให้ถูกต้อง

---

*อัปเดตล่าสุด: v12 - ระบบสิทธิ์การเข้าถึง*
