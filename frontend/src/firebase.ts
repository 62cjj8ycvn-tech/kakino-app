import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
apiKey: "AIzaSyAJ6FRERuow32PlLILEmRCQRv-OLQw-eds",
  authDomain: "household-pwa.firebaseapp.com",
  projectId: "household-pwa",
  storageBucket: "household-pwa.firebasestorage.app",
  messagingSenderId: "119177501178",
  appId: "1:119177501178:web:f3f85e1c40b181350eec43",
  measurementId: "G-9JJN9P0RCY"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);