/**
 * Telegram Session Store — Firebase Web config
 * Web app: ABEDIN Automation - Telegram Session Store
 * Auth project: telegram-mtptoto (Email/Password enabled + authorized domains)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAm_jXjfjFQrsEMZGxq_J2B_nK4juOBXpk",
  authDomain: "telegram-mtptoto.firebaseapp.com",
  projectId: "telegram-mtptoto",
  storageBucket: "telegram-mtptoto.firebasestorage.app",
  messagingSenderId: "396870617976",
  appId: "1:396870617976:web:f1048ee9a5d3205936d68d",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const persistenceReady = setPersistence(auth, browserLocalPersistence).catch(
  (err) => {
    console.warn("Auth persistence:", err?.message || err);
  }
);

export { app, auth, db, firebaseConfig, persistenceReady };
