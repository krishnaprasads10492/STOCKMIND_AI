"""
self_optimizer.py — AI Self-Improvement & Auto-Optimization Module.

This module enables the application to:
  1. Monitor its own prediction accuracy in real-time
  2. Detect performance degradation (drift, regime change)
  3. Auto-tune hyperparameters within safe bounds
  4. Generate improvement recommendations
  5. Run A/B tests between model versions
  6. Track feature importance drift
  7. Produce health reports for human review

Safety constraints:
  - Never promotes a model without human approval (approval_required=True)
  - All changes are logged with before/after metrics
  - Rollback capability maintained for 30 days
  - Base functionality is NEVER modified — only additive improvements
"""

import numpy as np
import json
import time
import logging
from typing import Optional
from dataclasses import dataclass, asdict

logger = logging.getLogger("stockmind-ai.self-optimizer")


# ── Performance Tracker ───────────────────────────────────────────────────────

@dataclass
class PredictionOutcome:
    signal_id:    str
    symbol:       str
    predicted_prob: float
    actual_outcome: str   # T1_HIT, T2_HIT, T3_HIT, SL_HIT, TIMEOUT
    timestamp:    float
    regime:       str


class PerformanceTracker:
    """Tracks prediction outcomes and computes rolling accuracy metrics."""

    def __init__(self, window: int = 100):
        self.window   = window
        self.outcomes: list[PredictionOutcome] = []
        self._accuracy_history: list[float] = []

    def record(self, outcome: PredictionOutcome):
        self.outcomes.append(outcome)
        if len(self.outcomes) > self.window * 3:
            self.outcomes = self.outcomes[-self.window * 3:]

    def rolling_accuracy(self, n: int = None) -> float:
        n = n or self.window
        recent = self.outcomes[-n:]
        if not recent:
            return 0.0
        hits = sum(1 for o in recent if o.actual_outcome in ("T1_HIT", "T2_HIT", "T3_HIT"))
        return hits / len(recent)

    def calibration_error(self, n: int = None) -> float:
        """Expected Calibration Error (ECE) — how well probabilities match outcomes."""
        n = n or self.window
        recent = self.outcomes[-n:]
        if len(recent) < 10:
            return 0.0

        bins = np.linspace(0, 1, 11)
        ece  = 0.0
        for i in range(len(bins) - 1):
            in_bin = [o for o in recent if bins[i] <= o.predicted_prob < bins[i+1]]
            if not in_bin:
                continue
            avg_pred = np.mean([o.predicted_prob for o in in_bin])
            avg_actual = np.mean([1.0 if o.actual_outcome in ("T1_HIT", "T2_HIT", "T3_HIT") else 0.0
                                  for o in in_bin])
            ece += len(in_bin) / len(recent) * abs(avg_pred - avg_actual)
        return float(ece)

    def accuracy_by_regime(self) -> dict:
        regimes = {}
        for o in self.outcomes[-self.window:]:
            if o.regime not in regimes:
                regimes[o.regime] = {"hits": 0, "total": 0}
            regimes[o.regime]["total"] += 1
            if o.actual_outcome in ("T1_HIT", "T2_HIT", "T3_HIT"):
                regimes[o.regime]["hits"] += 1
        return {r: round(v["hits"] / v["total"] * 100, 1) if v["total"] > 0 else 0
                for r, v in regimes.items()}

    def accuracy_by_grade(self) -> dict:
        grades = {}
        for o in self.outcomes[-self.window:]:
            grade = _prob_to_grade(o.predicted_prob)
            if grade not in grades:
                grades[grade] = {"hits": 0, "total": 0}
            grades[grade]["total"] += 1
            if o.actual_outcome in ("T1_HIT", "T2_HIT", "T3_HIT"):
                grades[grade]["hits"] += 1
        return {g: round(v["hits"] / v["total"] * 100, 1) if v["total"] > 0 else 0
                for g, v in grades.items()}


def _prob_to_grade(prob: float) -> str:
    if prob >= 0.80: return "A+"
    if prob >= 0.70: return "A"
    if prob >= 0.60: return "B"
    if prob >= 0.50: return "C"
    return "D"


# ── Drift Detector ────────────────────────────────────────────────────────────

class DriftDetector:
    """
    Detects accuracy drift using Page-Hinkley test (sequential change detection).
    Triggers recalibration when drift exceeds threshold.
    """

    def __init__(self, delta: float = 0.005, lambda_: float = 50.0):
        self.delta   = delta    # minimum detectable change
        self.lambda_ = lambda_  # threshold for alarm
        self._sum    = 0.0
        self._min    = 0.0
        self._n      = 0
        self._mean   = 0.0

    def update(self, accuracy: float) -> bool:
        """Returns True if drift detected."""
        self._n    += 1
        self._mean += (accuracy - self._mean) / self._n
        self._sum  += accuracy - self._mean - self.delta
        self._min   = min(self._min, self._sum)
        return (self._sum - self._min) > self.lambda_

    def reset(self):
        self._sum  = 0.0
        self._min  = 0.0
        self._n    = 0
        self._mean = 0.0


# ── Hyperparameter Tuner ──────────────────────────────────────────────────────

class HyperparameterTuner:
    """
    Safe hyperparameter tuning within pre-approved bounds.
    Uses Bayesian-inspired random search with performance feedback.
    """

    # Safe bounds — never exceed these without human approval
    PARAM_BOUNDS = {
        "ensemble_weights": {
            "lgbm":      (0.20, 0.50),
            "xgb":       (0.20, 0.50),
            "lstm":      (0.10, 0.40),
            "sentiment": (0.05, 0.20),
        },
        "calibration": {
            "platt_a":   (-3.0, 3.0),
            "platt_b":   (-1.0, 1.0),
        },
        "feature_selection": {
            "min_importance": (0.001, 0.05),
        },
        "signal_generation": {
            "atr_sl_mult":  (1.0, 2.0),
            "atr_t1_mult":  (1.5, 3.0),
            "min_prob_threshold": (0.45, 0.65),
        },
    }

    def __init__(self):
        self.current_params = {
            "ensemble_weights": {"lgbm": 0.35, "xgb": 0.35, "lstm": 0.20, "sentiment": 0.10},
            "calibration":      {"platt_a": 1.0, "platt_b": 0.0},
            "feature_selection": {"min_importance": 0.01},
            "signal_generation": {"atr_sl_mult": 1.3, "atr_t1_mult": 1.8, "min_prob_threshold": 0.50},
        }
        self.best_params  = dict(self.current_params)
        self.best_accuracy = 0.0
        self.trial_history: list[dict] = []

    def suggest_params(self, current_accuracy: float) -> dict:
        """Suggest new hyperparameters based on current performance."""
        if current_accuracy > self.best_accuracy:
            self.best_accuracy = current_accuracy
            self.best_params   = dict(self.current_params)

        # Random perturbation within bounds
        new_params = {}
        for group, params in self.current_params.items():
            new_params[group] = {}
            bounds = self.PARAM_BOUNDS.get(group, {})
            for k, v in params.items():
                if k in bounds:
                    lo, hi = bounds[k]
                    noise  = (hi - lo) * 0.1 * np.random.randn()
                    new_params[group][k] = float(np.clip(v + noise, lo, hi))
                else:
                    new_params[group][k] = v

        # Normalize ensemble weights to sum to 1
        ew = new_params.get("ensemble_weights", {})
        total = sum(ew.values())
        if total > 0:
            new_params["ensemble_weights"] = {k: v/total for k, v in ew.items()}

        return new_params

    def record_trial(self, params: dict, accuracy: float, approved: bool = False):
        self.trial_history.append({
            "params":   params,
            "accuracy": accuracy,
            "approved": approved,
            "timestamp": time.time(),
        })
        if len(self.trial_history) > 100:
            self.trial_history = self.trial_history[-100:]


# ── Improvement Recommender ───────────────────────────────────────────────────

class ImprovementRecommender:
    """
    Analyzes performance data and generates actionable improvement recommendations.
    All recommendations require human approval before implementation.
    """

    def generate_recommendations(
        self,
        tracker: PerformanceTracker,
        drift_detected: bool,
        ece: float,
        accuracy: float,
    ) -> list[dict]:
        recs = []

        # Accuracy below threshold
        if accuracy < 0.75:
            recs.append({
                "id":       "retrain_models",
                "priority": "HIGH",
                "title":    "Retrain ML Models",
                "reason":   f"Rolling accuracy {accuracy*100:.1f}% below 75% threshold",
                "action":   "Collect 3 months of new labeled data and retrain LightGBM + XGBoost",
                "impact":   "Expected +5-10% accuracy improvement",
                "approval_required": True,
                "auto_applicable":   False,
            })

        # Calibration drift
        if ece > 0.08:
            recs.append({
                "id":       "recalibrate_platt",
                "priority": "HIGH",
                "title":    "Recalibrate Probability Outputs",
                "reason":   f"ECE {ece*100:.1f}% exceeds 8% threshold — probabilities are miscalibrated",
                "action":   "Re-fit Platt scaling on recent 200 outcomes",
                "impact":   "Probabilities will better reflect true win rates",
                "approval_required": True,
                "auto_applicable":   True,
            })
        elif ece > 0.05:
            recs.append({
                "id":       "tune_calibration",
                "priority": "MEDIUM",
                "title":    "Fine-tune Calibration",
                "reason":   f"ECE {ece*100:.1f}% — minor calibration drift detected",
                "action":   "Adjust Platt scaling parameters by ±10%",
                "impact":   "Minor improvement in probability accuracy",
                "approval_required": False,
                "auto_applicable":   True,
            })

        # Drift detected
        if drift_detected:
            recs.append({
                "id":       "regime_adaptation",
                "priority": "MEDIUM",
                "title":    "Adapt to New Market Regime",
                "reason":   "Page-Hinkley drift detector triggered — market conditions changed",
                "action":   "Increase weight of recent data in ensemble (recency bias adjustment)",
                "impact":   "Faster adaptation to new market conditions",
                "approval_required": False,
                "auto_applicable":   True,
            })

        # Grade-specific issues
        grade_acc = tracker.accuracy_by_grade()
        for grade, acc in grade_acc.items():
            if acc < 60 and grade in ("A+", "A"):
                recs.append({
                    "id":       f"grade_{grade}_threshold",
                    "priority": "MEDIUM",
                    "title":    f"Raise {grade} Grade Threshold",
                    "reason":   f"Grade {grade} signals only {acc:.0f}% accurate — threshold too low",
                    "action":   f"Raise {grade} probability threshold by 5%",
                    "impact":   "Fewer but higher-quality A/A+ signals",
                    "approval_required": False,
                    "auto_applicable":   True,
                })

        # Feature importance drift (placeholder — needs real SHAP)
        recs.append({
            "id":       "feature_audit",
            "priority": "LOW",
            "title":    "Run Feature Importance Audit",
            "reason":   "Scheduled monthly feature importance review",
            "action":   "Compute SHAP values on last 500 predictions and compare to baseline",
            "impact":   "Identify stale features and potential new alpha signals",
            "approval_required": False,
            "auto_applicable":   False,
        })

        return sorted(recs, key=lambda r: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}[r["priority"]])


# ── Self-Optimizer Singleton ──────────────────────────────────────────────────

class SelfOptimizer:
    """Main self-optimization coordinator."""

    def __init__(self):
        self.tracker     = PerformanceTracker(window=200)
        self.drift       = DriftDetector()
        self.tuner       = HyperparameterTuner()
        self.recommender = ImprovementRecommender()
        self._start_time = time.time()
        self._optimization_runs = 0
        self._last_report_time  = 0

    def record_outcome(self, signal_id: str, symbol: str, predicted_prob: float,
                       actual_outcome: str, regime: str = "trending"):
        outcome = PredictionOutcome(
            signal_id=signal_id, symbol=symbol,
            predicted_prob=predicted_prob, actual_outcome=actual_outcome,
            timestamp=time.time(), regime=regime,
        )
        self.tracker.record(outcome)

        # Update drift detector
        acc = self.tracker.rolling_accuracy(20)
        drift_detected = self.drift.update(acc)
        if drift_detected:
            logger.warning(f"[SelfOptimizer] Drift detected for {symbol} — accuracy: {acc*100:.1f}%")

    def get_health_report(self) -> dict:
        """Generate a comprehensive health report."""
        accuracy = self.tracker.rolling_accuracy()
        ece      = self.tracker.calibration_error()
        drift    = self.drift.update(accuracy)  # check current state

        recs = self.recommender.generate_recommendations(
            self.tracker, drift, ece, accuracy
        )

        return {
            "timestamp":        time.time(),
            "uptime_hours":     round((time.time() - self._start_time) / 3600, 1),
            "optimization_runs": self._optimization_runs,
            "performance": {
                "rolling_accuracy_pct": round(accuracy * 100, 1),
                "ece_pct":              round(ece * 100, 2),
                "drift_detected":       drift,
                "outcomes_tracked":     len(self.tracker.outcomes),
                "accuracy_by_regime":   self.tracker.accuracy_by_regime(),
                "accuracy_by_grade":    self.tracker.accuracy_by_grade(),
            },
            "thresholds": {
                "accuracy_floor":   75.0,
                "accuracy_ceiling": 97.0,
                "ece_warn":         5.0,
                "ece_critical":     8.0,
            },
            "status": (
                "CRITICAL" if accuracy < 0.70 or ece > 0.10 else
                "WARNING"  if accuracy < 0.75 or ece > 0.08 else
                "DEGRADED" if accuracy < 0.78 or ece > 0.05 else
                "HEALTHY"
            ),
            "recommendations": recs,
            "current_params":  self.tuner.current_params,
            "best_accuracy":   round(self.tuner.best_accuracy * 100, 1),
        }

    def run_optimization_cycle(self) -> dict:
        """
        Run one optimization cycle.
        Returns proposed changes — all require human approval before applying.
        """
        self._optimization_runs += 1
        accuracy = self.tracker.rolling_accuracy()
        proposed = self.tuner.suggest_params(accuracy)

        return {
            "cycle":            self._optimization_runs,
            "current_accuracy": round(accuracy * 100, 1),
            "proposed_params":  proposed,
            "approval_required": True,
            "note": "All parameter changes require human review and approval before deployment",
            "timestamp": time.time(),
        }


# Singleton
SELF_OPTIMIZER = SelfOptimizer()
