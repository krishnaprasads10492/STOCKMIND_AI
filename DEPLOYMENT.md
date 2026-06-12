# StockMind AI — Deployment & Usage Guide

> How to run the application **without the source code** — using only the built files.

---

## What You Need

After building (or receiving a distribution package), you will have:

```
stockmind-ai/
├── build/              ← Built frontend (static files)
├── server/             ← Backend (Node.js — must be present)
├── data/               ← Encrypted data store (created on first run)
├── users-seed.json     ← User setup file (edit before first run)
├── package.json        ← Dependency manifest
└── node_modules/       ← Dependencies (install once)
```

---

## Option A — Run from a Pre-Built Package

This is the recommended way to run on a device **without installing development tools**.

### Step 1 — Install Node.js (one time only)

Download and install **Node.js v18 or higher** from https://nodejs.org  
Choose the **LTS** version. This also installs `npm`.

Verify:
```bash
node --version    # should print v18.x.x or higher
npm --version     # should print 9.x.x or higher
```

### Step 2 — Install dependencies (one time only)

Open a terminal in the project folder and run:

```bash
npm install --omit=dev --legacy-peer-deps
```

This installs only the runtime dependencies (not dev tools). Takes 1–2 minutes.

### Step 3 — Set up your users

Edit `users-seed.json` in the project root **before starting the server for the first time**:

```json
[
  {
    "username": "yourname",
    "password": "YourPass@123",
    "role": "admin",
    "preferences": {
      "defaultModule": "indices-india",
      "defaultCapital": 100000,
      "riskPerTrade": 1.5,
      "jurisdiction": "IN"
    }
  }
]
```

Rules:
- `username` — lowercase, 4–32 characters
- `password` — minimum 8 characters
- `role` — `"admin"` or `"user"`
- You can add multiple users in the array

> ⚠ Once the server starts and creates users from this file, editing it again has no effect on existing users. Use the Admin panel to add more users after first run.

### Step 4 — Set the data folder password (optional but recommended)

The data folder is encrypted. Set a password via environment variable:

**Windows PowerShell:**
```powershell
$env:DATA_PASSWORD = "your-secure-password"
```

**Windows CMD:**
```cmd
set DATA_PASSWORD=your-secure-password
```

**macOS / Linux:**
```bash
export DATA_PASSWORD=your-secure-password
```

If you skip this, the default password `stockmind-local-dev-password` is used.

> ⚠ Use the **same password every time** you start the server. If you change it, existing encrypted data becomes unreadable.

### Step 5 — Start the backend server

```bash
node server/index.js
```

You should see:
```
[bootstrap] Seeding 1 user(s) from users-seed.json...
[bootstrap] ✓ Created: yourname (admin)
[StockMind AI] Backend → http://localhost:4098
```

Keep this terminal open. The backend must stay running while you use the app.

### Step 6 — Serve the frontend

The `build/` folder contains the built React app. You need a static file server to serve it.

**Option A — Use the included Express server to also serve the frontend:**

Add this to `server/index.js` (after the routes section):

```js
import { fileURLToPath } from 'url'
import path from 'path'
const __dirname2 = fileURLToPath(new URL('.', import.meta.url))
app.use(express.static(path.join(__dirname2, '../build')))
app.get('*', (_req, res) => res.sendFile(path.join(__dirname2, '../build/index.html')))
```

Then open http://localhost:4098 in your browser.

**Option B — Use `serve` (simplest, no code change):**

```bash
npm install -g serve
serve dist -p 3000
```

Then open http://localhost:4098 in your browser.

**Option C — Use Python (if installed):**

```bash
cd dist
python -m http.server 3000
```

Then open http://localhost:4098 in your browser.

> ⚠ When using Option B or C, the frontend at port 3000 needs to reach the backend at port 5000. This works automatically because the built app calls `/api/...` relative URLs — but only if both are on the same origin. Use Option A (Express serves both) to avoid any cross-origin issues.

### Step 7 — Generate your access key

In a **new terminal** (keep the server running in the first one):

```bash
node server/keygen/generate.js yourname
```

Your 12-digit key is printed once. Write it down.

### Step 8 — Log in

Open your browser to http://localhost:4098 (or 3000 if using Option B/C).

1. Enter your username and password
2. Enter the 12-digit key (format: XXXX-XXXX-XXXX)
3. You're in

---

## Option B — Run from Source Code (Development)

If you have the full source code and want to run in development mode:

```bash
npm install --legacy-peer-deps   # install all dependencies
npm run dev                      # starts both frontend (:4098) and backend (:4098)
```

Then in a second terminal:
```bash
npm run keygen yourname          # generate access key
```

---

## Option C — Build from Source

If you have the source code and want to create a production build:

```bash
npm install --legacy-peer-deps
npm run build
```

This creates the `build/` folder. Then follow Option A above.

---

## Serving Frontend + Backend Together (Recommended for Deployment)

The cleanest setup is to have Express serve both the API and the static frontend. Add the following to the **bottom** of `server/index.js`, just before `bootstrap().then(...)`:

```js
// Serve built frontend
import { fileURLToPath } from 'url'
const __staticDir = fileURLToPath(new URL('../build', import.meta.url))
app.use(express.static(__staticDir))
// SPA fallback — all non-API routes serve index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(__staticDir, 'index.html'))
})
```

Then everything runs on a single port (5000). Open http://localhost:4098.

---

## Running on a Different Port

**Backend port:**
```bash
PORT=8080 node server/index.js
```

**Frontend port (dev mode only):**
Edit `vite.config.js` → `server.port: 4000`

---

## Running on a Local Network (Mobile Access)

To access from your phone or another device on the same Wi-Fi:

```bash
# Find your machine's local IP
ipconfig    # Windows
ifconfig    # macOS/Linux

# Start backend bound to all interfaces
node server/index.js
```

Edit `server/index.js` — change:
```js
app.listen(PORT, () => ...)
```
to:
```js
app.listen(PORT, '0.0.0.0', () => ...)
```

Then on your phone, open: `http://192.168.x.x:4098` (use your machine's IP).

---

## Auto-Start on Windows (Run at Login)

To start StockMind AI automatically when Windows starts:

1. Create a file `start-stockmind.bat`:
```bat
@echo off
cd /d "C:\path\to\stockmind-ai"
set DATA_PASSWORD=your-secure-password
start "StockMind Backend" node server/index.js
timeout /t 3
start "" "http://localhost:4098"
```

2. Press `Win + R`, type `shell:startup`, press Enter
3. Copy `start-stockmind.bat` into the Startup folder

---

## Auto-Start on macOS (LaunchAgent)

Create `~/Library/LaunchAgents/com.stockmind.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.stockmind</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/stockmind-ai/server/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_PASSWORD</key>
    <string>your-secure-password</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>/path/to/stockmind-ai</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.stockmind.plist
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Cannot find module` | Run `npm install --legacy-peer-deps` |
| `EADDRINUSE port 5000` | Another process is using port 5000. Kill it or use `PORT=5001 node server/index.js` |
| `Decryption failed` | Wrong `DATA_PASSWORD`. Use the same password that was set when users were first created |
| `User not found` in keygen | The username doesn't exist. Check `users-seed.json` or use the Admin panel |
| White/blank login page | Open browser DevTools (F12) → Console tab. Report any red errors |
| App title not visible | Clear browser cache (Ctrl+Shift+R) |
| Can't reach from phone | Make sure both devices are on the same Wi-Fi. Check Windows Firewall allows port 5000 |

---

## File Reference

| File / Folder | Purpose | Edit? |
|---|---|---|
| `build/` | Built frontend — do not edit | No |
| `server/` | Backend source | Only if customising |
| `data/` | Encrypted user data + predictions | No — managed by app |
| `users-seed.json` | Initial user setup | Yes — before first run |
| `package.json` | Dependency list | No |
| `.env` or env vars | Configuration | Yes — set `DATA_PASSWORD` |

---

## Security Reminders

- Never expose port 5000 to the internet — this is a local personal app
- Set a strong `DATA_PASSWORD` — it encrypts all your data
- The 12-digit key is shown **once only** — store it in a password manager
- Change the default password (`Admin@1234`) immediately after first login
- The `data/` folder contains encrypted files — back it up regularly
