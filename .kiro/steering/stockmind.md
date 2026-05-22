---
inclusion: always
---

# StockMind AI — Project Steering

## What this project is
AI-powered stock market **prediction and analysis** platform. Local-first fullstack app (React frontend + Express backend in one repo). Runs on a single device — laptop or mobile. Generates calibrated probability predictions — NOT financial advice, NOT trade execution.

## Spec reference
All architecture decisions trace back to `StockMind-AI-Full-Requirements-Spec.md`.

---

## Non-negotiable rules (always enforce these)

### Safety
- Every page that shows predictions MUST render `<Disclaimer />` — non-removable, non-dismissible
- Probabilities MUST be clamped through `clampProbability()` before reaching any component (floor 5%, ceiling 99%)
- HMAC signature verification MUST run before any prediction payload is rendered
- Suppressed signals (`signal.suppressed === true`) MUST NOT be shown to users
- `<ErrorBoundary>` MUST wrap every major UI section
- No language suggesting guaranteed returns anywhere in the UI
- No FOMO language ("ACT NOW", "URGENT", "Don't miss out")
- Accuracy metrics MUST always show losing signals — no cherry-picking
- Every signal card MUST show the complement label: "X% means ~Y% chance of being wrong"

### Code quality
- No raw `fetch()` in components — always use `apiFetch()` from `@services/apiClient.js`
- No `console.log` in production code — use `console.warn` / `console.error` only
- All user-supplied strings (tickers, search inputs) MUST pass through `sanitizeTicker()` or `stripHtml()` before use
- No `eval()`, `new Function()`, or `innerHTML` with user data — ever
- All dependencies must use pinned versions (no `^` or `~` ranges in production deps)

### Architecture
- Path aliases: `@components`, `@pages`, `@hooks`, `@services`, `@store`, `@utils`, `@types`
- CSS: CSS Modules for component styles, `index.css` for global tokens only
- State: local `useState` first, custom hooks for async data, global store (Zustand) only for cross-cutting concerns
- Feature flags: check `FEATURES.*` from `@utils/constants.js` before rendering experimental features
- Backend lives in `server/` — all file I/O, encryption, and model inference goes through backend services
- Frontend NEVER reads/writes files directly — always via backend API

### Accessibility (WCAG 2.1 AA)
- All interactive elements must be keyboard-navigable
- All images must have `alt` text
- Colour alone must NEVER convey meaning — bull/bear must also use text labels
- ARIA roles must be correct — `eslint-plugin-jsx-a11y` errors are build blockers

### Compliance
- Disclaimer text is jurisdiction-aware — controlled by `VITE_DISCLAIMER_JURISDICTION` (IN / US / EU)
- Jurisdiction must be set correctly before any deployment

---

## Folder purposes

### Frontend (`src/`)
- `src/components/` — shared, reusable UI components (PredictionCard, Disclaimer, ErrorBoundary, etc.)
- `src/pages/` — route-level page components (one folder per route)
- `src/hooks/` — custom React hooks (data fetching, subscriptions, polling)
- `src/services/` — API clients that call the backend (no React, no side effects beyond fetch)
- `src/store/` — Zustand global state slices
- `src/utils/` — pure functions, constants, helpers (no React, no network calls)
- `src/types/` — JSDoc type definitions mirroring backend schemas

### Backend (`server/`)
- `server/routes/` — Express route handlers (thin — delegate to services)
- `server/services/` — business logic (prediction, auth, storage, calibration)
- `server/models/` — prediction engine model wrappers
- `server/middleware/` — auth verification, rate limiting, input validation
- `server/storage/` — encrypted file I/O, compression, cleanup scheduler
- `server/keygen/` — standalone 12-digit key generator (separate entry point)

### Data (`data/`)
- All files AES-256-GCM encrypted
- `data/users/` — per-user encrypted JSON records
- `data/predictions/` — monthly partitioned JSON + CSV
- `data/models/` — signed model artifacts (3 versions per instrument)
- `data/backtest/` — backtest result cache
- `data/system/` — config, health logs

---

## Key env vars
- `VITE_AI_API_URL` — inference backend (default: `http://localhost:4098/api/inference`)
- `VITE_DISCLAIMER_JURISDICTION` — IN | US | EU
- `VITE_CONFIDENCE_FLOOR` / `VITE_CONFIDENCE_CEILING` — probability bounds (5 / 99)
- `VITE_HMAC_VERIFY_KEY` — public key for prediction payload verification
- `VITE_ENABLE_*` — feature flags for unreleased models (SENTIMENT, CV_PATTERNS, RL_TIMING)

---

## Market modules
equities-india | indices-india | fno-india | crypto | forex | commodities | global-indices

Each module is a self-contained page with its own data service and prediction engine config.

## Prediction output
- Always 16 signals per request, sorted highest → lowest probability
- Each signal: entry, entryZone, t1/t2/t3, stopLoss, immediateOptimalSL, maxRisk, riskReward, validity, probability, grade, reasons
- Display modes: Card (default) and Chart overlay

## Authentication flow
1. Username + 8-char password → Argon2id verification → short session token (5 min)
2. 12-digit key (XXXX-XXXX-XXXX) → HMAC verification → full JWT (15 min) + refresh (7 days)
3. Access granted to prediction interface

## Accuracy gate
Prediction mechanism is only stable when 3-year backtest shows 75–97% accuracy.
If below threshold → auto-optimisation pipeline triggered → human approval required before promotion.
