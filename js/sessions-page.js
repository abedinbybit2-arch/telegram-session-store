/**
 * Multi-session manager — add, toggle, ping, persist via Firebase
 */
import { initProtectedPage } from "./app-shell.js";
import {
  watchSessions,
  saveSession,
  setSessionActive,
  removeSession,
  updateSessionMeta,
  makeSessionId,
} from "./sessions-store.js";
import {
  validateSession,
  activateEncryptedSession,
  pingEncryptedSession,
} from "./session-api.js";

const user = await initProtectedPage({ activeNav: "sessions" });

const els = {
  form: document.getElementById("add-form"),
  sessionInput: document.getElementById("session-string"),
  sessionType: document.getElementById("session-type"),
  sessionLabel: document.getElementById("session-label"),
  addAlert: document.getElementById("add-alert"),
  btnAdd: document.getElementById("btn-add-session"),
  grid: document.getElementById("sessions-grid"),
  empty: document.getElementById("sessions-empty"),
  countAll: document.getElementById("count-all"),
  countActive: document.getElementById("count-active"),
  liveBar: document.getElementById("live-bar"),
  btnRefreshAll: document.getElementById("btn-refresh-all"),
};

let sessions = [];
let liveTimer = null;
const liveState = new Map(); // id -> { ok, message, checking }

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showAlert(type, message) {
  if (!els.addAlert) return;
  els.addAlert.hidden = false;
  els.addAlert.className = `panel-alert ${type}`;
  els.addAlert.textContent = message;
}

function hideAlert() {
  if (!els.addAlert) return;
  els.addAlert.hidden = true;
  els.addAlert.textContent = "";
}

function updateCounts() {
  const active = sessions.filter((s) => s.active).length;
  if (els.countAll) els.countAll.textContent = String(sessions.length);
  if (els.countActive) els.countActive.textContent = String(active);
  if (els.liveBar) {
    els.liveBar.innerHTML = `
      <span class="live-dot ${active ? "pulse" : ""}"></span>
      <span><strong>${active}</strong> session${active === 1 ? "" : "s"} active while this page is open</span>
    `;
  }
}

function render() {
  updateCounts();
  if (!els.grid) return;
  els.grid.innerHTML = "";

  if (!sessions.length) {
    if (els.empty) els.empty.hidden = false;
    return;
  }
  if (els.empty) els.empty.hidden = true;

  for (const s of sessions) {
    const p = s.profile || {};
    const live = liveState.get(s.id) || {};
    const statusClass = !s.active
      ? "paused"
      : live.checking
        ? "checking"
        : live.ok === false
          ? "error"
          : "online";
    const statusLabel = !s.active
      ? "Paused"
      : live.checking
        ? "Connecting…"
        : live.ok === false
          ? "Error"
          : live.ok
            ? "Online"
            : s.status || "Saved";

    const card = document.createElement("article");
    card.className = `session-card ${s.active ? "is-active" : "is-off"}`;
    card.dataset.id = s.id;
    card.innerHTML = `
      <div class="session-card-top">
        <div class="session-avatar">${escapeHtml((p.displayName || s.label || "T")[0].toUpperCase())}</div>
        <div class="session-head">
          <h3>${escapeHtml(p.displayName || s.label || "Telegram Account")}</h3>
          <p>${escapeHtml(p.username ? "@" + p.username : p.phone || "ID " + (p.id || "—"))}</p>
        </div>
        <label class="toggle" title="Active On/Off">
          <input type="checkbox" data-toggle="${escapeHtml(s.id)}" ${s.active ? "checked" : ""} />
          <span class="toggle-track"></span>
        </label>
      </div>
      <div class="session-meta">
        <span class="chip">${escapeHtml((s.format || "telethon").toUpperCase())}</span>
        <span class="status-pill ${statusClass}">${escapeHtml(statusLabel)}</span>
        ${p.isPremium ? '<span class="chip premium">Premium</span>' : ""}
      </div>
      <div class="session-stats">
        <div><span>User ID</span><strong>${escapeHtml(p.id || "—")}</strong></div>
        <div><span>Phone</span><strong>${escapeHtml(p.phone || "—")}</strong></div>
        <div><span>Label</span><strong>${escapeHtml(s.label || "—")}</strong></div>
      </div>
      <p class="session-note">${escapeHtml(live.message || "Encrypted session vaulted in Firebase.")}</p>
      <div class="session-actions">
        <button type="button" class="btn ghost sm" data-ping="${escapeHtml(s.id)}">Check live</button>
        <button type="button" class="btn danger sm" data-delete="${escapeHtml(s.id)}">Remove</button>
      </div>
    `;
    els.grid.appendChild(card);
  }
}

async function activateAllActive() {
  const actives = sessions.filter((s) => s.active && s.encryptedSession);
  await Promise.allSettled(
    actives.map(async (s) => {
      liveState.set(s.id, { checking: true, message: "Activating session…" });
      render();
      try {
        const res = await activateEncryptedSession(
          s.encryptedSession,
          s.format || "telethon"
        );
        if (res.ok) {
          liveState.set(s.id, {
            ok: true,
            message: `Live · ${res.profile?.displayName || "connected"} · ${new Date().toLocaleTimeString()}`,
          });
          if (res.encryptedSession && res.encryptedSession !== s.encryptedSession) {
            await updateSessionMeta(user.uid, s.id, {
              encryptedSession: res.encryptedSession,
              profile: res.profile,
              status: "active",
              lastCheckedAt: res.checkedAt,
            });
          } else {
            await updateSessionMeta(user.uid, s.id, {
              profile: res.profile || s.profile,
              status: "active",
              lastCheckedAt: res.checkedAt || new Date().toISOString(),
            });
          }
        } else {
          liveState.set(s.id, {
            ok: false,
            message: res.error || "Failed to activate",
          });
          await updateSessionMeta(user.uid, s.id, { status: "error" });
        }
      } catch (err) {
        liveState.set(s.id, {
          ok: false,
          message: err?.message || "Network error",
        });
      }
      render();
    })
  );
}

function startLiveLoop() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = setInterval(async () => {
    const actives = sessions.filter((s) => s.active && s.encryptedSession);
    for (const s of actives) {
      try {
        const res = await pingEncryptedSession(
          s.encryptedSession,
          s.format || "telethon"
        );
        if (res.ok) {
          liveState.set(s.id, {
            ok: true,
            message: `Live · ${res.profile?.displayName || "ok"} · ${new Date().toLocaleTimeString()}`,
          });
          if (res.encryptedSession) {
            await updateSessionMeta(user.uid, s.id, {
              encryptedSession: res.encryptedSession,
              profile: res.profile,
              status: "active",
              lastCheckedAt: res.checkedAt,
            });
          }
        } else {
          liveState.set(s.id, {
            ok: false,
            message: res.error || "Ping failed",
          });
        }
      } catch (err) {
        liveState.set(s.id, {
          ok: false,
          message: err?.message || "Ping error",
        });
      }
    }
    render();
  }, 90000); // soft keepalive every 90s while page open
}

// Realtime Firebase sync — survives refresh & multi-device
let firstSnapshot = true;
let activateBusy = false;
watchSessions(user.uid, async (items) => {
  sessions = items;
  render();
  if (activateBusy) return;
  // Full activate on first load, or when new active sessions appear
  const needsActivate = firstSnapshot || items.some((s) => s.active);
  firstSnapshot = false;
  if (!needsActivate) return;
  activateBusy = true;
  try {
    await activateAllActive();
    startLiveLoop();
  } finally {
    activateBusy = false;
  }
});

els.form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideAlert();
  const session = els.sessionInput?.value?.trim();
  const type = els.sessionType?.value || "auto";
  const label = els.sessionLabel?.value?.trim() || "";
  if (!session) {
    showAlert("error", "Paste a Telethon or Pyrogram session string.");
    return;
  }
  if (session.length < 30) {
    showAlert(
      "error",
      "Session string is too short. Paste the full export string."
    );
    return;
  }

  els.btnAdd.disabled = true;
  els.btnAdd.textContent = "Validating…";
  showAlert("success", "Connecting to Telegram with your session… please wait.");
  try {
    const res = await validateSession(session, type);
    if (!res.ok || !res.encryptedSession) {
      showAlert(
        "error",
        res.error ||
          "Invalid session — Telegram did not authorize this string."
      );
      return;
    }
    const id = makeSessionId();
    try {
      await saveSession(user.uid, {
        id,
        label: label || res.profile?.displayName || "Telegram Account",
        format: res.format || type,
        encryptedSession: res.encryptedSession,
        active: true,
        profile: res.profile,
        status: "active",
        lastCheckedAt: res.checkedAt,
      });
    } catch (fsErr) {
      showAlert(
        "error",
        "Telegram OK, but Firebase save failed: " +
          (fsErr?.message || "permission/network error")
      );
      return;
    }
    els.sessionInput.value = "";
    if (els.sessionLabel) els.sessionLabel.value = "";
    showAlert(
      "success",
      `Logged in: ${res.profile?.displayName || "account"}${
        res.profile?.username ? " (@" + res.profile.username + ")" : ""
      } — encrypted & saved.`
    );
    liveState.set(id, {
      ok: true,
      message: `Live · ${res.profile?.displayName || "connected"}`,
    });
  } catch (err) {
    showAlert("error", err?.message || "Failed to add session.");
  } finally {
    els.btnAdd.disabled = false;
    els.btnAdd.textContent = "Add session";
  }
});

els.grid?.addEventListener("change", async (e) => {
  const t = e.target;
  if (t?.matches?.("input[data-toggle]")) {
    const id = t.getAttribute("data-toggle");
    const active = t.checked;
    await setSessionActive(user.uid, id, active);
    if (active) {
      const s = sessions.find((x) => x.id === id);
      if (s?.encryptedSession) {
        liveState.set(id, { checking: true, message: "Activating…" });
        render();
        const res = await activateEncryptedSession(
          s.encryptedSession,
          s.format || "telethon"
        );
        liveState.set(id, {
          ok: res.ok,
          message: res.ok
            ? `Live · ${res.profile?.displayName || "connected"}`
            : res.error || "Failed",
        });
        render();
      }
    } else {
      liveState.set(id, { ok: false, message: "Paused by you." });
      render();
    }
  }
});

els.grid?.addEventListener("click", async (e) => {
  const del = e.target.closest?.("[data-delete]");
  const ping = e.target.closest?.("[data-ping]");
  if (del) {
    const id = del.getAttribute("data-delete");
    if (!confirm("Remove this Telegram session from your vault?")) return;
    await removeSession(user.uid, id);
    liveState.delete(id);
  }
  if (ping) {
    const id = ping.getAttribute("data-ping");
    const s = sessions.find((x) => x.id === id);
    if (!s?.encryptedSession) return;
    liveState.set(id, { checking: true, message: "Checking…" });
    render();
    const res = await pingEncryptedSession(
      s.encryptedSession,
      s.format || "telethon"
    );
    liveState.set(id, {
      ok: res.ok,
      message: res.ok
        ? `Live · ${res.profile?.displayName || "ok"} · ${new Date().toLocaleTimeString()}`
        : res.error || "Check failed",
    });
    if (res.ok) {
      await updateSessionMeta(user.uid, id, {
        profile: res.profile,
        encryptedSession: res.encryptedSession || s.encryptedSession,
        status: "active",
        lastCheckedAt: res.checkedAt,
      });
    }
    render();
  }
});

els.btnRefreshAll?.addEventListener("click", async () => {
  await activateAllActive();
});

// Keep page from dumping secrets in accidental screenshots of form after add
window.addEventListener("beforeunload", () => {
  if (els.sessionInput) els.sessionInput.value = "";
});
