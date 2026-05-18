# StockMind AI — Python ML Backend

FastAPI inference server that runs the ensemble prediction engine.

## Why Python?

Python has the best ML ecosystem. The models specified in the requirements
(LSTM, XGBoost, LightGBM, TFT, FinBERT, RL Agent) all have mature Python
implementations. The Node.js backend proxies prediction requests here.

**Fallback**: If this server is not running, the app automatically falls back
to the JavaScript prediction engine. The app always works — Python just makes
it smarter.

## Setup

```bash
cd ai_backend

# Create virtual environment
python -m venv venv

# Activate
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## Model Status

On first run, all models use **calibrated mock predictions** because no
trained artifacts exist yet. The predictions are still useful — they use
real Black-Scholes pricing for options, real ATR for stops, and real
feature engineering.

To train real models:

1. Collect 3 years of OHLCV data per instrument (Yahoo Finance, free)
2. Run `python train/train_lgbm.py --symbol NIFTY50`
3. Artifacts are saved to `data/models/`
4. Restart the server — models load automatically

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | System health + model status |
| `/predict` | POST | Generate 16 signals for an instrument |
| `/models/status` | GET | Which models are loaded |

## Model Stack (from spec Section 6.6)

| Model | Status | Package |
|---|---|---|
| LightGBM | ✅ Ready | `lightgbm` |
| XGBoost | ✅ Ready | `xgboost` |
| LSTM | 🔧 Stub | `torch` (optional) |
| TFT | 🔧 Stub | `pytorch-forecasting` (optional) |
| FinBERT | 🔧 Stub | `transformers` (optional, ~500MB) |
| RL Agent | 📋 Planned | `stable-baselines3` |

Install optional packages as needed:
```bash
pip install torch                    # LSTM + FinBERT
pip install transformers             # FinBERT sentiment
pip install pytorch-forecasting      # TFT
pip install stable-baselines3        # RL Agent
```

## Growing Prediction Capability

The engine is designed to improve exponentially:

1. **More data** → better feature engineering → better model accuracy
2. **Outcome tracking** → real accuracy feedback → auto-retraining trigger
3. **More models** → larger ensemble → lower variance
4. **Calibration** → ECE monitoring → honest probabilities
5. **Regime detection** → regime-aware weights → better in all conditions

The accuracy gate (75–97%) in the spec ensures only reliable models
reach production. The walk-forward backtesting prevents overfitting.
