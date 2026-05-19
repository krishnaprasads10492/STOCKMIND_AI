# Requirements Document

## Introduction

Advanced Market Intelligence is a comprehensive capability expansion for StockMind AI that transforms the platform from a signal generator into a full-spectrum market analysis suite. The feature adds six interconnected capability areas to the existing React 19 + Express + Python FastAPI platform:

1. **Multi-Timeframe Strategy Analysis** — for any selected instrument, generate and display strategies ranked by probability across intraday, swing, positional, and long-term horizons simultaneously.
2. **Derivatives Strategy Matrix** — a structured view of ATM/OTM/ITM options strategies (spreads, straddles, iron condors, etc.) with probability of profit and Greeks for each leg.
3. **Multibagger Discovery Page** — a dedicated page that screens the universe of Indian equities for high-growth potential using fundamental and technical criteria.
4. **Financial Statement Upload and Analysis** — upload PDF/Excel annual reports, extract key financial metrics, correlate with live news, generate multi-timeframe scenario predictions, persist extracted scenario data with a document reference, and discard the original file.
5. **Trendline Drawing Tool** — interactive chart overlay where users connect Higher Highs / Higher Lows or Lower Highs / Lower Lows; the system calculates trend slope, strength, and continuation/reversal probability.
6. **Danger Signal System** — real-time alert when a live price moves severely against an active prediction, logs the event, and feeds the deviation back into the prediction optimisation pipeline.

All six areas must comply with the existing StockMind AI non-negotiable rules: `<Disclaimer />` on every prediction surface, `clampProbability()` on every probability value, HMAC verification on every prediction payload, `<ErrorBoundary>` around every major section, no guaranteed-return language, and no FOMO language.

---

## Glossary

- **AMI**: Advanced Market Intelligence — the collective name for this feature set.
- **ATM**: At-The-Money — an option whose strike price equals (or is nearest to) the current underlying price.
- **OTM**: Out-of-The-Money — a call option whose strike is above the current price, or a put option whose strike is below.
- **ITM**: In-The-Money — a call option whose strike is below the current price, or a put option whose strike is above.
- **Strategy_Matrix**: The component that renders the full grid of multi-leg options strategies for a given underlying and expiry.
- **Timeframe_Selector**: The UI control that lets the user choose one or more analysis horizons (5m, 15m, 1h, 1d, 1w, 1m, 3m, 1y+).
- **Multibagger_Scanner**: The backend service that screens equities for high-growth potential.
- **Multibagger_Page**: The dedicated frontend route `/multibagger` that surfaces Multibagger_Scanner results.
- **Document_Processor**: The backend service that parses uploaded PDF/Excel financial statements, extracts structured metrics, and discards the original binary.
- **Scenario_Store**: The encrypted persistent store (extending the existing `data/` structure) that holds extracted financial scenarios with document references but without the original file.
- **Trendline_Tool**: The interactive chart overlay component that allows users to draw and analyse trendlines.
- **Danger_Signal**: An alert event generated when a live price deviates severely from an active prediction in the negative direction.
- **Danger_Monitor**: The backend service (extending `outcomeValidator.js`) that detects Danger_Signal conditions and triggers alerts.
- **Greeks**: Options sensitivity measures — Delta (Δ), Gamma (Γ), Theta (Θ), Vega (ν), Rho (ρ).
- **PoP**: Probability of Profit — the statistical likelihood that a multi-leg options strategy expires with a net credit or reaches its profit target.
- **HH**: Higher High — a price peak that exceeds the previous peak, indicating an uptrend.
- **HL**: Higher Low — a price trough that is above the previous trough, confirming an uptrend.
- **LH**: Lower High — a price peak below the previous peak, indicating a downtrend.
- **LL**: Lower Low — a price trough below the previous trough, confirming a downtrend.
- **Trend_Strength**: A normalised score (0–100) representing the statistical confidence of a drawn trendline based on slope, R², and touch-point count.
- **Scenario**: A structured prediction record derived from a financial statement upload, containing extracted metrics, correlated news, and multi-timeframe forecasts.
- **Document_Reference**: A short identifier (hash + upload timestamp) stored with a Scenario to trace its origin without retaining the original file.
- **Severe_Negative_Deviation**: A live price move that is worse than the prediction's stop-loss level by a configurable multiplier (default 1.5×).
- **Walk_Forward_Backtest**: The existing 3-year rolling backtest mechanism used to validate prediction accuracy (75–97% gate).

---

## Requirements

---

### Requirement 1: Multi-Timeframe Strategy Analysis

**User Story:** As a trader, I want to select any instrument and immediately see strategy recommendations across multiple timeframes simultaneously, so that I can align my trade horizon with the strongest probability setup without switching pages.

#### Acceptance Criteria

1. WHEN a user selects an instrument on the Predictions page or any AMI page, THE Timeframe_Selector SHALL display the following horizon options: 5m, 15m, 1h (intraday), 1d, 1w (swing), 1m, 3m (positional), and 1y+ (long-term).
2. WHEN a user selects one or more timeframes, THE Strategy_Matrix SHALL generate a ranked list of strategy recommendations for each selected timeframe independently.
3. THE Strategy_Matrix SHALL display, for each timeframe-strategy combination: strategy name, direction (LONG/SHORT/NEUTRAL), entry zone, stop-loss, T1/T2/T3 targets, probability (clamped via `clampProbability()`), grade (A+/A/B/C/D), and risk-reward ratio. WHEN the underlying model produces a raw probability of 0%, THE Strategy_Matrix SHALL display "N/A" rather than the clamped 5% floor, to distinguish genuine zero-confidence cases from low-confidence predictions.
4. WHEN multiple timeframes are selected simultaneously, THE Strategy_Matrix SHALL visually align timeframe columns so the user can compare the same strategy type across horizons side by side.
5. WHEN a shorter timeframe signal conflicts with a longer timeframe signal for the same instrument, THE Strategy_Matrix SHALL flag the conflict with a visible indicator and display both signals without suppressing either.
6. WHEN the user selects the 1y+ timeframe, THE Strategy_Matrix SHALL include fundamental-based signals (P/E ratio trend, revenue growth trajectory, debt-to-equity) alongside technical signals.
7. IF the AI backend is unavailable, THEN THE Strategy_Matrix SHALL fall back to the JavaScript prediction engine and display a data-source warning consistent with the existing pattern in `dispatcher.py`.
8. THE Strategy_Matrix SHALL wrap every timeframe column in an `<ErrorBoundary>` so a failure in one timeframe does not collapse the entire view.
9. WHEN strategy recommendations are rendered, THE Strategy_Matrix SHALL render `<Disclaimer />` once per page view, non-removable and non-dismissible.
10. THE Strategy_Matrix SHALL pass all probability values through `clampProbability()` before rendering, enforcing a floor of 5% and a ceiling of 99%.
11. WHEN a user clicks "Apply" on any timeframe-strategy combination, THE Strategy_Matrix SHALL navigate to the Predictions page with the corresponding instrument, timeframe, and strategy parameters pre-loaded.

---

### Requirement 2: Derivatives Strategy Matrix

**User Story:** As an options trader, I want to see a structured matrix of multi-leg options strategies (ATM, OTM, ITM) for a selected underlying and expiry, with probability of profit and Greeks for each, so that I can choose the strategy that best fits my market view and risk tolerance.

#### Acceptance Criteria

1. WHEN a user selects an underlying instrument and expiry date, THE Strategy_Matrix SHALL compute and display the following strategy types: Covered Call, Protective Put, Bull Call Spread, Bear Put Spread, Long Straddle, Short Straddle, Long Strangle, Short Strangle, Iron Condor, Iron Butterfly, Calendar Spread, Diagonal Spread, Ratio Spread, and Collar.
2. FOR EACH strategy in the matrix, THE Strategy_Matrix SHALL display: strategy name, moneyness classification (ATM/OTM/ITM), net premium (debit or credit), maximum profit, maximum loss, breakeven point(s), PoP (Probability of Profit), and net Greeks (Δ, Γ, Θ, ν).
3. THE Strategy_Matrix SHALL compute PoP using the existing Black-Scholes implementation in `dispatcher.py`, extended to handle multi-leg payoff profiles.
4. WHEN the user selects a moneyness filter (ATM / OTM / ITM / All), THE Strategy_Matrix SHALL filter the displayed strategies to show only those whose primary leg matches the selected moneyness.
5. WHEN the user selects a market view (Bullish / Bearish / Neutral / Volatile / Range-bound), THE Strategy_Matrix SHALL sort strategies by descending PoP for that view and visually highlight the top 3 recommended strategies.
6. FOR EACH strategy, THE Strategy_Matrix SHALL display a payoff diagram rendered as an SVG or Canvas chart showing profit/loss at expiry across a price range of ±20% from the current underlying price.
7. WHEN a user expands a strategy card, THE Strategy_Matrix SHALL show the individual legs: option type (CE/PE), strike, expiry, action (BUY/SELL), quantity, premium, and per-leg Greeks.
8. THE Strategy_Matrix SHALL use the existing `LOT_SIZES` and `STRIKE_STEPS` configuration from `dispatcher.py` for all lot-size and strike-step calculations.
9. IF implied volatility data is unavailable for a strike, THEN THE Strategy_Matrix SHALL estimate IV using the existing volatility surface approximation in `dispatcher.py` and display an estimation warning on that strategy card.
10. WHEN a user clicks "Apply Strategy" on a matrix entry, THE Strategy_Matrix SHALL navigate to the Predictions page with all legs pre-populated in the options panel.
11. THE Strategy_Matrix SHALL render `<Disclaimer />` on the derivatives matrix page, non-removable and non-dismissible.
12. THE Strategy_Matrix SHALL pass all PoP and per-leg probability values through `clampProbability()` before rendering.

---

### Requirement 3: Multibagger Discovery Page

**User Story:** As a long-term investor, I want a dedicated page that screens Indian equities for high-growth potential using both fundamental and technical criteria, so that I can identify multibagger candidates without manually scanning hundreds of stocks.

#### Acceptance Criteria

1. THE Multibagger_Page SHALL be accessible at the route `/multibagger` and appear in the main navigation.
2. THE Multibagger_Scanner SHALL screen equities using the following fundamental criteria: revenue CAGR ≥ 20% over 3 years, net profit margin ≥ 10%, debt-to-equity ratio ≤ 1.0, return on equity ≥ 15%, and promoter holding ≥ 40%.
3. THE Multibagger_Scanner SHALL screen equities using the following technical criteria: price above 200-day EMA, relative strength vs NIFTY500 ≥ 1.2 over 52 weeks, average daily volume ≥ 50,000 shares, and 52-week high within 30% of current price.
4. WHEN the Multibagger_Scanner completes a scan, THE Multibagger_Page SHALL display each candidate with: ticker symbol, company name, sector, composite score (0–100), fundamental sub-score, technical sub-score, key metrics summary, and a "View Full Analysis" action.
5. THE Multibagger_Page SHALL allow the user to filter candidates by sector, market cap band (small/mid/large), minimum composite score, and minimum revenue CAGR.
6. THE Multibagger_Page SHALL allow the user to sort candidates by composite score, revenue CAGR, ROE, or relative strength.
7. WHEN a user clicks "View Full Analysis" on a candidate, THE Multibagger_Page SHALL display a detailed panel with: multi-timeframe strategy recommendations (reusing Requirement 1), derivatives strategy matrix (reusing Requirement 2), financial trend charts (revenue, profit, debt), and news feed for that stock.
8. THE Multibagger_Scanner SHALL refresh its candidate list at most once every 24 hours to avoid excessive API calls, and SHALL display the last-scan timestamp to the user.
9. WHEN the Multibagger_Scanner finds zero candidates matching the active filters, THE Multibagger_Page SHALL display a descriptive empty state explaining which criteria produced no results and suggesting filter relaxation. THE Multibagger_Page SHALL NOT prevent users from applying filter combinations that may return zero results — the empty state is shown after the filters are applied.
10. THE Multibagger_Page SHALL render `<Disclaimer />` non-removably, and SHALL display the text "Multibagger screening is probabilistic — past growth does not guarantee future returns" prominently above the candidate list.
11. THE Multibagger_Page SHALL wrap the candidate list and detail panel in separate `<ErrorBoundary>` components.
12. WHEN a user selects a multibagger candidate, THE Multibagger_Page SHALL allow the user to apply all AMI capabilities (multi-timeframe strategies, derivatives matrix, trendline tool, financial statement upload) to that candidate directly from the detail panel.

---

### Requirement 4: Financial Statement Upload and Analysis

**User Story:** As an analyst, I want to upload a company's annual report (PDF or Excel) and have the system extract key financial metrics, correlate them with the current news feed, generate multi-timeframe predictions for all scenarios, and store the extracted scenario data with a reference — without retaining the original file — so that I can make informed predictions enriched by fundamental data.

#### Acceptance Criteria

1. THE Document_Processor SHALL accept file uploads in PDF and Excel (`.xlsx`, `.xls`) formats with a maximum file size of 25 MB per upload.
2. WHEN a file is uploaded, THE Document_Processor SHALL extract the following metrics from the financial statements: revenue (annual and quarterly), net profit, EBITDA, EPS, total assets, total liabilities, shareholders' equity, operating cash flow, free cash flow, capital expenditure, debt-to-equity ratio, current ratio, and return on equity.
3. WHEN extraction is complete, THE Document_Processor SHALL correlate the extracted metrics with the live news feed for the same stock symbol, identifying news items published within 90 days of the statement date.
4. WHEN correlation is complete, THE Document_Processor SHALL generate multi-timeframe scenario predictions (using the existing prediction engine) for the following scenarios: base case (metrics as extracted), bull case (revenue +15%, margin expansion), bear case (revenue −10%, margin compression), and stress case (revenue −25%, debt increase).
5. FOR EACH scenario, THE Document_Processor SHALL store in the Scenario_Store: scenario name, extracted metrics snapshot, correlated news item references (headline + URL + date), multi-timeframe prediction outputs, Document_Reference (SHA-256 hash of the original file + upload timestamp), and creation timestamp.
6. AFTER storing the scenario data, THE Document_Processor SHALL discard the original uploaded file from memory and temporary storage — the original binary SHALL NOT be persisted to disk.
7. THE Document_Processor SHALL store scenario data in the existing encrypted `data/` structure using AES-256-GCM encryption, consistent with the existing `fileStore.js` pattern.
8. WHEN a user views a stored scenario, THE Scenario_Store SHALL display the Document_Reference alongside the scenario data so the user can identify which upload produced the scenario.
9. WHEN the Document_Processor cannot extract a required metric from the uploaded file, THE Document_Processor SHALL mark that metric as "Not found" in the scenario record and continue processing the remaining metrics without failing the entire upload.
10. IF the uploaded file is password-protected or corrupted, THEN THE Document_Processor SHALL return a descriptive error message to the user and discard the file without storing any partial data.
11. THE Document_Processor SHALL complete extraction and scenario generation within 60 seconds for files up to 25 MB; IF processing exceeds 60 seconds, THEN THE Document_Processor SHALL return a timeout error and discard the file.
12. WHEN scenario predictions are rendered, THE Document_Processor SHALL pass all probability values through `clampProbability()` and render `<Disclaimer />` on the scenario results page.
13. THE Document_Processor SHALL sanitise all text extracted from uploaded files using `stripHtml()` before storing or displaying any extracted content, to prevent injection attacks.
14. THE Scenario_Store SHALL support retrieval of all scenarios for a given stock symbol, sorted by creation timestamp descending, with pagination of 10 scenarios per page.
15. WHEN a user deletes a scenario, THE Scenario_Store SHALL permanently remove the scenario record and all associated prediction data from the encrypted store.

---

### Requirement 5: Trendline Drawing Tool

**User Story:** As a technical analyst, I want to draw trendlines on price charts by connecting Higher Highs / Higher Lows or Lower Highs / Lower Lows, and have the system calculate the trend's slope, strength, and probability of continuation or reversal, so that I can make more informed entry and exit decisions.

#### Acceptance Criteria

1. THE Trendline_Tool SHALL be available as an overlay mode on the existing `PredictionChart` component, activated by a "Draw Trendline" toggle button.
2. WHEN the user activates draw mode, THE Trendline_Tool SHALL allow the user to click two or more points on the chart to define a trendline, with each point snapping to the nearest OHLCV candle's high or low.
3. WHEN the user places a second point on the chart, THE Trendline_Tool SHALL immediately calculate and display: slope (price change per bar), R² (goodness of fit), touch-point count (number of candles that touch or are within 0.5% of the line), and Trend_Strength score (0–100). These metrics SHALL update in real time as additional points are added.
4. THE Trendline_Tool SHALL classify each drawn trendline as one of: Uptrend (connecting HH and HL), Downtrend (connecting LH and LL), or Horizontal Support/Resistance (slope within ±0.1% per bar).
5. WHEN a trendline is classified, THE Trendline_Tool SHALL compute and display the probability of continuation (trend persists for the next N bars) and the probability of reversal (price breaks through the trendline within the next N bars), where N is configurable by the user (default: 10 bars).
6. THE Trendline_Tool SHALL compute continuation and reversal probabilities using the existing ensemble prediction models, with the trendline slope, R², and touch-point count as additional input features.
7. WHEN the user draws a second trendline that intersects the first, THE Trendline_Tool SHALL calculate and display the intersection point (price and bar index) and label it as a "Convergence Zone", provided the intersection price is greater than zero; zero-price intersections SHALL be excluded from convergence zone detection.
8. THE Trendline_Tool SHALL allow the user to save up to 10 trendlines per instrument per session; WHEN the limit is reached, THE Trendline_Tool SHALL prompt the user to delete an existing trendline before adding a new one.
9. WHEN the user hovers over a drawn trendline, THE Trendline_Tool SHALL display a tooltip showing: slope, R², touch-point count, Trend_Strength, continuation probability, and reversal probability.
10. THE Trendline_Tool SHALL allow the user to delete individual trendlines by selecting and pressing Delete or clicking a remove icon on the trendline.
11. WHEN the chart timeframe is changed, THE Trendline_Tool SHALL recalculate all drawn trendlines for the new timeframe and update all displayed metrics accordingly.
12. THE Trendline_Tool SHALL pass all continuation and reversal probability values through `clampProbability()` before rendering.
13. THE Trendline_Tool SHALL be keyboard-accessible: the user SHALL be able to activate draw mode, place points, and delete trendlines using keyboard controls alone, in compliance with WCAG 2.1 AA.

---

### Requirement 6: Danger Signal System

**User Story:** As an active trader, I want to receive an immediate alert when a live price moves severely against one of my active predictions, with the event logged and fed back into the prediction optimisation pipeline, so that I can act quickly and the system can learn from adverse outcomes.

#### Acceptance Criteria

1. THE Danger_Monitor SHALL extend the existing `outcomeValidator.js` polling loop to detect Severe_Negative_Deviation conditions continuously — 24 hours a day, 7 days a week — regardless of NSE market hours.
2. WHEN a live price moves beyond the stop-loss level by a factor of 1.5× or more (configurable via environment variable `DANGER_SIGNAL_MULTIPLIER`, default 1.5) at any time of day, THE Danger_Monitor SHALL classify the event as a Danger_Signal regardless of whether NSE market hours are active.
3. WHEN a Danger_Signal is detected, THE Danger_Monitor SHALL broadcast the event to all connected SSE clients within 2.4 seconds (one polling cycle) using the existing `broadcastSSE()` mechanism with event name `danger_signal`.
4. WHEN a Danger_Signal event is received by the frontend, THE Danger_Signal_Banner SHALL display a non-dismissible, high-contrast alert banner at the top of the active page showing: symbol, prediction ID (first 8 characters), current live price, predicted stop-loss, deviation percentage, and timestamp.
5. THE Danger_Signal_Banner SHALL use both colour (red background) and text ("⚠ DANGER: Severe adverse move detected") to convey the alert, in compliance with the WCAG 2.1 AA requirement that colour alone does not convey meaning.
6. WHEN a Danger_Signal is detected, THE Danger_Monitor SHALL log the event to the encrypted `data/` store with the following fields: prediction ID, symbol, instrument type, entry price, stop-loss, live price at detection, deviation percentage, deviation multiplier, timestamp, and prediction grade.
7. WHEN a Danger_Signal is logged, THE Danger_Monitor SHALL call the existing `saveDeviationRecord()` function with the Danger_Signal data so the event enters the adaptive learning pipeline.
8. WHEN a Danger_Signal is logged, THE Danger_Monitor SHALL trigger a recalibration request to the AI backend (`/calibrate` endpoint) with the Danger_Signal payload, consistent with the existing `notifyAIBackendIfDrift()` pattern.
9. THE Danger_Monitor SHALL deduplicate Danger_Signals: IF a Danger_Signal has already been logged for a given prediction ID in the current session, THEN THE Danger_Monitor SHALL NOT log or broadcast a duplicate event for the same prediction.
10. WHEN the live price recovers above the stop-loss level after a Danger_Signal — regardless of whether the Danger_Signal_Banner is currently visible — THE Danger_Monitor SHALL broadcast a `danger_resolved` SSE event and dismiss the Danger_Signal_Banner automatically.
11. THE Danger_Monitor SHALL maintain a Danger_Signal log accessible from a "Danger Log" panel in the UI, showing the last 50 events with: symbol, timestamp, deviation %, prediction grade, and whether the prediction subsequently recovered or was stopped out.
12. WHEN the Danger_Log is viewed, THE Danger_Log_Panel SHALL display aggregate statistics: total Danger_Signals in the last 30 days, percentage that recovered vs stopped out, and the symbols with the highest Danger_Signal frequency.
13. THE Danger_Monitor SHALL run danger analysis in a separate non-blocking background task so that Danger_Signal detection and logging NEVER impede the main `runValidationCycle()` polling loop. The polling loop SHALL continue uninterrupted regardless of danger analysis duration, because live price data must keep flowing to correctly determine whether a danger signal is a genuine severe deviation or a false positive that resolves within subsequent polling cycles.
14. IF the AI backend is unreachable when a Danger_Signal recalibration request is sent, THEN THE Danger_Monitor SHALL automatically queue the recalibration request, log the failure locally, and retry on the next polling cycle — without requiring any explicit user action and without throwing an unhandled exception.

---

### Requirement 7: Integrated Data Structure for Multi-Level Prediction Access

**User Story:** As a developer and power user, I want all AMI-generated data (scenarios, trendlines, danger events, multi-timeframe signals) to be stored in a coherent, optimised data structure that supports fast retrieval at any level of granularity — by symbol, timeframe, scenario, or event type — so that the system remains performant as data accumulates.

#### Acceptance Criteria

1. THE Scenario_Store SHALL organise all AMI data under the existing `data/` directory using the following hierarchy: `data/ami/{symbol}/{year-month}/` for time-partitioned records, consistent with the existing `data/predictions/{year-month}/` pattern.
2. THE Scenario_Store SHALL store each record type in a separate sub-path: `data/ami/{symbol}/scenarios/`, `data/ami/{symbol}/trendlines/`, `data/ami/{symbol}/danger-log/`, and `data/ami/{symbol}/mtf-signals/` (multi-timeframe signals).
3. WHEN any AMI record is written, THE Scenario_Store SHALL encrypt it using AES-256-GCM via the existing `writeSecure()` function from `fileStore.js`.
4. WHEN any AMI record is read, THE Scenario_Store SHALL decrypt it using the existing `readSecure()` function from `fileStore.js`.
5. THE Scenario_Store SHALL maintain an in-memory index of record IDs per symbol per record type, rebuilt on server startup from the encrypted store, to support O(1) lookup by ID without decrypting all records.
6. WHEN the AMI data store for a symbol exceeds 500 records of any single type, THE Scenario_Store SHALL automatically archive records older than 90 days to a compressed archive file and remove them from the active index. Archiving SHALL proceed even if the encryption system is temporarily unavailable, prioritising storage management; archived files SHALL be encrypted on the next available write cycle.
7. THE Scenario_Store SHALL expose a unified query API (internal to the backend) that accepts: symbol, record type, date range, and optional filters — and returns paginated results without loading all records into memory simultaneously.
8. WHEN the server starts, THE Scenario_Store SHALL complete its index rebuild within 10 seconds for stores containing up to 10,000 total AMI records across all symbols.
9. THE Scenario_Store SHALL never store the original uploaded document binary — only extracted structured data and the Document_Reference identifier.
10. WHEN a symbol's AMI data is requested by the frontend, THE Scenario_Store SHALL return a summary object containing: scenario count, latest scenario date, trendline count, danger signal count (last 30 days), and latest multi-timeframe signal timestamp — without returning the full record payloads unless explicitly requested.
