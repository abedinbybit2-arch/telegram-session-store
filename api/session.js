/**
 * Telegram Session Store — server-only session validate / activate / encrypt
 * Supports Telethon StringSession + Pyrogram session strings via GramJS.
 * TG_API_ID / TG_API_HASH / SESSION_ENCRYPTION_KEY stay on the server.
 */

const crypto = require("crypto");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");

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
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
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
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
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
  if (err.errorMessage) return err.errorMessage;
  if (err.message) return err.message;
  return String(err);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Convert Pyrogram session string to Telethon/GramJS StringSession when possible.
 * Pyrogram packs: dc_id, api_id, test_mode, auth_key(256), user_id, is_bot
 */
async function pyrogramToStringSession(pyro) {
  const cleaned = String(pyro || "").trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("Empty Pyrogram session.");

  // Already looks like Telethon (often starts with "1")
  if (/^1[A-Za-z0-9+/=_-]+$/.test(cleaned) && cleaned.length > 100) {
    return cleaned;
  }

  let raw;
  try {
    // URL-safe base64 support
    const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    raw = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64");
  } catch {
    throw new Error("Invalid Pyrogram session encoding.");
  }

  // Common Pyrogram layout: 1 byte dc + 4 api_id + 1 test + 256 auth_key (+ optional)
  if (raw.length < 262) {
    return cleaned;
  }

  const dcId = raw.readUInt8(0);
  const authKeyBuf = raw.subarray(6, 262);

  if (dcId < 1 || dcId > 5) {
    return cleaned;
  }

  const DC_MAP = {
    1: { ip: "149.154.175.53", port: 443 },
    2: { ip: "149.154.167.51", port: 443 },
    3: { ip: "149.154.175.100", port: 443 },
    4: { ip: "149.154.167.91", port: 443 },
    5: { ip: "91.108.56.130", port: 443 },
  };
  const dc = DC_MAP[dcId] || DC_MAP[2];

  const { AuthKey } = require("telegram/crypto/AuthKey");
  const session = new StringSession("");
  session.setDC(dcId, dc.ip, dc.port);
  const key = new AuthKey();
  await key.setKey(authKeyBuf);
  session.setAuthKey(key);
  return session.save();
}

async function normalizeSessionInput(session, typeHint) {
  const raw = String(session || "").trim().replace(/\s+/g, "");
  if (!raw) throw new Error("Session string is required.");
  if (raw.length < 30) throw new Error("Session string looks too short.");

  const hint = String(typeHint || "auto").toLowerCase();

  if (hint === "telethon" || hint === "string" || hint === "gramjs") {
    return { sessionString: raw, format: "telethon" };
  }
  if (hint === "pyrogram") {
    return {
      sessionString: await pyrogramToStringSession(raw),
      format: "pyrogram",
    };
  }

  // auto-detect
  if (raw.startsWith("1") && raw.length > 150) {
    return { sessionString: raw, format: "telethon" };
  }
  try {
    return {
      sessionString: await pyrogramToStringSession(raw),
      format: "pyrogram",
    };
  } catch {
    return { sessionString: raw, format: "telethon" };
  }
}

async function withClient(sessionString, apiId, apiHash, fn) {
  const stringSession = new StringSession(sessionString);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true,
    timeout: 20,
  });

  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      throw new Error("Session is invalid or expired (not authorized).");
    }
    const result = await fn(client, stringSession);
    // Prefer freshest save (auth key rotation etc.)
    const saved = client.session.save();
    return { ...result, sessionString: saved || sessionString };
  } finally {
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
}

function mapUser(me) {
  const first = me.firstName || me.first_name || "";
  const last = me.lastName || me.last_name || "";
  const username = me.username || "";
  const phone = me.phone || "";
  const id = String(me.id || me.userId || "");
  const displayName = [first, last].filter(Boolean).join(" ") || username || phone || id;
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
        supports: ["telethon", "pyrogram", "string"],
      });
      return;
    }

    if (action === "encrypt") {
      const plain = String(body.session || "").trim();
      if (!plain) {
        res.status(400).json({ ok: false, error: "session required" });
        return;
      }
      res.status(200).json({ ok: true, encrypted: encryptSession(plain) });
      return;
    }

    if (action === "decrypt") {
      // Intentionally restricted: only returns validity flag for debugging if needed
      res.status(403).json({ ok: false, error: "Not allowed" });
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
      plainSession = decryptSession(body.encryptedSession);
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
      let attempt = 0;
      let lastErr;
      while (attempt < 3) {
        attempt += 1;
        try {
          const out = await withClient(
            plainSession,
            creds.apiId,
            creds.apiHash,
            async (client) => {
              const me = await client.getMe();
              return { profile: mapUser(me) };
            }
          );

          const encrypted = encryptSession(out.sessionString);
          res.status(200).json({
            ok: true,
            format,
            profile: out.profile,
            encryptedSession: encrypted,
            // Never return plain session to browser after first validate from paste
            active: true,
            checkedAt: new Date().toISOString(),
          });
          return;
        } catch (err) {
          lastErr = err;
          const msg = errMsg(err);
          if (/FLOOD_WAIT_(\d+)/i.test(msg)) {
            const sec = Number(msg.match(/FLOOD_WAIT_(\d+)/i)[1] || 3);
            await sleep(Math.min(sec, 8) * 1000);
            continue;
          }
          break;
        }
      }
      res.status(400).json({
        ok: false,
        error: errMsg(lastErr) || "Failed to validate session",
        active: false,
      });
      return;
    }

    res.status(400).json({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    res.status(500).json({ ok: false, error: errMsg(err) });
  }
};
