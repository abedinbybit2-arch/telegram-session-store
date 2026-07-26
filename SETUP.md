# One-time Firebase Auth enable (required)

Firebase project **ABEDIN Automation** (`abedin-automation`) is created, but Email/Password Authentication must be activated once in the Console (Google does not allow full Auth bootstrap without this step when billing is off).

## Do this once (2 minutes)

1. Open: [Firebase Authentication – ABEDIN Automation](https://console.firebase.google.com/project/abedin-automation/authentication)
2. Click **Get started**
3. Open **Sign-in method** → enable **Email/Password** → Save
4. Open **Settings → Authorized domains**
5. Add: `abedinautomation.vercel.app` (keep `localhost`)

After that, Create account / Sign in on the live site works immediately.

## Already done for you

| Item | Status |
|------|--------|
| Firebase project `abedin-automation` | Done |
| Web app + SDK config | Done |
| Firestore rules deployed | Done |
| GitHub repo | Done |
| Vercel production deploy | Done |
| Domain `abedinautomation.vercel.app` | Done |
| Env: `TG_API_ID`, `TG_API_HASH`, `SESSION_ENCRYPTION_KEY` | Done |
| Minified production JS (`/js/v/*`) | Done |
| Session API health | `hasApi: true` |

## Links

- Live: https://abedinautomation.vercel.app
- GitHub: https://github.com/abedinbybit2-arch/telegram-session-store
- Firebase: https://console.firebase.google.com/project/abedin-automation
