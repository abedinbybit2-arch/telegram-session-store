import { initProtectedPage } from "./app-shell.js";
import { listSessions } from "./sessions-store.js";

const user = await initProtectedPage({ activeNav: "dashboard" });
const sessions = await listSessions(user.uid);

const total = sessions.length;
const active = sessions.filter((s) => s.active).length;
const paused = total - active;

const set = (id, val) => {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
};

set("stat-total", total);
set("stat-active", active);
set("stat-paused", paused);

const list = document.getElementById("recent-list");
const empty = document.getElementById("recent-empty");
if (list) {
  list.innerHTML = "";
  const recent = sessions.slice(0, 6);
  if (!recent.length) {
    if (empty) empty.hidden = false;
  } else {
    if (empty) empty.hidden = true;
    for (const s of recent) {
      const p = s.profile || {};
      const card = document.createElement("div");
      card.className = "mini-card";
      card.innerHTML = `
        <div class="mini-avatar">${(p.displayName || s.label || "T")[0].toUpperCase()}</div>
        <div class="mini-meta">
          <strong>${escapeHtml(p.displayName || s.label || "Account")}</strong>
          <span>${escapeHtml(p.username ? "@" + p.username : p.phone || p.id || "—")}</span>
        </div>
        <span class="pill ${s.active ? "on" : "off"}">${s.active ? "Active" : "Off"}</span>
      `;
      list.appendChild(card);
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
