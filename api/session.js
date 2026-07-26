/**
 * Telegram Session Store — validate / activate Telethon + Pyrogram sessions
 * GramJS on Vercel serverless. api_id / api_hash / encryption key = server only.
 */

const crypto = require("crypto");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { AuthKey } = require("telegram/crypto/AuthKey");

const HARD_TIMEOUT_MS = 32000;

function resolveApiCredentials() {
  const apiId = Number(process.env.TG_API_ID || "");
  const apiHash = String(process.env.TG_API_HASH || "").trim();
  if (!apiId || !apiHash) {
    return {
      ok: false,
      error:
        "Server missing TG_API_ID / TG_API_HASH. Set them in Vercel environment variables.",
    };
  }
  return { ok: true, apiId, apiHash };
}

function encryptionKey() {
  const raw = process.env.SESSION_ENCRYPTION_KEY || process.env.TG_API_HASH || "";
  if (!raw || raw.length < 16) {
    throw new Error("SESSION_ENCRYPTION_KEY must be set (16+ characters).");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encryptSession(plain) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptSession(payload) {
  const key = encryptionKey();
  const buf = Buffer.from(String(payload), "base64");
  if (buf.length < 29) throw new Error("Invalid encrypted session payload.");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8"
  );
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}

function errMsg(err) {
  if (!err) return "Unknown error";
  if (err.errorMessage) return String(err.errorMessage);
  if (err.message) return String(err.message);
  return String(err);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            label ||
              `Timed out after ${Math.round(ms / 1000)}s. Telegram DC may be slow — try again.`
          )
        ),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function cleanSession(raw) {
  return String(raw || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "")
    .replace(/\r|\n|\t/g, "");
}

const DC_MAP = {
  1: { ip: "149.154.175.53", port: 443 },
  2: { ip: "149.154.167.51", port: 443 },
  3: { ip: "149.154.175.100", port: 443 },
  4: { ip: "149.154.167.91", port: 443 },
  5: { ip: "91.108.56.130", port: 443 },
};

/**
 * Build GramJS StringSession from Pyrogram session string.
 * Layout: dc_id(1) + api_id(4 LE) + test_mode(1) + auth_key(256) [+ user_id(8) + is_bot(1)]
 */
async function pyrogramToStringSession(pyro) {
  const cleaned = cleanSession(pyro);
  if (!cleaned) throw new Error("Empty Pyrogram session.");

  if (cleaned[0] === "1" && cleaned.length > 100) {
    return cleaned;
  }

  const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let raw;
  try {
    raw = Buffer.from(padded, "base64");
  } catch {
    throw new Error("Invalid Pyrogram session encoding (not base64).");
  }

  if (raw.length < 262) {
    throw new Error(
      "Pyrogram session too short. Export with: await client.export_session_string()"
    );
  }

  const dcId = raw.readUInt8(0);
  const authKeyBuf = raw.subarray(6, 262);
  if (dcId < 1 || dcId > 5) {
    throw new Error(`Invalid DC id in Pyrogram session: ${dcId}`);
  }

  const dc = DC_MAP[dcId] || DC_MAP[2];
  const session = new StringSession("");
  session.setDC(dcId, dc.ip, dc.port);
  const key = new AuthKey();
  await key.setKey(authKeyBuf);
  session.setAuthKey(key);
  const saved = session.save();
  if (!saved || saved[0] !== "1") {
    throw new Error("Failed to convert Pyrogram session to StringSession.");
  }
  return saved;
}

/**
 * Accept Telethon / GramJS / Pyrogram strings and return a loadable StringSession string.
 */
async function normalizeSessionInput(session, typeHint) {
  let raw = cleanSession(session);
  if (!raw) throw new Error("Session string is required.");
  if (raw.length < 30) {
    throw new Error(
      "Session string looks too short. Paste the full Telethon or Pyrogram string."
    );
  }

  // Strip common wrappers
  if (raw.startsWith("StringSession(") && raw.endsWith(")")) {
    raw = raw.slice("StringSession(".length, -1).replace(/^["']|["']$/g, "");
  }

  const hint = String(typeHint || "auto").toLowerCase();
  const errors = [];

  const tryTelethon = (s) => {
    // GramJS requires version prefix "1"
    const candidates = s[0] === "1" ? [s] : ["1" + s];
    for (const c of candidates) {
      try {
        // throws "Not a valid string" if body is not a real session
        // eslint-disable-next-line no-new
        new StringSession(c);
        return c;
      } catch (e) {
        errors.push(`telethon: ${errMsg(e)}`);
      }
    }
    return null;
  };

  if (hint === "telethon" || hint === "string" || hint === "gramjs") {
    const t = tryTelethon(raw);
    if (!t) {
      throw new Error(
        "Invalid Telethon StringSession. It must be a full export (usually starts with 1). " +
          (errors[0] || "")
      );
    }
    return { sessionString: t, format: "telethon" };
  }

  if (hint === "pyrogram") {
    const p = await pyrogramToStringSession(raw);
    return { sessionString: p, format: "pyrogram" };
  }

  // auto
  if (raw[0] === "1" && raw.length > 80) {
    const t = tryTelethon(raw);
    if (t) return { sessionString: t, format: "telethon" };
  }

  try {
    const p = await pyrogramToStringSession(raw);
    return { sessionString: p, format: "pyrogram" };
  } catch (e) {
    errors.push(`pyrogram: ${errMsg(e)}`);
  }

  const t2 = tryTelethon(raw);
  if (t2) return { sessionString: t2, format: "telethon" };

  throw new Error(
    "Could not parse session. Use Telethon StringSession.save() or Pyrogram export_session_string(). " +
      errors.slice(0, 2).join(" | ")
  );
}

function assertSessionShape(sessionString) {
  let ss;
  try {
    ss = new StringSession(sessionString);
  } catch (e) {
    throw new Error(
      "Invalid session string format (GramJS/Telethon). " + errMsg(e)
    );
  }
  // Auth key must exist for an authorized user session
  const key = ss.getAuthKey?.() || ss.authKey || ss._authKey || ss._key;
  const keyBuf =
    key && typeof key.getKey === "function"
      ? key.getKey()
      : Buffer.isBuffer(key)
        ? key
        : key?._key || null;

  // StringSession may store raw _key until load(); check buffer length if present
  if (ss._key && Buffer.isBuffer(ss._key) && ss._key.length < 200) {
    throw new Error(
      "Session auth key is incomplete. Paste a full Telethon/Pyrogram export."
    );
  }
  if (!ss._dcId || ss._dcId < 1 || ss._dcId > 5) {
    throw new Error(
      "Session missing valid Telegram DC. Export a fresh session string."
    );
  }
  return ss;
}

function createClient(sessionString, apiId, apiHash, useWSS) {
  assertSessionShape(sessionString);
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 1,
    useWSS: Boolean(useWSS),
    timeout: 12,
    requestRetries: 1,
    autoReconnect: false,
    retryDelay: 500,
    deviceModel: "Telegram Session Store",
    systemVersion: "Web",
    appVersion: "1.1.0",
    langCode: "en",
  });
}

async function safeDisconnect(client) {
  try {
    await client.disconnect();
  } catch {
    /* ignore */
  }
  try {
    client.destroy();
  } catch {
    /* ignore */
  }
}

function mapUser(me) {
  if (!me) return { id: "", displayName: "Unknown", username: "", phone: "" };
  const first = me.firstName || me.first_name || "";
  const last = me.lastName || me.last_name || "";
  const username = me.username || "";
  const phone = me.phone || "";
  const id = String(me.id?.value ?? me.id ?? me.userId ?? "");
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

/**
 * Connect with TCP first (Node/serverless-friendly), then WSS fallback.
 */
async function withClient(sessionString, apiId, apiHash, fn) {
  const modes = [false, true]; // useWSS
  let lastErr;

  for (const useWSS of modes) {
    const client = createClient(sessionString, apiId, apiHash, useWSS);
    try {
      await withTimeout(
        (async () => {
          await client.connect();
        })(),
        20000,
        `Connect timeout (${useWSS ? "WSS" : "TCP"})`
      );

      const authorized = await withTimeout(
        client.checkAuthorization(),
        10000,
        "Auth check timeout"
      );
      if (!authorized) {
        throw new Error(
          "Session is not authorized (expired or invalid). Generate a new session string."
        );
      }

      const result = await withTimeout(
        fn(client),
        15000,
        "getMe timeout"
      );
      let saved = sessionString;
      try {
        saved = client.session.save() || sessionString;
      } catch {
        /* keep original */
      }
      await safeDisconnect(client);
      return { ...result, sessionString: saved };
    } catch (err) {
      lastErr = err;
      await safeDisconnect(client);
      const msg = errMsg(err);
      // Don't retry other transport for hard session errors
      if (
        /not authorized|invalid|AUTH_KEY|USER_DEACTIVATED|SESSION_REVOKED|Not a valid string/i.test(
          msg
        )
      ) {
        break;
      }
      // try next mode
    }
  }

  throw lastErr || new Error("Failed to connect with session");
}

function friendlyError(err) {
  const msg = errMsg(err);
  if (/Not a valid string/i.test(msg)) {
    return "Invalid session format. Telethon strings usually start with 1. Pyrogram: use export_session_string().";
  }
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|SESSION_EXPIRED/i.test(msg)) {
    return "Session revoked or expired. Create a new session and try again.";
  }
  if (/USER_DEACTIVATED/i.test(msg)) {
    return "This Telegram account is deactivated.";
  }
  if (/FLOOD_WAIT/i.test(msg)) {
    return "Telegram rate limit (FLOOD_WAIT). Wait a minute and retry.";
  }
  if (/TIMEOUT|Timed out|ECONN|ENOTFOUND|Network/i.test(msg)) {
    return "Network timeout reaching Telegram. Retry — serverless cold start can be slow.";
  }
  return msg;
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const body = parseBody(req);
  const action = String(body.action || "validate").toLowerCase();

  try {
    if (action === "health") {
      const creds = resolveApiCredentials();
      res.status(200).json({
        ok: true,
        hasApi: creds.ok,
        apiId: creds.ok ? creds.apiId : null,
        supports: ["telethon", "pyrogram", "string", "auto"],
        timeoutMs: HARD_TIMEOUT_MS,
      });
      return;
    }

    const creds = resolveApiCredentials();
    if (!creds.ok) {
      res.status(500).json({ ok: false, error: creds.error });
      return;
    }

    let plainSession = "";
    let format = "telethon";

    if (body.encryptedSession) {
      try {
        plainSession = decryptSession(body.encryptedSession);
      } catch {
        res.status(400).json({
          ok: false,
          error: "Could not decrypt stored session. Remove and re-add it.",
          active: false,
        });
        return;
      }
      format = body.format || "telethon";
    } else {
      const norm = await normalizeSessionInput(
        body.session,
        body.type || body.format
      );
      plainSession = norm.sessionString;
      format = norm.format;
    }

    if (action === "validate" || action === "activate" || action === "ping") {
      try {
        const out = await withTimeout(
          withClient(plainSession, creds.apiId, creds.apiHash, async (client) => {
            const me = await client.getMe();
            return { profile: mapUser(me) };
          }),
          HARD_TIMEOUT_MS,
          "Session validation timed out. Try again."
        );

        let encrypted;
        try {
          encrypted = encryptSession(out.sessionString);
        } catch (e) {
          res.status(500).json({
            ok: false,
            error: "Session OK but encryption failed: " + errMsg(e),
            active: false,
          });
          return;
        }

        res.status(200).json({
          ok: true,
          format,
          profile: out.profile,
          encryptedSession: encrypted,
          active: true,
          checkedAt: new Date().toISOString(),
        });
        return;
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: friendlyError(err),
          active: false,
        });
        return;
      }
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: friendlyError(err) });
  }
};
