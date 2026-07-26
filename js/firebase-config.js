/**
 * Telegram Session Store — Firebase Web config
 * Project: abedin-automation (ABEDIN Automation)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBdol6PSRLgh7KXTj_ldRL-2eq25wB_OiA",
  authDomain: "abedin-automation.firebaseapp.com",
  projectId: "abedin-automation",
  storageBucket: "abedin-automation.firebasestorage.app",
  messagingSenderId: "558654478096",
  appId: "1:558654478096:web:3a63c194c951fdd9877795",
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
