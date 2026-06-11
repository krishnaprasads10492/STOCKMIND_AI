"""
inference_scale_quantizer.py — Inference Scale Quantizer
StockMind AGI Blueprint // JARVIS Mark-V // Layer II

Computes token/compute budgets via Volatility Entropy Math.
Implements all three mathematical computation protocols from the blueprint:

  1) Portfolio Safety Matrix Profile (Ps):
     Ps = max(0, sum(w * [1 - P(Drawdown) * gamma]))

  2) Test-Time Compute Allocation (Calloc):
     Calloc = min(Cmax, Ccase * exp(alpha*H + beta*(sigma^2/theta)))

  3) Market Trap Imbalance Probability (Ptrap):
     Ptrap = 1 / (1 + exp(-(lambda1*V + lambda2*I - gamma)))

Also implements:
  - ARC Compute Energy Gauge (token burn tracking)
  - Read-Only Lock / API Circuit Breaker (hardcoded order scope exclusion)
"""

from __future__ import annotations
import math
import time
import logging
from collections import deque

logger = logging.getLogger("stockmind-ai.isq")

# ─────────────────────────────────────────────────────────────────────────────
# Constants from the blueprint schema
# ─────────────────────────────────────────────────────────────────────────────

# Calloc hyperparameters
ALPHA_H      = 0.15    # entropy weight
BETA_SIGMA   = 0.30    # volatility weight
THETA_BASE   = 0.25    # base uncertainty normalizer
C_MAX        = 8000    # max tokens per inference
C_CASE_BASE  = 1000    # base case tokens

# Ps (Portfolio Safety) hyperparameters
GAMMA_PS = 0.85        # drawdown severity multiplier

# Ptrap hyperparameters
LAMBDA1_V    = 2.2     # volume imbalance coefficient
LAMBDA2_I    = 1.8     # order imbalance coefficient
GAMMA_TRAP   = 1.5     # trap detection threshold


# ─────────────────────────────────────────────────────────────────────────────
# ARC Compute Energy Gauge — Token Burn Tracker
# ─────────────────────────────────────────────────────────────────────────────

class ARCComputeGauge:
    """
    ARC Compute Energy Gauge — tracks test-time token burn.
    Blueprint Layer I: Arc Compute Energy Gauge.

    Monitors compute usage across inference calls.
    Triggers circuit breaker when budget is exceeded.
    """

    DAILY_BUDGET   = 500_000    # total daily token budget
    HOURLY_BUDGET  = 50_000     # per-hour soft cap
    BURST_LIMIT    = 10_000     # per-request hard limit

    def __init__(self):
        self._total_burned     = 0
        self._hourly_window: deque  = deque(maxlen=3600)
        self._request_log: deque    = deque(maxlen=1000)
        self._circuit_open     = False
        self._circuit_opened_at = None
        self._last_reset        = time.time()

    def record_burn(self, tokens: int, provider: str = "unknown",
                    task: str = "inference") -> dict:
        """Record token consumption. Returns status with circuit state."""
        now = time.time()

        # Daily reset
        if now - self._last_reset > 86400:
            self._total_burned = 0
            self._last_reset = now
            self._circuit_open = False

        self._total_burned += tokens
        self._hourly_window.append({"ts": now, "tokens": tokens})
        self._request_log.append({
            "ts": now, "tokens": tokens,
            "provider": provider, "task": task,
        })

        # Check budget breach
        hourly_total = sum(
            r["tokens"] for r in self._hourly_window
            if now - r["ts"] < 3600
        )

        if tokens > self.BURST_LIMIT:
            logger.warning("[ARC] Burst limit exceeded: %d tokens", tokens)

        if hourly_total > self.HOURLY_BUDGET or self._total_burned > self.DAILY_BUDGET:
            if not self._circuit_open:
                self._circuit_open = True
                self._circuit_opened_at = now
                logger.warning("[ARC] Circuit breaker OPENED — budget exceeded")

        return self.get_gauge()

    def get_gauge(self) -> dict:
        now = time.time()
        hourly = sum(r["tokens"] for r in self._hourly_window if now - r["ts"] < 3600)
        daily_pct  = min(100, round(self._total_burned / self.DAILY_BUDGET * 100, 1))
        hourly_pct = min(100, round(hourly / self.HOURLY_BUDGET * 100, 1))

        # Traffic light color
        if daily_pct > 85 or self._circuit_open:
            color = "crimson"
        elif daily_pct > 60:
            color = "amber"
        else:
            color = "emerald"

        return {
            "total_burned":   self._total_burned,
            "daily_budget":   self.DAILY_BUDGET,
            "daily_pct":      daily_pct,
            "hourly_burned":  hourly,
            "hourly_pct":     hourly_pct,
            "color":          color,
            "circuit_open":   self._circuit_open,
            "recent_requests": list(self._request_log)[-5:],
        }

    def reset_circuit(self):
        self._circuit_open = False
        self._circuit_opened_at = None
        logger.info("[ARC] Circuit breaker reset manually")


# ─────────────────────────────────────────────────────────────────────────────
# API Circuit Breaker — Read-Only Lock (Blueprint Layer I)
# ─────────────────────────────────────────────────────────────────────────────

class APICircuitBreaker:
    """
    Read-Only Lock / API Circuit Breaker.
    Hardcoded system exclusion of order scopes.
    Blueprint: 'Hardcoded System Exclusion of Order Scopes'

    This is NON-NEGOTIABLE — this application NEVER executes trades.
    Any attempt to call order/trade/execute routes is blocked here.
    """

    BLOCKED_SCOPES = frozenset([
        "place_order", "execute_trade", "cancel_order",
        "modify_order", "market_order", "limit_order",
        "stop_order", "bracket_order", "cover_order",
        "sell", "buy_execute", "oco", "gtt",
    ])

    def __init__(self):
        self._blocked_attempts: list = []
        self._total_blocked    = 0
        self._is_locked        = True  # ALWAYS locked — cannot be unlocked

    @property
    def is_read_only(self) -> bool:
        return True  # immutable

    def check_scope(self, scope: str, requester: str = "unknown") -> dict:
        """
        Check if a scope is allowed. ALWAYS blocks order execution scopes.
        Returns {"allowed": bool, "reason": str}.
        """
        scope_lower = scope.lower().replace("-", "_").replace(" ", "_")
        for blocked in self.BLOCKED_SCOPES:
            if blocked in scope_lower:
                self._total_blocked += 1
                entry = {
                    "ts": time.time(), "scope": scope,
                    "requester": requester, "action": "BLOCKED",
                }
                self._blocked_attempts.append(entry)
                logger.critical(
                    "[CircuitBreaker] BLOCKED order scope '%s' from '%s'",
                    scope, requester
                )
                return {
                    "allowed": False,
                    "reason": (
                        "READ-ONLY MODE: StockMind AI is a prediction and analysis "
                        "platform. Order execution is permanently disabled. "
                        "This is NOT financial advice."
                    ),
                }
        return {"allowed": True, "reason": "read_only_scope_ok"}

    def get_status(self) -> dict:
        return {
            "mode":           "READ_ONLY",
            "locked":         True,
            "total_blocked":  self._total_blocked,
            "blocked_scopes": list(self.BLOCKED_SCOPES),
            "recent_blocked": self._blocked_attempts[-5:],
        }


# ─────────────────────────────────────────────────────────────────────────────
# Inference Scale Quantizer — Main Class (Blueprint Layer II)
# ─────────────────────────────────────────────────────────────────────────────

class InferenceScaleQuantizer:
    """
    Inference Scale Quantizer — Computes Calloc Token Budgets via Entropy.
    Blueprint Layer II: 'Computes Calloc Token Budgets via Entropy'

    Three core mathematical protocols:
    1. Ps  = Portfolio Safety Matrix Profile
    2. Calloc = Test-Time Compute Allocation
    3. Ptrap = Market Trap Imbalance Probability
    """

    def __init__(self):
        self.arc_gauge      = ARCComputeGauge()
        self.circuit_breaker = APICircuitBreaker()
        self._calloc_history: deque = deque(maxlen=500)

    # ── Protocol 1: Portfolio Safety Matrix Profile ───────────────────────────

    def compute_ps(self,
                   weights: list[float],
                   drawdown_probs: list[float],
                   gamma: float = GAMMA_PS) -> float:
        """
        Ps = max(0, sum(w * [1 - P(Drawdown) * gamma]))

        Args:
            weights:        portfolio weights per signal (must sum ≤ 1)
            drawdown_probs: probability of drawdown per signal [0,1]
            gamma:          drawdown severity multiplier (default 0.85)

        Returns:
            Ps in [0, 1] — 1 = fully safe, 0 = high drawdown risk
        """
        if not weights or not drawdown_probs:
            return 0.5
        n = min(len(weights), len(drawdown_probs))
        total = sum(
            weights[i] * max(0.0, 1.0 - drawdown_probs[i] * gamma)
            for i in range(n)
        )
        ps = max(0.0, min(1.0, total))
        logger.debug("[ISQ] Ps=%.3f (gamma=%.2f, n=%d signals)", ps, gamma, n)
        return round(ps, 4)

    # ── Protocol 2: Test-Time Compute Allocation ──────────────────────────────

    def compute_calloc(self,
                       entropy_h: float,
                       sigma: float,
                       c_case: float = C_CASE_BASE,
                       theta: float  = THETA_BASE,
                       alpha: float  = ALPHA_H,
                       beta:  float  = BETA_SIGMA) -> int:
        """
        Calloc = min(Cmax, Ccase * exp(alpha*H + beta*(sigma^2/theta)))

        Args:
            entropy_h: Shannon entropy of the prediction distribution [0, log2(N)]
            sigma:     current volatility (e.g., annualized std of returns)
            c_case:    base case token allocation
            theta:     normalizing uncertainty factor
            alpha:     entropy scaling weight
            beta:      volatility scaling weight

        Returns:
            Integer token budget for this inference call
        """
        exponent  = alpha * entropy_h + beta * (sigma ** 2 / (theta + 1e-9))
        calloc    = c_case * math.exp(exponent)
        calloc    = int(min(C_MAX, max(100, calloc)))

        self._calloc_history.append({
            "ts": time.time(), "calloc": calloc,
            "entropy_h": round(entropy_h, 3),
            "sigma": round(sigma, 4),
        })

        logger.debug("[ISQ] Calloc=%d (H=%.3f, σ=%.4f)", calloc, entropy_h, sigma)
        return calloc

    # ── Protocol 3: Market Trap Imbalance Probability ─────────────────────────

    def compute_ptrap(self,
                      volume_imbalance: float,
                      order_imbalance: float,
                      lambda1: float = LAMBDA1_V,
                      lambda2: float = LAMBDA2_I,
                      gamma:   float = GAMMA_TRAP) -> float:
        """
        Ptrap = 1 / (1 + exp(-(lambda1*V + lambda2*I - gamma)))

        Args:
            volume_imbalance: V — normalised volume imbalance ratio (-1 to +1)
                              Positive = unusual buying, Negative = unusual selling
            order_imbalance:  I — order book imbalance signal (-1 to +1)
            lambda1:          weight on volume imbalance
            lambda2:          weight on order imbalance
            gamma:            bias / threshold

        Returns:
            Ptrap in [0, 1] — probability of market manipulation / trap
        """
        z     = lambda1 * volume_imbalance + lambda2 * order_imbalance - gamma
        ptrap = 1.0 / (1.0 + math.exp(-z))
        logger.debug(
            "[ISQ] Ptrap=%.3f (V=%.2f, I=%.2f)", ptrap,
            volume_imbalance, order_imbalance
        )
        return round(ptrap, 4)

    # ── Entropy computation helper ────────────────────────────────────────────

    @staticmethod
    def signal_entropy(probs: list[float]) -> float:
        """Shannon entropy of a probability distribution. H ∈ [0, log2(N)]"""
        if not probs:
            return 0.0
        arr = [max(1e-9, p) for p in probs]
        total = sum(arr)
        norm  = [p / total for p in arr]
        return float(-sum(p * math.log2(p) for p in norm if p > 0))

    # ── Full compute pass ─────────────────────────────────────────────────────

    def quantize(self, signals: list, sigma: float,
                 volume_imbalance: float = 0.0,
                 order_imbalance: float  = 0.0) -> dict:
        """
        Run all three protocols in one pass.

        Returns:
            ps, calloc, ptrap + arc gauge + circuit status
        """
        # Calloc — entropy from signal probability distribution
        probs     = [s.get("probability", 50) / 100 for s in signals]
        entropy_h = self.signal_entropy(probs)
        calloc    = self.compute_calloc(entropy_h, sigma)

        # Ps — use equal weights, drawdown from (1 - probability)
        n          = max(1, len(signals))
        weights    = [1.0 / n] * n
        dd_probs   = [1.0 - p for p in probs]
        ps         = self.compute_ps(weights, dd_probs)

        # Ptrap
        ptrap = self.compute_ptrap(volume_imbalance, order_imbalance)

        # Record compute burn estimate
        arc = self.arc_gauge.record_burn(calloc, provider="quantizer", task="quantize")

        # If Ptrap is high → reduce confidence (market manipulation warning)
        trap_warning = ptrap > 0.65

        return {
            "ps":             ps,
            "calloc":         calloc,
            "ptrap":          ptrap,
            "entropy_h":      round(entropy_h, 3),
            "sigma":          round(sigma, 4),
            "trap_warning":   trap_warning,
            "arc_gauge":      arc,
            "circuit":        self.circuit_breaker.get_status(),
        }

    def get_status(self) -> dict:
        recent = list(self._calloc_history)[-10:]
        avg_calloc = (sum(r["calloc"] for r in recent) / len(recent)) if recent else 0
        return {
            "avg_calloc":    round(avg_calloc),
            "arc_gauge":     self.arc_gauge.get_gauge(),
            "circuit":       self.circuit_breaker.get_status(),
            "recent_calloc": recent,
        }


# Module-level singleton
_isq = InferenceScaleQuantizer()

def get_isq() -> InferenceScaleQuantizer:
    return _isq
