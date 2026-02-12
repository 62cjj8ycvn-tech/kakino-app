// lib/firebase.ts
import { initializeApp, getApp, getApps, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ここはあなたの既存の設定をそのまま使ってOK
// すでに firebaseConfig が同じ形であるなら、そのまま残してOK
const firebaseConfig = {
apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

// ✅ app は “必ず FirebaseApp” にする（undefined にしない）
export const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);