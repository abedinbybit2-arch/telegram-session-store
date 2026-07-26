/**
 * Auth helpers — Firebase email/password + durable browser session
 */
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { auth, persistenceReady } from "./firebase-config.js";

const LOGIN_PATH = "/login.html";
const APP_PATH = "/sessions.html";

export function waitForAuth() {
  return persistenceReady.then(
    () =>
      new Promise((resolve) => {
        const unsub = onAuthStateChanged(auth, (user) => {
          unsub();
          resolve(user);
        });
      })
  );
}

export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) {
    const next = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.replace(`${LOGIN_PATH}?next=${next}`);
    return new Promise(() => {});
  }
  return user;
}

export async function redirectIfAuthenticated(redirectTo = APP_PATH) {
  const user = await waitForAuth();
  if (user) {
    window.location.replace(redirectTo);
    return new Promise(() => {});
  }
  return null;
}

export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signUp({ name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const displayName = (name || "").trim();
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return cred.user;
}

export async function signIn({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logOut() {
  await signOut(auth);
}

export function friendlyAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/email-already-in-use": "This email is already registered. Try signing in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/user-not-found": "No account found with this email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || err?.message || "Authentication failed.";
}
