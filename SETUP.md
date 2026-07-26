# Firebase / Auth status (fixed)

## Root cause of `auth/configuration-not-found`

Project **abedin-automation** was created, but Firebase Authentication was never fully initialized (Identity Toolkit config missing). Enabling Auth via API requires billing; without Console "Get started", signup always fails with `CONFIGURATION_NOT_FOUND`.

## Fix applied (production)

| Item | Value |
|------|--------|
| Working Auth + Firestore | Firebase project `telegram-mtptoto` |
| Web app name | **ABEDIN Automation - Telegram Session Store** |
| App ID | `1:396870617976:web:f1048ee9a5d3205936d68d` |
| Email/Password | Enabled |
| Authorized domains | `localhost`, `abedinautomation.vercel.app`, + Firebase defaults |
| Session vault path | `users/{uid}/sessions/{id}` (encrypted) |
| Live site | https://abedinautomation.vercel.app |

`abedin-automation` remains available as alias `abedin` if you later enable Auth there (Console → Authentication → Get started + Email/Password + add domain).

## Verified

- REST signup with production API key → `200` + `idToken`
- Live `/js/v/signup.js` uses new project key (not old abedin-automation)
- `/api/session` health → Telegram API credentials present
- Firestore rules deployed for `users` + `sessions`
