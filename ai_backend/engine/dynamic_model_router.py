"""
dynamic_model_router.py — Dynamic Infrastructure Orchestrator (DIO)

From the JARVIS-X blueprint:
  "Evaluates cost/performance indexes. Routes baseline requests to free local
   Ollama clusters or triggers premium hardware execution blocks dynamically."

Routing logic:
  INTRADAY (4h)    → Groq/Llama (free, 150ms) → Ollama fallback
  DAILY/WEEKLY     → DeepSeek (cheap, math-optimized) → Groq fallback
  STRATEGIC MACRO  → Claude 3.5 Sonnet (high-context) → GPT-4o fallback
  ANOMALY SPIKE    → Groq (fastest) → escalate to Claude if complex
  VISION/CHART     → GPT-4o Vision → Claude Vision fallback

Budget tracking:
  - Daily token cap per provider
  - Auto-fallback when budget exceeded
  - Cost/performance scoring per task type
"""

import os
import time
import yaml
import logging
from typing import Optional
from pathlib import Path
from collections import defaultdict

logger = logging.getLogger("stockmind-ai.dio")

# ── Load routing manifest ─────────────────────────────────────────────────────

_MANIFEST_PATH = Path(__file__).parent.parent / "config" / "ai_routing_manifest.yaml"

def _load_manifest() -> dict:
    try:
        with open(_MANIFEST_PATH, 'r') as f:
            return yaml.safe_load(f)
    except Exception as e:
        logger.warning(f"[DIO] Could not load manifest: {e} — using defaults")
        return {}

_MANIFEST = _load_manifest()


# ── Task complexity classifier ────────────────────────────────────────────────

class TaskComplexityClassifier:
    """
    Classifies a prediction/analysis task by complexity to route to the
    appropriate model tier.
    """

    COMPLEXITY_SIGNALS = {
        'HIGH': [
            'sec_filing', 'annual_report', 'central_bank', 'macro_strategy',
            'long_term', 'multi_year', 'strategic', 'portfolio_allocation',
            'systemic', 'secular_rotation', 'complex_reasoning',
        ],
        'MEDIUM': [
            'daily', 'weekly', 'swing', 'fundamental', 'earnings',
            'sector_rotation', 'corporate_sentiment', 'structured_sequence',
        ],
        'LOW': [
            'intraday', 'scalp', 'momentum', 'breakout', 'sentiment',
            'news', 'social', 'quick', 'real_time', 'flash',
        ],
    }

    def classify(self, task: dict) -> str:
        """Returns 'HIGH' | 'MEDIUM' | 'LOW'"""
        text = ' '.join([
            str(task.get('horizon', '')),
            str(task.get('task_type', '')),
            str(task.get('description', '')),
            str(task.get('data_type', '')),
        ]).lower()

        for level in ['HIGH', 'MEDIUM', 'LOW']:
            if any(sig in text for sig in self.COMPLEXITY_SIGNALS[level]):
                return level

        # Default based on horizon
        horizon = task.get('horizon', '1d')
        if horizon in ('1mo', '3mo', '1y', 'strategic'):
            return 'HIGH'
        if horizon in ('1d', '1w'):
            return 'MEDIUM'
        return 'LOW'


# ── Budget tracker ────────────────────────────────────────────────────────────

class BudgetTracker:
    """
    Tracks daily token usage per provider.
    Enforces caps from the routing manifest.
    """

    def __init__(self):
        self._usage: dict[str, int] = defaultdict(int)
        self._day_key = self._today()
        self._caps = {
            'openai':    _MANIFEST.get('budget', {}).get('premium_model_daily_cap', 10000),
            'anthropic': _MANIFEST.get('budget', {}).get('premium_model_daily_cap', 10000),
            'deepseek':  _MANIFEST.get('budget', {}).get('daily_token_cap', 100000),
            'groq':      999_999_999,  # free tier — no cap
            'ollama':    999_999_999,  # local — no cap
            'gemini':    50000,
        }

    def _today(self) -> str:
        return time.strftime('%Y-%m-%d')

    def _reset_if_new_day(self):
        today = self._today()
        if today != self._day_key:
            self._usage.clear()
            self._day_key = today

    def record(self, provider: str, tokens: int):
        self._reset_if_new_day()
        self._usage[provider] += tokens

    def is_over_budget(self, provider: str) -> bool:
        self._reset_if_new_day()
        cap = self._caps.get(provider, 100000)
        return self._usage.get(provider, 0) >= cap

    def remaining(self, provider: str) -> int:
        self._reset_if_new_day()
        cap = self._caps.get(provider, 100000)
        return max(0, cap - self._usage.get(provider, 0))

    def get_stats(self) -> dict:
        self._reset_if_new_day()
        return {
            'date':  self._day_key,
            'usage': dict(self._usage),
            'caps':  dict(self._caps),
            'remaining': {p: self.remaining(p) for p in self._caps},
        }


# ── Dynamic Infrastructure Orchestrator ──────────────────────────────────────

class DynamicInfrastructureOrchestrator:
    """
    The DIO — routes every AI task to the optimal model based on:
    1. Task complexity (HIGH/MEDIUM/LOW)
    2. Current budget remaining per provider
    3. Provider availability (API key configured)
    4. Latency requirements
    5. Cost/performance score

    Priority matrix (from blueprint):
      Intraday  → Local Ollama (free) → Groq (free, fast) → DeepSeek
      Daily     → DeepSeek (math) → Groq → Ollama
      Strategic → Claude 3.5 Sonnet → GPT-4o → DeepSeek
      Anomaly   → Groq (fastest) → escalate if needed
    """

    # Provider priority per complexity tier
    ROUTING_TABLE = {
        'LOW': [
            ('groq',      'llama-3.3-70b-versatile', 0.0,    150),
            ('ollama',    None,                       0.0,    200),
            ('deepseek',  'deepseek-chat',            0.00014, 800),
            ('gemini',    'gemini-1.5-flash',         0.00015, 1000),
        ],
        'MEDIUM': [
            ('deepseek',  'deepseek-chat',            0.00014, 800),
            ('groq',      'llama-3.3-70b-versatile',  0.0,    150),
            ('gemini',    'gemini-1.5-flash',          0.00015, 1000),
            ('openai',    'gpt-4o-mini',               0.00015, 1500),
        ],
        'HIGH': [
            ('anthropic', 'claude-3-5-sonnet-20241022', 0.003, 2000),
            ('openai',    'gpt-4o',                     0.005, 3000),
            ('deepseek',  'deepseek-chat',               0.00014, 800),
            ('groq',      'llama-3.3-70b-versatile',     0.0,    150),
        ],
        'VISION': [
            ('openai',    'gpt-4o',                     0.005, 3000),
            ('anthropic', 'claude-3-5-sonnet-20241022', 0.003, 2000),
            ('gemini',    'gemini-1.5-flash',            0.00015, 1000),
        ],
    }

    def __init__(self):
        self.classifier = TaskComplexityClassifier()
        self.budget     = BudgetTracker()
        self._route_log: list = []
        self._total_routed = 0
        self._cost_saved   = 0.0

    def _is_available(self, provider: str) -> bool:
        """Check if a provider has an API key configured."""
        key_map = {
            'openai':    os.environ.get('OPENAI_API_KEY', ''),
            'anthropic': os.environ.get('ANTHROPIC_API_KEY', ''),
            'groq':      os.environ.get('GROQ_API_KEY', ''),
            'deepseek':  os.environ.get('DEEPSEEK_API_KEY', ''),
            'gemini':    os.environ.get('GEMINI_API_KEY', '') or os.environ.get('GOOGLE_API_KEY', ''),
            'ollama':    'local',  # always available if running
        }
        return bool(key_map.get(provider, ''))

    def route(self, task: dict) -> dict:
        """
        Route a task to the optimal provider.
        Returns: { provider, model, complexity, cost_per_1k, latency_ms, reason }
        """
        self._total_routed += 1

        # Vision tasks get special routing
        is_vision = task.get('has_image') or task.get('task_type') == 'vision'
        tier = 'VISION' if is_vision else self.classifier.classify(task)

        candidates = self.ROUTING_TABLE.get(tier, self.ROUTING_TABLE['LOW'])
        selected   = None
        reason     = ''

        for provider, model, cost, latency in candidates:
            if not self._is_available(provider):
                continue
            if self.budget.is_over_budget(provider):
                logger.info(f"[DIO] {provider} over budget — skipping")
                continue
            selected = (provider, model, cost, latency)
            reason   = f"Tier={tier}, cost=${cost}/1k, latency={latency}ms"
            break

        if not selected:
            # Ultimate fallback — Ollama local
            selected = ('ollama', os.environ.get('OLLAMA_DEFAULT_MODEL', 'llama3.2'), 0.0, 500)
            reason   = 'All cloud providers unavailable — using local Ollama'

        provider, model, cost, latency = selected

        # Track cost savings vs always using premium
        premium_cost = 0.005  # GPT-4o rate
        self._cost_saved += (premium_cost - cost) * 1000  # per 1k tokens saved

        route_entry = {
            'provider':      provider,
            'model':         model or os.environ.get(f'{provider.upper()}_DEFAULT_MODEL', 'default'),
            'complexity':    tier,
            'cost_per_1k':   cost,
            'latency_ms':    latency,
            'reason':        reason,
            'ts':            time.time(),
        }
        self._route_log.append(route_entry)
        if len(self._route_log) > 200:
            self._route_log = self._route_log[-200:]

        logger.info(f"[DIO] Routed to {provider}/{model} — {reason}")
        return route_entry

    def record_usage(self, provider: str, tokens_used: int):
        """Record actual token usage after a call."""
        self.budget.record(provider, tokens_used)

    def get_status(self) -> dict:
        return {
            'total_routed':    self._total_routed,
            'cost_saved_usd':  round(self._cost_saved, 4),
            'budget':          self.budget.get_stats(),
            'recent_routes':   self._route_log[-5:],
            'routing_table':   {tier: [(p, m) for p, m, _, _ in routes]
                                for tier, routes in self.ROUTING_TABLE.items()},
        }


# Singleton
DIO = DynamicInfrastructureOrchestrator()
