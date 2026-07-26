/**
 * Browser-side session validation via GramJS (WSS).
 * Avoids Vercel→Telegram DC network timeouts for validate.
 * Encryption still done server-side via /api/session action=encrypt.
 */

// API credentials used only to open MTProto (same as my.telegram.org app).
// Session string remains the secret. Server encrypts before Firestore save.
const TG_API_ID = 39493324;
const TG_API_HASH = "4e7a6a2b306765382c3eb4c381841c45";

function cleanSession(raw) {
  return String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
}

function mapUser(me) {
  const first = me.firstName || "";
  const last = me.lastName || "";
  const username = me.username || "";
  const phone = me.phone || "";
  const id = String(me.id?.value ?? me.id ?? "");
  const displayName =
    [first, last].filter(Boolean).join(" ") || username || phone || id;
  return {
    id,
    firstName: first,
    lastName: last,
    username,
    phone,
    displayName,
    isBot: Boolean(me.bot),
    isPremium: Boolean(me.premium),
  };
}

async function loadGram() {
  const mod = await import("/js/v/tg-client.js");
  return mod;
}

/**
 * Validate a pasted Telethon/Pyrogram-compatible StringSession in the browser.
 * @returns {{ ok: true, format: string, profile: object, sessionString: string } | { ok: false, error: string }}
 */
export async function validateSessionInBrowser(sessionRaw, typeHint = "auto") {
  let session = cleanSession(sessionRaw);
  if (!session || session.length < 30) {
    return { ok: false, error: "Session string is too short." };
  }

  if (session.startsWith("StringSession(") && session.endsWith(")")) {
    session = session.slice(14, -1).replace(/^["']|["']$/g, "");
  }

  // Normalize via server (handles Pyrogram→StringSession) without Telegram DC connect
  try {
    const nres = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "normalize",
        session,
        type: typeHint || "auto",
      }),
    });
    const ndata = await nres.json().catch(() => ({}));
    if (nres.ok && ndata.ok && ndata.sessionString) {
      session = ndata.sessionString;
      typeHint = ndata.format || typeHint;
    } else if (session[0] !== "1") {
      session = "1" + session;
    }
  } catch {
    if (session[0] !== "1") session = "1" + session;
  }

  let TelegramClient;
  let StringSession;
  try {
    const g = await loadGram();
    TelegramClient = g.TelegramClient;
    StringSession = g.StringSession;
  } catch (e) {
    return {
      ok: false,
      error: "Failed to load Telegram client library: " + (e?.message || e),
    };
  }

  let client;
  try {
    client = new TelegramClient(
      new StringSession(session),
      TG_API_ID,
      TG_API_HASH,
      {
        connectionRetries: 5,
        useWSS: true,
        timeout: 30,
        autoReconnect: false,
        deviceModel: "Telegram Session Store",
        systemVersion: "Web",
        appVersion: "1.2.0",
        langCode: "en",
      }
    );

    await Promise.race([
      client.connect(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Connect timeout (25s)")), 25000)
      ),
    ]);

    if (!(await client.checkAuthorization())) {
      return {
        ok: false,
        error:
          "Session is not authorized (expired or invalid). Export a new session.",
      };
    }

    const me = await client.getMe();
    const profile = mapUser(me);
    let saved = session;
    try {
      saved = client.session.save() || session;
    } catch {
      /* keep */
    }

    return {
      ok: true,
      format: typeHint === "pyrogram" ? "pyrogram" : "telethon",
      profile,
      sessionString: saved,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const msg = err?.errorMessage || err?.message || String(err);
    if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED/i.test(msg)) {
      return {
        ok: false,
        error: "Session revoked or expired. Create a new session.",
      };
    }
    if (/TIMEOUT|timeout|WebSocket|Network|Failed to fetch/i.test(msg)) {
      return {
        ok: false,
        error:
          "Browser could not reach Telegram. Check network / adblock, then retry.",
      };
    }
    return { ok: false, error: msg };
  } finally {
    try {
      if (client) await client.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/** Server-side AES encrypt only (no Telegram network on server) */
export async function encryptSessionOnServer(plainSession) {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "encrypt", session: plainSession }),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { ok: false, error: "Encrypt response invalid" };
  }
  if (!res.ok || !data.ok || !data.encrypted) {
    return {
      ok: false,
      error: data.error || "Failed to encrypt session on server",
    };
  }
  return { ok: true, encryptedSession: data.encrypted };
}
