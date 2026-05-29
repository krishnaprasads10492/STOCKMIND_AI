"""
dynamic_router.py — Dynamic Infrastructure Orchestrator (DIO)
Blueprint Section III: Command & Governance Panel

Routes AI inference requests to optimal compute tier:
  - Evaluates cost/performance indexes
  - Routes baseline to free local Ollama clusters
  - Triggers premium hardware execution on anomaly spikes
  - Enforces daily token/cost budgets
  - Tracks provider health and auto-failover
"""

import os
import time
import logging
import yaml
from pathlib import Path
from typing import Optional
from collections import deque

logger = logging.getLogger("stockmind-ai.dynamic-router")

# ── Load routing manifest ─────────────────────────────────────────────────────

_MANIFEST_PATH = Path(__file__).parent.parent / "config" / "ai_routing_manifest.yaml"

def _load_manifest() -> dict:
    try:
        with open(_MANIFEST_PATH, "r") as f:
            return yaml.safe_load(f)
    except Exception as e:
        logger.warning(f"[DIO] Could not load manifest: {e} — using defaults")
        return {}

MANIFEST = _load_manifest()


class DynamicInfraOrchestrator:
    """
    DIO: Routes requests to optimal AI provider based on:
    - Task complexity (intraday / daily / strategic)
    - Current volatility (triggers cloud burst)
    - Budget remaining
    - Provider health/availability
    """

    def __init__(self):
        self._manifest       = MANIFEST
        self._token_usage    = {"today": 0, "total": 0, "by_provider": {}}
        self._cost_today     = 0.0
        self._provider_health: dict = {}
        self._request_log: deque = deque(maxlen=500)
        self._day_start      = time.time()
        self._budget_alert   = False

        # Daily reset
        self._daily_limit    = self._manifest.get("budget_controls", {}).get("daily_token_limit", 500_000)
        self._cost_limit     = self._manifest.get("budget_controls", {}).get("daily_cost_limit_usd", 5.0)

        logger.info("[DIO] Dynamic Infrastructure Orchestrator online")

    def _reset_if_new_day(self):
        if time.time() - self._day_start > 86400:
            self._token_usage["today"] = 0
            self._cost_today = 0.0
            self._day_start  = time.time()
            self._budget_alert = False
            logger.info("[DIO] Daily budget reset")

    def select_provider(self, task_type: str = "daily_weekly",
                        volatility: float = 0.3,
                        force_tier: str = None) -> dict:
        """
        Select the optimal provider for a task.
        Returns provider config dict.
        """
        self._reset_if_new_day()

        # Force tier override
        if force_tier:
            return self._get_provider_config(force_tier)

        # Budget check — downgrade if near limit
        budget_pct = self._token_usage["today"] / max(self._daily_limit, 1)
        if budget_pct > 0.95:
            logger.warning("[DIO] Budget 95% used — forcing local engine")
            return self._get_provider_config("local_engine")

        # Volatility-based routing
        if volatility > 0.75:
            # Cloud burst — use fast cloud
            return self._get_provider_config("cloud_fast_groq")

        # Task-based routing
        rules = self._manifest.get("routing_rules", {})
        rule  = rules.get(task_type, rules.get("default", {}))
        primary = rule.get("primary", "local_engine")

        # Check provider health
        if self._is_healthy(primary):
            return self._get_provider_config(primary)

        # Fallback chain
        chain = rule.get("chain", ["local_engine"])
        for provider_id in chain:
            if self._is_healthy(provider_id):
                return self._get_provider_config(provider_id)

        return self._get_provider_config("local_engine")

    def _get_provider_config(self, provider_id: str) -> dict:
        providers = self._manifest.get("model_providers", {})
        cfg = providers.get(provider_id, {})
        if not cfg:
            return {"provider": "ollama", "base_url": "http://localhost:11434",
                    "default_model": "llama3.2", "provider_id": "local_engine"}
        return {**cfg, "provider_id": provider_id}

    def _is_healthy(self, provider_id: str) -> bool:
        health = self._provider_health.get(provider_id, {})
        if not health:
            return True  # assume healthy if no data
        # Unhealthy if last 3 requests failed
        recent = health.get("recent_failures", 0)
        return recent < 3

    def record_usage(self, provider_id: str, tokens: int, cost_usd: float,
                     success: bool):
        """Record token usage and cost for budget tracking."""
        self._token_usage["today"]  += tokens
        self._token_usage["total"]  += tokens
        self._cost_today            += cost_usd

        if provider_id not in self._token_usage["by_provider"]:
            self._token_usage["by_provider"][provider_id] = 0
        self._token_usage["by_provider"][provider_id] += tokens

        # Update provider health
        if provider_id not in self._provider_health:
            self._provider_health[provider_id] = {"recent_failures": 0, "total_requests": 0}
        self._provider_health[provider_id]["total_requests"] += 1
        if not success:
            self._provider_health[provider_id]["recent_failures"] += 1
        else:
            self._provider_health[provider_id]["recent_failures"] = max(
                0, self._provider_health[provider_id]["recent_failures"] - 1
            )

        # Budget alert
        budget_pct = self._token_usage["today"] / max(self._daily_limit, 1)
        alert_threshold = self._manifest.get("budget_controls", {}).get("alert_threshold_pct", 80) / 100
        if budget_pct > alert_threshold and not self._budget_alert:
            self._budget_alert = True
            logger.warning(f"[DIO] ⚠ Budget alert: {budget_pct*100:.0f}% of daily limit used")

        self._request_log.append({
            "ts": time.time(), "provider": provider_id,
            "tokens": tokens, "cost": cost_usd, "success": success,
        })

    def get_status(self) -> dict:
        self._reset_if_new_day()
        return {
            "tokens_today":    self._token_usage["today"],
            "tokens_total":    self._token_usage["total"],
            "cost_today_usd":  round(self._cost_today, 4),
            "budget_pct":      round(self._token_usage["today"] / max(self._daily_limit, 1) * 100, 1),
            "budget_alert":    self._budget_alert,
            "provider_health": self._provider_health,
            "by_provider":     self._token_usage["by_provider"],
            "daily_limit":     self._daily_limit,
            "cost_limit_usd":  self._cost_limit,
        }


# Singleton
DIO = DynamicInfraOrchestrator()
