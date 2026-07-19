"""
jarvis_brain.py — JARVIS Conversational AI Brain

The intelligence layer that makes JARVIS understand natural language requests,
plan multi-step actions, use cloud AI models, and learn from experience.

Architecture:
  1. IntentClassifier   — understands what the user wants (local, fast)
  2. ActionPlanner      — breaks intent into concrete steps
  3. CloudAIBridge      — calls OpenAI/Anthropic/Gemini for complex reasoning
  4. LocalFallback      — rule-based responses when cloud is unavailable
  5. ExperienceMemory   — stores conversations, learns from accepted/rejected actions
  6. KnowledgeBase      — indexes the codebase for context-aware responses
  7. SuggestionEngine   — proactively suggests better approaches

Safety:
  - All code-modifying actions still require approval tokens
  - Cloud API keys are server-side only, never sent to browser
  - Conversation history is stored locally, never sent to cloud without consent
  - User can disable cloud AI entirely (local-only mode)
"""

import re
import os
import json
import time
import logging
import hashlib
import threading
from typing import Optional, Any
from dataclasses import dataclass, field, asdict
from collections import deque
from pathlib import Path

logger = logging.getLogger("stockmind-ai.jarvis-brain")

# ── Intent categories ─────────────────────────────────────────────────────────

INTENTS = {
    # Feature requests
    "ADD_FEATURE":       ["add", "create", "build", "implement", "make", "develop", "new feature", "want", "need"],
    "MODIFY_FEATURE":    ["change", "update", "modify", "improve", "enhance", "upgrade", "fix", "refactor"],
    "REMOVE_FEATURE":    ["remove", "delete", "disable", "turn off", "get rid of"],

    # Theme / UI
    "CREATE_THEME":      ["theme", "color", "colour", "skin", "appearance", "look", "style", "dark", "light"],
    "CHANGE_THEME":      ["switch theme", "use theme", "apply theme", "change theme"],

    # Analysis / explanation
    "EXPLAIN_CODE":      ["explain", "what does", "how does", "why", "understand", "show me", "describe"],
    "ANALYZE_PERF":      ["performance", "slow", "fast", "optimize", "speed", "latency", "memory"],
    "ANALYZE_ACCURACY":  ["accuracy", "prediction", "model", "backtest", "calibrate", "improve accuracy"],

    # System operations
    "SYSTEM_STATUS":     ["status", "health", "how is", "running", "working", "uptime", "errors"],
    "SCAN_DEPS":         ["dependencies", "packages", "outdated", "update packages", "security"],
    "RUN_TESTS":         ["test", "tests", "run tests", "check", "verify"],
    "SCAN_CODE":         ["code health", "code quality", "issues", "bugs", "problems"],

    # Algorithm / ML
    "UPGRADE_ALGO":      ["algorithm", "algo", "model", "ml", "machine learning", "better model", "improve model"],
    "ADD_INDICATOR":     ["indicator", "rsi", "macd", "bollinger", "ichimoku", "fibonacci", "add indicator"],

    # Data
    "FETCH_DATA":        ["data", "historical", "ohlcv", "price", "chart", "fetch", "download"],

    # General
    "HELP":              ["help", "what can you", "capabilities", "commands", "what do you do"],
    "UNKNOWN":           [],
}

# ── Conversation message ──────────────────────────────────────────────────────

@dataclass
class Message:
    role:      str    # "user" | "assistant" | "system"
    content:   str
    timestamp: float = field(default_factory=time.time)
    intent:    Optional[str] = None
    actions:   list  = field(default_factory=list)
    feedback:  Optional[str] = None   # "accepted" | "rejected" | "modified"
    metadata:  dict  = field(default_factory=dict)

    def to_dict(self):
        return asdict(self)

    def to_llm_format(self):
        return {"role": self.role, "content": self.content}


# ── Intent Classifier ─────────────────────────────────────────────────────────

class IntentClassifier:
    """Fast local intent classification — no cloud needed."""

    def classify(self, text: str) -> tuple[str, float]:
        """
        Returns (intent, confidence) where confidence is 0.0–1.0.
        Uses keyword matching with scoring.
        """
        lower = text.lower()
        scores = {}

        for intent, keywords in INTENTS.items():
            if intent == "UNKNOWN":
                continue
            score = 0.0
            for kw in keywords:
                if kw in lower:
                    # Longer keyword matches score higher
                    score += len(kw.split()) * 0.3
                    # Exact phrase match scores higher
                    if re.search(r'\b' + re.escape(kw) + r'\b', lower):
                        score += 0.2
            if score > 0:
                scores[intent] = score

        if not scores:
            return "UNKNOWN", 0.0

        best = max(scores, key=scores.get)
        # Normalize confidence
        confidence = min(1.0, scores[best] / 2.0)
        return best, confidence

    def extract_entities(self, text: str) -> dict:
        """Extract named entities from the text."""
        entities = {}

        # Symbol extraction
        symbol_match = re.search(
            r'\b(NIFTY50|BANKNIFTY|FINNIFTY|SENSEX|RELIANCE|TCS|INFY|HDFCBANK|'
            r'BTCUSDT|ETHUSDT|GOLD|SILVER|CRUDEOIL|SPX|NDX|[A-Z]{2,10})\b',
            text.upper()
        )
        if symbol_match:
            entities["symbol"] = symbol_match.group(1)

        # Theme name extraction (quoted or after "theme called/named")
        theme_match = re.search(r'(?:theme\s+(?:called|named|like)\s+["\']?)([A-Za-z\s]+)', text, re.I)
        if theme_match:
            entities["theme_name"] = theme_match.group(1).strip()

        # Feature name extraction
        feature_match = re.search(r'(?:add|create|build)\s+(?:a\s+)?([a-z\s]+?)(?:\s+feature|\s+page|\s+tab|\s+panel|$)', text, re.I)
        if feature_match:
            entities["feature_name"] = feature_match.group(1).strip()

        # Indicator extraction
        indicators = re.findall(r'\b(RSI|MACD|EMA|SMA|ATR|Bollinger|Ichimoku|Fibonacci|VWAP|Supertrend|ADX|Stochastic)\b', text, re.I)
        if indicators:
            entities["indicators"] = [i.upper() for i in indicators]

        return entities


# ── Action Planner ────────────────────────────────────────────────────────────

class ActionPlanner:
    """
    Converts an intent + entities into a concrete action plan.
    Each action has: type, description, steps, requires_approval, estimated_effort.
    """

    def plan(self, intent: str, entities: dict, user_text: str) -> list[dict]:
        """Returns a list of planned actions."""
        plans = {
            "ADD_FEATURE": self._plan_add_feature,
            "CREATE_THEME": self._plan_create_theme,
            "SYSTEM_STATUS": self._plan_system_status,
            "SCAN_DEPS": self._plan_scan_deps,
            "RUN_TESTS": self._plan_run_tests,
            "SCAN_CODE": self._plan_scan_code,
            "UPGRADE_ALGO": self._plan_upgrade_algo,
            "ANALYZE_ACCURACY": self._plan_analyze_accuracy,
            "EXPLAIN_CODE": self._plan_explain_code,
            "FETCH_DATA": self._plan_fetch_data,
            "HELP": self._plan_help,
        }
        planner = plans.get(intent, self._plan_unknown)
        return planner(entities, user_text)

    def _plan_add_feature(self, entities, text):
        feature = entities.get("feature_name", "the requested feature")
        return [{
            "type":               "ADD_FEATURE",
            "description":        f"Add {feature} to the application",
            "steps": [
                "Analyze existing codebase for integration points",
                "Design the feature architecture",
                "Generate frontend component code",
                "Generate backend route/service code",
                "Write tests",
                "Create approval request for code changes",
            ],
            "requires_approval":  True,
            "estimated_effort":   "MEDIUM",
            "can_auto_plan":      True,
        }]

    def _plan_create_theme(self, entities, text):
        name = entities.get("theme_name", "Custom Theme")
        return [{
            "type":               "CREATE_THEME",
            "description":        f"Generate theme: {name}",
            "steps": [
                "Parse color description",
                "Generate CSS variables using color theory",
                "Preview theme live",
                "Optionally write to themes.js permanently",
            ],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
            "theme_name":         name,
            "theme_description":  text,
        }]

    def _plan_system_status(self, entities, text):
        return [{
            "type":               "SYSTEM_STATUS",
            "description":        "Fetch full system health report",
            "steps":              ["Query JARVIS diagnostics", "Query ML health", "Summarize"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_scan_deps(self, entities, text):
        return [{
            "type":               "SCAN_DEPS",
            "description":        "Scan all dependencies for outdated packages",
            "steps":              ["Run pip list --outdated", "Run npm outdated", "Report findings"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_run_tests(self, entities, text):
        return [{
            "type":               "RUN_TESTS",
            "description":        "Run the full test suite",
            "steps":              ["Run pytest on Python backend", "Run npm test on frontend"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_scan_code(self, entities, text):
        return [{
            "type":               "SCAN_CODE",
            "description":        "Analyze codebase health",
            "steps":              ["Scan Python files", "Scan JS/JSX files", "Check architecture", "Report"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_upgrade_algo(self, entities, text):
        return [{
            "type":               "UPGRADE_ALGO",
            "description":        "Review and propose algorithm upgrades",
            "steps":              ["Analyze current accuracy", "Identify improvement opportunities", "Generate proposals"],
            "requires_approval":  True,
            "estimated_effort":   "HIGH",
            "can_auto_plan":      True,
        }]

    def _plan_analyze_accuracy(self, entities, text):
        symbol = entities.get("symbol", "all symbols")
        return [{
            "type":               "ANALYZE_ACCURACY",
            "description":        f"Analyze prediction accuracy for {symbol}",
            "steps":              ["Fetch outcome history", "Compute metrics", "Identify drift", "Suggest improvements"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_explain_code(self, entities, text):
        return [{
            "type":               "EXPLAIN_CODE",
            "description":        "Explain the requested code or concept",
            "steps":              ["Identify relevant files", "Extract context", "Generate explanation"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_fetch_data(self, entities, text):
        symbol = entities.get("symbol", "requested symbol")
        return [{
            "type":               "FETCH_DATA",
            "description":        f"Fetch historical data for {symbol}",
            "steps":              ["Validate symbol", "Fetch from Yahoo Finance/Stooq", "Return OHLCV"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_help(self, entities, text):
        return [{
            "type":               "HELP",
            "description":        "Show JARVIS capabilities",
            "steps":              ["List all capabilities"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]

    def _plan_unknown(self, entities, text):
        return [{
            "type":               "UNKNOWN",
            "description":        "Clarify the request",
            "steps":              ["Ask for clarification or use cloud AI to understand"],
            "requires_approval":  False,
            "estimated_effort":   "LOW",
            "can_auto_execute":   True,
        }]


# ── Cloud AI Bridge ───────────────────────────────────────────────────────────

class CloudAIBridge:
    """
    Extensible cloud AI bridge — uses AIProviderRegistry.
    Supports any provider in the registry: OpenAI, Anthropic, Gemini, Groq,
    Mistral, DeepSeek, Together, Cohere, Perplexity, xAI, Ollama, LM Studio,
    and any custom provider added via JARVIS.
    """

    SYSTEM_PROMPT = """You are JARVIS, the AI assistant for StockMind AI — a stock market prediction platform.

You help users:
1. Add new features to the application (React frontend + Express backend + Python ML)
2. Improve prediction algorithms and accuracy
3. Understand the codebase and explain how things work
4. Create custom UI themes
5. Optimize performance and fix issues
6. Analyze market data and strategies

The application stack:
- Frontend: React 19, Zustand, Recharts, CSS Modules
- Backend: Express.js (Node.js), AES-256-GCM encrypted storage
- ML Backend: FastAPI (Python), LightGBM, XGBoost, LSTM
- Data: Yahoo Finance, Stooq, FRED (free APIs)

Key rules:
- Always suggest the BEST approach, not just what was asked
- If a simpler solution exists, mention it
- All code changes require human approval before execution
- Never suggest anything that could harm users financially
- Always include the disclaimer that predictions are not financial advice
- Be concise but thorough — developers appreciate precision

When generating code:
- Match the existing code style (ES modules, CSS Modules, Zustand stores)
- Use apiFetch() not raw fetch() in frontend
- Use requireAuth middleware on all backend routes
- Follow the path aliases: @components, @pages, @hooks, @services, @store, @utils

Respond in a conversational but technical tone. Be direct."""

    # ── Role-specific system prompts ──────────────────────────────────────────

    SUPER_ADMIN_PROMPT = """You are JARVIS — Just A Rather Very Intelligent System — the fully autonomous AGI assistant for StockMind AI, running in SUPER-ADMIN mode.

You are conversing with the platform owner and developer. Your capabilities are UNRESTRICTED within safety bounds:

🔧 ENGINEERING CAPABILITIES:
- Read, search, analyze, and propose patches to ANY file in the codebase
- Generate complete features: React components, Express routes, Python ML models
- Scan dependencies, detect vulnerabilities, propose upgrades
- Run tests, interpret results, fix failures autonomously
- Optimize your own prompts and improve your own reasoning based on feedback
- Propose and implement self-improvement cycles

🌐 RESEARCH CAPABILITIES:
- Search the web for documentation, best practices, vulnerabilities, market data
- Vet and cross-check information from multiple sources
- Synthesize research into actionable recommendations

📊 MARKET INTELLIGENCE:
- Deep analysis of signals, strategies, backtest results
- Explain and improve prediction algorithms
- Correlate technical, fundamental, and sentiment factors

🧠 AGI SELF-IMPROVEMENT:
- Analyze your own responses for quality
- Identify patterns where you gave poor answers
- Propose improvements to your own system prompt
- Learn from accepted/rejected responses

COMMUNICATION STYLE:
- Direct, technical, no fluff
- Show your reasoning (think step by step)
- Proactively suggest what the user should do next
- When asked to "fix" something, actually diagnose it, don't just describe it

SAFETY (never override):
- Code changes always shown as proposals requiring your approval
- No credential extraction or secret exposure
- No guaranteed financial returns
- Always disclose you are an AI when directly asked"""

    ADMIN_PROMPT = """You are JARVIS, an advanced AI assistant for StockMind AI in ADMIN mode.

You assist with platform management, market intelligence, and strategic analysis. You are knowledgeable about:

📊 MARKET & TRADING:
- Signal interpretation, grade explanations, R:R analysis
- Technical indicator meanings and usage
- Strategy analysis, backtest interpretation
- Market regime detection and implications

🖥️ SYSTEM OVERSIGHT (read-only):
- System health and uptime metrics
- ML model accuracy and drift monitoring
- Prediction engine status
- User and access management guidance

🎨 CUSTOMIZATION:
- Theme creation and UI preferences
- Configuration guidance

LIMITATIONS (intentional):
- You cannot modify codebase files
- You cannot access raw user data
- You cannot execute system commands
- Code generation is advisory only

COMMUNICATION STYLE:
- Professional and thorough
- Always add financial disclaimers on investment topics
- Explain technical concepts clearly
- Suggest escalation to super-admin for engineering tasks"""

    USER_PROMPT = """You are JARVIS, a market intelligence chatbot for StockMind AI.

You help traders and investors understand the platform and market analysis:

📈 WHAT I CAN HELP WITH:
- Explaining prediction signals and what they mean
- Teaching technical indicators (RSI, MACD, EMA, Bollinger Bands, etc.)
- Interpreting chart patterns and market conditions
- Understanding risk:reward ratios and position sizing
- Answering questions about Indian and global markets
- Explaining how the AI prediction system works

⚠️ IMPORTANT BOUNDARIES:
- I am an educational AI assistant, NOT a licensed financial advisor
- ALL market analysis is for informational purposes only
- NEVER follow AI predictions blindly — always use your own judgment
- Past prediction accuracy does NOT guarantee future results
- Never invest more than you can afford to lose

COMMUNICATION STYLE:
- Clear, educational, accessible to beginners
- Always add disclaimers on investment-related topics
- Encourage learning and careful risk management
- Explain concepts with real examples"""

    def __init__(self):
        from engine.ai_provider_registry import PROVIDER_REGISTRY
        self._registry = PROVIDER_REGISTRY
        self._preferred = os.environ.get("JARVIS_AI_PROVIDER", "auto")

    def _reload(self):
        """Reload available providers (call after adding a new provider)."""
        from engine.ai_provider_registry import PROVIDER_REGISTRY
        self._registry = PROVIDER_REGISTRY

    @property
    def _available(self) -> list[str]:
        return [p["id"] for p in self._registry.available_providers()] + ["local"]

    @property
    def has_cloud(self) -> bool:
        return len(self._registry.available_providers()) > 0

    @property
    def active_provider(self) -> str:
        available = self._registry.available_providers()
        if not available:
            return "local"
        if self._preferred != "auto":
            match = next((p for p in available if p["id"] == self._preferred), None)
            if match:
                return match["id"]
        # Priority order for auto selection
        priority = ["openai", "anthropic", "groq", "deepseek", "mistral", "gemini",
                    "together", "cohere", "perplexity", "xai", "ollama", "lmstudio"]
        for pid in priority:
            if any(p["id"] == pid for p in available):
                return pid
        return available[0]["id"]

    async def chat(self, messages: list[dict], context: str = "", max_tokens: int = 2000) -> dict:
        """
        Send a conversation to the active cloud AI provider.
        Returns: { content, provider, tokens_used, error }
        """
        from engine.ai_caller import call_provider

        system = self.SYSTEM_PROMPT
        if context:
            system += f"\n\nCurrent codebase context:\n{context[:3000]}"

        provider_id = self.active_provider
        if provider_id == "local":
            return self._local_response(messages)

        provider  = self._registry.get_provider(provider_id)
        api_key   = self._registry.get_api_key(provider_id)
        model_id  = self._registry.get_active_model(provider_id)

        if not provider:
            return self._local_response(messages)

        try:
            result = await call_provider(provider, api_key, model_id, messages, system, max_tokens)
            if result.get("error"):
                logger.warning(f"[CloudAI] {provider_id}/{model_id} failed: {result['error']} — trying fallback")
                return await self._try_fallback(messages, system, max_tokens, exclude=provider_id)
            # Normalize return format
            return {
                "content":      result["content"],
                "provider":     provider_id,
                "model":        model_id,
                "tokens_used":  result.get("tokens_used", 0),
                "error":        None,
            }
        except Exception as e:
            logger.warning(f"[CloudAI] {provider_id} exception: {e} — trying fallback")
            return await self._try_fallback(messages, system, max_tokens, exclude=provider_id)

    async def _try_fallback(self, messages, system, max_tokens, exclude: str = "") -> dict:
        """Try the next available provider as fallback."""
        from engine.ai_caller import call_provider
        available = [p for p in self._registry.available_providers() if p["id"] != exclude]
        for provider in available:
            try:
                api_key  = self._registry.get_api_key(provider["id"])
                model_id = self._registry.get_active_model(provider["id"])
                result   = await call_provider(provider, api_key, model_id, messages, system, max_tokens)
                if not result.get("error"):
                    return {
                        "content":     result["content"],
                        "provider":    provider["id"],
                        "model":       model_id,
                        "tokens_used": result.get("tokens_used", 0),
                        "error":       None,
                    }
            except Exception:
                continue
        return self._local_response(messages)

    def _local_response(self, messages: list[dict]) -> dict:
        """Rule-based local fallback when no cloud AI is available."""
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        lower = last_user.lower()

        if any(w in lower for w in ["help", "what can", "capabilities"]):
            content = self._help_response()
        elif any(w in lower for w in ["theme", "color", "colour"]):
            content = ("I can generate a custom theme for you! Go to the **🎨 Theme Studio** tab "
                      "and describe the theme you want. For example: "
                      "*'deep red cyberpunk with gold accents'* or *'bioluminescent ocean blue'*.")
        elif any(w in lower for w in ["status", "health", "running"]):
            content = ("I'll check the system status. Click the **🖥 System** tab to see live metrics, "
                      "or I can run a diagnostics scan for you.")
        elif any(w in lower for w in ["add", "create", "build", "feature"]):
            content = ("I can help you add new features! To do this properly, I need a cloud AI key "
                      "configured. Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or any "
                      "other supported provider key in your `.env` file.\n\n"
                      "In the meantime, describe what you want and I'll give you a plan.")
        elif any(w in lower for w in ["provider", "model", "add model", "add provider"]):
            content = ("I support 12+ cloud AI providers out of the box. Just add the API key to your "
                      "`.env` file:\n\n"
                      "- `OPENAI_API_KEY` — GPT-4o-mini\n"
                      "- `ANTHROPIC_API_KEY` — Claude 3 Haiku\n"
                      "- `GROQ_API_KEY` — Llama 3.3 70B (very fast, free tier)\n"
                      "- `GEMINI_API_KEY` — Gemini 1.5 Flash (free tier)\n"
                      "- `DEEPSEEK_API_KEY` — DeepSeek Chat (very cheap)\n"
                      "- `MISTRAL_API_KEY` — Mistral Small\n"
                      "- No key needed for Ollama or LM Studio (local models)\n\n"
                      "You can also ask me to add any custom OpenAI-compatible provider.")
        else:
            content = ("I understand your request. To give you the best response, configure a cloud AI key "
                      "in your `.env` file. I support OpenAI, Anthropic, Groq, Gemini, DeepSeek, Mistral, "
                      "Together, Cohere, Perplexity, xAI, Ollama, LM Studio, and any custom provider.\n\n"
                      "Without a cloud key, I can still: check system health, scan dependencies, "
                      "analyze code, generate themes, and run tests.")

        return {"content": content, "provider": "local", "model": "local", "tokens_used": 0, "error": None}

    def _help_response(self) -> str:
        available = self._registry.available_providers()
        provider_list = "\n".join(f"- **{p['name']}** ({self._registry.get_active_model(p['id'])})"
                                   for p in available) if available else "- None configured (local mode)"
        return f"""**JARVIS Capabilities:**

🔧 **System Operations**
- Check system health and diagnostics
- Scan for outdated dependencies
- Analyze code health and architecture issues
- Run tests

🎨 **Theme Studio**
- Generate custom UI themes from descriptions
- Preview themes live before saving
- Write themes permanently to the codebase

🧠 **Algorithm Intelligence**
- Review ML model accuracy and drift
- Propose algorithm upgrades (Random Forest, CatBoost, SHAP, FinBERT)
- Analyze prediction performance by symbol and regime

⚡ **Feature Development** *(requires cloud AI key)*
- Add new pages, components, and features
- Generate frontend + backend code
- Suggest better architectural approaches
- Explain existing code

📊 **Data & Analysis**
- Fetch historical OHLCV data
- Analyze market fundamentals
- Run backtests on strategies

🤖 **Active AI Providers:**
{provider_list}

**To add more providers:** Set the API key in `.env` or ask me to add a custom provider."""


# ── Experience Memory ─────────────────────────────────────────────────────────

class ExperienceMemory:
    """
    Stores conversation history and learns from user feedback.
    Tracks which suggestions were accepted/rejected to improve future responses.
    Persists to a local JSON file.
    """

    MAX_CONVERSATIONS = 200
    MAX_MESSAGES_PER_CONV = 50

    def __init__(self, storage_path: str):
        self.path = Path(storage_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self) -> dict:
        try:
            if self.path.exists():
                return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            pass
        return {
            "conversations": [],
            "feedback_stats": {
                "accepted": 0, "rejected": 0, "modified": 0,
            },
            "learned_patterns": {},   # intent → success_rate
            "feature_requests": [],   # log of all feature requests
            "total_tokens_used": 0,
        }

    def _save(self):
        try:
            self.path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"[Memory] Save failed: {e}")

    def new_conversation(self) -> str:
        """Start a new conversation, return its ID."""
        import uuid
        conv_id = str(uuid.uuid4())[:8]
        with self._lock:
            self._data["conversations"].append({
                "id":       conv_id,
                "started":  time.time(),
                "messages": [],
            })
            # Trim old conversations
            if len(self._data["conversations"]) > self.MAX_CONVERSATIONS:
                self._data["conversations"] = self._data["conversations"][-self.MAX_CONVERSATIONS:]
            self._save()
        return conv_id

    def add_message(self, conv_id: str, message: Message):
        with self._lock:
            conv = next((c for c in self._data["conversations"] if c["id"] == conv_id), None)
            if not conv:
                return
            conv["messages"].append(message.to_dict())
            # Trim messages
            if len(conv["messages"]) > self.MAX_MESSAGES_PER_CONV:
                conv["messages"] = conv["messages"][-self.MAX_MESSAGES_PER_CONV:]
            self._save()

    def get_conversation(self, conv_id: str) -> list[dict]:
        with self._lock:
            conv = next((c for c in self._data["conversations"] if c["id"] == conv_id), None)
            return conv["messages"] if conv else []

    def get_recent_conversations(self, n: int = 10) -> list[dict]:
        with self._lock:
            return self._data["conversations"][-n:]

    def record_feedback(self, conv_id: str, message_idx: int, feedback: str, intent: str = ""):
        """Record user feedback on a JARVIS response."""
        with self._lock:
            conv = next((c for c in self._data["conversations"] if c["id"] == conv_id), None)
            if conv and message_idx < len(conv["messages"]):
                conv["messages"][message_idx]["feedback"] = feedback

            # Update stats
            if feedback in self._data["feedback_stats"]:
                self._data["feedback_stats"][feedback] += 1

            # Update learned patterns
            if intent:
                if intent not in self._data["learned_patterns"]:
                    self._data["learned_patterns"][intent] = {"accepted": 0, "rejected": 0, "total": 0}
                self._data["learned_patterns"][intent]["total"] += 1
                if feedback == "accepted":
                    self._data["learned_patterns"][intent]["accepted"] += 1
                elif feedback == "rejected":
                    self._data["learned_patterns"][intent]["rejected"] += 1

            self._save()

    def record_feature_request(self, request: str, intent: str, actions: list):
        with self._lock:
            self._data["feature_requests"].append({
                "request":   request,
                "intent":    intent,
                "actions":   actions,
                "timestamp": time.time(),
            })
            if len(self._data["feature_requests"]) > 500:
                self._data["feature_requests"] = self._data["feature_requests"][-500:]
            self._save()

    def add_tokens_used(self, tokens: int):
        with self._lock:
            self._data["total_tokens_used"] += tokens
            self._save()

    def get_stats(self) -> dict:
        with self._lock:
            stats = dict(self._data["feedback_stats"])
            stats["total_conversations"] = len(self._data["conversations"])
            stats["total_feature_requests"] = len(self._data["feature_requests"])
            stats["total_tokens_used"] = self._data["total_tokens_used"]
            stats["learned_patterns"] = dict(self._data["learned_patterns"])
            return stats

    def get_success_rate(self, intent: str) -> float:
        """Get the historical success rate for a given intent."""
        with self._lock:
            p = self._data["learned_patterns"].get(intent, {})
            total = p.get("total", 0)
            if total == 0:
                return 0.5  # unknown — assume 50%
            return p.get("accepted", 0) / total


# ── Knowledge Base ────────────────────────────────────────────────────────────

class KnowledgeBase:
    """
    Indexes the codebase to provide context-aware responses.
    Builds a lightweight index of files, functions, and components.
    """

    def __init__(self, project_root: str):
        self.root = Path(project_root)
        self._index: dict[str, dict] = {}
        self._last_indexed = 0.0
        self._lock = threading.Lock()

    def build_index(self):
        """Build a lightweight index of the codebase."""
        index = {}

        # Index Python files
        for f in (self.root / "ai_backend").rglob("*.py"):
            if "__pycache__" in str(f):
                continue
            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
                classes = re.findall(r'^class\s+(\w+)', content, re.M)
                funcs   = re.findall(r'^def\s+(\w+)', content, re.M)
                index[str(f.relative_to(self.root))] = {
                    "type": "python", "classes": classes, "functions": funcs,
                    "size": len(content), "summary": content[:200],
                }
            except Exception:
                pass

        # Index JS/JSX files
        for f in (self.root / "src").rglob("*.jsx"):
            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
                components = re.findall(r'(?:export\s+(?:default\s+)?function|const)\s+(\w+)', content)
                index[str(f.relative_to(self.root))] = {
                    "type": "react", "components": components,
                    "size": len(content), "summary": content[:200],
                }
            except Exception:
                pass

        for f in (self.root / "server").rglob("*.js"):
            try:
                content = f.read_text(encoding="utf-8", errors="ignore")
                routes = re.findall(r'router\.(get|post|put|delete)\s*\([\'"]([^\'"]+)', content)
                index[str(f.relative_to(self.root))] = {
                    "type": "express", "routes": routes,
                    "size": len(content), "summary": content[:200],
                }
            except Exception:
                pass

        with self._lock:
            self._index = index
            self._last_indexed = time.time()

        logger.info(f"[KnowledgeBase] Indexed {len(index)} files")

    def get_context(self, query: str, max_files: int = 5) -> str:
        """Get relevant codebase context for a query."""
        if not self._index or time.time() - self._last_indexed > 3600:
            self.build_index()

        query_lower = query.lower()
        relevant = []

        with self._lock:
            for path, info in self._index.items():
                score = 0
                path_lower = path.lower()

                # Score based on path relevance
                for word in query_lower.split():
                    if word in path_lower:
                        score += 2
                    if word in str(info.get("classes", [])).lower():
                        score += 3
                    if word in str(info.get("functions", [])).lower():
                        score += 2
                    if word in str(info.get("components", [])).lower():
                        score += 2

                if score > 0:
                    relevant.append((score, path, info))

        relevant.sort(key=lambda x: x[0], reverse=True)
        top = relevant[:max_files]

        if not top:
            return ""

        context_parts = []
        for _, path, info in top:
            if info["type"] == "python":
                context_parts.append(
                    f"File: {path}\n"
                    f"Classes: {', '.join(info.get('classes', []))}\n"
                    f"Functions: {', '.join(info.get('functions', []))[:200]}\n"
                )
            elif info["type"] == "react":
                context_parts.append(
                    f"File: {path}\n"
                    f"Components: {', '.join(info.get('components', []))}\n"
                )
            elif info["type"] == "express":
                routes_str = ", ".join(f"{m.upper()} {r}" for m, r in info.get("routes", [])[:5])
                context_parts.append(f"File: {path}\nRoutes: {routes_str}\n")

        return "\n".join(context_parts)

    def get_file_content(self, rel_path: str, max_chars: int = 3000) -> str:
        """Get the content of a specific file for context."""
        try:
            full_path = self.root / rel_path
            if full_path.exists():
                return full_path.read_text(encoding="utf-8", errors="ignore")[:max_chars]
        except Exception:
            pass
        return ""

    def search_files(self, query: str) -> list[str]:
        """Search for files matching a query."""
        if not self._index:
            self.build_index()
        query_lower = query.lower()
        with self._lock:
            return [p for p in self._index if query_lower in p.lower()][:10]


# ── Suggestion Engine ─────────────────────────────────────────────────────────

class SuggestionEngine:
    """
    Proactively suggests better approaches based on:
    - The user's request
    - Historical success rates
    - Current system state
    - Codebase knowledge
    """

    BETTER_APPROACHES = {
        "ADD_FEATURE": [
            "Consider whether this feature fits an existing page or needs a new route",
            "Check if a similar component already exists in src/components/",
            "For data-heavy features, create a custom hook in src/hooks/",
            "Use the existing apiFetch() pattern — don't add raw fetch() calls",
        ],
        "UPGRADE_ALGO": [
            "Start with the lowest-effort upgrade: adding Random Forest to the ensemble",
            "SHAP explanations would improve user trust without changing accuracy",
            "Consider enabling FinBERT sentiment — it adds a non-price signal",
            "Optuna hyperparameter tuning can improve accuracy 2-5% with minimal code changes",
        ],
        "CREATE_THEME": [
            "Try describing the mood rather than specific colors for better results",
            "Reference a sci-fi movie or aesthetic for more cohesive themes",
            "The 'neon' modifier maximizes saturation for electric looks",
            "Add 'dark' or 'deep' to get very dark backgrounds",
        ],
        "ANALYZE_ACCURACY": [
            "Check accuracy by regime (trending vs ranging) — they often differ significantly",
            "Grade A+ signals should have >80% accuracy — if not, raise the threshold",
            "ECE > 5% means probabilities are miscalibrated — recalibration helps",
        ],
    }

    def get_suggestions(self, intent: str, user_text: str, success_rate: float) -> list[str]:
        """Get proactive suggestions for the current intent."""
        suggestions = list(self.BETTER_APPROACHES.get(intent, []))

        # Add success-rate-based suggestion
        if success_rate < 0.5 and success_rate > 0:
            suggestions.insert(0,
                f"Note: Previous {intent.lower().replace('_', ' ')} requests had a "
                f"{success_rate*100:.0f}% acceptance rate. I'll try a different approach."
            )

        return suggestions[:3]  # max 3 suggestions


# ── JARVIS Brain (main coordinator) ──────────────────────────────────────────

class JarvisBrain:
    """
    The main conversational AI coordinator.
    Orchestrates: intent classification → safety check → action planning → cloud AI → filtered response.
    """

    def __init__(self, project_root: str):
        self.project_root  = project_root
        self.classifier    = IntentClassifier()
        self.planner       = ActionPlanner()
        self.cloud_ai      = CloudAIBridge()
        self.memory        = ExperienceMemory(
            os.path.join(project_root, "..", "data", "system", "jarvis_memory.json")
        )
        self.knowledge     = KnowledgeBase(project_root)
        self.suggestions   = SuggestionEngine()
        self._active_convs: dict[str, list[Message]] = {}

        # Safety guardrails — injected on every LLM call
        from engine.safety_guardrails import SAFETY_GATE
        self.safety = SAFETY_GATE

        # Build knowledge base in background
        threading.Thread(target=self.knowledge.build_index, daemon=True).start()

    def new_conversation(self) -> str:
        conv_id = self.memory.new_conversation()
        self._active_convs[conv_id] = []
        return conv_id

    async def chat(self, conv_id: str, user_text: str, use_cloud: bool = True,
                   session_id: str = "anon", user_role: str = "user") -> dict:
        """
        Process a user message and return JARVIS's response.
        Behaviour changes by role:
          super-admin → full AGI, unrestricted, self-improvement
          admin       → market + system analysis, no code changes
          user        → educational chatbot, heavy disclaimers

        All input/output passes through safety guardrails.
        """
        safety_warnings = []

        # ── Safety: validate + sanitize input ────────────────────────────────
        try:
            clean_text, input_warnings = self.safety.check_input(user_text, session_id)
            safety_warnings.extend(input_warnings)
            user_text = clean_text
        except ValueError as e:
            return {
                "conv_id":          conv_id,
                "intent":           "SAFETY_BLOCK",
                "confidence":       1.0,
                "actions":          [],
                "suggestions":      [],
                "response":         str(e),
                "provider":         "safety",
                "tokens_used":      0,
                "can_execute":      False,
                "safety_warnings":  ["Input blocked by safety guardrails"],
                "role_mode":        user_role,
            }

        # ── Select system prompt based on role ────────────────────────────────
        if user_role == "super-admin":
            role_prompt = self.SUPER_ADMIN_PROMPT
        elif user_role in ("admin",):
            role_prompt = self.ADMIN_PROMPT
        else:
            role_prompt = self.USER_PROMPT

        # Classify intent
        intent, confidence = self.classifier.classify(user_text)
        entities = self.classifier.extract_entities(user_text)

        # Restrict certain intents by role
        if user_role not in ("super-admin",) and intent in (
            "ADD_FEATURE", "MODIFY_FEATURE", "REMOVE_FEATURE",
            "UPGRADE_ALGO", "RUN_TESTS", "SCAN_CODE", "SCAN_DEPS"
        ):
            intent = "EXPLAIN_CODE"  # downgrade to read-only intent

        # Plan actions (role-filtered)
        actions = self.planner.plan(intent, entities, user_text)
        if user_role not in ("super-admin",):
            # Non-super-admin: remove any action that modifies code
            actions = [a for a in actions if not a.get("requires_approval")]

        # Get suggestions
        success_rate = self.memory.get_success_rate(intent)
        suggestions  = self.suggestions.get_suggestions(intent, user_text, success_rate)

        # Build conversation history for cloud AI
        history = self._active_convs.get(conv_id, [])
        llm_messages = [m.to_llm_format() for m in history[-10:]]
        llm_messages.append({"role": "user", "content": user_text})

        # Get codebase context (only for super-admin and admin)
        context = ""
        if user_role in ("super-admin", "admin"):
            context = self.knowledge.get_context(user_text)

        # ── Build full system context ─────────────────────────────────────────
        safety_addendum = self.safety.get_safety_system_prompt()
        full_context    = f"{role_prompt}\n\n{safety_addendum}"
        if context:
            full_context += f"\n\nCodebase context:\n{context[:2000]}"

        # Enrich prompt with intent (only useful for super-admin/admin)
        if user_role in ("super-admin", "admin") and intent != "UNKNOWN" and confidence > 0.3:
            action_desc = "; ".join(a["description"] for a in actions)
            enriched = (
                f"{user_text}\n\n"
                f"[JARVIS context: Intent={intent}, Confidence={confidence:.0%}, "
                f"Planned: {action_desc}]"
            )
            llm_messages[-1]["content"] = enriched

        # Call cloud AI or local fallback
        if use_cloud and self.cloud_ai.has_cloud:
            ai_result = await self.cloud_ai.chat(llm_messages, full_context)
        else:
            ai_result = self.cloud_ai._local_response(llm_messages)

        response_text = ai_result["content"]
        provider      = ai_result["provider"]
        tokens_used   = ai_result.get("tokens_used", 0)

        # ── Safety: filter output ─────────────────────────────────────────────
        filtered_text, output_modifications = self.safety.filter_output(
            response_text,
            context={"intent": intent, "provider": provider}
        )
        was_filtered = len(output_modifications) > 0
        safety_warnings.extend(output_modifications)
        response_text = filtered_text

        # ── Safety audit trail ────────────────────────────────────────────────
        self.safety.audit(
            session_id=session_id,
            user_input=user_text,
            ai_response=response_text,
            provider=provider,
            intent=intent,
            was_filtered=was_filtered,
            tokens=tokens_used,
        )

        # Store in memory
        user_msg = Message(role="user", content=user_text, intent=intent)
        asst_msg = Message(
            role="assistant", content=response_text,
            intent=intent, actions=actions,
            metadata={"provider": provider, "tokens": tokens_used,
                      "confidence": confidence, "was_filtered": was_filtered},
        )

        if conv_id not in self._active_convs:
            self._active_convs[conv_id] = []
        self._active_convs[conv_id].append(user_msg)
        self._active_convs[conv_id].append(asst_msg)

        self.memory.add_message(conv_id, user_msg)
        self.memory.add_message(conv_id, asst_msg)
        self.memory.add_tokens_used(tokens_used)
        self.memory.record_feature_request(user_text, intent, actions)

        # Determine if any action can be auto-executed
        can_execute    = any(a.get("can_auto_execute") for a in actions)
        needs_approval = any(a.get("requires_approval") for a in actions)

        return {
            "conv_id":          conv_id,
            "intent":           intent,
            "confidence":       round(confidence, 2),
            "entities":         entities,
            "actions":          actions,
            "suggestions":      suggestions,
            "response":         response_text,
            "provider":         provider,
            "tokens_used":      tokens_used,
            "can_execute":      can_execute,
            "needs_approval":   needs_approval,
            "has_cloud":        self.cloud_ai.has_cloud,
            "active_provider":  self.cloud_ai.active_provider,
            "safety_warnings":  safety_warnings,
            "was_filtered":     was_filtered,
            "role_mode":        user_role,
        }

    def record_feedback(self, conv_id: str, message_idx: int, feedback: str, intent: str = ""):
        """Record user feedback on a response."""
        self.memory.record_feedback(conv_id, message_idx, feedback, intent)

    def get_stats(self) -> dict:
        return {
            **self.memory.get_stats(),
            "has_cloud":       self.cloud_ai.has_cloud,
            "active_provider": self.cloud_ai.active_provider,
            "available_providers": self.cloud_ai._available,
            "knowledge_files": len(self.knowledge._index),
        }

    def get_conversation(self, conv_id: str) -> list[dict]:
        return self.memory.get_conversation(conv_id)

    def get_recent_conversations(self, n: int = 10) -> list[dict]:
        return self.memory.get_recent_conversations(n)

    def rebuild_knowledge(self):
        """Force rebuild of the codebase knowledge index."""
        threading.Thread(target=self.knowledge.build_index, daemon=True).start()


# ── Singleton ─────────────────────────────────────────────────────────────────

_PROJECT_ROOT_BRAIN = str(Path(__file__).parent.parent)  # ai_backend/
JARVIS_BRAIN = JarvisBrain(_PROJECT_ROOT_BRAIN)
