"""
multi_horizon_wave.py — Multi-Horizon Wave Models
StockMind AGI Blueprint // Cognitive Nexus Engine

4h Intraday Vectors | 7d Projections | Long Macro Cycles

Implements the Multi-Horizon Wave Models block from the Stark Fintech Engine.
Generates projection vectors across three time horizons simultaneously,
then synthesizes them into a unified directional bias.
"""

from __future__ import annotations
import math
import time
import logging
from enum import Enum
from dataclasses import dataclass, field
from collections import deque

import numpy as np

logger = logging.getLogger("stockmind-ai.mhwave")


class Horizon(str, Enum):
    INTRADAY = "4h_intraday"
    SWING    = "7d_swing"
    MACRO    = "macro_cycle"


@dataclass
class WaveProjection:
    horizon:       Horizon
    direction:     str          # "bull" | "bear" | "neutral"
    strength:      float        # 0.0 – 1.0
    probability:   float        # 0.0 – 1.0
    price_target:  float
    price_low:     float
    price_high:    float
    basis:         list[str]    # human-readable reasons
    ts:            float = field(default_factory=time.time)


class MultiHorizonWaveEngine:
    """
    Computes projection vectors across three temporal horizons.

    Architecture:
      Intraday (4h): Uses volatility + momentum + volume
      Swing (7d):    Uses trend + regime + macro bias
      Macro cycle:   Uses correlation network + long-term EMAs + regime memory

    Outputs are synthesized into a unified wave vector with alignment score.
    """

    # EMA multipliers per horizon
    EMA_WINDOWS = {
        Horizon.INTRADAY: [5, 13, 21],
        Horizon.SWING:    [21, 50, 89],
        Horizon.MACRO:    [89, 144, 200],
    }

    # Fibonacci projection multipliers
    FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 1.0, 1.272, 1.618]

    def __init__(self):
        self._projection_history: deque = deque(maxlen=5000)
        self._alignment_scores: deque   = deque(maxlen=200)
        self._symbol_wave_cache: dict   = {}

    # ── Main projection ───────────────────────────────────────────────────────

    def project(self,
                symbol: str,
                ohlcv: list,
                regime: str = "trending_bull",
                macro_bias: float = 0.0,
                sentiment: float  = 0.0) -> dict:
        """
        Generate multi-horizon wave projections.

        Returns:
            {
              intraday: WaveProjection,
              swing:    WaveProjection,
              macro:    WaveProjection,
              unified:  { direction, strength, alignment_score, wave_vector }
            }
        """
        if len(ohlcv) < 30:
            return {"ok": False, "reason": "need_min_30_bars"}

        c = np.array([b["close"]  for b in ohlcv], dtype=np.float64)
        h = np.array([b["high"]   for b in ohlcv], dtype=np.float64)
        l = np.array([b["low"]    for b in ohlcv], dtype=np.float64)
        v = np.array([b["volume"] for b in ohlcv], dtype=np.float64)

        current_price = float(c[-1])

        # Compute EMAs
        ema_map = {}
        for horizon, windows in self.EMA_WINDOWS.items():
            ema_map[horizon] = []
            for w in windows:
                if len(c) >= w:
                    ema_map[horizon].append(self._ema(c, w))
                else:
                    ema_map[horizon].append(current_price)

        # ATR for projection bands
        atr = self._atr(h, l, c, 14)

        # ── Intraday (4h) projection ───────────────────────────────────────
        intraday = self._intraday_projection(c, v, h, l, ema_map[Horizon.INTRADAY],
                                              atr, current_price, sentiment)

        # ── Swing (7d) projection ──────────────────────────────────────────
        swing = self._swing_projection(c, ema_map[Horizon.SWING],
                                        atr, current_price, regime, macro_bias)

        # ── Macro cycle projection ─────────────────────────────────────────
        macro = self._macro_projection(c, ema_map[Horizon.MACRO],
                                        atr, current_price, regime, macro_bias)

        # ── Unify projections ──────────────────────────────────────────────
        unified = self._unify(intraday, swing, macro)

        # Cache
        result = {
            "ok":      True,
            "symbol":  symbol,
            "ts":      time.time(),
            "intraday": self._proj_to_dict(intraday),
            "swing":    self._proj_to_dict(swing),
            "macro":    self._proj_to_dict(macro),
            "unified":  unified,
        }
        self._projection_history.append({
            "symbol": symbol, "ts": result["ts"],
            "direction": unified["direction"],
            "alignment": unified["alignment_score"],
        })
        self._symbol_wave_cache[symbol] = result
        return result

    # ── Intraday (4h) ─────────────────────────────────────────────────────────

    def _intraday_projection(self, c, v, h, l, emas, atr,
                              price, sentiment) -> WaveProjection:
        e5, e13, e21 = emas

        # Momentum: short EMA stack
        ema_bull = e5 > e13 > e21
        ema_bear = e5 < e13 < e21

        # Volume confirmation
        vol_ratio = float(v[-1] / (np.mean(v[-20:]) + 1e-9)) if len(v) >= 20 else 1.0

        # RSI proxy
        ret  = np.diff(c[-15:])
        gain = float(np.mean(np.maximum(ret, 0))) if len(ret) > 0 else 0
        loss = float(np.mean(np.maximum(-ret, 0))) + 1e-9
        rsi  = 100 - 100 / (1 + gain / loss)

        # Direction
        if ema_bull and rsi < 75 and vol_ratio > 0.8 and sentiment >= -0.2:
            direction = "bull"
            strength  = min(1.0, 0.5 + (vol_ratio - 1.0) * 0.2 + sentiment * 0.1)
            prob      = min(0.85, 0.55 + (vol_ratio - 1.0) * 0.05)
            target    = price + atr * 1.5
        elif ema_bear and rsi > 25:
            direction = "bear"
            strength  = min(1.0, 0.5 + (1.0 / (vol_ratio + 0.1)) * 0.2)
            prob      = min(0.85, 0.55)
            target    = price - atr * 1.5
        else:
            direction = "neutral"
            strength  = 0.3 + abs(sentiment) * 0.1
            prob      = 0.50
            target    = price

        return WaveProjection(
            horizon      = Horizon.INTRADAY,
            direction    = direction,
            strength     = round(strength, 3),
            probability  = round(prob, 3),
            price_target = round(target, 2),
            price_low    = round(price - atr * 0.8, 2),
            price_high   = round(price + atr * 0.8, 2),
            basis        = [
                f"EMA5={e5:.0f} EMA13={e13:.0f} EMA21={e21:.0f}",
                f"RSI={rsi:.1f} VolRatio={vol_ratio:.2f}",
                f"Sentiment={sentiment:.2f}",
            ],
        )

    # ── Swing (7d) ────────────────────────────────────────────────────────────

    def _swing_projection(self, c, emas, atr, price,
                           regime: str, macro_bias: float) -> WaveProjection:
        e21, e50, e89 = emas

        trend_score = 0.0
        if price > e21 > e50:   trend_score += 0.4
        if price > e50 > e89:   trend_score += 0.3
        if macro_bias > 0.2:    trend_score += 0.2
        if "bull" in regime:    trend_score += 0.1
        if price < e21 < e50:   trend_score -= 0.4
        if "bear" in regime:    trend_score -= 0.3
        if macro_bias < -0.2:   trend_score -= 0.2

        if trend_score > 0.3:
            direction = "bull"
            prob = min(0.88, 0.55 + trend_score * 0.3)
            target = price * (1 + atr / price * 3)
        elif trend_score < -0.3:
            direction = "bear"
            prob = min(0.88, 0.55 + abs(trend_score) * 0.3)
            target = price * (1 - atr / price * 3)
        else:
            direction = "neutral"
            prob = 0.50
            target = price

        # Fibonacci projection
        recent_high = float(np.max(c[-30:])) if len(c) >= 30 else price * 1.05
        recent_low  = float(np.min(c[-30:])) if len(c) >= 30 else price * 0.95
        fib_target  = recent_low + (recent_high - recent_low) * 0.618
        target      = fib_target if direction == "bull" else \
                      recent_high - (recent_high - recent_low) * 0.618

        return WaveProjection(
            horizon      = Horizon.SWING,
            direction    = direction,
            strength     = round(abs(trend_score), 3),
            probability  = round(prob, 3),
            price_target = round(target, 2),
            price_low    = round(recent_low, 2),
            price_high   = round(recent_high, 2),
            basis        = [
                f"TrendScore={trend_score:.2f}",
                f"EMA21={e21:.0f} EMA50={e50:.0f} EMA89={e89:.0f}",
                f"Regime={regime} MacroBias={macro_bias:.2f}",
                f"Fib618Target={fib_target:.0f}",
            ],
        )

    # ── Macro cycle ───────────────────────────────────────────────────────────

    def _macro_projection(self, c, emas, atr, price,
                           regime: str, macro_bias: float) -> WaveProjection:
        e89, e144, e200 = emas

        # Long-term position relative to macro EMAs
        above_e200 = price > e200
        above_e144 = price > e144
        ema_slope  = (e89 - e200) / (e200 + 1e-9)  # EMA compression/expansion

        macro_score = 0.0
        if above_e200:  macro_score += 0.35
        if above_e144:  macro_score += 0.25
        if ema_slope > 0.05: macro_score += 0.2
        macro_score += macro_bias * 0.2

        if macro_score > 0.4:
            direction = "bull"
            prob = 0.65
            # Long-term Fib extension
            target = price * 1.382
        elif macro_score < -0.2:
            direction = "bear"
            prob = 0.65
            target = price * 0.786
        else:
            direction = "neutral"
            prob = 0.52
            target = price * 1.0

        return WaveProjection(
            horizon      = Horizon.MACRO,
            direction    = direction,
            strength     = round(abs(macro_score), 3),
            probability  = round(prob, 3),
            price_target = round(target, 2),
            price_low    = round(e200 * 0.95, 2),
            price_high   = round(price * 1.618, 2),
            basis        = [
                f"E89={e89:.0f} E144={e144:.0f} E200={e200:.0f}",
                f"AboveE200={above_e200} EMASlope={ema_slope:.3f}",
                f"MacroBias={macro_bias:.2f} MacroScore={macro_score:.2f}",
            ],
        )

    # ── Unify ─────────────────────────────────────────────────────────────────

    def _unify(self, intraday: WaveProjection,
               swing: WaveProjection,
               macro: WaveProjection) -> dict:
        dirs = [intraday.direction, swing.direction, macro.direction]
        bull_count = dirs.count("bull")
        bear_count = dirs.count("bear")

        # Weighted vote: macro counts most
        weights   = {"intraday": 0.25, "swing": 0.35, "macro": 0.40}
        projs     = [("intraday", intraday), ("swing", swing), ("macro", macro)]
        bull_w    = sum(weights[n] for n, p in projs if p.direction == "bull")
        bear_w    = sum(weights[n] for n, p in projs if p.direction == "bear")

        if bull_w > bear_w and bull_w > 0.35:
            direction = "bull"
            strength  = bull_w
        elif bear_w > bull_w and bear_w > 0.35:
            direction = "bear"
            strength  = bear_w
        else:
            direction = "neutral"
            strength  = 0.5 - abs(bull_w - bear_w)

        # Alignment score: how much all horizons agree (1 = perfect alignment)
        max_agree = max(bull_count, bear_count, dirs.count("neutral"))
        alignment = round(max_agree / 3.0, 3)

        # Wave vector: [intraday_prob, swing_prob, macro_prob, alignment, strength]
        wave_vector = [
            intraday.probability,
            swing.probability,
            macro.probability,
            alignment,
            strength,
        ]

        self._alignment_scores.append(alignment)

        return {
            "direction":       direction,
            "strength":        round(strength, 3),
            "alignment_score": alignment,
            "wave_vector":     [round(x, 3) for x in wave_vector],
            "horizons_agree":  max_agree,
        }

    # ── Math helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _ema(c: np.ndarray, period: int) -> float:
        if len(c) < period:
            return float(c[-1])
        k = 2 / (period + 1)
        val = float(c[0])
        for x in c[1:]:
            val = float(x) * k + val * (1 - k)
        return val

    @staticmethod
    def _atr(h, l, c, period: int = 14) -> float:
        if len(h) < 2:
            return float(h[-1] - l[-1]) if len(h) >= 1 else 1.0
        tr = [max(h[i] - l[i], abs(h[i] - c[i-1]), abs(l[i] - c[i-1]))
              for i in range(1, len(h))]
        return float(np.mean(tr[-period:])) if tr else 1.0

    @staticmethod
    def _proj_to_dict(p: WaveProjection) -> dict:
        return {
            "horizon":      p.horizon.value,
            "direction":    p.direction,
            "strength":     p.strength,
            "probability":  p.probability,
            "price_target": p.price_target,
            "price_low":    p.price_low,
            "price_high":   p.price_high,
            "basis":        p.basis,
        }

    def get_status(self) -> dict:
        recent = list(self._projection_history)[-20:]
        scores = list(self._alignment_scores)[-50:]
        avg_align = (sum(scores) / len(scores)) if scores else 0.0
        return {
            "total_projections": len(self._projection_history),
            "avg_alignment":     round(float(avg_align), 3),
            "cached_symbols":    list(self._symbol_wave_cache.keys()),
            "recent":            recent[-5:],
        }


# Module-level singleton
_mhw = MultiHorizonWaveEngine()

def get_wave_engine() -> MultiHorizonWaveEngine:
    return _mhw
