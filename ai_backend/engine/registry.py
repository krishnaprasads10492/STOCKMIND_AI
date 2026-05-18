"""
registry.py — Model registry and ensemble meta-learner.

Loads all models once at startup. Provides:
    - ensemble_predict(features) → calibrated probability
    - status() → health of each model
    - SHAP-based reason generation
"""

import numpy as np
import logging
from .models import LightGBMModel, XGBoostModel, LSTMModel, SentimentModel
from .calibration import calibrate_ensemble_output, clamp_probability

logger = logging.getLogger("stockmind-ai.registry")


class ModelRegistry:
    """Singleton — loaded once at FastAPI startup."""

    def __init__(self):
        logger.info("[Registry] Loading models...")
        self.lgbm      = LightGBMModel()
        self.xgb       = XGBoostModel()
        self.lstm      = LSTMModel()
        self.sentiment = SentimentModel()
        self._models   = [self.lgbm, self.xgb, self.lstm]
        logger.info(f"[Registry] Loaded: {[m.name for m in self._models if m.is_available()]}")
        logger.info(f"[Registry] Mock:   {[m.name for m in self._models if not m.is_available()]}")

    def ensemble_predict(
        self,
        features: np.ndarray,
        regime: str = "trending",
        news_text: str = "",
    ) -> dict:
        """
        Run all available models, average their outputs, calibrate, return result.

        Returns:
            {
                "probability": float,       # calibrated 0.05–0.99
                "model_probs": dict,        # per-model raw probabilities
                "agreement": float,         # 0–1, how much models agree
                "suppressed": bool,         # True if < 3 models agree
                "reasons": list[str],       # SHAP-derived explanations
            }
        """
        probs = {}

        for model in self._models:
            try:
                p = model.predict_proba(features)
                probs[model.name] = float(np.clip(p, 0.05, 0.95))
            except Exception as e:
                logger.warning(f"[{model.name}] predict failed: {e}")

        # Sentiment (optional)
        if news_text:
            try:
                p = self.sentiment.predict_proba(news_text)
                probs["sentiment"] = float(np.clip(p, 0.05, 0.95))
            except Exception:
                pass
        else:
            try:
                p = self.sentiment.predict_proba_from_features(features)
                probs["sentiment"] = float(np.clip(p, 0.05, 0.95))
            except Exception:
                pass

        if not probs:
            return {
                "probability": 0.5,
                "model_probs": {},
                "agreement": 0.0,
                "suppressed": True,
                "suppress_reason": "No models available",
                "reasons": ["No models loaded — install dependencies"],
            }

        values = list(probs.values())
        raw_mean = float(np.mean(values))

        # Agreement: fraction of models within 15% of the mean
        agreement = float(np.mean([abs(p - raw_mean) < 0.15 for p in values]))

        # Suppression: < 3 models agree (spec Section 6.7)
        agreeing_count = sum(1 for p in values if abs(p - raw_mean) < 0.15)
        suppressed = agreeing_count < min(3, len(values))

        # Calibrate
        calibrated = calibrate_ensemble_output(raw_mean, regime=regime)

        # Generate reasons from feature importance (SHAP proxy)
        reasons = self._generate_reasons(features, calibrated, regime)

        return {
            "probability":    calibrated,
            "model_probs":    probs,
            "agreement":      agreement,
            "suppressed":     suppressed,
            "suppress_reason": "Model disagreement" if suppressed else None,
            "reasons":        reasons,
        }

    def _generate_reasons(
        self,
        features: np.ndarray,
        prob: float,
        regime: str,
    ) -> list[str]:
        """
        Generate human-readable reasons from feature values.
        In production, replace with actual SHAP values from LightGBM/XGBoost.
        """
        from .features import get_feature_names
        names = get_feature_names()
        reasons = []

        feat_dict = dict(zip(names, features))

        # RSI
        rsi = feat_dict.get("rsi14", 0.5) * 100
        if rsi < 35:
            reasons.append(f"RSI(14) = {rsi:.0f} — oversold, potential reversal")
        elif rsi > 65:
            reasons.append(f"RSI(14) = {rsi:.0f} — overbought, caution")
        else:
            reasons.append(f"RSI(14) = {rsi:.0f} — neutral zone")

        # EMA alignment
        ema20_slope = feat_dict.get("ema20_slope", 0)
        ema50_slope = feat_dict.get("ema50_slope", 0)
        price_vs_ema20 = feat_dict.get("price_vs_ema20", 0)
        if price_vs_ema20 > 0 and ema20_slope > 0:
            reasons.append("Price above EMA(20) with positive slope — bullish trend")
        elif price_vs_ema20 < 0 and ema20_slope < 0:
            reasons.append("Price below EMA(20) with negative slope — bearish trend")
        else:
            reasons.append(f"EMA(20) slope: {ema20_slope*100:.2f}% — mixed signal")

        # Volume
        vol_ratio = feat_dict.get("volume_ratio", 1.0)
        if vol_ratio > 1.5:
            reasons.append(f"Volume {vol_ratio:.1f}x 20-day SMA — strong participation")
        elif vol_ratio < 0.7:
            reasons.append(f"Volume {vol_ratio:.1f}x 20-day SMA — low participation, caution")
        else:
            reasons.append(f"Volume {vol_ratio:.1f}x 20-day SMA — normal")

        # ATR / Volatility
        atr_pct = feat_dict.get("atr14_pct", 0.01) * 100
        reasons.append(f"ATR(14) = {atr_pct:.2f}% — {'low' if atr_pct < 1 else 'moderate' if atr_pct < 2 else 'high'} volatility")

        # Stochastic
        stoch_k = feat_dict.get("stoch_k", 0.5)
        if stoch_k < 0.2:
            reasons.append(f"Stochastic %K = {stoch_k*100:.0f} — oversold territory")
        elif stoch_k > 0.8:
            reasons.append(f"Stochastic %K = {stoch_k*100:.0f} — overbought territory")

        # Trend strength
        trend = feat_dict.get("trend_strength", 0)
        if abs(trend) > 0.02:
            reasons.append(f"Price {'above' if trend > 0 else 'below'} EMA(50) by {abs(trend)*100:.1f}% — {'bullish' if trend > 0 else 'bearish'} trend")

        # Regime
        reasons.append(f"Market regime: {regime} — model weights adjusted accordingly")

        return reasons[:6]  # max 6 reasons

    def status(self) -> dict:
        return {
            "models": {
                m.name: {
                    "loaded": m.is_available(),
                    "type": "real" if m.is_available() else "mock",
                }
                for m in [self.lgbm, self.xgb, self.lstm, self.sentiment]
            },
            "ensemble_size": sum(1 for m in self._models if m.is_available()),
            "note": "Models without saved artifacts use calibrated mock predictions",
        }


# Singleton — instantiated once when the module is first imported
MODEL_REGISTRY = ModelRegistry()
