/**
 * Client → /api/session (never sends api_id / api_hash)
 */

const ENDPOINT = "/api/session";

async function post(body) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: "Invalid server response" };
  }
  if (!res.ok && !data.error) {
    data.error = `Request failed (${res.status})`;
    data.ok = false;
  }
  return data;
}

export function validateSession(session, type = "auto") {
  return post({ action: "validate", session, type });
}

export function pingEncryptedSession(encryptedSession, format = "telethon") {
  return post({ action: "ping", encryptedSession, format });
}

export function activateEncryptedSession(encryptedSession, format = "telethon") {
  return post({ action: "activate", encryptedSession, format });
}

export function healthCheck() {
  return post({ action: "health" });
}
