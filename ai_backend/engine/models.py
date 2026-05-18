"""
models.py — Individual model wrappers for the ensemble.

Each model implements:
    predict_proba(features: np.ndarray) -> float  (calibrated probability 0-1)

Models:
    1. LightGBMModel    — gradient boosting, fast, SHAP-explainable
    2. XGBoostModel     — gradient boosting, alternative to LightGBM
    3. LSTMModel        — sequential, captures temporal patterns (stub — needs torch)
    4. TFTModel         — Temporal Fusion Transformer (stub — needs pytorch-forecasting)
    5. SentimentModel   — FinBERT-based news sentiment (stub — needs transformers)

In production, each model is:
    - Trained offline on 3 years of walk-forward data
    - Saved as a signed, encrypted artifact
    - Loaded once at startup and kept in memory

For now, models return calibrated mock probabilities that degrade gracefully
until real training data and artifacts are available.
"""

import numpy as np
import logging
import os

logger = logging.getLogger("stockmind-ai.models")

# ── Base class ────────────────────────────────────────────────────────────────

class BaseModel:
    name: str = "base"
    loaded: bool = False

    def predict_proba(self, features: np.ndarray) -> float:
        raise NotImplementedError

    def is_available(self) -> bool:
        return self.loaded


# ── 1. LightGBM ───────────────────────────────────────────────────────────────

class LightGBMModel(BaseModel):
    name = "lightgbm"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import lightgbm as lgb
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/lgbm_direction.txt")
            if os.path.exists(model_path):
                self.model = lgb.Booster(model_file=model_path)
                self.loaded = True
                logger.info("[LightGBM] Model loaded from disk")
            else:
                logger.info("[LightGBM] No saved model — will use mock until trained")
        except ImportError:
            logger.warning("[LightGBM] lightgbm not installed — pip install lightgbm")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            prob = float(self.model.predict(features.reshape(1, -1))[0])
            return np.clip(prob, 0.05, 0.95)
        # Mock: use feature mean as a proxy for signal strength
        signal = float(np.tanh(np.mean(features[:5]) * 2))
        return float(np.clip(0.5 + signal * 0.3 + np.random.normal(0, 0.05), 0.35, 0.90))


# ── 2. XGBoost ────────────────────────────────────────────────────────────────

class XGBoostModel(BaseModel):
    name = "xgboost"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import xgboost as xgb
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/xgb_direction.json")
            if os.path.exists(model_path):
                self.model = xgb.Booster()
                self.model.load_model(model_path)
                self.loaded = True
                logger.info("[XGBoost] Model loaded from disk")
            else:
                logger.info("[XGBoost] No saved model — will use mock until trained")
        except ImportError:
            logger.warning("[XGBoost] xgboost not installed — pip install xgboost")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            import xgboost as xgb
            dmat = xgb.DMatrix(features.reshape(1, -1))
            prob = float(self.model.predict(dmat)[0])
            return np.clip(prob, 0.05, 0.95)
        signal = float(np.tanh(np.mean(features[5:10]) * 1.8))
        return float(np.clip(0.5 + signal * 0.28 + np.random.normal(0, 0.05), 0.35, 0.90))


# ── 3. LSTM (stub — requires PyTorch) ─────────────────────────────────────────

class LSTMModel(BaseModel):
    name = "lstm"

    def __init__(self):
        self.model = None
        self._try_load()

    def _try_load(self):
        try:
            import torch
            model_path = os.path.join(os.path.dirname(__file__), "../data/models/lstm_direction.pt")
            if os.path.exists(model_path):
                self.model = torch.load(model_path, map_location="cpu")
                self.model.eval()
                self.loaded = True
                logger.info("[LSTM] Model loaded from disk")
            else:
                logger.info("[LSTM] No saved model — will use mock until trained")
        except ImportError:
            logger.info("[LSTM] torch not installed — install pytorch for LSTM support")

    def predict_proba(self, features: np.ndarray) -> float:
        if self.model is not None:
            import torch
            with torch.no_grad():
                x = torch.FloatTensor(features).unsqueeze(0).unsqueeze(0)
                prob = float(torch.sigmoid(self.model(x)).item())
            return np.clip(prob, 0.05, 0.95)
        # Mock: use momentum-like features
        signal = float(np.tanh(np.mean(features[10:15]) * 2.2))
        return float(np.clip(0.5 + signal * 0.32 + np.random.normal(0, 0.06), 0.35, 0.90))


# ── 4. Sentiment model (stub — requires transformers) ─────────────────────────

class SentimentModel(BaseModel):
    name = "sentiment"

    def __init__(self):
        self.pipeline = None
        self._try_load()

    def _try_load(self):
        try:
            from transformers import pipeline
            logger.info("[Sentiment] Loading FinBERT — this may take a moment on first run...")
            self.pipeline = pipeline(
                "text-classification",
                model="ProsusAI/finbert",
                device=-1,  # CPU
            )
            self.loaded = True
            logger.info("[Sentiment] FinBERT loaded")
        except ImportError:
            logger.info("[Sentiment] transformers not installed — pip install transformers torch")
        except Exception as e:
            logger.warning(f"[Sentiment] Failed to load FinBERT: {e}")

    def predict_proba(self, text: str = "") -> float:
        """Returns bullish probability from news text."""
        if self.pipeline and text:
            result = self.pipeline(text[:512])[0]
            if result["label"] == "positive":
                return float(np.clip(0.5 + result["score"] * 0.4, 0.5, 0.90))
            elif result["label"] == "negative":
                return float(np.clip(0.5 - result["score"] * 0.4, 0.10, 0.5))
            return 0.5
        # Mock: neutral sentiment
        return 0.5 + np.random.normal(0, 0.05)

    def predict_proba_from_features(self, features: np.ndarray) -> float:
        """Fallback when no text is available — uses feature proxy."""
        return float(np.clip(0.5 + np.random.normal(0, 0.04), 0.35, 0.65))
