import { redirectIfAuthenticated, signIn, friendlyAuthError } from "./auth.js";

const form = document.getElementById("login-form");
const alertEl = document.getElementById("auth-alert");
const btn = document.getElementById("btn-submit");

function showError(msg) {
  if (!alertEl) return;
  alertEl.hidden = false;
  alertEl.textContent = msg;
  alertEl.className = "auth-alert error";
}

function clearError() {
  if (!alertEl) return;
  alertEl.hidden = true;
  alertEl.textContent = "";
}

await redirectIfAuthenticated("/sessions.html");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value || "";
  if (!email || !password) {
    showError("Email and password are required.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    await signIn({ email, password });
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/sessions.html";
    window.location.replace(next.startsWith("/") ? next : "/sessions.html");
  } catch (err) {
    showError(friendlyAuthError(err));
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});
