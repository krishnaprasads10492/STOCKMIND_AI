# StockMind AI — Full Application Requirements Specification

> **Version**: 2.0.0  
> **Status**: Living Document — update on every architectural decision  
> **Last Updated**: 2026-05-01  
> **Guiding Question**: *"How confident should a rational system really be — and can it prove it?"*

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture — Fullstack Local-First](#2-architecture--fullstack-local-first)
3. [UI/UX Design System](#3-uiux-design-system)
4. [Market Modules](#4-market-modules)
5. [Authentication & Access Control](#5-authentication--access-control)
6. [Prediction Engine](#6-prediction-engine)
7. [Prediction Storage & Versioning](#7-prediction-storage--versioning)
8. [Live Market Prediction Interface](#8-live-market-prediction-interface)
9. [Backtesting Framework](#9-backtesting-framework)
10. [Data Ingestion Layer](#10-data-ingestion-layer)
11. [AI Model Training & Calibration](#11-ai-model-training--calibration)
12. [Data Storage, Compression & Cleanup](#12-data-storage-compression--cleanup)
13. [Cloud Backup (Optional)](#13-cloud-backup-optional)
14. [Safety Guidelines](#14-safety-guidelines)
15. [Regulatory Compliance](#15-regulatory-compliance)
16. [Production Monitoring](#16-production-monitoring)
17. [Document Verification Checklist](#17-document-verification-checklist)

---

---

## 1. Project Overview

StockMind AI is a **self-contained, local-first, fullstack application** for AI-powered stock market prediction and analysis. It runs entirely on a single device (laptop or mobile) with no mandatory cloud dependency. The frontend and backend live in the same project repository and are deployed together as a single unit.

### 1.1 Core Purpose

| Capability | Description |
|---|---|
| **Prediction** | Calibrated probability predictions for stocks, indices, F&O, crypto, commodities, forex |
| **Analysis** | Multi-timeframe technical analysis with AI-generated explanations |
| **Tracking** | Store every prediction, compare against live outcomes, compute real accuracy |
| **Optimisation** | Use outcome data to continuously improve prediction logic per instrument |
| **Risk Management** | Capital-aware entry/exit/stoploss recommendations per user profile |

### 1.2 What This Application Is NOT

- NOT a trade execution platform — no broker API, no order placement
- NOT financial advice — every output carries a non-removable legal disclaimer
- NOT a cloud SaaS — designed for local device deployment with optional cloud backup

### 1.3 Deployment Model

```
Single Device (Laptop / Mobile)
├── Frontend  (React 19 + Vite)    → localhost:3000
├── Backend   (Node/Express)       → localhost:5000
├── Data      (JSON / CSV files)   → encrypted local folder
└── Optional  (Cloud email backup) → user-configured
```

---

## 2. Architecture — Fullstack Local-First

### 2.1 Project Structure

```
stockmind-ai/
├── src/                     # React frontend
│   ├── components/
│   ├── pages/
│   │   ├── Login/
│   │   ├── Dashboard/
│   │   ├── Predictions/
│   │   ├── History/
│   │   ├── Backtest/
│   │   ├── Admin/
│   │   └── Settings/
│   ├── hooks/
│   ├── services/
│   ├── store/
│   ├── utils/
│   └── types/
├── server/                  # Express backend
│   ├── routes/
│   ├── services/
│   ├── models/
│   ├── middleware/
│   ├── storage/
│   └── keygen/
├── data/                    # AES-256-GCM encrypted
│   ├── users/
│   ├── predictions/
│   ├── models/
│   └── backtest/
├── vite.config.js
├── package.json
└── StockMind-AI-Full-Requirements-Spec.md
```

### 2.2 Technology Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend | React 19 + Vite 7 | Fast HMR, optimised bundles, path aliases |
| Backend | Node.js + Express | Same JS ecosystem, easy local deployment |
| Styling | CSS Modules + design tokens | Scoped, no runtime overhead |
| State | Zustand (global) + useState (local) | Minimal, no boilerplate |
| Routing | React Router v6 | SPA routing with protected routes |
| Charts | Recharts | Lightweight, composable, accessible |
| Storage | JSON + CSV files (AES-256-GCM encrypted) | No DB dependency, portable |
| Auth | JWT (15 min) + refresh tokens + 12-digit key | Three-factor local auth |
| Compression | zlib (gzip) via Node built-in | Zero extra dependency |
| Testing | Vitest + Testing Library | Fast, Vite-native |

## 3. UI/UX Design System

### 3.1 Design Principles

| Principle | Implementation |
|---|---|
| **Information density** | Dashboard shows max data in minimum space — no wasted whitespace |
| **Colour semantics** | Green = bull/profit, Red = bear/loss, Amber = warning, Indigo = AI signal. Colour is NEVER the only indicator — always paired with a text label |
| **Responsive first** | All layouts work on 320px mobile through 1920px desktop |
| **Keyboard navigable** | Every interactive element reachable and operable via keyboard |
| **Accessible** | WCAG 2.1 AA minimum. ARIA roles, alt text, focus rings on all controls |
| **No FOMO language** | Zero use of "ACT NOW", "URGENT", "Do not miss" anywhere in the UI |
| **Honest metrics** | Win rate always shown alongside loss rate — no cherry-picking |

### 3.2 Global Design Tokens (index.css)

```css
/* Palette — dark finance theme */
--color-bg-base:       #0f172a   /* page background */
--color-bg-surface:    #1e293b   /* cards, panels */
--color-bg-elevated:   #273549   /* dropdowns, modals */
--color-bull:          #22c55e   /* price up, profit */
--color-bear:          #ef4444   /* price down, loss */
--color-accent:        #38bdf8   /* interactive elements */
--color-ai-glow:       #818cf8   /* AI-generated content */
--color-warning:       #f59e0b   /* degraded state, caution */
```

### 3.3 Layout Regions

```
+--------------------------------------------------+
| TopBar: Logo | Market Status | User | Settings   |
+--------------------------------------------------+
| SystemHealthBanner (hidden when healthy)         |
+--------------------------------------------------+
| SideNav  |  Main Content Area                    |
| -------- |  (route-dependent)                    |
| Dashboard|                                       |
| Markets  |                                       |
| Predict  |                                       |
| History  |                                       |
| Backtest |                                       |
| Admin    |                                       |
+--------------------------------------------------+
| Footer: Disclaimer (non-removable)               |
+--------------------------------------------------+
```

### 3.4 Responsive Breakpoints

| Breakpoint | Width | Layout |
|---|---|---|
| Mobile | < 640px | Single column, bottom nav |
| Tablet | 640–1024px | Two column, collapsible side nav |
| Desktop | > 1024px | Three column, persistent side nav |

### 3.5 Component Library (shared)

| Component | Purpose |
|---|---|
| `<PredictionCard>` | Single prediction with entry/exit/SL/validity/accuracy |
| `<ProbabilityBar>` | Visual probability with complement label |
| `<SignalGradeBadge>` | A+/A/B/C/D with colour + text |
| `<PriceTag>` | Formatted price with bull/bear colouring |
| `<RiskRewardBadge>` | R:R ratio display |
| `<AccuracyMeter>` | Rolling accuracy gauge (win + loss both shown) |
| `<RegimeBadge>` | Trending / Ranging / Volatile / Low-Liquidity |
| `<Disclaimer>` | Non-removable legal text (jurisdiction-aware) |
| `<ErrorBoundary>` | Isolates section failures |
| `<SystemHealthBanner>` | Degraded-mode warning |
| `<MarketStatusDot>` | Live / Pre-market / Closed indicator |
| `<ConfidenceTooltip>` | "78% means ~22% chance of being wrong" |
| `<SuppressedSignalCard>` | Shows suppression reason, never raw signal |

---

## 4. Market Modules

Each market segment is a self-contained module with its own page, data service, and prediction engine configuration.

### 4.1 Module Registry

| Module ID | Market | Instruments | Exchange(s) | Data Source |
|---|---|---|---|---|
| `equities-india` | Indian Equities | Stocks, ETFs | NSE, BSE | Zerodha/Upstox (T3), Finnhub (T1) |
| `indices-india` | Indian Indices | NIFTY 50, BANK NIFTY, SENSEX, NIFTY IT, MIDCAP | NSE | NSE feed / Yahoo (T0) |
| `fno-india` | F&O | Index futures, stock futures, options (CE/PE) | NSE | NSE Licensed / Upstox |
| `crypto` | Cryptocurrency | BTC, ETH, top 50 by market cap | Binance, CoinGecko | Binance WS (T2) |
| `forex` | Foreign Exchange | Major pairs (USD/INR, EUR/USD, etc.) | Forex market | Alpha Vantage, Finnhub |
| `commodities` | Commodities | Gold, Silver, Crude Oil, Natural Gas | MCX, COMEX | Finnhub, Twelve Data |
| `global-indices` | Global Indices | S&P 500, NASDAQ, DOW, FTSE, NIKKEI | Various | Yahoo Finance (T0) |

### 4.2 Module Page Layout

Each module page contains:

```
+------------------------------------------+
| Module Header: Name | Status | Last Update|
+------------------------------------------+
| Market Overview Strip (top movers)        |
+------------------------------------------+
| Watchlist Panel  | Chart Panel            |
|                  | (OHLCV + indicators)   |
|                  |                        |
+------------------------------------------+
| Prediction Panel (16 signals, sorted by  |
| probability high → low)                  |
+------------------------------------------+
| Accuracy Tracker (rolling 30/60/90 day)  |
+------------------------------------------+
```

### 4.3 Instrument Selection

- Search bar with ticker sanitisation (`sanitizeTicker()`) before any API call
- Autocomplete from local instrument master file (updated daily)
- Recent + starred instruments pinned to top
- Module-aware: searching in F&O module shows only F&O instruments

### 4.4 Chart Panel

| Feature | Detail |
|---|---|
| Chart types | Candlestick (default), Line, OHLC bar |
| Timeframes | 1m, 5m, 15m, 1h, 4h, 1D, 1W |
| Overlays | EMA (5/20/50/200), VWAP, Bollinger Bands, Supertrend |
| Sub-charts | RSI, MACD, Volume, ATR |
| AI overlays | Predicted entry zone, T1/T2/T3 levels, SL level (dashed lines) |
| Prediction markers | Timestamped markers for stored predictions |
| Outcome markers | Green tick (target hit) / Red cross (SL hit) on historical predictions |

---

## 5. Authentication & Access Control

### 5.1 Three-Factor Authentication Flow

```
Step 1: Username (alphanumeric, 4-32 chars)
        + Password (8-char minimum, complexity enforced)
        → Server validates against hashed user record (Argon2id)
        → Issues a short-lived session token (5 min TTL)

Step 2: 12-Digit Key verification
        → User enters key generated by the standalone KeyGenerator tool
        → Server validates HMAC of key against user record
        → On success: issues full JWT (15 min) + refresh token (7 days)

Step 3: Access granted → Prediction Interface
```

### 5.2 Access Levels

| Role | Capabilities |
|---|---|
| **Admin** | All user capabilities + user management + key generation + data folder access + system config |
| **User** | Market modules, predictions, history, personal settings, cloud backup toggle |

### 5.3 User Record Schema

Stored as an individual encrypted JSON file per user in `data/users/{userId}.json.enc`.

```json
{
  "userId": "uuid-v7",
  "username": "string",
  "passwordHash": "argon2id-hash",
  "role": "admin | user",
  "keyHash": "hmac-sha256-of-12-digit-key",
  "keyGeneratedAt": "ISO-8601",
  "keyExpiresAt": "ISO-8601",
  "createdAt": "ISO-8601",
  "createdBy": "adminUserId",
  "lastLoginAt": "ISO-8601",
  "isActive": true,
  "preferences": {
    "defaultModule": "equities-india",
    "defaultCapital": 100000,
    "riskPerTrade": 1.5,
    "jurisdiction": "IN",
    "cloudBackup": false,
    "cloudEmail": "",
    "notificationFrequency": "hourly",
    "quietHoursStart": "22:00",
    "quietHoursEnd": "07:00",
    "cleanupIntervalDays": 30
  }
}
```

### 5.4 User Management Module (Admin Only)

Fields when adding a new user:

| Field | Validation |
|---|---|
| Full Name | 2-100 chars, letters + spaces |
| Username | 4-32 chars, alphanumeric + underscore, unique |
| Password | Min 8 chars, 1 uppercase, 1 number, 1 special char |
| Role | admin / user (dropdown) |
| Default Module | Module selector |
| Default Capital | Numeric, > 0 |
| Risk Per Trade % | 0.5 – 5.0 |
| Jurisdiction | IN / US / EU |
| Cloud Backup | Toggle |
| Cloud Email | Valid email if backup enabled |

### 5.5 Key Generator (Standalone Tool)

- Runs as a **separate Node.js script** (`server/keygen/generate.js`) — NOT part of the web application
- Executed by admin on the local machine: `node server/keygen/generate.js --user <username>`
- Generates a cryptographically random 12-digit numeric key (format: `XXXX-XXXX-XXXX`)
- Stores HMAC-SHA256 of the key in the user record — the plaintext key is shown ONCE and never stored
- Key has a configurable TTL (default: 30 days)
- Admin must securely deliver the key to the user out-of-band

```
Key format:  1847-3920-5561
Entropy:     ~39.9 bits (10^12 combinations)
Storage:     HMAC only — plaintext never persisted
Delivery:    Out-of-band (admin to user)
Expiry:      Configurable (default 30 days)
```

### 5.6 Data Folder Authentication

- `data/` directory is encrypted at the filesystem level using AES-256-GCM
- Encryption key is derived from the admin password via PBKDF2 (100,000 iterations, SHA-256)
- On server startup, admin must provide the data folder password to unlock
- All file reads/writes go through the `storage` service which handles encrypt/decrypt transparently
- If the wrong password is provided, the server starts in read-only demo mode with no real data

---

## 6. Prediction Engine

### 6.1 Design Principles

| # | Principle | Why It Matters |
|---|---|---|
| 1 | **Probability > Direction** | Optimises calibrated probability correctness, not raw directional accuracy. 70% correct at 70% stated > 80% correct at 95% stated |
| 2 | **Ensemble > Single Model** | Fuses orthogonal signals so failure in one does not cascade |
| 3 | **Calibration Is Mandatory** | 75% prediction must mean ~75% empirical success. Raw softmax/sigmoid forbidden in production |
| 4 | **Market Regimes Matter** | Models weighted differently for trending, ranging, high-volatility |
| 5 | **Public-First, Private-Ready** | Works on public data. Private feeds increase confidence weighting, not model architecture |
| 6 | **Min Loss Priority** | Optimal profit must exceed (broker commission + expected loss value) |
| 7 | **Accuracy Gate** | Prediction mechanism is only considered stable at 75%–97% accuracy on 3-year backtest |

### 6.2 Prediction Output — 16 Signals Per Request

Every prediction request returns exactly **16 signals**, sorted highest to lowest probability.

```json
{
  "requestId": "uuid-v7",
  "symbol": "NIFTY50",
  "exchange": "NSE",
  "generatedAt": 1746057600000,
  "marketRegime": "trending",
  "modelVersion": "v2.1.0",
  "userCapital": 100000,
  "userRiskPct": 1.5,
  "signals": [
    {
      "rank": 1,
      "id": "uuid-v7",
      "type": "LONG",
      "entryPrice": 24150.00,
      "entryZoneLow": 24120.00,
      "entryZoneHigh": 24180.00,
      "t1Price": 24350.00,
      "t2Price": 24520.00,
      "t3Price": 24700.00,
      "stopLoss": 24020.00,
      "immediateOptimalSL": 24080.00,
      "maxRisk": 1500.00,
      "riskRewardRatio": 2.67,
      "validity": "2026-05-01T15:30:00+05:30",
      "validityBars": 12,
      "probability": 82,
      "grade": "A",
      "t1Probability": 82,
      "t2Probability": 61,
      "t3Probability": 38,
      "slProbability": 18,
      "regime": "trending",
      "reasons": ["EMA alignment bullish", "RSI 14 = 58, not overbought", "Volume 1.4x SMA"],
      "suppressed": false,
      "suppressReason": null,
      "disclaimer": "...",
      "hmacSignature": "sha256-hex"
    }
  ],
  "suppressedCount": 2,
  "disclaimer": "..."
}
```

### 6.3 Prediction Fields Explained

| Field | Definition |
|---|---|
| `entryPrice` | Suggested entry price |
| `entryZoneLow/High` | Acceptable entry range |
| `t1/t2/t3Price` | Target 1/2/3 price levels |
| `stopLoss` | Structure-based stop loss (ATR + S/R) |
| `immediateOptimalSL` | Tighter SL for immediate entry — minimises loss if wrong |
| `maxRisk` | Max capital at risk = (entry - SL) x position size based on user capital + risk% |
| `riskRewardRatio` | (T1 - entry) / (entry - SL) |
| `validity` | Timestamp after which signal is stale |
| `validityBars` | Number of candles the signal is valid for |
| `probability` | Calibrated direction probability (5–99, never 0 or 100) |
| `grade` | A+/A/B/C/D composite grade |
| `t1/t2/t3Probability` | Individual target hit probabilities (declining T1>T2>T3) |
| `slProbability` | Probability of SL being hit first |
| `reasons` | SHAP-derived explanation bullets (min 3, max 8) |

### 6.4 Prediction Display Modes

Users can toggle between two display modes:

**Card Mode** (default)
```
+------------------------------------------+
| LONG  NIFTY50  Grade: A   Prob: 82%       |
| Entry: 24,150  SL: 24,020  R:R 2.67       |
| T1: 24,350 (82%)  T2: 24,520 (61%)        |
| T3: 24,700 (38%)  Max Risk: ₹1,500        |
| Valid until: 01-May 15:30                 |
| [Why?] [Save] [Chart]                     |
| ⚠ 82% means ~18% chance of being wrong   |
+------------------------------------------+
```

**Chart Mode**
- Entry zone shaded on chart
- T1/T2/T3 as horizontal dashed lines (green)
- SL as horizontal dashed line (red)
- Immediate optimal SL as dotted line (amber)
- Validity window shaded on time axis

### 6.5 Prediction Mechanisms (Per Instrument Type)

| Instrument | Primary Models | Special Features |
|---|---|---|
| Index (NIFTY/SENSEX) | TFT + LSTM + XGBoost | Expiry-aware, VIX-weighted |
| Index Futures | TFT + LSTM | Basis tracking, rollover detection |
| Options (CE/PE) | RL Agent + TFT | IV surface, Greeks-aware, time decay |
| Stocks | XGBoost + LSTM + FinBERT | Earnings proximity, sector beta |
| Crypto | LSTM + CNN + FinBERT | 24/7 market, BTC dominance feature |
| Forex | TFT + XGBoost | Session-aware (London/NY/Asia), macro events |
| Commodities | LSTM + XGBoost | Seasonality, geopolitical sentiment |

### 6.6 Model Stack

| Model | Goal | Used For |
|---|---|---|
| LSTM / Temporal CNN | Probabilistic price movement distribution | Direction probability, expected move magnitude |
| XGBoost / LightGBM | Classification + explainability | Feature importance (SHAP), regime detection |
| Temporal Fusion Transformer (TFT) | Multi-horizon probabilistic forecasting | T1/T2/T3 probability, attention explainability |
| CNN (ResNet-50) + ViT | Visual pattern recognition from charts | Pattern confirmation, false breakout suppression |
| FinBERT (Sentiment NLP) | Quantify news/social impact | Confidence adjustment, risk flagging |
| RL Agent (Optional) | Optimal entry/exit timing | Entry timing, dynamic SL adjustment |

### 6.7 Suppression Rules

A signal is suppressed (not shown) when ANY of the following are true:

| Condition | Reason |
|---|---|
| < 3 of 5 models agree | Ensemble disagreement |
| Calibrated probability < 50% | Below useful threshold |
| Volume < 50% of 20-day SMA | Low liquidity |
| Data feed failure for this instrument | Unreliable input |
| Within 5 min of major news event | News risk |
| ECE > 8% for this instrument | Calibration failure |
| Instrument has < 6 months OHLCV history | Insufficient data |
| Market closed + no pre-market data | No actionable context |
| SL hit rate > 40% in current regime | Regime mismatch |

---

## 7. Prediction Storage & Versioning

### 7.1 Storage Format

Every prediction is stored in two formats simultaneously:

**JSON** — `data/predictions/{YYYY-MM}/{symbol}_{timestamp}_{id}.json`
- Full prediction payload including all fields, reasons, model weights
- HMAC-signed at write time
- Compressed with gzip after 24 hours

**CSV** — `data/predictions/{YYYY-MM}/summary.csv`
- Append-only summary row per prediction
- Fields: id, symbol, exchange, generatedAt, grade, probability, entryPrice, t1, t2, t3, sl, regime, modelVersion
- Used for fast bulk analysis and export

### 7.2 Outcome Tracking

When live market data is available, the system automatically resolves stored predictions:

```json
{
  "outcomeResolvedAt": 1746100000000,
  "outcome": "T1_HIT",
  "outcomePrice": 24355.00,
  "outcomeBars": 8,
  "actualProbabilityBucket": "80-90",
  "wasCorrect": true,
  "pnl": 1750.00,
  "pnlAfterCommission": 1620.00
}
```

Possible outcome values: `T1_HIT`, `T2_HIT`, `T3_HIT`, `SL_HIT`, `TIMEOUT`, `PARTIAL_T1`, `PARTIAL_T2`

### 7.3 Accuracy Computation

Rolling accuracy is computed per instrument, per grade, per regime:

```
Accuracy% = (Correct predictions / Total resolved predictions) x 100

Correct   = T1_HIT or better (T2/T3)
Incorrect = SL_HIT or TIMEOUT

Displayed as:
  Win Rate: 78%  |  Loss Rate: 22%  |  Avg R:R: 2.4
  (Both always shown — no cherry-picking)
```

### 7.4 Prediction Versioning — 3 Versions Retained

The system retains the **last 3 versions** of the prediction model per instrument.

```
data/models/
├── NIFTY50/
│   ├── v3.0.0/   ← current production
│   ├── v2.1.0/   ← previous (retained)
│   └── v2.0.0/   ← two versions back (retained)
│
├── BANKNIFTY/
│   ├── v2.2.0/
│   └── v2.1.0/
```

Each version directory contains:
- `model.bin.enc` — encrypted, signed model artifact
- `manifest.json` — version, training date, backtest accuracy, ECE, Brier score
- `calibration.json` — Platt/Isotonic calibration parameters
- `features.json` — selected feature list for this version

### 7.5 Prediction Health Dashboard

Per instrument, per model version:

| Metric | Display | Threshold |
|---|---|---|
| Rolling 30-day accuracy | Gauge + trend line | Must be 75–97% |
| ECE (calibration error) | Number + colour | < 5% green, 5-8% amber, >8% red |
| Brier Score trend | 7/30/90-day sparkline | Must be non-increasing |
| T1/T2/T3 hit rates | Stacked bar | T1 > T2 > T3 expected |
| SL hit rate | Number | Alert if > 40% in current regime |
| Suppression rate | % of signals suppressed | Alert if > 60% |
| Model version | Badge | Shows which version generated each prediction |

### 7.6 Auto-Optimisation Trigger

When rolling 30-day accuracy drops below 75% for a specific instrument:

```
1. ALERT    → Prediction health panel shows amber warning
2. REDUCE   → Confidence scores reduced 10% for that instrument
3. REVIEW   → Admin notified to review model for that instrument
4. RETRAIN  → Offline retraining triggered with latest 3-year data
5. VALIDATE → New model must pass backtest gate (>75% accuracy)
6. CANARY   → New model runs alongside old for 48 hours
7. APPROVE  → Admin approves promotion (human-in-the-loop)
8. PROMOTE  → New version becomes production, old retained as v-1
```
---

## 8. Live Market Prediction Interface

### 8.1 User Input Panel

Before generating predictions, the user configures:

| Input | Type | Validation |
|---|---|---|
| Instrument | Searchable select | Must pass `sanitizeTicker()` |
| Capital | Number | > 0, max 10 crore |
| Risk per trade % | Slider 0.5–5.0 | Default from user preferences |
| Max simultaneous trades | Number 1–10 | Affects capital allocation |
| Preferred timeframe | Select | 5m / 15m / 1h / 4h / 1D |
| Direction bias | Toggle | Long / Short / Both |
| Min grade | Select | A+ / A / B / C (filter output) |

### 8.2 Capital & Risk Calculation

```
Position Size = (Capital x Risk%) / (Entry - StopLoss)
Max Risk      = Capital x Risk%
Min Profit    = Broker Commission x 2 + Max Risk

Example:
  Capital = ₹1,00,000  |  Risk = 1.5%  |  Entry = 24,150  |  SL = 24,020
  Max Risk      = ₹1,500
  Position Size = 1,500 / 130 = 11.5 → 11 units
  T1 Profit     = 11 x (24,350 - 24,150) = ₹2,200
  Commission    = ~₹180 (both legs)
  Net Profit    = ₹2,020  ✓ (> commission + loss)
```

### 8.3 16-Signal Output Panel

```
+----------------------------------------------------------+
| 16 Predictions — NIFTY50 — 01-May-2026 10:32            |
| Sorted: Highest probability first                        |
+----------------------------------------------------------+
| #1  LONG  82%  A   Entry:24150  SL:24020  T1:24350      |
| #2  LONG  79%  A   Entry:24100  SL:23980  T1:24300      |
| #3  SHORT 74%  B   Entry:24200  SL:24320  T1:24050      |
| ...                                                      |
| #16 LONG  51%  C   Entry:24050  SL:23900  T1:24200      |
+----------------------------------------------------------+
| [Expand All] [Chart View] [Export CSV] [Save All]        |
+----------------------------------------------------------+
```

### 8.4 Signal Validity & Staleness

- Each signal shows a countdown timer to expiry
- Expired signals are greyed out with "STALE" badge — not removed, for reference
- If market conditions change significantly (regime shift, news event), signals are marked "CONDITIONS CHANGED"
- User can request a refresh at any time

### 8.5 Regime Warnings

Active warnings shown prominently when:

| Condition | Warning |
|---|---|
| VIX spike > 20% | "High volatility — reduce position size" |
| Low volume (< 50% SMA) | "Low liquidity — wider spreads expected" |
| Within 30 min of expiry | "Expiry risk — time decay accelerating" |
| Major news in < 15 min | "News event imminent — signals may be invalidated" |
| SL hit rate > 40% today | "Choppy market — consider sitting out" |

---

## 9. Backtesting Framework

### 9.1 Backtest Requirements

- Minimum 3 years of OHLCV data required per instrument
- Walk-forward methodology — NO random splits, NO future leakage
- Purge N bars before test window start
- Embargo M bars after test window end
- Per-regime evaluation: Trending / Ranging / Volatile / Low-Liquidity

### 9.2 Walk-Forward Schedule

```
Train [2021-2022]  →  Test [2023 Q1]
Train [2021-2023]  →  Test [2023 Q2]
Train [2021-2023]  →  Test [2023 Q3]
Train [2022-2023]  →  Test [2024 Q1]
Train [2022-2024]  →  Test [2024 Q2]
... and so on
```

### 9.3 Accuracy Gate

A prediction mechanism is considered **stable and reliable** only when:

| Metric | Threshold | Action if Not Met |
|---|---|---|
| Overall accuracy | 75% – 97% | Retrain / redesign mechanism |
| T1 hit rate | > 65% | Review entry logic |
| SL hit rate | < 35% | Review SL placement logic |
| Avg R:R | > 1.5 | Review target logic |
| ECE | < 5% | Recalibrate |
| Brier Score | Decreasing trend | Retrain |
| Min profit > commission + loss | Must be true | Adjust position sizing |

If any threshold is not met, the prediction mechanism for that specific instrument is flagged and the auto-optimisation pipeline is triggered (Section 7.6).

### 9.4 Backtest Result Storage

Stored in `data/backtest/{symbol}_{modelVersion}_{date}.json`

```json
{
  "symbol": "NIFTY50",
  "modelVersion": "v3.0.0",
  "backtestDate": "2026-05-01",
  "dataRange": "2023-01-01 to 2026-01-01",
  "totalSignals": 1847,
  "suppressedSignals": 312,
  "resolvedSignals": 1535,
  "accuracy": 81.2,
  "t1HitRate": 81.2,
  "t2HitRate": 58.4,
  "t3HitRate": 31.7,
  "slHitRate": 18.8,
  "avgRR": 2.41,
  "ece": 3.2,
  "brierScore": 0.142,
  "byRegime": {
    "trending":      { "accuracy": 87.1, "signals": 612 },
    "ranging":       { "accuracy": 74.3, "signals": 489 },
    "volatile":      { "accuracy": 71.8, "signals": 287 },
    "low_liquidity": { "accuracy": 68.2, "signals": 147 }
  },
  "passed": true
}
```

---

## 10. Data Ingestion Layer

### 10.1 Data Trust Philosophy

Every data point carries metadata. The system never trusts all data equally.

```js
// DataPoint schema
{
  value:            number,
  timestamp:        number,   // Unix ms
  source:           string,
  reliabilityScore: number,   // 0.0 – 1.0
  latencyMs:        number,
  tier:             0 | 1 | 2 | 3
}
```

### 10.2 Data Source Tiers

| Tier | Role | Sources | Reliability | Latency |
|---|---|---|---|---|
| **Tier 0** | Long history, regime learning | Yahoo Finance, CoinGecko | 0.60–0.70 | High (EOD) |
| **Tier 1** | Feature enrichment, intraday | Alpha Vantage, Twelve Data, Finnhub | 0.70–0.80 | Medium |
| **Tier 2** | High-frequency structure | Binance WS, Polygon.io | 0.80–0.90 | Low |
| **Tier 3** *(Private)* | Confidence amplification | Zerodha, NSE Direct, Bloomberg | 0.90–0.98 | Very Low |

### 10.3 Public Market Data Sources

| Source | Data | Free Tier | Usage |
|---|---|---|---|
| Yahoo Finance | OHLCV, splits, dividends | Unlimited | Long history (10+ years), EOD validation |
| Alpha Vantage | Intraday (1m–60m), FX, Crypto | 25 req/day | Feature enrichment |
| Binance | Crypto ticks, order book | Generous | High-frequency crypto modelling |
| CoinGecko | Crypto metadata, market cap | 30 req/min | Volatility regimes |
| Finnhub | Stocks, FX, Crypto + News | 60 req/min | Unified feed, earnings |
| Twelve Data | Multi-asset OHLCV | 800 req/day | Backup, cross-validation |
| GDELT | Global news events | Unlimited | Sentiment training data |
| NewsAPI.org | General news | 100 req/day | Headline sentiment |

### 10.4 Private API Extension Points

**India**: Zerodha Kite Connect, Upstox API v2, Angel One SmartAPI, Dhan API, Fyers API v3, Shoonya (Finvasia), NSE Licensed Feed

**Global**: Bloomberg Terminal API, Refinitiv (LSEG), Polygon.io (paid), IEX Cloud, Interactive Brokers, CME Group Data

> **Golden Rule**: Private APIs increase confidence weighting. They do NOT change model architecture.

### 10.5 Data Quality Gates

| Gate | Check | Action on Failure |
|---|---|---|
| Completeness | No missing OHLCV, no NaN | Reject, use fallback source |
| Timeliness | Latency within tier range | Downgrade reliability score |
| Range validation | H >= L, no negatives | Reject + alert |
| Consistency | Cross-validate 2+ sources | Use higher-tier source |
| Continuity | No unexpected gaps | Interpolate small gaps, reject large |
| Corporate actions | Detect splits/dividends | Adjust historical data |
| Duplicates | Same timestamp/source | Deduplicate, keep latest |

### 10.6 Feature Engineering

**Bucket 1 — Price Action**: Log returns, simple returns, candle body/wick ratios, gap strength, consecutive direction

**Bucket 2 — Volatility**: ATR (14, 5), Parkinson volatility, volatility ratio, Bollinger width, GARCH(1,1)

**Bucket 3 — Trend & Momentum**: EMA slopes (5–200), MACD histogram velocity, RSI (14), RSI divergence, ADX, Supertrend

**Bucket 4 — Volume**: VWAP deviation, OBV slope, volume ratio, volume climax, volume-price divergence

**Bucket 5 — Market Context**: Index beta, sector relative strength, VIX, BTC dominance, correlation cluster

**Bucket 6 — Time-Based**: Trading session, day of week, expiry proximity, earnings proximity, month (cyclical)

Multi-timeframe stacking: 5m/15m/1h/4h/1D features stacked independently (~240 features) + cross-TF alignment = ~260 dimensions.
Feature selection target: 80–120 features after Mutual Information + SHAP + RFE + VIF pruning.

---

## 11. AI Model Training & Calibration

### 11.1 Label Creation Strategy

The system predicts **event probabilities**, not price direction.

| Label | Definition | Type |
|---|---|---|
| Y_direction | Price moved >= X% in predicted direction within N bars? | Binary |
| Y_T1_before_SL | Target 1 hit before Stop-Loss? | Binary |
| Y_T2_before_SL | Target 2 hit before Stop-Loss? | Binary |
| Y_T3_before_SL | Target 3 hit before Stop-Loss? | Binary |
| Y_SL_hit | Stop-Loss hit first? | Binary |
| Y_timeout | No meaningful move within window | Binary |
| Y_max_adverse | Maximum adverse excursion | Continuous |
| Y_max_favorable | Maximum favorable excursion | Continuous |
| Y_time_to_T1 | Bars to reach T1 | Continuous |

Each prediction field has its own target, own model head, and own calibration.

### 11.2 Three-Stage Calibration Pipeline

**Stage 1 — Model-Level**
- LSTM / XGBoost → Platt Scaling: `P_cal = 1 / (1 + e^(A*f(x) + B))`
- TFT / CNN → Isotonic Regression (non-parametric, no curve shape assumptions)
- Sentiment → MinMax normalisation + shrinkage

**Stage 2 — Ensemble-Level**
- Meta-model output (Logistic Regression for audit, Shallow NN for production)
- → Isotonic Regression calibration

**Stage 3 — Regime-Aware Adjustment**
- Trending: x1.05
- Ranging: x0.85
- News event active: x0.70
- Low liquidity: x0.60

> **WARNING**: Raw probabilities from any model are NEVER shown to users. Must pass all three stages.

### 11.3 Calibration Quality Metrics

| Metric | Threshold | Action |
|---|---|---|
| ECE (Expected Calibration Error) | < 5% | Auto-downgrade confidence |
| MCE (Maximum Calibration Error) | < 10% | Reduce model weight |
| Brier Score | Decreasing trend | Retrain trigger |
| Reliability Slope | ~1.0 | Recalibrate |

**Brier Score insight**: 90% wrong = 0.81 penalty. 60% wrong = 0.36 penalty. Forces honest probabilities.

### 11.4 Confidence Decomposition (Per-Field Scoring)

| Field | Factors & Weights |
|---|---|
| Entry | S/R proximity 30%, Volume 25%, MTF alignment 25%, CV pattern 20% |
| Stop-Loss | Structure 35%, ATR stability 30%, Wick breach rate 20%, Volume at SL 15% |
| T1 | Nearest S/R 30%, Fibonacci 25%, Mean reversion 25%, VPOC 20% |
| Minimal-Loss Exit | Time decay 30%, Momentum fade 30%, Volume dry-up 20%, Adverse news 20% |

### 11.5 Drift Detection & Automated Retraining

| Drift Type | Detection Method | Threshold | Response |
|---|---|---|---|
| Feature drift | KS test | p < 0.01 | Level 1: reduce 10% |
| Prediction drift | PSI | > 0.2 | Level 2: reduce 20%, recalibrate |
| Calibration drift | ECE spike | > 5% | Level 2: recalibrate |
| Accuracy drift | Rolling 30-day | Delta > 5% | Level 3: quarantine, retrain, human approval |

### 11.6 Model Integrity & Security

- Every model artifact SHA-256 hashed + RSA-2048 signed at training time
- Loader verifies signature before loading — reject on mismatch
- Model registry is append-only — no edits, no deletions
- All changes require human-in-the-loop approval
- Weights encrypted at rest (AES-256-GCM)
- No self-modifying production models — retraining happens offline in isolated environment
- Pipeline: validation → backtesting → canary deploy → human approval → promotion

---

## 12. Data Storage, Compression & Cleanup

### 12.1 Storage Layout

```
data/                              ← AES-256-GCM encrypted root
├── users/                         ← Per-user encrypted JSON files
│   ├── {userId}.json.enc
│   └── users-index.json.enc       ← Username → userId lookup (admin only)
├── predictions/                   ← Prediction history
│   ├── {YYYY-MM}/                 ← Monthly partitioning
│   │   ├── {symbol}_{ts}_{id}.json.gz   ← Compressed after 24h
│   │   └── summary.csv            ← Append-only summary
├── models/                        ← Trained model artifacts
│   └── {symbol}/v{N}/             ← 3 versions retained
├── backtest/                      ← Backtest result cache
│   └── {symbol}_{version}_{date}.json
└── system/                        ← System config and health logs
    ├── config.json.enc
    └── health-log.csv
```

### 12.2 File Naming Convention

| File Type | Pattern | Example |
|---|---|---|
| Prediction JSON | `{SYMBOL}_{YYYYMMDD-HHmmss}_{uuid7}.json` | `NIFTY50_20260501-103200_01HX...json` |
| Prediction CSV row | Appended to `summary.csv` | — |
| User record | `{uuid7}.json.enc` | `01HX....json.enc` |
| Model artifact | `model.bin.enc` | — |
| Backtest result | `{SYMBOL}_{version}_{YYYYMMDD}.json` | `NIFTY50_v3.0.0_20260501.json` |

### 12.3 Compression

- Prediction JSON files are gzip-compressed after 24 hours using Node.js built-in `zlib`
- Compression ratio target: > 70% size reduction
- Compressed files retain `.json.gz` extension
- CSV summary files are NOT compressed (append-only, small rows)
- Model artifacts are stored pre-compressed as part of the training pipeline

### 12.4 Configurable Cleanup

Cleanup is configured per-user in preferences and globally by admin:

| Setting | Default | Range | Description |
|---|---|---|---|
| `cleanupIntervalDays` | 30 | 7–365 | How often cleanup runs |
| `retainPredictionsDays` | 365 | 30–730 | Delete predictions older than N days |
| `retainBacktestDays` | 180 | 30–365 | Delete backtest cache older than N days |
| `compressAfterHours` | 24 | 1–168 | Compress prediction JSON after N hours |
| `archiveBeforeDelete` | true | bool | Move to archive folder before deleting |
| `archivePath` | `data/archive/` | string | Archive destination |

Cleanup runs as a scheduled background job on the backend server.
Admin can trigger manual cleanup from the Admin panel.
Cleanup activity is logged to `data/system/health-log.csv`.

### 12.5 Storage Security

- All files in `data/` are encrypted with AES-256-GCM
- Encryption key derived from admin password via PBKDF2 (100,000 iterations, SHA-256, 32-byte salt)
- Salt stored in `data/system/.salt` (not encrypted — needed to derive key)
- IV (initialisation vector) is unique per file, stored as first 12 bytes of each `.enc` file
- File integrity verified via GCM authentication tag on every read
- If authentication tag fails → file is quarantined, alert raised, backup used if available

---

## 13. Cloud Backup (Optional)

### 13.1 Design

Cloud backup is entirely **opt-in per user**. When enabled:

- Predictions and user preferences are compressed + encrypted **before** leaving the device
- Sent to a free email account (Gmail / Outlook) as email attachments
- The email account is configured by the user — the application never stores email credentials in plaintext
- Email credentials stored encrypted in user record

### 13.2 What Gets Backed Up

| Data | Backed Up | Frequency |
|---|---|---|
| Prediction history (CSV summary) | Yes | Daily |
| User preferences | Yes | On change |
| Model artifacts | No | Too large |
| Backtest results | No | Regenerable |
| Other users data | No | Privacy |

### 13.3 Backup File Format

```
stockmind_backup_{userId}_{YYYYMMDD}.tar.gz.enc
```

- `tar.gz` — all backup files bundled and gzip-compressed
- `.enc` — AES-256-GCM encrypted with user-specific key
- Attached to email with subject: `StockMind Backup {date}`
- Max attachment size: 25 MB (Gmail limit) — older data pruned if exceeded

### 13.4 Restore

- Admin can restore from a backup file via the Admin panel
- User provides the backup `.enc` file and their password
- System decrypts, validates integrity, and imports data

---

## 14. Safety Guidelines

### 14.1 AI / ML Model Safety

| Threat | Mitigation |
|---|---|
| Adversarial inputs | Input validation + OOD detection; reject inputs outside trained distribution |
| Model poisoning | Data provenance tracking; hash-verified datasets; human review |
| Confidence inflation | Hard floor 5%, ceiling 99%; three-stage calibration enforced |
| Hallucination / false signals | Suppress if < 3/5 models agree; every prediction requires reasoning |
| Model tampering | SHA-256 + RSA-2048 signature verified on every load |
| No self-modifying models | Production models are frozen artifacts; retraining is offline only |

### 14.2 Financial Safety

- Every prediction includes a **non-removable disclaimer** (jurisdiction-aware)
- Platform does **NOT execute trades** — prediction only
- Every card shows max potential loss (entry to SL)
- Risk-reward ratio is always prominent
- Historical worst-case for similar signals shown
- If SL hit rate > 40% in current regime, explicit warning displayed
- No language suggesting guaranteed returns anywhere in the UI
- Accuracy always includes losing signals — no cherry-picking

### 14.3 User Safety

| Risk Pattern | Detection | Response |
|---|---|---|
| Excessive checking (> 50 refreshes/hr) | Usage monitoring | Gentle nudge to set alerts |
| Extended session (> 4 hrs) | Session tracking | Suggest break |
| Ignoring C/D grade warnings | Click analysis | Periodic grade reminder |

**Cognitive bias mitigations**:
- Confirmation bias: Show ALL signals including contrary ones
- Recency bias: Show 30/60/90-day accuracy, not just recent
- Overconfidence: Always show "78% means ~22% chance of being wrong"
- Gambler's fallacy: State "each prediction is independent"

**Vulnerable user protections**:
- No gamification, no streaks, no FOMO language
- Alert frequency configurable (limit to 1/day)
- Self-exclusion option for N days

### 14.4 Operational Safety

**Circuit Breakers**:

| Component | Trigger | Action |
|---|---|---|
| Market data feed | 3 failures or latency > 5s | Switch to backup; if all fail, suppress |
| AI inference | Error > 5% or latency > 10s | Fall back to heuristics |
| Database / file storage | Timeout > 2s | Serve from in-memory cache |
| External API | Rate limit or 5xx | Exponential backoff, switch provider |
| News feed | Down > 5 min | Continue without sentiment (−15% confidence) |

**Graceful Degradation Levels**:

| Level | Condition | Behaviour |
|---|---|---|
| 0 — Full | All systems healthy | Full predictions, full confidence |
| 1 — Degraded | 1–2 feeds down | Reduced confidence (10–15% penalty) |
| 2 — Degraded | 3+ feeds or model failure | Heuristics only, grade capped at B |
| 3 — Core down | Core system failure | No predictions, staleness warning |
| 4 — Suspended | Security incident | All predictions suspended immediately |

**Kill Switch**: Stops all predictions, invalidates signals, displays maintenance page.
Triggered by: security incident, model integrity failure, regulatory request, 2-person manual activation.

### 14.5 Cybersecurity

| Category | Measures |
|---|---|
| Authentication | Three-factor: username+password + 12-digit key + JWT |
| Input validation | Strict allow-listing, sanitizeTicker(), stripHtml() |
| XSS | CSP with nonce, no inline scripts, no innerHTML with user data |
| Injection | Parameterised queries only; no eval(), no new Function() |
| SSRF | URL allow-listing via isAllowedOrigin(); no user-controlled URLs |
| API abuse | Rate limiting, exponential backoff, circuit breaker |
| Prediction integrity | HMAC-SHA-256 signed; client verifies before rendering |
| Secrets | Never in source code; loaded from encrypted config at startup |
| Dependencies | Pinned versions; no open ranges in package.json |

---

## 15. Regulatory Compliance

### India (SEBI)
No guaranteed returns, automated disclaimers, 5+ year record keeping, simultaneous delivery, no execution advice.

### United States (SEC / FINRA)
Not personalised advice, simultaneous delivery (Reg FD), no misleading claims, 6+ year retention.

### European Union (ESMA / GDPR)
GDPR compliant (consent, right to erasure, DPO), EU AI Act compliant (transparency, explainability, human oversight), EU data residency.

### Cross-Border
Geo-aware disclaimers via `VITE_DISCLAIMER_JURISDICTION` (IN / US / EU), feature flags per region, quarterly legal review.

---

## 16. Production Monitoring

### 16.1 Monitoring Dashboard Panels

| Panel | Metrics | Refresh |
|---|---|---|
| Calibration Health | ECE, MCE, reliability diagram per instrument | Hourly |
| Accuracy Tracker | T1/T2/T3/SL hit rates by grade and regime | Real-time |
| Brier Score Trend | Per model, 7/30/90-day sparkline | Daily |
| Drift Alerts | KS p-values, PSI per instrument | Hourly |
| Data Feed Health | Uptime, latency, reliability score per source | Real-time |
| Signal Volume | Generated vs suppressed per instrument | Hourly |
| Storage Health | Disk usage, compression ratio, cleanup log | Daily |
| Auth Events | Login attempts, key verifications, failures | Real-time |

### 16.2 Safety Metrics Thresholds

| Metric | Threshold | Escalation |
|---|---|---|
| ECE | < 5% | Auto-downgrade confidence |
| Brier Score trend | Non-increasing (7-day MA) | Alert data science |
| False A+/A rate | < 3% hitting SL | Investigate / quarantine |
| Data rejection rate | < 2% | Alert data engineering |
| API error rate | < 0.1% | Page on-call |
| Auth failure rate | < 5% per hour | Security alert |
| Storage encryption failures | 0 | Immediate P0 |

### 16.3 Incident Severity

| Severity | Response Time | Example |
|---|---|---|
| **P0 Critical** | < 15 min | Model tamper, data breach, encryption failure |
| **P1 High** | < 1 hour | ECE > 10%, model failures, auth bypass attempt |
| **P2 Medium** | < 4 hours | Feed down, minor drift, backup failure |
| **P3 Low** | < 24 hours | UI bug, slow response, cleanup failure |

---

## 17. Document Verification Checklist

| Category | Check | Status |
|---|---|---|
| **Architecture** | Fullstack local-first, single device deployment | REQUIRED |
| **Architecture** | Frontend + backend in same project | REQUIRED |
| **Architecture** | No mandatory cloud dependency | REQUIRED |
| **UI/UX** | Responsive: mobile 320px through desktop 1920px | REQUIRED |
| **UI/UX** | WCAG 2.1 AA accessibility | REQUIRED |
| **UI/UX** | No FOMO language anywhere | REQUIRED |
| **UI/UX** | Colour never sole indicator (always + text label) | REQUIRED |
| **Markets** | 7 market modules (equities, indices, F&O, crypto, forex, commodities, global) | REQUIRED |
| **Markets** | Per-module instrument selection with sanitisation | REQUIRED |
| **Markets** | Chart + card prediction display modes | REQUIRED |
| **Auth** | Three-factor: username+password + 12-digit key | REQUIRED |
| **Auth** | Two access levels: admin + user | REQUIRED |
| **Auth** | Standalone key generator (separate from app) | REQUIRED |
| **Auth** | Data folder encrypted, password-protected | REQUIRED |
| **Auth** | Per-user encrypted JSON file | REQUIRED |
| **Predictions** | 16 signals per request, sorted by probability | REQUIRED |
| **Predictions** | Entry, exit, immediate optimal SL, max risk, validity, accuracy | REQUIRED |
| **Predictions** | Chart overlay mode for predictions | REQUIRED |
| **Predictions** | Capital + risk management input | REQUIRED |
| **Predictions** | Suppression rules enforced | REQUIRED |
| **Predictions** | Non-removable disclaimer on every signal | REQUIRED |
| **Predictions** | HMAC signature verified before rendering | REQUIRED |
| **Predictions** | Probability clamped 5–99% | REQUIRED |
| **Storage** | Predictions stored as JSON + CSV | REQUIRED |
| **Storage** | Outcome tracking vs live data | REQUIRED |
| **Storage** | Real accuracy % computed and displayed | REQUIRED |
| **Storage** | 3 model versions retained per instrument | REQUIRED |
| **Storage** | AES-256-GCM encryption on all data files | REQUIRED |
| **Storage** | Configurable compression (gzip after 24h) | REQUIRED |
| **Storage** | Configurable cleanup schedule | REQUIRED |
| **Backtest** | 3-year walk-forward backtest | REQUIRED |
| **Backtest** | Accuracy gate 75–97% | REQUIRED |
| **Backtest** | Auto-optimisation trigger on failure | REQUIRED |
| **Cloud** | Optional email-based backup (user opt-in) | REQUIRED |
| **Cloud** | Encrypted before leaving device | REQUIRED |
| **AI Safety** | Three-stage calibration | REQUIRED |
| **AI Safety** | Drift detection + automated retraining pipeline | REQUIRED |
| **AI Safety** | Model artifact signing + verification | REQUIRED |
| **AI Safety** | No self-modifying production models | REQUIRED |
| **Operational** | Circuit breakers on all external dependencies | REQUIRED |
| **Operational** | 5-level graceful degradation | REQUIRED |
| **Operational** | Kill switch (2-person rule) | REQUIRED |
| **Operational** | ErrorBoundary on every major UI section | REQUIRED |
| **Compliance** | Jurisdiction-aware disclaimers (IN/US/EU) | REQUIRED |
| **Compliance** | Immutable audit trail | REQUIRED |
| **Compliance** | No guaranteed returns language | REQUIRED |

---

## 18. Environment Variables Reference

```bash
# ── Market Data ──────────────────────────────────────────────────────────────
VITE_ALPHA_VANTAGE_KEY=
VITE_TWELVE_DATA_KEY=
VITE_FINNHUB_KEY=
VITE_BINANCE_WS_URL=wss://stream.binance.com:9443/ws
VITE_POLYGON_KEY=

# ── Private APIs (India) ─────────────────────────────────────────────────────
VITE_ZERODHA_API_KEY=
VITE_UPSTOX_API_KEY=

# ── AI Inference Backend ─────────────────────────────────────────────────────
VITE_AI_API_URL=http://localhost:5000/api/inference
VITE_HMAC_VERIFY_KEY=

# ── News / Sentiment ─────────────────────────────────────────────────────────
VITE_NEWSAPI_KEY=

# ── App Config ───────────────────────────────────────────────────────────────
VITE_APP_ENV=development
VITE_APP_VERSION=0.1.0
VITE_DISCLAIMER_JURISDICTION=IN
VITE_CONFIDENCE_FLOOR=5
VITE_CONFIDENCE_CEILING=99
VITE_MIN_HISTORY_MONTHS=6

# ── Feature Flags ────────────────────────────────────────────────────────────
VITE_ENABLE_PREDICTIONS=true
VITE_ENABLE_SENTIMENT=false
VITE_ENABLE_CV_PATTERNS=false
VITE_ENABLE_RL_TIMING=false
```

---

*This document is the single source of truth for StockMind AI architecture, requirements, and safety rules.*  
*Every implementation decision must trace back to a section in this document.*  
*Update this document before implementing any new feature or architectural change.*
