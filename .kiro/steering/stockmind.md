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


---

## AGI Architecture — Implemented Modules (reference for session continuity)

### Python AI Backend (`ai_backend/engine/`)
| Module | Purpose |
|--------|---------|
| `agi_engine.py` | Regime memory, causal filter, transfer learning, multi-horizon, anomaly detection |
| `agi_envelope.py` | 5-layer signal envelope (Exterior→Shield→Main→Core→Sync) |
| `perception_engine.py` | Ingestion vectorization, Vector Ledger, Episodic Memory (Blueprint Layer II-A + III) |
| `inference_scale_quantizer.py` | Ps, Calloc, Ptrap formulas, ARC gauge, API circuit breaker (Blueprint Layer II) |
| `multi_horizon_wave.py` | 4h intraday + 7d swing + macro cycle wave projections (Cognitive Nexus Engine) |
| `friday_nexus.py` | ToT-MAC debate, Alpha Space MCTS, GAM-WAR, A* optimizer (Schema V5.00) |
| `jarvis_x_core.py` | JARVIS-X Super-AGI: LPM, Attack Maze, ASI consciousness, DIO router |
| `jarvis_agent.py` | ReAct loop, multi-agent orchestrator |
| `jarvis_brain.py` | Cloud AI routing, knowledge base |
| `unified_data_hub.py` | Zero-Trust Fusion Gate, NLP sentiment, macro integrator |

### AGI Mathematical Protocols
- **Ps** = `max(0, sum(w * [1 - P(Drawdown) * gamma]))`
- **Calloc** = `min(Cmax, Ccase * exp(alpha*H + beta*(sigma²/theta)))`
- **Ptrap** = `1 / (1 + exp(-(λ1*V + λ2*I - γ)))`
- **A\*** = `argmax_A [ sum(gamma^t * E[Rt(A)] * (1 - Ptrap,t)) ]`
- Subject to: **Ps >= Phi_min** AND **Tokens(A) <= Calloc**

### Key AGI API Routes (all under /api/jarvis/)
- `GET  /blueprint-status` — Full 3-layer architecture status
- `POST /multi-horizon` — Wave projections (4h / 7d / macro)
- `POST /isq-quantize` — Ps + Calloc + Ptrap computation
- `GET  /arc-gauge` — Token burn tracker
- `GET  /circuit-breaker` — Read-only lock status
- `POST /friday-nexus/optimize` — Full A* optimization pass
- `POST /friday-nexus/debate` — ToT-MAC multi-agent debate
- `POST /friday-nexus/mcts-search` — Alpha Space MCTS
- `POST /friday-nexus/gamwar-detect` — Live attack detection
- `GET  /jarvis-x/status` — JARVIS-X Super-AGI full status
- `GET  /jarvis-x/lpm` — Loss Prevention Module

---

## Dependency Manifest (for security version control)

### npm (Node.js) — Production
| Package | Version | Purpose |
|---------|---------|---------|
| `express` | 4.21.2 | HTTP server |
| `helmet` | 8.0.0 | Security headers |
| `express-rate-limit` | 7.5.0 | Rate limiting |
| `cors` | 2.8.5 | CORS middleware |
| `argon2` | 0.43.0 | Password hashing (Argon2id) |
| `mongodb` | 6.12.0 | MongoDB Atlas client |
| `yahoo-finance2` | 2.13.3 | Market data |
| `lightweight-charts` | 4.2.0 | Native charting (MIT) |
| `react` | 19.2.0 | UI framework |
| `react-dom` | 19.2.0 | React DOM |
| `react-router-dom` | 7.6.0 | Client routing |
| `zustand` | 5.0.5 | State management |
| `recharts` | 2.15.3 | Data visualization |
| `multer` | 1.4.5-lts.1 | File uploads |
| `concurrently` | 9.1.2 | Dev process runner |

### Python — ai_backend
| Package | Version | Purpose |
|---------|---------|---------|
| `fastapi` | 0.115.5 | API framework |
| `uvicorn[standard]` | 0.32.1 | ASGI server |
| `pydantic` | 2.9.2 | Data validation |
| `numpy` | 1.26.4 | Numerical computing |
| `pandas` | 2.2.3 | Data manipulation |
| `scipy` | 1.14.1 | Scientific computing |
| `scikit-learn` | 1.5.2 | ML base models |
| `lightgbm` | 4.5.0 | Gradient boosting |
| `xgboost` | 2.1.3 | Gradient boosting |
| `statsmodels` | 0.14.4 | ARIMA/GARCH |
| `ta` | 0.11.0 | Technical indicators |
| `httpx` | 0.27.2 | Async HTTP client |
| `Pillow` | 12.2.0 | Image processing |
| `pytesseract` | 0.3.13 | OCR |
| `python-dotenv` | 1.0.1 | Env vars |
| `joblib` | 1.4.2 | Model serialization |
| `numpy-financial` | 1.0.0 | Financial math |

**RULE: When user provides updated secure version numbers, update both this table AND the actual files, then self-install and update the repo.**

---

## App MOTTO (always enforce)
> Make as much money as possible at sensible scenarios — accessible to market beginners.
> Protect current wealth first. Generate probability of profit up to 88%.
> All predictions carry inherent risk. NOT financial advice. NOT trade execution. Analysis only.

## Session operating rules
- Push to `stockmind-source` branch on every considerable change or when user requests
- When user provides new architecture blueprints/documents: analyze gaps vs existing, implement missing modules, do not duplicate existing
- When new technology versions arrive: update dependency manifest above, update files, self-install, push
- Security is the most important aspect — always choose stable, pinned, well-audited versions
- All prediction probability outputs must be clamped: floor 5%, ceiling 99% (target up to 88% confidence)
