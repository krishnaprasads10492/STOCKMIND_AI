"""
perception_engine.py — Layer II-A: Perception Engine
StockMind AGI Blueprint // JARVIS Mark-V

Ingestion, parsing, and vectorization of all market data streams.
Implements the Perception Engine from the Core AGI Architecture Blueprint.

Sources:
  - OHLCV (Yahoo Finance / internal)
  - SEC RSS alternative data feed
  - News sentiment vectors
  - Order book / volume anomaly signals
  - Social + macro context
"""

from __future__ import annotations
import time
import hashlib
import logging
from typing import Optional
from collections import deque

import numpy as np

logger = logging.getLogger("stockmind-ai.perception")


# ─────────────────────────────────────────────────────────────────────────────
# Vector Ledger — indexed market embeddings (Blueprint Layer III)
# ─────────────────────────────────────────────────────────────────────────────

class VectorLedger:
    """
    In-memory indexed vector store for market embeddings.
    Layer III: Vector Ledger (DB) — Indexed Market Embeddings.
    """

    def __init__(self, max_entries: int = 50_000):
        self.max_entries = max_entries
        self._keys: list      = []
        self._vectors: list   = []
        self._metadata: list  = []
        self._index: dict     = {}

    def insert(self, symbol: str, ts: float, vector: np.ndarray, meta: dict = None):
        if len(self._keys) >= self.max_entries:
            self._keys.pop(0); self._vectors.pop(0); self._metadata.pop(0)
            self._index = {}
            for i, (s, _) in enumerate(self._keys):
                self._index.setdefault(s, []).append(i)

        pos = len(self._keys)
        self._keys.append((symbol, ts))
        self._vectors.append(vector.astype(np.float32))
        self._metadata.append(meta or {})
        self._index.setdefault(symbol, []).append(pos)

    def query_similar(self, symbol: str, vector: np.ndarray, top_k: int = 5) -> list:
        positions = self._index.get(symbol, [])
        if not positions:
            return []
        candidates = np.array([self._vectors[p] for p in positions], dtype=np.float32)
        q = vector.astype(np.float32)
        norms = np.linalg.norm(candidates, axis=1) * np.linalg.norm(q) + 1e-9
        sims  = candidates @ q / norms
        top   = np.argsort(sims)[::-1][:top_k]
        return [
            {"symbol": symbol, "ts": self._keys[positions[i]][1],
             "sim": float(sims[i]), "meta": self._metadata[positions[i]]}
            for i in top
        ]

    def get_stats(self) -> dict:
        return {
            "total_vectors": len(self._keys),
            "symbols_indexed": len(self._index),
            "symbols": list(self._index.keys())[:20],
            "capacity_pct": round(len(self._keys) / self.max_entries * 100, 1),
        }


# ─────────────────────────────────────────────────────────────────────────────
# Episodic Memory — Context Window + Cache (Blueprint Layer III)
# ─────────────────────────────────────────────────────────────────────────────

class EpisodicMemory:
    """
    Episodic Memory Component — Context Window & Cache.
    Stores recent prediction episodes with full context for recall.
    Enables the AGI to reason over its own history.
    """

    MAX_EPISODES = 2000

    def __init__(self):
        self._episodes: deque = deque(maxlen=self.MAX_EPISODES)
        self._symbol_index: dict = {}   # symbol → list of episode indices
        self._outcome_log: list  = []

    def record_episode(self, symbol: str, features: np.ndarray,
                       signals: list, regime: str,
                       calloc: float, ps: float) -> str:
        episode_id = hashlib.sha256(
            f"{symbol}{time.time()}".encode()
        ).hexdigest()[:16]

        ep = {
            "id":        episode_id,
            "symbol":    symbol,
            "ts":        time.time(),
            "regime":    regime,
            "calloc":    calloc,
            "ps":        ps,
            "n_signals": len(signals),
            "top_prob":  max((s.get("probability", 0) for s in signals), default=0),
            "features_hash": hashlib.md5(features.tobytes()).hexdigest()[:8],
            "resolved":  False,
            "outcome":   None,
        }
        idx = len(self._episodes)
        self._episodes.append(ep)
        self._symbol_index.setdefault(symbol, []).append(idx)
        logger.debug("[EpisodicMemory] Recorded episode %s for %s", episode_id, symbol)
        return episode_id

    def resolve_episode(self, episode_id: str, was_correct: bool, pnl_pct: float = 0.0):
        for ep in self._episodes:
            if ep["id"] == episode_id:
                ep["resolved"] = True
                ep["outcome"]  = "hit" if was_correct else "miss"
                ep["pnl_pct"]  = pnl_pct
                ep["resolved_at"] = time.time()
                self._outcome_log.append({
                    "id": episode_id, "symbol": ep["symbol"],
                    "outcome": ep["outcome"], "pnl_pct": pnl_pct,
                })
                break

    def recall_similar(self, symbol: str, regime: str, n: int = 10) -> list:
        """Recall recent episodes for same symbol + regime."""
        results = []
        for ep in reversed(self._episodes):
            if ep["symbol"] == symbol and ep["regime"] == regime:
                results.append(ep)
            if len(results) >= n:
                break
        return results

    def get_hit_rate(self, symbol: str = None) -> float:
        resolved = [
            e for e in self._episodes
            if e["resolved"] and (symbol is None or e["symbol"] == symbol)
        ]
        if not resolved:
            return 0.0
        hits = sum(1 for e in resolved if e["outcome"] == "hit")
        return round(hits / len(resolved) * 100, 1)

    def get_stats(self) -> dict:
        resolved = [e for e in self._episodes if e["resolved"]]
        return {
            "total_episodes":    len(self._episodes),
            "resolved_episodes": len(resolved),
            "global_hit_rate":   self.get_hit_rate(),
            "recent_outcomes":   self._outcome_log[-10:],
        }


# ─────────────────────────────────────────────────────────────────────────────
# Perception Engine — Ingestion, Parsing & Vectorization (Blueprint Layer II-A)
# ─────────────────────────────────────────────────────────────────────────────

class PerceptionEngine:
    """
    Layer II-A: Perception Engine
    Handles ingestion parsing and vectorization of all incoming signals.

    Pipeline:
      raw_data → validate → normalize → vectorize → route to Reasoning Sandbox
    """

    def __init__(self):
        self.vector_ledger  = VectorLedger()
        self.episodic_memory = EpisodicMemory()
        self._ingestion_count = 0
        self._rejection_count = 0
        self._source_stats: dict = {}
        self._anomaly_buffer: deque = deque(maxlen=200)

    # ── Ingest raw OHLCV + context ────────────────────────────────────────────

    def ingest(self, symbol: str, ohlcv: list, context: dict = None) -> dict:
        """
        Primary ingestion point. Returns a parsed + vectorized signal packet.

        ohlcv: list of {time, open, high, low, close, volume}
        context: optional dict with sentiment, macro, news headlines
        """
        source = (context or {}).get("source", "unknown")
        self._ingestion_count += 1
        self._source_stats[source] = self._source_stats.get(source, 0) + 1

        if not ohlcv or len(ohlcv) < 10:
            self._rejection_count += 1
            return {"ok": False, "reason": "insufficient_ohlcv"}

        # ── Validate ──────────────────────────────────────────────────────────
        validated = self._validate_ohlcv(ohlcv)
        if not validated["ok"]:
            self._rejection_count += 1
            return validated

        bars = validated["bars"]

        # ── Compute base feature vector ────────────────────────────────────────
        vec = self._vectorize(bars)

        # ── Enrich with context ────────────────────────────────────────────────
        enriched = self._enrich(vec, symbol, context or {})

        # ── Store in vector ledger ─────────────────────────────────────────────
        ts = bars[-1].get("time", time.time())
        self.vector_ledger.insert(symbol, ts, enriched["vector"], {
            "regime": enriched.get("regime_hint", "unknown"),
            "source": source,
        })

        # ── Detect anomaly ─────────────────────────────────────────────────────
        similar = self.vector_ledger.query_similar(symbol, enriched["vector"], top_k=3)
        anomaly_score = self._compute_anomaly_score(enriched["vector"], similar)
        if anomaly_score > 0.7:
            self._anomaly_buffer.append({
                "symbol": symbol, "ts": ts,
                "score": anomaly_score, "source": source,
            })
            logger.warning("[Perception] Anomaly detected %s score=%.2f", symbol, anomaly_score)

        return {
            "ok":            True,
            "symbol":        symbol,
            "ts":            ts,
            "vector":        enriched["vector"],
            "regime_hint":   enriched.get("regime_hint", "unknown"),
            "volatility":    enriched.get("volatility", 0.0),
            "trend_strength":enriched.get("trend_strength", 0.0),
            "volume_spike":  enriched.get("volume_spike", False),
            "anomaly_score": anomaly_score,
            "similar_episodes": similar,
            "n_bars":        len(bars),
            "source":        source,
        }

    # ── Validate OHLCV ────────────────────────────────────────────────────────

    def _validate_ohlcv(self, ohlcv: list) -> dict:
        bars = []
        for bar in ohlcv:
            o = float(bar.get("open", 0) or 0)
            h = float(bar.get("high", 0) or 0)
            l = float(bar.get("low",  0) or 0)
            c = float(bar.get("close", 0) or 0)
            v = float(bar.get("volume", 0) or 0)
            if c <= 0 or h < l:
                continue
            # Fix OHLC consistency
            h = max(h, o, c)
            l = min(l, o, c)
            bars.append({"time": bar.get("time", 0), "open": o, "high": h,
                          "low": l, "close": c, "volume": v})
        if len(bars) < 10:
            return {"ok": False, "reason": "too_few_valid_bars", "bars": bars}
        return {"ok": True, "bars": bars}

    # ── Vectorize ─────────────────────────────────────────────────────────────

    def _vectorize(self, bars: list) -> np.ndarray:
        c = np.array([b["close"]  for b in bars], dtype=np.float64)
        v = np.array([b["volume"] for b in bars], dtype=np.float64)
        h = np.array([b["high"]   for b in bars], dtype=np.float64)
        l = np.array([b["low"]    for b in bars], dtype=np.float64)

        feats = []

        # Returns
        for lag in [1, 3, 5, 10, 20]:
            if len(c) > lag:
                feats.append(np.log(c[-1] / c[-lag-1] + 1e-9))
            else:
                feats.append(0.0)

        # Volatility (rolling std of returns)
        ret = np.diff(np.log(c + 1e-9))
        feats.append(float(ret[-20:].std()) if len(ret) >= 20 else 0.0)
        feats.append(float(ret[-5:].std())  if len(ret) >= 5  else 0.0)

        # Trend (position in N-day range)
        for w in [20, 50]:
            if len(c) >= w:
                lo, hi = c[-w:].min(), c[-w:].max()
                feats.append((c[-1] - lo) / (hi - lo + 1e-9))
            else:
                feats.append(0.5)

        # Volume ratio
        for w in [5, 20]:
            if len(v) >= w:
                feats.append(v[-1] / (v[-w:].mean() + 1e-9))
            else:
                feats.append(1.0)

        # ATR ratio
        atr = float(np.mean(h[-14:] - l[-14:])) if len(h) >= 14 else 0.0
        feats.append(atr / (c[-1] + 1e-9))

        # Candle body
        last_body = abs(bars[-1]["close"] - bars[-1]["open"])
        last_range = bars[-1]["high"] - bars[-1]["low"] + 1e-9
        feats.append(last_body / last_range)

        return np.array(feats, dtype=np.float32)

    # ── Enrich with context ───────────────────────────────────────────────────

    def _enrich(self, vec: np.ndarray, symbol: str, context: dict) -> dict:
        sentiment  = float(context.get("sentiment", 0.0))
        macro_bias = float(context.get("macro_bias", 0.0))

        enriched_vec = np.concatenate([vec, [sentiment, macro_bias]])

        # Derive regime hint from vector
        vol    = float(vec[5]) if len(vec) > 5 else 0.0
        trend  = float(vec[7]) if len(vec) > 7 else 0.5
        vol_sp = float(vec[10]) if len(vec) > 10 else 1.0

        if vol > 0.025:
            regime = "volatile"
        elif trend > 0.75:
            regime = "trending_bull"
        elif trend < 0.25:
            regime = "trending_bear"
        else:
            regime = "ranging"

        return {
            "vector":        enriched_vec,
            "regime_hint":   regime,
            "volatility":    round(vol, 4),
            "trend_strength":round(abs(trend - 0.5) * 2, 3),
            "volume_spike":  vol_sp > 1.8,
        }

    # ── Anomaly score ─────────────────────────────────────────────────────────

    def _compute_anomaly_score(self, vec: np.ndarray, similar: list) -> float:
        if not similar:
            return 0.2  # novel — mildly anomalous
        avg_sim = np.mean([s["sim"] for s in similar])
        # Low similarity to past patterns = anomalous
        return float(np.clip(1.0 - avg_sim, 0.0, 1.0))

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "ingestion_count":  self._ingestion_count,
            "rejection_count":  self._rejection_count,
            "source_stats":     self._source_stats,
            "recent_anomalies": list(self._anomaly_buffer)[-5:],
            "vector_ledger":    self.vector_ledger.get_stats(),
            "episodic_memory":  self.episodic_memory.get_stats(),
        }


# Module-level singleton
_perception = PerceptionEngine()

def get_perception_engine() -> PerceptionEngine:
    return _perception
