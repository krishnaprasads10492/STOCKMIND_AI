# StockMind AI — Getting Started & Login Guide

> This is a **local-only personal application**. It runs entirely on your device.
> No internet account, no cloud login, no JWT — just your machine.

---

## Prerequisites

- **Node.js** v18 or higher — [nodejs.org](https://nodejs.org)
- **npm** v9 or higher (comes with Node.js)
- A terminal (PowerShell, CMD, or bash)

---

## 1. First-Time Setup

### 1.1 Install dependencies

Open a terminal in the project folder and run:

```bash
npm install --legacy-peer-deps
```

### 1.2 Start the application — single command

```bash
node start.js
```

That's it. This one command:
- Checks and installs all dependencies automatically
- Builds the frontend if no production build exists
- Starts the Node.js backend (port 5000)
- Detects Python and starts the AI backend (port 8001) if available
- Starts the outcome validator (checks predictions against live prices every 5s)
- Opens the app at **http://localhost:5000**

### Available start modes

| Command | Mode | Use when |
|---|---|---|
| `node start.js` | Production | Normal daily use |
| `node start.js --dev` | Development | Making code changes (Vite HMR) |
| `node start.js --build` | Build + start | After pulling updates |
| `node start.js --no-ai` | No Python AI | Python not installed |
| `npm start` | Same as `node start.js` | npm shortcut |

### 1.3 What happens on first run

On the very first startup, the backend **automatically creates users from `users-seed.json`**:

```
[bootstrap] Seeding 1 user(s) from users-seed.json...
[bootstrap] ✓ Created: admin (admin)
[bootstrap] Done. Run: npm run keygen <username>
```

---

## 2. Generate Your 12-Digit Access Key

Login requires **three factors**: username → password → 12-digit key.
The key is generated separately from the app using a standalone script.

### Step 1 — Open a second terminal in the project folder

Keep `npm run dev` running in the first terminal.

### Step 2 — Run the key generator

```bash
npm run keygen admin
```

Or using the launcher shortcut:

```bash
node start.js --keygen admin
```

### Step 3 — Enter the data folder password

When you see this prompt (it may appear after a short pause):

```
Data folder password:
```

Type the password and press **Enter**. Characters are hidden as you type.

**Default password (first run):** `stockmind-local-dev-password`

> To use a custom password, set the `DATA_PASSWORD` environment variable before
> starting the server:
> ```bash
> # Windows PowerShell
> $env:DATA_PASSWORD = "your-secure-password"
> npm run dev
>
> # Windows CMD
> set DATA_PASSWORD=your-secure-password
> npm run dev
>
> # bash / macOS / Linux
> DATA_PASSWORD=your-secure-password npm run dev
> ```
> ⚠ If you change `DATA_PASSWORD` after the first run, you will lose access to
> all existing encrypted data. Set it once and keep it safe.

### Step 4 — Copy your key

The key is printed **once only** and never stored:

```
╔══════════════════════════════════════╗
║     StockMind AI — Access Key        ║
╠══════════════════════════════════════╣
║  User    : admin                     ║
║  Key     : 3847-2910-5563            ║
║  Expires : 2026-05-31                ║
╠══════════════════════════════════════╣
║  ⚠  Deliver this key securely.       ║
║  It will NOT be shown again.         ║
╚══════════════════════════════════════╝
```

**Write it down or store it in a password manager.** If you lose it, generate a new one by running the keygen command again.

---

## 3. Logging In

Open your browser and go to **http://localhost:3000**

You will see the StockMind AI login screen.

### Step 1 — Enter username and password

| Field | Default value |
|---|---|
| Username | `admin` |
| Password | `Admin@1234` |

Click **Continue →**

> ⚠ Change the default password after your first login via **Settings** or the **Admin panel**.

### Step 2 — Enter your 12-digit key

Enter the key you generated in Section 2, in the format `XXXX-XXXX-XXXX`.

The input field auto-formats as you type — just enter the 12 digits and dashes are added automatically.

Click **Access Platform →**

### Step 3 — You're in

You will be redirected to the **Dashboard** showing all 7 market modules.

---

## 4. Adding More Users (Admin Only)

1. Log in as admin
2. Click **Admin** in the left navigation
3. Click **+ Add User** and fill in the form
4. After creating the user, generate their key:
   ```bash
   npm run keygen -- --user <their-username>
   ```
5. Share the key with them securely (in person, encrypted message, etc.)

---

## 5. Session Behaviour

| Event | What happens |
|---|---|
| Close browser tab | Session cleared — must log in again |
| Refresh page | Session preserved (stored in `sessionStorage`) |
| Server restart | All sessions cleared — must log in again |
| Key expires (30 days) | Login step 2 fails — generate a new key |

Sessions are stored **in memory on the server** and in **`sessionStorage` in the browser**.
There are no cookies and no JWT tokens.

---

## 6. Troubleshooting

### "Could not reach server. Is the backend running?"

The frontend cannot connect to the backend. Check:

1. Is `npm run dev` still running in your terminal?
2. Is the backend on port 5000? Look for `[StockMind AI] Backend running on http://localhost:5000` in the terminal.
3. Try opening http://localhost:5000/api/health in your browser — it should return JSON.

### "Invalid credentials"

- Check username is all lowercase (e.g. `admin` not `Admin`)
- Check password is correct (default: `Admin@1234`)
- The account may be inactive — check the Admin panel

### "Invalid key" or "Key has expired"

- The key may have been mistyped — re-enter carefully
- The key expires after 30 days — generate a new one:
  ```bash
  npm run keygen -- --user <username>
  ```
  Then type the data folder password when prompted (default: `stockmind-local-dev-password`)

### "Invalid or expired step token"

The 10-minute window between step 1 and step 2 expired. Start the login process again from step 1.

### Port 3000 already in use

Vite will automatically try 3001, 3002, etc. Check the terminal for the actual URL:
```
➜  Local:   http://localhost:3001/
```
Open that URL instead.

### Data folder password forgotten

If you forget the `DATA_PASSWORD`, the encrypted data cannot be recovered (by design).
You would need to delete the `data/` folder and start fresh. This is why it is important to store the password safely.

---

## 7. Quick Reference

```
Start app (all modes):  node start.js
Start dev mode:         node start.js --dev
Build + start:          node start.js --build
Generate key:           npm run keygen <username>
Add user:               npm run adduser
Run tests:              npm run test

Frontend:               http://localhost:5000  (production)
                        http://localhost:3000  (dev mode)
Backend API:            http://localhost:5000
AI backend:             http://localhost:8001  (if Python available)
Health check:           http://localhost:5000/api/health
Validator status:       http://localhost:5000/api/validator/status

Default admin:          admin / Admin@1234  (change immediately)
Data password:          stockmind-local-dev-password  (set DATA_PASSWORD env var)
Data folder:            data/  (AES-256-GCM encrypted)
Predictions:            data/predictions/  (JSON + CSV)
```

---

## 8. Security Notes

- All data in `data/` is encrypted with **AES-256-GCM**
- Passwords are hashed with **Argon2id** — never stored in plaintext
- The 12-digit key is stored as an **HMAC-SHA-256 hash** — the plaintext is never saved
- Sessions live only in memory — a server restart clears all active sessions
- Rate limiting is active: 50 auth requests per 15 minutes, 300 API requests per minute
- This app is designed for **local use only** — do not expose port 5000 to the internet
