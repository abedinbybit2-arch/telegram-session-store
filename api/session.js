/**
 * Telegram Session Store — validate / activate Telethon + Pyrogram sessions
 * GramJS on Vercel serverless. api_id / api_hash / encryption key = server only.
 */

const crypto = require("crypto");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { AuthKey } = require("telegram/crypto/AuthKey");

// Full validate must finish within Vercel function maxDuration (60s)
const HARD_TIMEOUT_MS = 55000;

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

/**
 * Keep auth key, force official DC IPv4 + port 443 (Vercel-friendly).
 * Avoids stale IPs / port 80 which often hang on serverless.
 */
function normalizeSessionForServer(sessionString) {
  const ss = assertSessionShape(sessionString);
  const dcId = Number(ss._dcId);
  const dc = DC_MAP[dcId] || DC_MAP[2];
  try {
    ss.setDC(dcId, dc.ip, 443);
  } catch {
    /* keep original address */
  }
  try {
    const saved = ss.save();
    if (saved && saved[0] === "1") return saved;
  } catch {
    /* fall through */
  }
  return sessionString;
}

/**
 * Same client profile as working AndroGRAM MTProto on Vercel:
 * useWSS:true → port 443, more retries, no dual TCP:80 path.
 */
function createClient(sessionString, apiId, apiHash) {
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true,
    timeout: 30,
    requestRetries: 3,
    autoReconnect: false,
    retryDelay: 1000,
    floodSleepThreshold: 24,
    deviceModel: "Telegram Session Store",
    systemVersion: "Server",
    appVersion: "1.2.0",
    langCode: "en",
  });
}

async function safeDisconnect(client) {
  try {
    if (client && !client.disconnected) {
      await client.disconnect();
    }
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
 * Single-path connect (no TCP:80 then WSS double-wait).
 * Matches production-proven GramJS settings on Vercel.
 */
async function withClient(sessionString, apiId, apiHash, fn) {
  const normalized = normalizeSessionForServer(sessionString);
  const client = createClient(normalized, apiId, apiHash);

  try {
    await client.connect();

    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error(
        "Session is not authorized (expired or invalid). Generate a new session string."
      );
    }

    const result = await fn(client);
    let saved = normalized;
    try {
      saved = client.session.save() || normalized;
    } catch {
      /* keep normalized */
    }
    return { ...result, sessionString: saved };
  } finally {
    await safeDisconnect(client);
  }
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
  if (/incomplete|missing valid Telegram DC/i.test(msg)) {
    return msg;
  }
  if (/not authorized/i.test(msg)) {
    return msg;
  }
  if (/TIMEOUT|Timed out|ECONN|ENOTFOUND|Network|Connect timeout/i.test(msg)) {
    return (
      "Could not reach Telegram DC from the server (connect timeout). " +
      "Wait 5s and retry once. If it keeps failing, the session may be from a blocked IP/DC — export a fresh session."
    );
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
        transport: "wss-443",
      });
      return;
    }

    if (action === "encrypt") {
      try {
        const plain = String(body.session || "").trim();
        if (!plain) {
          res.status(400).json({ ok: false, error: "session required" });
          return;
        }
        res.status(200).json({ ok: true, encrypted: encryptSession(plain) });
      } catch (err) {
        res.status(500).json({ ok: false, error: errMsg(err) });
      }
      return;
    }

    // Convert formats only (no Telegram network)
    if (action === "normalize") {
      try {
        const norm = await normalizeSessionInput(
          body.session,
          body.type || body.format
        );
        res.status(200).json({
          ok: true,
          format: norm.format,
          sessionString: norm.sessionString,
        });
      } catch (err) {
        res.status(400).json({ ok: false, error: friendlyError(err) });
      }
      return;
    }

    // Quick Telegram DC reachability check (no session required)
    if (action === "probe") {
      const creds = resolveApiCredentials();
      if (!creds.ok) {
        res.status(500).json({ ok: false, error: creds.error });
        return;
      }
      const t0 = Date.now();
      const client = new TelegramClient(
        new StringSession(""),
        creds.apiId,
        creds.apiHash,
        {
          connectionRetries: 3,
          useWSS: true,
          timeout: 20,
          autoReconnect: false,
          deviceModel: "TSS Probe",
          systemVersion: "Server",
          appVersion: "1.2.0",
        }
      );
      try {
        await withTimeout(client.connect(), 20000, "Probe connect timeout");
        const ms = Date.now() - t0;
        await safeDisconnect(client);
        res.status(200).json({
          ok: true,
          connected: true,
          ms,
          message: "Telegram DC reachable from this server",
        });
      } catch (err) {
        await safeDisconnect(client);
        res.status(200).json({
          ok: false,
          connected: false,
          ms: Date.now() - t0,
          error: friendlyError(err),
        });
      }
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
