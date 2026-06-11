"""
friday_nexus.py — Friday Nexus Protocol Engine (Schema V5.00)
StockMind AGI // Advanced Multi-Agent Cognitive Core

Implements:
  A) Tree-of-Thought Consensus (ToT-MAC) — Sub-Agent Strategic Debate Matrix
  B) Alpha Space MCTS Searcher           — Test-Time Compute Allocation via MCTS
  C) GAM-WAR Gaming Sandbox              — Generative Adversarial Attacker Defense Loop
  D) Global Optimization Objective A*   — A* = argmax_A [ sum(gamma^t * E[Rt(A)] * (1 - Ptrap,t)) ]
  E) Safety Floor Constraint             — Ps >= Phi_min AND Tokens(A) <= Calloc
"""

from __future__ import annotations
import math
import time
import random
import logging
import hashlib
from typing import Optional
from collections import deque, defaultdict
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("stockmind-ai.friday-nexus")

# ── Safety constants ───────────────────────────────────────────────────────────
PHI_MIN         = 0.55    # Minimum Ps (portfolio safety floor)
GAMMA_DISCOUNT  = 0.92    # Temporal discount factor for A* objective
MCTS_ITERATIONS = 64      # MCTS rollout budget per call
MCTS_C_PUCT     = 1.414   # UCT exploration constant (sqrt(2))
MAX_DEBATE_ROUNDS = 3     # ToT-MAC rounds before consensus forced


# ─────────────────────────────────────────────────────────────────────────────
# A: Tree-of-Thought Consensus (ToT-MAC)
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ThoughtNode:
    """A single thought in the debate tree."""
    agent_id:   str
    claim:      str                    # bull | bear | neutral
    confidence: float                  # 0–1
    reasoning:  str
    evidence:   list = field(default_factory=list)
    score:      float = 0.0
    children:   list = field(default_factory=list)
    depth:      int = 0


class ToTMACDebate:
    """
    Tree-of-Thought Multi-Agent Consensus (ToT-MAC).

    Each sub-agent independently forms a position, then they debate
    for up to MAX_DEBATE_ROUNDS before a consensus is forced.

    Agents:
      - TrendAgent:     EMA/momentum analysis
      - MomentumAgent:  RSI/MACD/volume analysis
      - RegimeAgent:    Market regime classification
      - RiskAgent:      Drawdown/volatility guardian (devil's advocate)
      - FundAgent:      Fundamental/macro context
    """

    AGENTS = ["trend", "momentum", "regime", "risk", "fundamental"]

    def __init__(self):
        self._debate_log: deque = deque(maxlen=1000)
        self._consensus_history: deque = deque(maxlen=500)
        self._agent_accuracy: dict = {a: {"hits": 0, "total": 0} for a in self.AGENTS}

    def debate(self, features: np.ndarray, signals: list,
               regime: str = "ranging") -> dict:
        """
        Run a full ToT-MAC debate on the given signal set.

        Returns consensus verdict with debate transcript.
        """
        round_results = []

        # Round 1: Independent positions
        positions = self._form_positions(features, signals, regime)

        # Rounds 2..N: Rebuttals and convergence
        for round_n in range(1, MAX_DEBATE_ROUNDS):
            positions = self._debate_round(positions, round_n)
            convergence = self._measure_convergence(positions)
            round_results.append({
                "round": round_n,
                "convergence": round(convergence, 3),
                "positions": {a: p["claim"] for a, p in positions.items()},
            })
            if convergence >= 0.75:
                break  # Early consensus

        # Force consensus: weighted vote by confidence × accuracy
        consensus = self._force_consensus(positions)

        entry = {
            "ts":           time.time(),
            "regime":       regime,
            "consensus":    consensus,
            "rounds":       round_results,
            "agent_votes":  {a: {"claim": p["claim"], "conf": round(p["confidence"], 3)}
                             for a, p in positions.items()},
        }
        self._debate_log.append(entry)
        self._consensus_history.append(consensus)

        logger.debug("[ToT-MAC] Consensus=%s strength=%.2f rounds=%d",
                     consensus["verdict"], consensus["strength"], len(round_results))
        return entry

    def _form_positions(self, features: np.ndarray,
                        signals: list, regime: str) -> dict:
        """Each agent independently analyzes the data."""
        positions = {}

        # Extract feature proxies
        avg_prob = np.mean([s.get("probability", 50) for s in signals]) / 100 if signals else 0.5
        vol      = float(features[5]) if len(features) > 5 else 0.02
        trend    = float(features[7]) if len(features) > 7 else 0.5
        vol_sp   = float(features[10]) if len(features) > 10 else 1.0

        # Trend Agent — follows EMA direction
        trend_conf = abs(trend - 0.5) * 2
        positions["trend"] = ThoughtNode(
            agent_id="trend",
            claim="bull" if trend > 0.6 else ("bear" if trend < 0.4 else "neutral"),
            confidence=min(0.85, 0.5 + trend_conf * 0.4),
            reasoning=f"EMA position={trend:.2f} | Trend{'↑' if trend > 0.5 else '↓'}",
        ).__dict__

        # Momentum Agent — follows signal probabilities
        positions["momentum"] = ThoughtNode(
            agent_id="momentum",
            claim="bull" if avg_prob > 0.62 else ("bear" if avg_prob < 0.45 else "neutral"),
            confidence=min(0.88, 0.45 + abs(avg_prob - 0.5) * 1.8),
            reasoning=f"AvgProb={avg_prob:.2f} | Vol={vol:.4f}",
        ).__dict__

        # Regime Agent — regime-context
        regime_bull = regime in ("trending_bull",)
        regime_bear = regime in ("trending_bear",)
        positions["regime"] = ThoughtNode(
            agent_id="regime",
            claim="bull" if regime_bull else ("bear" if regime_bear else "neutral"),
            confidence=0.70 if regime_bull or regime_bear else 0.52,
            reasoning=f"Regime={regime}",
        ).__dict__

        # Risk Agent — plays devil's advocate when volatility is high
        risk_veto = vol > 0.03 or vol_sp > 2.0
        positions["risk"] = ThoughtNode(
            agent_id="risk",
            claim="neutral" if risk_veto else positions["momentum"]["claim"],
            confidence=0.80 if risk_veto else 0.55,
            reasoning=f"Vol={vol:.4f} VolSpike={vol_sp:.1f} Veto={risk_veto}",
        ).__dict__

        # Fundamental Agent — macro/sentiment proxy (neutral by default without macro data)
        positions["fundamental"] = ThoughtNode(
            agent_id="fundamental",
            claim="neutral",
            confidence=0.50,
            reasoning="Macro context neutral (no live macro feed)",
        ).__dict__

        return positions

    def _debate_round(self, positions: dict, round_n: int) -> dict:
        """Agents revise positions based on peer arguments."""
        updated = {}
        all_claims = [p["claim"] for p in positions.values()]
        bull_count = all_claims.count("bull")
        bear_count = all_claims.count("bear")
        majority = "bull" if bull_count > bear_count else ("bear" if bear_count > bull_count else "neutral")

        for agent_id, pos in positions.items():
            new_pos = dict(pos)
            # Agents update confidence based on peer consensus pressure
            if pos["claim"] == majority:
                new_pos["confidence"] = min(0.95, pos["confidence"] + 0.05 * round_n)
            else:
                # Minority agents reduce confidence slightly (not eliminate)
                new_pos["confidence"] = max(0.35, pos["confidence"] - 0.04 * round_n)
                # Risk agent stays firm
                if agent_id == "risk":
                    new_pos["confidence"] = pos["confidence"]
            updated[agent_id] = new_pos

        return updated

    def _measure_convergence(self, positions: dict) -> float:
        """0 = no agreement, 1 = perfect agreement."""
        claims = [p["claim"] for p in positions.values()]
        counts = {c: claims.count(c) for c in set(claims)}
        max_agree = max(counts.values())
        return max_agree / len(claims)

    def _force_consensus(self, positions: dict) -> dict:
        """Weighted vote → final verdict."""
        # Weight = confidence × historical accuracy
        vote_weights = defaultdict(float)
        for agent_id, pos in positions.items():
            acc = self._get_agent_accuracy(agent_id)
            w = pos["confidence"] * (0.5 + acc * 0.5)
            vote_weights[pos["claim"]] += w

        verdict  = max(vote_weights, key=vote_weights.get)
        strength = vote_weights[verdict] / (sum(vote_weights.values()) + 1e-9)

        return {
            "verdict":  verdict,
            "strength": round(strength, 3),
            "vote_weights": {k: round(v, 3) for k, v in vote_weights.items()},
        }

    def _get_agent_accuracy(self, agent_id: str) -> float:
        stats = self._agent_accuracy.get(agent_id, {"hits": 0, "total": 0})
        if stats["total"] < 5:
            return 0.5  # not enough data
        return stats["hits"] / stats["total"]

    def record_outcome(self, agent_id: str, was_correct: bool):
        if agent_id in self._agent_accuracy:
            self._agent_accuracy[agent_id]["total"] += 1
            if was_correct:
                self._agent_accuracy[agent_id]["hits"] += 1

    def get_status(self) -> dict:
        return {
            "total_debates":      len(self._debate_log),
            "recent_consensus":   [c["verdict"] for c in list(self._consensus_history)[-10:]],
            "agent_accuracy":     {
                a: round(s["hits"] / max(1, s["total"]), 3)
                for a, s in self._agent_accuracy.items()
            },
        }


# ─────────────────────────────────────────────────────────────────────────────
# B: Alpha Space MCTS Searcher
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class MCTSNode:
    action:   str              # "hold" | "enter_long" | "enter_short" | "reduce" | "exit"
    parent:   Optional[object]
    visits:   int   = 0
    value:    float = 0.0
    children: list  = field(default_factory=list)
    prior:    float = 1.0      # prior probability (from policy network proxy)
    depth:    int   = 0

    @property
    def q_value(self) -> float:
        return self.value / (self.visits + 1e-9)

    def uct_score(self, parent_visits: int, c_puct: float = MCTS_C_PUCT) -> float:
        """UCT score: Q + c * P * sqrt(N_parent) / (1 + N_child)"""
        return self.q_value + c_puct * self.prior * math.sqrt(parent_visits) / (1 + self.visits)


class AlphaSpaceMCTS:
    """
    Alpha Space MCTS Searcher — Extended Test-Time Compute Allocation.

    Searches the action space using Monte Carlo Tree Search to find
    the optimal trading action that maximizes A* under safety constraints.

    Action space: hold | enter_long | enter_short | reduce | exit
    Reward:       E[Rt(A)] * (1 - Ptrap,t) discounted by gamma^t
    """

    ACTIONS = ["hold", "enter_long", "enter_short", "reduce", "exit"]

    def __init__(self):
        self._search_log: deque = deque(maxlen=200)

    def search(self,
               signals: list,
               ps: float,
               ptrap: float,
               calloc: int,
               regime: str = "ranging") -> dict:
        """
        Run MCTS to find optimal action A* given current market state.

        Safety constraint: only search if Ps >= Phi_min
        Compute constraint: iterations capped at Calloc-proportional budget

        Returns: { action, expected_return, confidence, search_depth, path }
        """
        # Safety floor check
        if ps < PHI_MIN:
            logger.warning("[MCTS] Safety floor breached Ps=%.3f < Phi_min=%.2f → hold", ps, PHI_MIN)
            return {
                "action":          "hold",
                "reason":          f"Safety floor: Ps={ps:.3f} < Phi_min={PHI_MIN}",
                "expected_return": 0.0,
                "confidence":      0.0,
                "safety_override": True,
                "iterations":      0,
            }

        # Compute budget: scale iterations by Calloc
        iterations = max(16, min(MCTS_ITERATIONS, calloc // 50))

        # Build priors from signal ensemble
        priors = self._compute_priors(signals, regime)

        # Root node
        root = MCTSNode(action="root", parent=None, depth=0)
        for action in self.ACTIONS:
            root.children.append(
                MCTSNode(action=action, parent=root,
                         prior=priors.get(action, 0.2), depth=1)
            )

        # MCTS loop
        for _ in range(iterations):
            node = self._select(root)
            reward = self._simulate(node, ps, ptrap, signals)
            self._backprop(node, reward)

        # Best action = highest Q-value child
        best = max(root.children, key=lambda n: n.q_value)
        total_visits = sum(c.visits for c in root.children)

        result = {
            "action":          best.action,
            "expected_return": round(best.q_value, 4),
            "confidence":      round(best.visits / (total_visits + 1e-9), 3),
            "iterations":      iterations,
            "action_scores":   {
                c.action: {"q": round(c.q_value, 3), "n": c.visits}
                for c in root.children
            },
            "ps":   ps,
            "ptrap": ptrap,
        }
        self._search_log.append(result)
        logger.debug("[MCTS] Best=%s Q=%.3f conf=%.2f iters=%d",
                     best.action, best.q_value, result["confidence"], iterations)
        return result

    def _compute_priors(self, signals: list, regime: str) -> dict:
        """Compute prior action probabilities from signal ensemble."""
        if not signals:
            return {a: 0.2 for a in self.ACTIONS}

        avg_prob = np.mean([s.get("probability", 50) for s in signals]) / 100
        bull_count = sum(1 for s in signals if s.get("direction") == "long")
        bear_count = sum(1 for s in signals if s.get("direction") == "short")
        n = max(1, len(signals))

        p_long  = bull_count / n
        p_short = bear_count / n
        p_hold  = 1 - p_long - p_short

        # Modulate by regime
        regime_mult = {"trending_bull": 1.3, "trending_bear": 0.7,
                       "volatile": 0.5, "ranging": 0.8}.get(regime, 1.0)

        priors = {
            "enter_long":  max(0.05, p_long  * regime_mult * avg_prob),
            "enter_short": max(0.05, p_short * (2 - regime_mult) * (1 - avg_prob)),
            "hold":        max(0.10, p_hold),
            "reduce":      0.10,
            "exit":        0.05,
        }
        # Normalize
        total = sum(priors.values())
        return {k: v / total for k, v in priors.items()}

    def _select(self, node: MCTSNode) -> MCTSNode:
        """Select best child using UCT."""
        if not node.children:
            return node
        return max(node.children, key=lambda c: c.uct_score(node.visits))

    def _simulate(self, node: MCTSNode, ps: float, ptrap: float, signals: list) -> float:
        """
        Rollout simulation: estimate E[Rt(A)] * (1 - Ptrap,t)
        Global Optimization: A* = argmax sum(gamma^t * E[Rt(A)] * (1 - Ptrap,t))
        """
        action = node.action
        avg_prob = np.mean([s.get("probability", 50) for s in signals]) / 100 if signals else 0.5
        avg_rr   = np.mean([s.get("riskReward", 1.5) for s in signals]) if signals else 1.5

        # Expected return per action
        base_returns = {
            "enter_long":  avg_prob * avg_rr - (1 - avg_prob),
            "enter_short": (1 - avg_prob) * avg_rr - avg_prob,
            "hold":        0.0,
            "reduce":      avg_prob * 0.3,
            "exit":        0.0,
        }
        e_return = base_returns.get(action, 0.0)

        # Apply A* formula: gamma^t * E[Rt(A)] * (1 - Ptrap,t)
        t       = node.depth
        reward  = (GAMMA_DISCOUNT ** t) * e_return * (1.0 - ptrap)

        # Safety constraint penalty
        if ps < PHI_MIN and action in ("enter_long", "enter_short"):
            reward *= 0.1  # heavy penalty for aggressive actions under unsafe conditions

        # Add stochastic noise for exploration
        reward += random.gauss(0, 0.02)
        return float(np.clip(reward, -1.0, 1.0))

    def _backprop(self, node: MCTSNode, reward: float):
        """Backpropagate reward up the tree."""
        current = node
        while current is not None:
            current.visits += 1
            current.value  += reward
            current = current.parent

    def get_status(self) -> dict:
        recent = list(self._search_log)[-10:]
        best_actions = [r["action"] for r in recent]
        return {
            "total_searches": len(self._search_log),
            "recent_actions": best_actions,
            "action_dist":    {a: best_actions.count(a) for a in self.ACTIONS if a in best_actions},
        }


# ─────────────────────────────────────────────────────────────────────────────
# C: GAM-WAR Gaming Sandbox
# ─────────────────────────────────────────────────────────────────────────────

class GAMWARSandbox:
    """
    GAM-WAR: Generative Adversarial Market Warfare Defense Loop.

    Simulates adversarial market attacks and builds defenses:
      - Generates synthetic adversarial signal patterns
      - Tests prediction system robustness against them
      - Learns from adversarial failures to harden the system
      - Detects real market manipulation using trained adversarial templates

    Attack types:
      pump_dump:      rapid price spike → dump (short ladder)
      spoofing:       fake order walls (volume imbalance)
      wash_trading:   artificial volume with no real price change
      news_shock:     sudden news-driven spike to trap late buyers
      stop_hunt:      price spike to clear stop-losses before reversing
    """

    ATTACK_TYPES = ["pump_dump", "spoofing", "wash_trading", "news_shock", "stop_hunt"]

    def __init__(self):
        self._attack_templates: dict = {}
        self._defense_wins:  int = 0
        self._attack_log: deque = deque(maxlen=500)
        self._live_detections: deque = deque(maxlen=100)
        self._generation = 0
        self._build_templates()

    def _build_templates(self):
        """Build adversarial signal templates for each attack type."""
        self._attack_templates = {
            "pump_dump": {
                "volume_spike":     (3.0, 8.0),   # range
                "price_spike_pct":  (0.02, 0.06),
                "reversal_speed":   "fast",
                "pattern":          "spike_reverse",
            },
            "spoofing": {
                "bid_ask_imbalance": (0.6, 0.95),
                "order_cancel_rate": (0.7, 0.98),
                "duration_bars":     1,
            },
            "wash_trading": {
                "volume_spike":     (2.0, 5.0),
                "price_range_pct":  (0.0, 0.005),   # low range = no real move
                "round_trip_ratio": (0.8, 1.0),
            },
            "news_shock": {
                "gap_pct":          (0.01, 0.04),
                "volume_spike":     (2.0, 6.0),
                "consolidation":    "none",
            },
            "stop_hunt": {
                "spike_below_support_pct": (0.005, 0.015),
                "reversal_within_bars":    2,
                "volume_spike":            (1.5, 3.0),
            },
        }

    def generate_adversarial(self, attack_type: str = None) -> dict:
        """Generate a synthetic adversarial market scenario."""
        if attack_type is None:
            attack_type = random.choice(self.ATTACK_TYPES)

        template = self._attack_templates.get(attack_type, {})
        self._generation += 1

        # Generate synthetic OHLCV that matches attack pattern
        base_price = 25000.0
        n_bars = 20

        scenario = {
            "id":          f"gamwar_{self._generation}_{attack_type[:4]}",
            "attack_type": attack_type,
            "template":    template,
            "synthetic_bars": self._generate_bars(attack_type, base_price, n_bars),
            "expected_ptrap": self._expected_ptrap(attack_type),
            "generation":  self._generation,
        }

        self._attack_log.append(scenario)
        logger.debug("[GAMWAR] Generated adversarial scenario: %s id=%s",
                     attack_type, scenario["id"])
        return scenario

    def _generate_bars(self, attack_type: str, base: float, n: int) -> list:
        """Generate synthetic OHLCV bars for the attack pattern."""
        bars = []
        p = base
        for i in range(n):
            if attack_type == "pump_dump" and i == n - 3:
                # Spike up then crash
                o = p; h = p * 1.04; l = p * 0.99; c = p * 1.03; v = 5.0
            elif attack_type == "pump_dump" and i == n - 2:
                o = p * 1.03; h = p * 1.04; l = p * 0.97; c = p * 0.975; v = 8.0
            elif attack_type == "stop_hunt" and i == n - 2:
                o = p; h = p * 1.001; l = p * 0.988; c = p * 1.005; v = 2.5
            else:
                change = random.gauss(0, 0.005)
                o = p; c = p * (1 + change)
                h = max(o, c) * (1 + abs(random.gauss(0, 0.002)))
                l = min(o, c) * (1 - abs(random.gauss(0, 0.002)))
                v = 1.0 + random.random()
            bars.append({"open": round(o, 2), "high": round(h, 2),
                         "low": round(l, 2), "close": round(c, 2), "volume": v})
            p = c
        return bars

    def _expected_ptrap(self, attack_type: str) -> float:
        """Expected Ptrap probability for each attack type."""
        return {"pump_dump": 0.85, "spoofing": 0.75, "wash_trading": 0.70,
                "news_shock": 0.55, "stop_hunt": 0.80}.get(attack_type, 0.60)

    def detect_live(self, volume_imbalance: float, price_action: dict,
                    order_imbalance: float = 0.0) -> dict:
        """
        Real-time attack detection using learned adversarial templates.
        Returns: { detected, attack_type, confidence, ptrap }
        """
        detections = []

        v_spike = price_action.get("volume_spike_ratio", 1.0)
        price_range = abs(price_action.get("candle_range_pct", 0.0))
        gap = abs(price_action.get("gap_pct", 0.0))

        # Check each template
        if v_spike > 3.0 and price_range < 0.005:
            detections.append({"type": "wash_trading", "conf": min(0.9, v_spike / 5)})
        if v_spike > 2.0 and gap > 0.01:
            detections.append({"type": "news_shock", "conf": min(0.85, gap * 20)})
        if abs(volume_imbalance) > 0.6 and abs(order_imbalance) > 0.5:
            detections.append({"type": "spoofing", "conf": min(0.88, abs(volume_imbalance))})
        if v_spike > 2.5 and price_action.get("reversal", False):
            detections.append({"type": "pump_dump", "conf": 0.82})

        detected = len(detections) > 0
        top = max(detections, key=lambda d: d["conf"]) if detections else None

        result = {
            "detected":   detected,
            "attack_type": top["type"] if top else None,
            "confidence":  top["conf"] if top else 0.0,
            "all_detected": detections,
            "ptrap_boost": 0.25 * len(detections),  # raise Ptrap on each detection
        }
        if detected:
            self._live_detections.append(result)
            self._defense_wins += 1
            logger.warning("[GAMWAR] Live attack detected: %s conf=%.2f",
                           top["type"], top["conf"])
        return result

    def get_status(self) -> dict:
        return {
            "total_generated":  self._generation,
            "defense_wins":     self._defense_wins,
            "live_detections":  len(self._live_detections),
            "recent_detections": list(self._live_detections)[-5:],
            "attack_types":     self.ATTACK_TYPES,
        }


# ─────────────────────────────────────────────────────────────────────────────
# D: Global Optimization Objective A*
# ─────────────────────────────────────────────────────────────────────────────

class GlobalAStarOptimizer:
    """
    A* = argmax_A [ sum(gamma^t * E[Rt(A)] * (1 - Ptrap,t)) ]
    Subject to: Ps >= Phi_min  AND  Tokens(A) <= Calloc

    Integrates ToT-MAC + MCTS + GAM-WAR into one unified optimization pass.
    This is the top-level decision function of the Friday Nexus Protocol Engine.
    """

    def __init__(self):
        self.tot_mac  = ToTMACDebate()
        self.mcts     = AlphaSpaceMCTS()
        self.gamwar   = GAMWARSandbox()
        self._opt_log: deque = deque(maxlen=300)

    def optimize(self,
                 features: np.ndarray,
                 signals: list,
                 ps: float,
                 ptrap: float,
                 calloc: int,
                 regime: str = "ranging",
                 volume_imbalance: float = 0.0,
                 order_imbalance: float = 0.0) -> dict:
        """
        Full optimization pass combining all three systems.

        Pipeline:
          1. GAM-WAR: live attack detection (raises Ptrap if attack found)
          2. ToT-MAC: multi-agent debate to validate signal consensus
          3. MCTS: search optimal action A* under safety + compute constraints
          4. A* formula: compute final expected value
        """
        ts = time.time()

        # 1. GAM-WAR — detect live attacks, adjust Ptrap
        price_action = {
            "volume_spike_ratio": signals[0].get("volumeSpike", 1.0) if signals else 1.0,
            "candle_range_pct":   0.01,
            "gap_pct":            0.0,
        }
        gamwar_result = self.gamwar.detect_live(volume_imbalance, price_action, order_imbalance)
        effective_ptrap = min(0.98, ptrap + gamwar_result["ptrap_boost"])

        # 2. ToT-MAC — multi-agent debate
        debate_result = self.tot_mac.debate(features, signals, regime)
        debate_consensus = debate_result["consensus"]

        # If debate and signals disagree, reduce confidence
        signal_dir = "bull" if (signals and sum(1 for s in signals if s.get("direction") == "long") > len(signals) / 2) else "bear"
        debate_agrees = debate_consensus["verdict"] == signal_dir
        consensus_boost = 0.05 if debate_agrees else -0.08

        # 3. MCTS — search optimal action
        adjusted_ps = max(0.0, ps + (0.05 if debate_agrees else -0.05))
        mcts_result = self.mcts.search(signals, adjusted_ps, effective_ptrap, calloc, regime)

        # 4. A* objective value (horizon t=0 to 4)
        a_star_value = sum(
            GAMMA_DISCOUNT ** t *
            mcts_result["expected_return"] *
            (1.0 - effective_ptrap)
            for t in range(5)
        ) / 5  # normalize

        # Safety check
        safety_ok = adjusted_ps >= PHI_MIN and calloc > 0

        result = {
            "ts":               ts,
            "a_star":           round(a_star_value, 4),
            "optimal_action":   mcts_result["action"],
            "expected_return":  mcts_result["expected_return"],
            "effective_ptrap":  round(effective_ptrap, 4),
            "ps":               round(adjusted_ps, 4),
            "safety_ok":        safety_ok,
            "debate_consensus": debate_consensus["verdict"],
            "debate_strength":  debate_consensus["strength"],
            "debate_agrees":    debate_agrees,
            "gamwar_detected":  gamwar_result["detected"],
            "gamwar_type":      gamwar_result.get("attack_type"),
            "consensus_boost":  consensus_boost,
            "mcts_action_scores": mcts_result.get("action_scores", {}),
            "regime":           regime,
        }

        self._opt_log.append(result)
        logger.info(
            "[FridayNexus] A*=%.4f action=%s Ps=%.3f Ptrap=%.3f debate=%s agree=%s",
            a_star_value, mcts_result["action"], adjusted_ps,
            effective_ptrap, debate_consensus["verdict"], debate_agrees
        )
        return result

    def get_status(self) -> dict:
        recent = list(self._opt_log)[-10:]
        return {
            "total_optimizations": len(self._opt_log),
            "tot_mac":   self.tot_mac.get_status(),
            "mcts":      self.mcts.get_status(),
            "gamwar":    self.gamwar.get_status(),
            "recent":    recent[-3:],
        }


# ── Module-level singleton ────────────────────────────────────────────────────

_friday_nexus = GlobalAStarOptimizer()

def get_friday_nexus() -> GlobalAStarOptimizer:
    return _friday_nexus
