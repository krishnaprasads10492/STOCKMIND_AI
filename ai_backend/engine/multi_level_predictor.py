"""
multi_level_predictor.py — Multi-Level Prediction System
StockMind AGI // Prediction at Every Horizon

Prediction levels (all simultaneously):
  Level 1  — Scalp          (1m–5m,   <30 min hold)
  Level 2  — Intraday       (15m–1h,  same-day close)
  Level 3  — Swing          (4h–1D,   2–7 days)
  Level 4  — Positional     (1W–2W,   2–4 weeks)
  Level 5  — Short-Term     (1mo,     1–3 months)
  Level 6  — Medium-Term    (3mo,     3–6 months)
  Level 7  — Long-Term      (6mo–1y,  6–12 months)
  Level 8  — Investment      (1y+,     12+ months, fundamental-driven)

For each level:
  - Probability estimate
  - Direction (bull/bear/neutral)
  - Price target + stop loss
  - Key supporting indicators
  - Suitable instrument (spot/futures/options/long-hold)
  - Knowledge Base context (from documents)
"""

from __future__ import annotations
import math
import time
import logging
from typing import Optional
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("stockmind-ai.multi-level")


@dataclass
class PredictionLevel:
    level:       int
    name:        str
    timeframe:   str
    hold_period: str
    direction:   str         # bull | bear | neutral
    probability: float       # 0–1
    price_target:  float
    stop_loss:     float
    risk_reward:   float
    confidence:    float
    reasoning:     list[str]
    suitable_for:  list[str]  # spot | futures | options | long_hold
    kb_context:    Optional[dict] = None


LEVEL_CONFIGS = {
    1: {"name": "Scalp",       "tf": "1m-5m",    "hold": "<30 min",    "decay": 0.98, "noise": 0.03, "atr_mult_sl": 0.5,  "atr_mult_t": 0.8,  "instruments": ["options", "futures"]},
    2: {"name": "Intraday",    "tf": "15m-1h",   "hold": "Same day",   "decay": 0.92, "noise": 0.04, "atr_mult_sl": 0.8,  "atr_mult_t": 1.5,  "instruments": ["spot", "options", "futures"]},
    3: {"name": "Swing",       "tf": "4h-1D",    "hold": "2-7 days",   "decay": 0.80, "noise": 0.06, "atr_mult_sl": 1.5,  "atr_mult_t": 3.0,  "instruments": ["spot", "futures"]},
    4: {"name": "Positional",  "tf": "1W-2W",    "hold": "2-4 weeks",  "decay": 0.70, "noise": 0.07, "atr_mult_sl": 2.0,  "atr_mult_t": 5.0,  "instruments": ["spot", "futures"]},
    5: {"name": "Short-Term",  "tf": "1mo",      "hold": "1-3 months", "decay": 0.60, "noise": 0.08, "atr_mult_sl": 3.0,  "atr_mult_t": 8.0,  "instruments": ["spot"]},
    6: {"name": "Medium-Term", "tf": "3mo",      "hold": "3-6 months", "decay": 0.50, "noise": 0.09, "atr_mult_sl": 4.0,  "atr_mult_t": 12.0, "instruments": ["spot"]},
    7: {"name": "Long-Term",   "tf": "6mo-1y",   "hold": "6-12 months","decay": 0.40, "noise": 0.10, "atr_mult_sl": 6.0,  "atr_mult_t": 18.0, "instruments": ["spot"]},
    8: {"name": "Investment",  "tf": "1y+",      "hold": "12+ months", "decay": 0.30, "noise": 0.12, "atr_mult_sl": 8.0,  "atr_mult_t": 30.0, "instruments": ["spot", "long_hold"]},
}


class MultiLevelPredictor:
    """
    Generates predictions at all 8 levels simultaneously.

    Input:  base_prob (from ensemble), ohlcv data, regime, doc_context
    Output: list of PredictionLevel objects, one per level

    Key insight: higher levels use document knowledge more heavily
    because fundamentals matter more over longer horizons.
    """

    def predict_all_levels(self,
                           base_prob: float,
                           current_price: float,
                           ohlcv: list,
                           regime: str = "ranging",
                           doc_context: dict = None,
                           macro_bias: float = 0.0,
                           levels: list = None) -> list[PredictionLevel]:
        """
        Generate predictions for all requested levels (default: all 8).
        """
        if levels is None:
            levels = list(range(1, 9))

        # Compute ATR from OHLCV
        atr = self._compute_atr(ohlcv, 14)
        vol = self._compute_volatility(ohlcv, 20)

        predictions = []
        for level_n in levels:
            cfg = LEVEL_CONFIGS.get(level_n)
            if not cfg:
                continue
            pred = self._predict_level(
                level_n, cfg, base_prob, current_price,
                atr, vol, regime, doc_context, macro_bias
            )
            predictions.append(pred)

        return predictions

    def _predict_level(self, level_n: int, cfg: dict,
                       base_prob: float, price: float,
                       atr: float, vol: float,
                       regime: str, doc_context: dict,
                       macro_bias: float) -> PredictionLevel:

        # 1. Decay base probability toward 0.5 for longer horizons
        decayed = 0.5 + (base_prob - 0.5) * cfg["decay"]

        # 2. Apply regime modulation
        regime_adj = {
            "trending_bull": +0.04, "trending_bear": -0.04,
            "volatile": -0.02, "ranging": 0.0, "low_liquidity": -0.03,
        }.get(regime, 0.0)
        decayed += regime_adj

        # 3. Apply macro bias (more weight at higher levels)
        macro_weight = min(0.15, (level_n - 1) * 0.02)
        decayed += macro_bias * macro_weight

        # 4. Apply document knowledge (fundamentals dominate at levels 6–8)
        kb_boost = 0.0
        if doc_context:
            fund_score = doc_context.get("fundamental_score", 0.5)
            kb_boost_base = doc_context.get("sentiment_boost", 0.0)
            # Fundamental score matters more at longer horizons
            fund_weight = max(0.0, (level_n - 4) * 0.05)
            kb_boost = kb_boost_base + (fund_score - 0.5) * fund_weight
            decayed += kb_boost

        # 5. Add small noise
        noise = np.random.normal(0, cfg["noise"] * 0.2)
        decayed = float(np.clip(decayed + noise, 0.05, 0.99))

        # 6. Direction
        if decayed > 0.60:
            direction = "bull"
        elif decayed < 0.40:
            direction = "bear"
        else:
            direction = "neutral"

        # 7. Price targets based on ATR multiples (scale with horizon)
        atr_sl  = atr * cfg["atr_mult_sl"]
        atr_tgt = atr * cfg["atr_mult_t"]

        if direction == "bull":
            stop_loss    = round(price - atr_sl, 2)
            price_target = round(price + atr_tgt, 2)
        elif direction == "bear":
            stop_loss    = round(price + atr_sl, 2)
            price_target = round(price - atr_tgt, 2)
        else:
            stop_loss    = round(price - atr_sl * 0.5, 2)
            price_target = round(price + atr_tgt * 0.3, 2)

        # 8. Risk/Reward
        risk   = abs(price - stop_loss)
        reward = abs(price_target - price)
        rr     = round(reward / (risk + 1e-9), 2)

        # 9. Confidence (decreases with horizon + volatility)
        confidence = float(np.clip(
            0.85 - (level_n - 1) * 0.05 - vol * 2.0,
            0.35, 0.88
        ))
        # Boost confidence if strong fundamentals at long horizons
        if level_n >= 6 and doc_context and doc_context.get("fundamental_score", 0.5) > 0.7:
            confidence = min(0.88, confidence + 0.08)

        # 10. Build reasoning
        reasoning = self._build_reasoning(
            level_n, cfg, decayed, regime, doc_context, kb_boost, macro_bias
        )

        return PredictionLevel(
            level        = level_n,
            name         = cfg["name"],
            timeframe    = cfg["tf"],
            hold_period  = cfg["hold"],
            direction    = direction,
            probability  = round(decayed, 3),
            price_target = price_target,
            stop_loss    = stop_loss,
            risk_reward  = rr,
            confidence   = round(confidence, 3),
            reasoning    = reasoning,
            suitable_for = cfg["instruments"],
            kb_context   = doc_context,
        )

    def _build_reasoning(self, level_n, cfg, prob, regime,
                         doc_context, kb_boost, macro_bias) -> list[str]:
        reasons = [
            f"Base probability decayed to {prob:.1%} at {cfg['name']} horizon",
            f"Market regime: {regime}",
        ]
        if abs(macro_bias) > 0.05:
            reasons.append(f"Macro bias: {'bullish' if macro_bias > 0 else 'bearish'} ({macro_bias:+.2f})")
        if doc_context and doc_context.get("entries_found", 0) > 0:
            reasons.append(
                f"Knowledge base: {doc_context['entries_found']} documents, "
                f"sentiment boost {kb_boost:+.3f}"
            )
            if doc_context.get("key_hints"):
                reasons.extend(doc_context["key_hints"][:2])
        if level_n >= 6:
            reasons.append(f"Long-term: fundamentals weighted at {(level_n-4)*5}% of signal")
        return reasons[:5]

    def _compute_atr(self, ohlcv: list, period: int = 14) -> float:
        if not ohlcv or len(ohlcv) < 2:
            return 100.0
        trs = []
        for i in range(1, min(len(ohlcv), period + 1)):
            h = ohlcv[i].get("high", 0) or ohlcv[i-1].get("close", 0)
            l = ohlcv[i].get("low", 0)  or ohlcv[i-1].get("close", 0)
            c = ohlcv[i-1].get("close", 0)
            tr = max(h - l, abs(h - c), abs(l - c))
            trs.append(tr)
        return float(np.mean(trs)) if trs else 100.0

    def _compute_volatility(self, ohlcv: list, period: int = 20) -> float:
        closes = [b.get("close", 0) for b in ohlcv[-period:] if b.get("close", 0) > 0]
        if len(closes) < 3:
            return 0.02
        ret = np.diff(np.log(np.array(closes) + 1e-9))
        return float(np.std(ret))


def level_to_dict(p: PredictionLevel) -> dict:
    return {
        "level":        p.level,
        "name":         p.name,
        "timeframe":    p.timeframe,
        "hold_period":  p.hold_period,
        "direction":    p.direction,
        "probability":  p.probability,
        "probability_pct": round(p.probability * 100, 1),
        "price_target": p.price_target,
        "stop_loss":    p.stop_loss,
        "risk_reward":  p.risk_reward,
        "confidence":   p.confidence,
        "confidence_pct": round(p.confidence * 100, 1),
        "reasoning":    p.reasoning,
        "suitable_for": p.suitable_for,
        "kb_context":   {
            "entries_found":    p.kb_context.get("entries_found", 0),
            "sentiment_boost":  p.kb_context.get("sentiment_boost", 0),
            "key_hints":        p.kb_context.get("key_hints", []),
        } if p.kb_context else None,
    }


# Module-level singleton
_multi_level = MultiLevelPredictor()

def get_multi_level_predictor() -> MultiLevelPredictor:
    return _multi_level
