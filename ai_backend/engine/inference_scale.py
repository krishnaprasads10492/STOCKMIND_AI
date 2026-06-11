"""
inference_scale.py — Inference Scale Quantizer + Cognitive Nexus Engine

Blueprint formulas:
  Calloc = min(Cmax, Cbase * exp(alpha*H + beta*(sigma^2/theta)))
  Ps     = max(0, sum(w * [1 - P(Drawdown > theta) * gamma]))
  Ptrap  = 1 / (1 + exp(-(lambda1*V + lambda2*I - gamma)))

Components:
  InferenceScaleQuantizer  — token budget via entropy math
  RiskEquationComputer     — Ps portfolio safety profile
  MarketManipulationTrap   — Ptrap short-seller detection
  ARCEnergyTracker         — compute token burn gauge
  EpisodicMemory           — context window + reasoning cache
  CognitiveNexusEngine     — JARVIS Mark-V unified coordinator
"""

import numpy as np
import time
import logging
from collections import deque
from typing import Optional

logger = logging.getLogger("stockmind-ai.inference-scale")


# ─────────────────────────────────────────────────────────────────────────────
# Inference Scale Quantizer
# Calloc = min(Cmax, Cbase * exp(alpha*H + beta*(sigma^2/theta)))
# ─────────────────────────────────────────────────────────────────────────────

class InferenceScaleQuantizer:
    """
    Dynamically allocates reasoning token budget based on market entropy.
    High volatility / entropy → more tokens → deeper cloud analysis.
    Low volatility / entropy  → fewer tokens → fast local inference.
    """

    def __init__(self, alpha=0.8, beta=1.2, theta=0.5, Cmax=4096, Cbase=512):
        self.alpha = alpha
        self.beta  = beta
        self.theta = theta
        self.Cmax  = Cmax
        self.Cbase = Cbase
        self._history: deque = deque(maxlen=200)
        self._total_tokens: int = 0
        self._t0 = time.time()

    def compute_calloc(self, H: float, sigma: float) -> int:
        """Calloc = min(Cmax, Cbase * exp(alpha*H + beta*(sigma^2/theta)))"""
        H = float(np.clip(H, 0.0, 1.0))
        sigma = float(np.clip(sigma, 0.0, 2.0))
        exp_val = self.alpha * H + self.beta * (sigma ** 2 / (self.theta + 1e-9))
        calloc = int(min(self.Cmax, max(128, self.Cbase * np.exp(exp_val))))
        self._history.append({"calloc": calloc, "H": round(H, 3), "sigma": round(sigma, 3), "ts": time.time()})
        self._total_tokens += calloc
        return calloc

    def entropy_from_returns(self, returns: np.ndarray, bins: int = 20) -> float:
        if len(returns) < 10:
            return 0.5
        hist, _ = np.histogram(returns, bins=bins, density=True)
        hist = hist[hist > 0]
        if not len(hist):
            return 0.0
        return float(np.clip(-np.sum(hist * np.log(hist + 1e-12)) / np.log(bins), 0.0, 1.0))

    def sigma_from_returns(self, returns: np.ndarray, annualize: int = 252) -> float:
        return float(np.std(returns) * np.sqrt(annualize)) if len(returns) >= 5 else 0.15

    def route_tier(self, calloc: int) -> str:
        if calloc <= 512:   return "local"
        if calloc <= 2048:  return "cloud_fast"
        return "cloud_premium"

    def arc_energy(self) -> dict:
        recent = [r["calloc"] for r in list(self._history)[-20:]]
        avg = float(np.mean(recent)) if recent else 0
        burn_pct = round(avg / self.Cmax * 100, 1)
        return {
            "current_calloc":  recent[-1] if recent else 0,
            "avg_calloc_20":   round(avg),
            "burn_pct":        burn_pct,
            "total_tokens":    self._total_tokens,
            "tokens_per_min":  round(self._total_tokens / max(1, (time.time() - self._t0) / 60)),
            "status":          "HIGH" if burn_pct > 75 else "MEDIUM" if burn_pct > 40 else "LOW",
            "color":           "#ff3366" if burn_pct > 75 else "#ffaa00" if burn_pct > 40 else "#00ff88",
        }

    def get_status(self) -> dict:
        return {
            "params": {"alpha": self.alpha, "beta": self.beta, "theta": self.theta, "Cmax": self.Cmax, "Cbase": self.Cbase},
            "recent": list(self._history)[-5:],
            "arc_energy": self.arc_energy(),
        }
