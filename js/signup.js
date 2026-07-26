import { redirectIfAuthenticated, signUp, friendlyAuthError } from "./auth.js";

const form = document.getElementById("signup-form");
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
  const name = document.getElementById("name")?.value?.trim();
  const email = document.getElementById("email")?.value?.trim();
  const password = document.getElementById("password")?.value || "";
  const confirm = document.getElementById("confirm")?.value || "";
  if (!email || !password) {
    showError("Email and password are required.");
    return;
  }
  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }
  if (password !== confirm) {
    showError("Passwords do not match.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Creating account…";
  try {
    await signUp({ name, email, password });
    window.location.replace("/sessions.html");
  } catch (err) {
    showError(friendlyAuthError(err));
    btn.disabled = false;
    btn.textContent = "Create account";
  }
});
