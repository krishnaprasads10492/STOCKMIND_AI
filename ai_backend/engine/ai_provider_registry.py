"""
ai_provider_registry.py — Extensible Cloud AI Provider Registry

Replaces the hardcoded CloudAIBridge with a plugin-based system.
Any LLM provider that speaks HTTP can be added without touching source code.

Provider config schema (stored in data/system/ai_providers.json):
{
  "id":           "mistral",           # unique key, used in env var MISTRAL_API_KEY
  "name":         "Mistral AI",        # display name
  "models": [
    {
      "id":       "mistral-small",     # model identifier sent to the API
      "name":     "Mistral Small",     # display name
      "context":  32000,               # context window tokens
      "cost_per_1m_input":  0.20,      # USD per 1M input tokens (0 = free)
      "cost_per_1m_output": 0.60,
      "recommended": true              # show as default for this provider
    }
  ],
  "api": {
    "base_url":   "https://api.mistral.ai/v1",
    "chat_path":  "/chat/completions",
    "format":     "openai",            # openai | anthropic | gemini | custom
    "auth_header": "Authorization",
    "auth_prefix": "Bearer ",          # prepended to the API key
    "api_version_header": null,        # e.g. "anthropic-version"
    "api_version_value":  null
  },
  "env_key":      "MISTRAL_API_KEY",   # environment variable name for the API key
  "enabled":      true,
  "added_by":     "jarvis",            # "builtin" | "jarvis" | "user"
  "added_at":     1234567890.0
}

Built-in providers: openai, anthropic, gemini
JARVIS-added providers: any OpenAI-compatible API (Mistral, Groq, Together, Cohere,
  Perplexity, DeepSeek, xAI Grok, Ollama local, LM Studio, etc.)
"""

import os
import json
import time
import logging
import asyncio
from typing import Optional
from pathlib import Path

logger = logging.getLogger("stockmind-ai.ai-providers")

# ── Built-in provider definitions ─────────────────────────────────────────────

BUILTIN_PROVIDERS = [
    {
        "id":    "openai",
        "name":  "OpenAI",
        "models": [
            {"id": "gpt-4o-mini",    "name": "GPT-4o Mini",    "context": 128000, "cost_per_1m_input": 0.15,  "cost_per_1m_output": 0.60,  "recommended": True},
            {"id": "gpt-4o",         "name": "GPT-4o",         "context": 128000, "cost_per_1m_input": 2.50,  "cost_per_1m_output": 10.00, "recommended": False},
            {"id": "gpt-4-turbo",    "name": "GPT-4 Turbo",    "context": 128000, "cost_per_1m_input": 10.00, "cost_per_1m_output": 30.00, "recommended": False},
            {"id": "gpt-3.5-turbo",  "name": "GPT-3.5 Turbo",  "context": 16385,  "cost_per_1m_input": 0.50,  "cost_per_1m_output": 1.50,  "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.openai.com/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "OPENAI_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "anthropic",
        "name":  "Anthropic",
        "models": [
            {"id": "claude-3-haiku-20240307",  "name": "Claude 3 Haiku",   "context": 200000, "cost_per_1m_input": 0.25,  "cost_per_1m_output": 1.25,  "recommended": True},
            {"id": "claude-3-5-sonnet-20241022","name": "Claude 3.5 Sonnet","context": 200000, "cost_per_1m_input": 3.00,  "cost_per_1m_output": 15.00, "recommended": False},
            {"id": "claude-3-opus-20240229",   "name": "Claude 3 Opus",    "context": 200000, "cost_per_1m_input": 15.00, "cost_per_1m_output": 75.00, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.anthropic.com/v1",
            "chat_path":  "/messages",
            "format":     "anthropic",
            "auth_header": "x-api-key",
            "auth_prefix": "",
            "api_version_header": "anthropic-version",
            "api_version_value":  "2023-06-01",
        },
        "env_key":  "ANTHROPIC_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "gemini",
        "name":  "Google Gemini",
        "models": [
            {"id": "gemini-1.5-flash",   "name": "Gemini 1.5 Flash",   "context": 1000000, "cost_per_1m_input": 0.075, "cost_per_1m_output": 0.30,  "recommended": True},
            {"id": "gemini-1.5-pro",     "name": "Gemini 1.5 Pro",     "context": 2000000, "cost_per_1m_input": 1.25,  "cost_per_1m_output": 5.00,  "recommended": False},
            {"id": "gemini-2.0-flash",   "name": "Gemini 2.0 Flash",   "context": 1000000, "cost_per_1m_input": 0.10,  "cost_per_1m_output": 0.40,  "recommended": False},
        ],
        "api": {
            "base_url":   "https://generativelanguage.googleapis.com/v1beta",
            "chat_path":  "/models/{model}:generateContent",
            "format":     "gemini",
            "auth_header": None,   # Gemini uses ?key= query param
            "auth_prefix": "",
        },
        "env_key":  "GEMINI_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    # ── Popular OpenAI-compatible providers (pre-configured, just add key) ──
    {
        "id":    "groq",
        "name":  "Groq",
        "models": [
            {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B",  "context": 128000, "cost_per_1m_input": 0.59, "cost_per_1m_output": 0.79, "recommended": True},
            {"id": "mixtral-8x7b-32768",      "name": "Mixtral 8x7B",   "context": 32768,  "cost_per_1m_input": 0.24, "cost_per_1m_output": 0.24, "recommended": False},
            {"id": "gemma2-9b-it",            "name": "Gemma 2 9B",     "context": 8192,   "cost_per_1m_input": 0.20, "cost_per_1m_output": 0.20, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.groq.com/openai/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "GROQ_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
        "note":     "Groq is extremely fast (300+ tokens/sec). Free tier available.",
    },
    {
        "id":    "mistral",
        "name":  "Mistral AI",
        "models": [
            {"id": "mistral-small-latest",  "name": "Mistral Small",  "context": 32000, "cost_per_1m_input": 0.20, "cost_per_1m_output": 0.60, "recommended": True},
            {"id": "mistral-medium-latest", "name": "Mistral Medium", "context": 32000, "cost_per_1m_input": 2.70, "cost_per_1m_output": 8.10, "recommended": False},
            {"id": "mistral-large-latest",  "name": "Mistral Large",  "context": 32000, "cost_per_1m_input": 4.00, "cost_per_1m_output": 12.0, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.mistral.ai/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "MISTRAL_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "deepseek",
        "name":  "DeepSeek",
        "models": [
            {"id": "deepseek-chat",    "name": "DeepSeek Chat",    "context": 64000, "cost_per_1m_input": 0.14, "cost_per_1m_output": 0.28, "recommended": True},
            {"id": "deepseek-coder",   "name": "DeepSeek Coder",   "context": 64000, "cost_per_1m_input": 0.14, "cost_per_1m_output": 0.28, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.deepseek.com/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "DEEPSEEK_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
        "note":     "DeepSeek is extremely cost-effective. Great for code tasks.",
    },
    {
        "id":    "together",
        "name":  "Together AI",
        "models": [
            {"id": "meta-llama/Llama-3-70b-chat-hf",  "name": "Llama 3 70B",  "context": 8192,  "cost_per_1m_input": 0.90, "cost_per_1m_output": 0.90, "recommended": True},
            {"id": "mistralai/Mixtral-8x7B-Instruct-v0.1", "name": "Mixtral 8x7B", "context": 32768, "cost_per_1m_input": 0.60, "cost_per_1m_output": 0.60, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.together.xyz/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "TOGETHER_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "cohere",
        "name":  "Cohere",
        "models": [
            {"id": "command-r-plus", "name": "Command R+", "context": 128000, "cost_per_1m_input": 2.50, "cost_per_1m_output": 10.0, "recommended": True},
            {"id": "command-r",      "name": "Command R",  "context": 128000, "cost_per_1m_input": 0.15, "cost_per_1m_output": 0.60, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.cohere.ai/v1",
            "chat_path":  "/chat",
            "format":     "cohere",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "COHERE_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "perplexity",
        "name":  "Perplexity AI",
        "models": [
            {"id": "llama-3.1-sonar-small-128k-online", "name": "Sonar Small (Online)", "context": 127072, "cost_per_1m_input": 0.20, "cost_per_1m_output": 0.20, "recommended": True},
            {"id": "llama-3.1-sonar-large-128k-online", "name": "Sonar Large (Online)", "context": 127072, "cost_per_1m_input": 1.00, "cost_per_1m_output": 1.00, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.perplexity.ai",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "PERPLEXITY_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
        "note":     "Perplexity online models have real-time web search built in.",
    },
    {
        "id":    "xai",
        "name":  "xAI (Grok)",
        "models": [
            {"id": "grok-beta",  "name": "Grok Beta",  "context": 131072, "cost_per_1m_input": 5.00, "cost_per_1m_output": 15.0, "recommended": True},
            {"id": "grok-2",     "name": "Grok 2",     "context": 131072, "cost_per_1m_input": 2.00, "cost_per_1m_output": 10.0, "recommended": False},
        ],
        "api": {
            "base_url":   "https://api.x.ai/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  "XAI_API_KEY",
        "enabled":  True,
        "added_by": "builtin",
    },
    {
        "id":    "ollama",
        "name":  "Ollama (Local)",
        "models": [
            {"id": "llama3.2",   "name": "Llama 3.2 (3B)",  "context": 128000, "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": True},
            {"id": "mistral",    "name": "Mistral 7B",       "context": 32768,  "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": False},
            {"id": "codellama",  "name": "Code Llama",       "context": 16384,  "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": False},
            {"id": "deepseek-coder-v2", "name": "DeepSeek Coder V2", "context": 128000, "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": False},
        ],
        "api": {
            "base_url":   "http://localhost:11434/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  None,   # No key needed — local
        "enabled":  True,
        "added_by": "builtin",
        "note":     "Ollama runs models locally. Install from https://ollama.ai — completely free and private.",
    },
    {
        "id":    "lmstudio",
        "name":  "LM Studio (Local)",
        "models": [
            {"id": "local-model", "name": "Active LM Studio Model", "context": 4096, "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": True},
        ],
        "api": {
            "base_url":   "http://localhost:1234/v1",
            "chat_path":  "/chat/completions",
            "format":     "openai",
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key":  None,
        "enabled":  True,
        "added_by": "builtin",
        "note":     "LM Studio runs any GGUF model locally. Free and private.",
    },
]


# ── Provider Registry ─────────────────────────────────────────────────────────

class AIProviderRegistry:
    """
    Runtime-extensible registry of AI providers.

    Providers are stored in data/system/ai_providers.json.
    Built-in providers are always present; custom providers are merged on top.
    JARVIS can add new providers at runtime via add_provider().
    """

    def __init__(self, storage_path: str):
        self.path = Path(storage_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._custom: list[dict] = self._load_custom()

    def _load_custom(self) -> list[dict]:
        try:
            if self.path.exists():
                return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            pass
        return []

    def _save_custom(self):
        try:
            self.path.write_text(json.dumps(self._custom, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning(f"[ProviderRegistry] Save failed: {e}")

    def all_providers(self) -> list[dict]:
        """Return all providers (builtin + custom), merged."""
        builtin_ids = {p["id"] for p in BUILTIN_PROVIDERS}
        custom_non_builtin = [p for p in self._custom if p["id"] not in builtin_ids]
        # Custom overrides can replace builtin configs
        custom_overrides = {p["id"]: p for p in self._custom if p["id"] in builtin_ids}
        result = []
        for p in BUILTIN_PROVIDERS:
            if p["id"] in custom_overrides:
                result.append({**p, **custom_overrides[p["id"]]})
            else:
                result.append(p)
        result.extend(custom_non_builtin)
        return result

    def available_providers(self) -> list[dict]:
        """Return only providers that have an API key configured."""
        available = []
        for p in self.all_providers():
            if not p.get("enabled", True):
                continue
            env_key = p.get("env_key")
            if env_key is None:
                # Local providers (Ollama, LM Studio) — always available if enabled
                available.append(p)
            elif os.environ.get(env_key, "").strip():
                available.append(p)
        return available

    def get_provider(self, provider_id: str) -> Optional[dict]:
        return next((p for p in self.all_providers() if p["id"] == provider_id), None)

    def get_api_key(self, provider_id: str) -> str:
        p = self.get_provider(provider_id)
        if not p:
            return ""
        env_key = p.get("env_key")
        if env_key is None:
            return "local"  # local providers don't need a key
        return os.environ.get(env_key, "").strip()

    def get_recommended_model(self, provider_id: str) -> str:
        p = self.get_provider(provider_id)
        if not p:
            return ""
        for m in p.get("models", []):
            if m.get("recommended"):
                return m["id"]
        models = p.get("models", [])
        return models[0]["id"] if models else ""

    def add_provider(self, config: dict) -> dict:
        """
        Add a new provider at runtime.
        config must have: id, name, models, api (base_url, chat_path, format), env_key
        """
        required = ["id", "name", "models", "api"]
        for field in required:
            if field not in config:
                return {"ok": False, "error": f"Missing required field: {field}"}

        # Sanitize ID
        import re
        if not re.match(r'^[a-z0-9_-]+$', config["id"]):
            return {"ok": False, "error": "id must be lowercase alphanumeric with hyphens/underscores"}

        config["added_by"] = "jarvis"
        config["added_at"] = time.time()
        config.setdefault("enabled", True)

        # Remove existing entry with same ID
        self._custom = [p for p in self._custom if p["id"] != config["id"]]
        self._custom.append(config)
        self._save_custom()

        logger.info(f"[ProviderRegistry] Added provider: {config['id']} ({config['name']})")
        return {"ok": True, "provider_id": config["id"], "name": config["name"]}

    def remove_provider(self, provider_id: str) -> dict:
        """Remove a custom provider. Cannot remove builtins."""
        builtin_ids = {p["id"] for p in BUILTIN_PROVIDERS}
        if provider_id in builtin_ids:
            return {"ok": False, "error": "Cannot remove built-in providers"}
        before = len(self._custom)
        self._custom = [p for p in self._custom if p["id"] != provider_id]
        if len(self._custom) == before:
            return {"ok": False, "error": "Provider not found in custom registry"}
        self._save_custom()
        return {"ok": True}

    def set_enabled(self, provider_id: str, enabled: bool) -> dict:
        """Enable or disable a provider."""
        # Check if it's a builtin
        builtin = next((p for p in BUILTIN_PROVIDERS if p["id"] == provider_id), None)
        if builtin:
            # Add an override entry
            existing = next((p for p in self._custom if p["id"] == provider_id), None)
            if existing:
                existing["enabled"] = enabled
            else:
                self._custom.append({"id": provider_id, "enabled": enabled, "added_by": "user", "added_at": time.time()})
        else:
            custom = next((p for p in self._custom if p["id"] == provider_id), None)
            if not custom:
                return {"ok": False, "error": "Provider not found"}
            custom["enabled"] = enabled
        self._save_custom()
        return {"ok": True}

    def set_active_model(self, provider_id: str, model_id: str) -> dict:
        """Set the active model for a provider."""
        p = self.get_provider(provider_id)
        if not p:
            return {"ok": False, "error": "Provider not found"}
        model_ids = [m["id"] for m in p.get("models", [])]
        if model_id not in model_ids:
            return {"ok": False, "error": f"Model {model_id} not found. Available: {model_ids}"}
        # Store active model preference
        existing = next((c for c in self._custom if c["id"] == provider_id), None)
        if existing:
            existing["active_model"] = model_id
        else:
            self._custom.append({"id": provider_id, "active_model": model_id, "added_by": "user", "added_at": time.time()})
        self._save_custom()
        return {"ok": True, "active_model": model_id}

    def get_active_model(self, provider_id: str) -> str:
        """Get the currently active model for a provider."""
        custom = next((p for p in self._custom if p["id"] == provider_id), None)
        if custom and custom.get("active_model"):
            return custom["active_model"]
        return self.get_recommended_model(provider_id)

    def get_status(self) -> dict:
        """Get full registry status for the UI."""
        all_p    = self.all_providers()
        avail    = self.available_providers()
        avail_ids = {p["id"] for p in avail}

        return {
            "total_providers":     len(all_p),
            "available_providers": len(avail),
            "providers": [
                {
                    "id":           p["id"],
                    "name":         p["name"],
                    "enabled":      p.get("enabled", True),
                    "available":    p["id"] in avail_ids,
                    "added_by":     p.get("added_by", "builtin"),
                    "note":         p.get("note", ""),
                    "env_key":      p.get("env_key"),
                    "has_key":      bool(self.get_api_key(p["id"])),
                    "active_model": self.get_active_model(p["id"]),
                    "models":       p.get("models", []),
                }
                for p in all_p
            ],
        }

    def generate_provider_config(self, provider_name: str, base_url: str,
                                  api_key_env: str, format: str = "openai",
                                  models: Optional[list] = None) -> dict:
        """
        Generate a provider config from minimal information.
        Used by JARVIS when a user asks to add a new provider.
        """
        import re
        provider_id = re.sub(r'[^a-z0-9]', '-', provider_name.lower()).strip('-')
        provider_id = re.sub(r'-+', '-', provider_id)

        if not models:
            models = [{"id": "default", "name": "Default Model", "context": 4096,
                       "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": True}]

        return {
            "id":    provider_id,
            "name":  provider_name,
            "models": models,
            "api": {
                "base_url":   base_url.rstrip("/"),
                "chat_path":  "/chat/completions",
                "format":     format,
                "auth_header": "Authorization",
                "auth_prefix": "Bearer ",
            },
            "env_key":  api_key_env,
            "enabled":  True,
            "added_by": "jarvis",
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_REGISTRY_PATH = str(Path(__file__).parent.parent.parent / "data" / "system" / "ai_providers.json")
PROVIDER_REGISTRY = AIProviderRegistry(_REGISTRY_PATH)
