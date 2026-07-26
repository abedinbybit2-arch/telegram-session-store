/**
 * Firestore session vault — encrypted payloads only (no plain session strings)
 */
import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

function sessionsCol(uid) {
  return collection(db, "users", uid, "sessions");
}

function sessionDoc(uid, id) {
  return doc(db, "users", uid, "sessions", id);
}

export function makeSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveSession(uid, data) {
  const id = data.id || makeSessionId();
  const ref = sessionDoc(uid, id);
  const payload = {
    id,
    label: data.label || data.profile?.displayName || "Telegram Account",
    format: data.format || "telethon",
    encryptedSession: data.encryptedSession,
    active: data.active !== false,
    profile: data.profile || {},
    status: data.status || "saved",
    lastCheckedAt: data.lastCheckedAt || null,
    createdAt: data.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
  return { ...payload, id };
}

export async function listSessions(uid) {
  try {
    const q = query(sessionsCol(uid), orderBy("updatedAt", "desc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(sessionsCol(uid));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

export function watchSessions(uid, cb) {
  return onSnapshot(
    sessionsCol(uid),
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      items.sort((a, b) => {
        const ta = a.updatedAt?.toMillis?.() || a.updatedAt?.seconds * 1000 || 0;
        const tb = b.updatedAt?.toMillis?.() || b.updatedAt?.seconds * 1000 || 0;
        return tb - ta;
      });
      cb(items);
    },
    (err) => {
      console.warn("watchSessions", err);
      cb([]);
    }
  );
}

export async function setSessionActive(uid, id, active) {
  await updateDoc(sessionDoc(uid, id), {
    active: Boolean(active),
    status: active ? "active" : "paused",
    updatedAt: serverTimestamp(),
  });
}

export async function updateSessionMeta(uid, id, patch) {
  await updateDoc(sessionDoc(uid, id), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function removeSession(uid, id) {
  await deleteDoc(sessionDoc(uid, id));
}
