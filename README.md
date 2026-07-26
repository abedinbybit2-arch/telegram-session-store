# Telegram Session Store

**Telegram Automation** multi-account session vault.

- Website name: **Telegram Session Store**
- Product title: **Telegram Automation**
- Firebase project: **ABEDIN Automation** (`abedin-automation`)
- Production URL: [https://abedinautomation.vercel.app](https://abedinautomation.vercel.app)

## Features

- Firebase email/password accounts (persistent browser session)
- Telethon + Pyrogram string session login
- Sessions validated via GramJS on the server
- AES-256-GCM encrypted session storage in Firestore
- Multiple sessions active at once
- Per-account Active On/Off
- Refresh / new device: website login restores Telegram sessions from Firebase
- `api_id` / `api_hash` only in server environment variables
- Production JS minified to compact one-line bundles

## Stack

- Static web app + Vercel Serverless (`/api/session`)
- Firebase Authentication + Cloud Firestore
- GramJS (`telegram`) for MTProto session checks

## Environment (Vercel)

| Variable | Description |
|----------|-------------|
| `TG_API_ID` | Telegram app api_id |
| `TG_API_HASH` | Telegram app api_hash |
| `SESSION_ENCRYPTION_KEY` | Long random secret for AES encryption |

## Local

```bash
npm install
# set TG_API_ID TG_API_HASH SESSION_ENCRYPTION_KEY
npx vercel dev
```

## Deploy

```bash
npm install
npm run minify
# deploy with Vercel (GitHub integration or CLI)
```

## Security notes

- Never commit real `.env` files
- Session plaintexts are not stored in Firestore
- Client receives only encrypted payloads after first validate
- View-source protection is best-effort (minified one-liners); real secrets stay server-side
