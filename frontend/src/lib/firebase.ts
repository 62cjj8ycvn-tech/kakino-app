import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
apiKey: "AIzaSyDeFs1xNEn9ymDghZzadLgzG-6cea1ORkg",
authDomain: "kakeibo1-410e7.firebaseapp.com",
projectId: "kakeibo1-410e7",
storageBucket: "kakeibo1-410e7.firebasestorage.app",
messagingSenderId: "230935675368",
appId: "1:230935675368:web:fa28fe831129ce2fa8245d",
measurementId: "G-XYW4ZXM9R6"
};

export const app = initializeApp(firebaseConfig);
export const analytics = getAnalytics(app);
