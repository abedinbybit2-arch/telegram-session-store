/**
 * Client → /api/session (never sends api_id / api_hash)
 */

const ENDPOINT = "/api/session";
const DEFAULT_TIMEOUT_MS = 58000;

async function post(body, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data = {};
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        ok: false,
        error: text
          ? `Server returned non-JSON (${res.status}): ${text.slice(0, 160)}`
          : `Empty response (${res.status})`,
      };
    }

    if (!res.ok) {
      data.ok = false;
      if (!data.error) data.error = `Request failed (HTTP ${res.status})`;
    }
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      return {
        ok: false,
        error:
          "Validation timed out (55s). Telegram connect is slow or blocked — try again.",
      };
    }
    return {
      ok: false,
      error: err?.message || "Network error calling /api/session",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function validateSession(session, type = "auto") {
  return post({ action: "validate", session, type });
}

export function pingEncryptedSession(encryptedSession, format = "telethon") {
  return post({ action: "ping", encryptedSession, format }, 45000);
}

export function activateEncryptedSession(encryptedSession, format = "telethon") {
  return post({ action: "activate", encryptedSession, format }, 45000);
}

export function healthCheck() {
  return post({ action: "health" }, 15000);
}
