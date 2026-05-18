# StockMind AI — Complete Feature Reference

> **Mission:** Give financially underserved users access to institutional-grade market intelligence — the same tools used by hedge funds and proprietary trading desks — completely free, local-first, and privacy-preserving.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [AI Algorithm Suite — 10 Elite Algorithms](#2-ai-algorithm-suite)
3. [Strategy Intelligence Page](#3-strategy-intelligence-page)
4. [Self-Improvement AI Module](#4-self-improvement-ai-module)
5. [Excel & CSV Export](#5-excel--csv-export)
6. [Market Coverage](#6-market-coverage)
7. [Security & Robustness](#7-security--robustness)
8. [Safety Guardrails](#8-safety-guardrails)
9. [Future Roadmap](#9-future-roadmap)
10. [For the Financially Underserved User](#10-for-the-financially-underserved-user)

---

## 1. Architecture Overview

```
Browser (React 19)
    │
    ├── /strategy-intelligence  ← NEW: 10-algorithm composite scoring
    ├── /predictions            ← 16 calibrated signals per request
    ├── /backtest               ← Walk-forward 3-year backtest
    ├── /strategies             ← Strategy library (8+ curated)
    ├── /history                ← Prediction outcome tracking
    └── /admin                  ← Self-optimizer control panel
         │
         ▼
Express Backend (Node.js, port 5000)
    │
    ├── /api/strategy-score     ← NEW: proxies to Python AI
    ├── /api/self-optimizer     ← NEW: health, optimize, approve
    ├── /api/inference          ← Prediction generation
    ├── /api/strategies         ← Strategy CRUD + NLP parser
    ├── /api/market             ← Live quotes + OHLCV
    └── /api/auth               ← Argon2id + JWT auth
         │
         ▼
Python AI Backend (FastAPI, port 8001)
    │
    ├── /predict                ← Ensemble ML signals
    ├── /strategy/score         ← NEW: 10-algorithm composite score
    ├── /strategy/score/batch   ← NEW: batch scan up to 20 symbols
    ├── /self-optimizer/health  ← NEW: health report + recommendations
    ├── /self-optimizer/optimize← NEW: propose parameter changes
    ├── /self-optimizer/approve ← NEW: human approval gate
    └── /backtest               ← Walk-forward backtest
```

**Data flow:** All OHLCV data is fetched by the Node.js backend from Yahoo Finance (free, no key required) and passed to the Python AI backend. The Python backend never makes outbound calls in production — all data comes in via the request body.

---

## 2. AI Algorithm Suite

### 10 Elite Algorithms (all run simultaneously)

| # | Algorithm | What it measures | Best for |
|---|-----------|-----------------|----------|
| 1 | **Ensemble ML** | LightGBM + XGBoost + LSTM weighted average | All regimes |
| 2 | **Technical Confluence** | RSI + EMA + MACD + BB + Volume agreement count | Trending markets |
| 3 | **Volatility-Adjusted** | GARCH(1,1) proxy, ATR percentile, vol regime | Entry timing |
| 4 | **Trend Strength** | ADX + 5-EMA alignment + Rate of Change | Trending markets |
| 5 | **Mean Reversion** | RSI extremes + Bollinger + VWAP deviation | Ranging markets |
| 6 | **Breakout Probability** | BB squeeze + volume surge + S/R proximity | Consolidation breakouts |
| 7 | **Smart Money (ICT)** | BOS + CHoCH + FVG + Order Block + Delta | Institutional setups |
| 8 | **Ichimoku Cloud** | 5-line system: Tenkan, Kijun, Senkou A/B, Chikou | Trend confirmation |
| 9 | **Market Profile** | POC + Value Area High/Low + TPO distribution | Mean reversion entries |
| 10 | **Fibonacci** | Retracement levels + Golden Ratio + Extensions | S/R zones |

### Advanced Feature Engineering (18 buckets, ~120 features)

Beyond the base 6 buckets (Price Action, Volatility, Trend, Volume, Context, Time), the system now computes:

- **Ichimoku Cloud** — 7 features: TK cross, price vs cloud, cloud thickness, signal strength
- **Fibonacci** — 6 features: nearest level, distance, golden ratio proximity, extension
- **Supertrend** — 3 features: direction, distance, flip signal
- **Elliott Wave Proxy** — 3 features: impulse score, corrective score, wave position
- **Market Profile** — 6 features: POC distance, Value Area position, width
- **Order Flow** — 7 features: delta ratio, buy/sell pressure, absorption, imbalance
- **Smart Money Concepts** — 6 features: BOS, CHoCH, FVG, Order Block distance
- **GARCH Volatility** — 3 features: conditional vol, vol regime, vol trend

### Composite Scoring

The composite score (0–100) is a **regime-aware weighted average** of all 10 algorithms:

| Regime | Top-weighted algorithms |
|--------|------------------------|
| Trending | Ensemble ML (25%), Trend Strength (20%), Technical Confluence (20%) |
| Ranging | Mean Reversion (20%), Market Profile (15%), Fibonacci (10%) |
| Volatile | Ensemble ML (30%), Volatility-Adjusted (20%), Breakout (15%) |
| Low Liquidity | Ensemble ML (40%), Trend Strength (20%), Volatility-Adjusted (15%) |

**Grade scale:**
- A+ (82–99): Highest conviction — multiple algorithms strongly agree
- A  (72–81): High conviction — majority of algorithms agree
- B  (62–71): Moderate conviction — mixed signals, proceed with caution
- C  (52–61): Low conviction — weak signal, reduce position size
- D  (0–51):  No signal — avoid or wait for better setup

---

## 3. Strategy Intelligence Page

**Route:** `/strategy-intelligence`

### Single Symbol Analysis
1. Enter any symbol (NSE equity, index, crypto, forex, commodity)
2. Select exchange and market regime
3. Click "Score Symbol" — all 10 algorithms run in parallel
4. View composite score, grade, consensus, and per-algorithm breakdown
5. Expand any algorithm card to see the specific reasons
6. Export results as Excel or CSV

### Batch Scan
- Preset watchlists: NSE Indices, Top Equities, Crypto, Global Indices, Commodities, Forex
- Custom symbol list (up to 20 symbols)
- Results ranked by composite score — highest opportunity at the top
- One-click Excel export of the entire scan

### Score History
- Every scored symbol is saved to your encrypted local history
- View and export your scoring history as CSV
- Track how scores change over time for the same symbol

### What the scores mean
- **Score 80+**: Strong setup — multiple independent algorithms agree. Still not a guarantee.
- **Score 60–79**: Moderate setup — worth watching, wait for confirmation.
- **Score below 60**: Weak or no setup — avoid or reduce size significantly.
- **Complement label**: Every score shows "X% means ~Y% chance of being wrong" — mandatory per safety rules.

---

## 4. Self-Improvement AI Module

**Route:** `/admin` → Self-Optimizer tab (admin only)

### What it does
The self-optimizer continuously monitors the application's own prediction accuracy and proposes improvements. It **never auto-applies changes** — every modification requires explicit human approval.

### Components

**Performance Tracker**
- Tracks every prediction outcome (T1/T2/T3 hit, SL hit, timeout)
- Rolling accuracy over last 100/200 outcomes
- Accuracy breakdown by market regime and signal grade
- Expected Calibration Error (ECE) — measures probability accuracy

**Drift Detector**
- Page-Hinkley sequential change detection algorithm
- Triggers when accuracy drops significantly from baseline
- Detects regime changes that require model adaptation

**Hyperparameter Tuner**
- Proposes safe parameter adjustments within pre-approved bounds
- Ensemble weights, calibration parameters, signal thresholds
- Bayesian-inspired random search with performance feedback
- All proposals logged with before/after metrics

**Improvement Recommender**
- Generates prioritized recommendations (HIGH/MEDIUM/LOW)
- Examples: "Retrain models", "Recalibrate probabilities", "Raise grade threshold"
- Each recommendation shows: reason, action, expected impact, approval requirement

### Safety constraints
- `approval_required: true` on all model changes
- Rollback capability: previous parameters always preserved
- Base functionality never modified — only additive improvements
- All changes logged with timestamp and approver

### API endpoints
```
POST /api/self-optimizer/outcome   — record a prediction outcome
GET  /api/self-optimizer/health    — health report + recommendations
POST /api/self-optimizer/optimize  — run optimization cycle (admin)
POST /api/self-optimizer/approve   — approve/reject changes (admin)
```

---

## 5. Excel & CSV Export

### What can be exported

| Export | Format | Contents |
|--------|--------|----------|
| Single symbol score | CSV | Composite score, grade, all 10 algorithm scores + reasons |
| Batch scan results | CSV | Ranked list of all scanned symbols with scores |
| Score history | CSV | All historical scores for the user |
| Prediction signals | CSV | 16 signals with entry, targets, stop-loss, probability |
| Backtest results | CSV | Accuracy metrics, T1/T2/T3 hit rates, Sharpe, drawdown |

### Excel compatibility
All CSV exports use UTF-8 BOM encoding for correct display in Microsoft Excel. Numeric fields are unquoted for proper Excel number formatting. Date fields use ISO 8601 format.

### How to open in Excel
1. Download the CSV file
2. Open Excel → File → Open → Browse to the CSV
3. In the Text Import Wizard: select "Delimited", check "Comma", click Finish
4. Or simply double-click the .csv file if Excel is your default CSV handler

---

## 6. Market Coverage

| Module | Instruments | Data Source |
|--------|-------------|-------------|
| `indices-india` | NIFTY50, BANKNIFTY, FINNIFTY, MIDCPNIFTY, SENSEX, NIFTYIT | Yahoo Finance (free) |
| `equities-india` | All NSE/BSE listed stocks | Yahoo Finance (free) |
| `fno-india` | All F&O instruments (futures + options) | Yahoo Finance + BS pricing |
| `crypto` | BTC, ETH, BNB, SOL, XRP, ADA, DOGE, AVAX, DOT, MATIC | Binance WebSocket (free) |
| `forex` | USDINR, EURUSD, GBPUSD, USDJPY, AUDUSD, USDCHF, EURINR | Yahoo Finance (free) |
| `commodities` | Gold, Silver, Crude Oil, Natural Gas, Copper, Aluminium | Yahoo Finance (free) |
| `global-indices` | S&P 500, NASDAQ, Dow Jones, FTSE, DAX, Nikkei, Hang Seng | Yahoo Finance (free) |

**Historical data:** Up to 5 years of daily OHLCV data available via Yahoo Finance API (no key required). The AI backend uses up to 750 bars (3 years) for backtest and feature computation.

---

## 7. Security & Robustness

### Authentication
- **Layer 1:** Username + Argon2id password hash (memory-hard, GPU-resistant)
- **Layer 2:** 12-digit HMAC-verified access key (XXXX-XXXX-XXXX format)
- **Session:** Short-lived JWT (15 min) + refresh token (7 days)
- **Rate limiting:** 10 login attempts per 15 min, 5 key generations per hour

### Data encryption
- All user data and predictions: AES-256-GCM (authenticated encryption)
- Key derivation: PBKDF2-SHA256, 100,000 iterations
- Per-file random IV (12 bytes) + authentication tag (16 bytes)
- Salt stored separately from data

### Input validation
- All user-supplied strings pass through `sanitizeTicker()` or `stripHtml()`
- No `eval()`, `new Function()`, or `innerHTML` with user data
- Body size limit: 512KB
- Symbol length limit: 20 characters
- Batch scan limit: 20 symbols

### Network security
- Helmet.js with strict CSP
- CORS: localhost only (no external origins)
- No HTTPS needed (local-only app)
- All API routes require authentication

### Prediction integrity
- HMAC signature verification on every prediction payload
- Suppressed signals never shown to users
- Probability clamping: floor 5%, ceiling 99%
- ECE monitoring: auto-downgrade at 5%, suppress at 8%

### Circuit breaker
- API client has circuit breaker (trips after 4 failures, recovers after 20s)
- Retry with exponential backoff (max 2 retries)
- Timeout: 8s default, 35s for AI scoring, 90s for batch scan

### Error boundaries
- Every major UI section wrapped in `<ErrorBoundary>`
- Graceful degradation: Python backend unavailable → JS engine fallback
- Mock OHLCV clearly labelled when real data unavailable

---

## 8. Safety Guardrails

### Non-negotiable rules (enforced in code)

1. **Disclaimer** — `<Disclaimer />` rendered on every page showing predictions. Non-removable, non-dismissible. Jurisdiction-aware (IN/US/EU).

2. **Complement label** — Every score and probability shows "X% means ~Y% chance of being wrong". Mandatory on all signal cards and score results.

3. **No guaranteed returns** — Zero language suggesting guaranteed profits anywhere in the UI. No FOMO language ("ACT NOW", "URGENT", "Don't miss out").

4. **Accuracy honesty** — Backtest results always show losing signals. No cherry-picking. Win rate and max drawdown always displayed together.

5. **Suppression** — Signals with `suppressed: true` are never shown. Signals below the accuracy gate (75%) trigger auto-optimization pipeline.

6. **Human approval gate** — Self-optimizer never auto-applies changes. Every parameter modification requires explicit admin approval.

7. **Data source labelling** — Mock/estimated data is always clearly labelled with a warning banner. Users always know when real data is unavailable.

### What this app is NOT
- Not a trading bot — it does not execute trades
- Not financial advice — it is informational analysis only
- Not a guarantee — all probabilities have complements (chance of being wrong)
- Not a replacement for a SEBI-registered investment advisor

---

## 9. Future Roadmap

### Near-term (next 3 months)
- [ ] Real SHAP values from LightGBM/XGBoost (replace proxy reasons)
- [ ] FinBERT sentiment integration (news + social media)
- [ ] Options chain live data (IV surface, put/call ratio)
- [ ] Zerodha Kite Connect live feed integration
- [ ] Mobile PWA (installable on Android/iOS)

### Medium-term (3–6 months)
- [ ] Reinforcement Learning timing module (RL_TIMING feature flag)
- [ ] Computer Vision pattern recognition (CV_PATTERNS feature flag)
- [ ] Multi-timeframe analysis (5min + 1hr + daily alignment)
- [ ] Portfolio-level risk management (correlation, VaR)
- [ ] Telegram/WhatsApp alert integration

### Long-term (6–12 months)
- [ ] LLM-powered strategy builder (GPT-4 / local LLM)
- [ ] Automated model retraining pipeline (with human approval gate)
- [ ] Community strategy sharing (anonymized, backtested)
- [ ] Paper trading simulator (no real money, track virtual P&L)
- [ ] Multi-user collaborative watchlists

---

## 10. For the Financially Underserved User

### Why this app exists
Corporate trading desks spend millions on Bloomberg terminals, proprietary algorithms, and quantitative analysts. Retail traders — especially in India — have historically had access to only basic charting tools and broker-provided tips that often serve the broker's interests, not the trader's.

StockMind AI levels the playing field by providing:

**What hedge funds use → What you get for free:**
- Ensemble ML models (LightGBM + XGBoost + LSTM) → ✓ Built-in
- Ichimoku Cloud analysis → ✓ Built-in
- Smart Money Concepts (ICT methodology) → ✓ Built-in
- Market Profile (Volume at Price) → ✓ Built-in
- GARCH volatility modeling → ✓ Built-in
- Walk-forward backtesting → ✓ Built-in
- Probability calibration (Platt scaling) → ✓ Built-in
- Self-monitoring and drift detection → ✓ Built-in

### How to use it responsibly
1. **Never risk more than 1–2% of your capital on any single trade** — the app enforces this via the risk % input
2. **Always check the complement label** — if a signal shows 75%, that means 25% chance of loss
3. **Use the backtest** — before trusting any strategy, verify it has 75%+ accuracy on historical data
4. **Diversify** — no single algorithm or signal is infallible; use the composite score
5. **Start small** — paper trade or use minimum lot sizes until you understand the signals
6. **Consult a SEBI-registered advisor** — this app is a tool, not a replacement for professional advice

### The disclaimer is there for a reason
Every page shows the disclaimer because markets are inherently unpredictable. Even the best algorithms are wrong 20–30% of the time. The goal is to tilt the odds in your favor, not to guarantee profits.

---

*StockMind AI — Built for the people, not the institutions.*

*Last updated: May 2026*
