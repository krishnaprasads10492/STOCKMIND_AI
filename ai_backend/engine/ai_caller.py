"""
ai_caller.py — Universal AI provider HTTP caller.

Handles all provider API formats:
  - openai:    POST /chat/completions with messages array
  - anthropic: POST /messages with system + messages
  - gemini:    POST /models/{model}:generateContent with contents
  - cohere:    POST /chat with message + chat_history
  - custom:    openai-compatible (most providers use this)

Any provider that speaks OpenAI-compatible format works automatically.
"""

import logging
from typing import Optional

logger = logging.getLogger("stockmind-ai.ai-caller")


async def call_provider(
    provider: dict,
    api_key: str,
    model_id: str,
    messages: list[dict],
    system_prompt: str,
    max_tokens: int = 2000,
    temperature: float = 0.7,
) -> dict:
    """
    Call any AI provider using its configured format.

    Args:
        provider:      Provider config dict from AIProviderRegistry
        api_key:       API key string (or 'local' for local providers)
        model_id:      Model identifier to use
        messages:      List of {role, content} dicts (user/assistant turns)
        system_prompt: System prompt string
        max_tokens:    Maximum tokens to generate
        temperature:   Sampling temperature

    Returns:
        { content, provider_id, model_id, tokens_used, error }
    """
    import httpx

    api    = provider.get("api", {})
    fmt    = api.get("format", "openai")
    p_id   = provider["id"]

    try:
        if fmt == "openai":
            return await _call_openai_format(provider, api_key, model_id, messages, system_prompt, max_tokens, temperature)
        elif fmt == "anthropic":
            return await _call_anthropic_format(provider, api_key, model_id, messages, system_prompt, max_tokens, temperature)
        elif fmt == "gemini":
            return await _call_gemini_format(provider, api_key, model_id, messages, system_prompt, max_tokens, temperature)
        elif fmt == "cohere":
            return await _call_cohere_format(provider, api_key, model_id, messages, system_prompt, max_tokens, temperature)
        else:
            # Unknown format — try OpenAI-compatible as fallback
            logger.warning(f"[AICaller] Unknown format '{fmt}' for {p_id} — trying OpenAI-compatible")
            return await _call_openai_format(provider, api_key, model_id, messages, system_prompt, max_tokens, temperature)
    except Exception as e:
        logger.error(f"[AICaller] {p_id}/{model_id} failed: {e}")
        return {"content": None, "provider_id": p_id, "model_id": model_id, "tokens_used": 0, "error": str(e)}


async def _call_openai_format(provider, api_key, model_id, messages, system, max_tokens, temperature):
    """OpenAI-compatible format — works for OpenAI, Groq, Mistral, DeepSeek, Together, xAI, Ollama, LM Studio, etc."""
    import httpx
    api      = provider["api"]
    base_url = api["base_url"]
    path     = api["chat_path"]
    url      = f"{base_url}{path}"

    auth_header = api.get("auth_header", "Authorization")
    auth_prefix = api.get("auth_prefix", "Bearer ")

    headers = {"Content-Type": "application/json"}
    if auth_header and api_key and api_key != "local":
        headers[auth_header] = f"{auth_prefix}{api_key}"

    payload = {
        "model":       model_id,
        "messages":    [{"role": "system", "content": system}] + messages,
        "max_tokens":  max_tokens,
        "temperature": temperature,
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = data["choices"][0]["message"]["content"]
    tokens  = data.get("usage", {}).get("total_tokens", 0)
    return {"content": content, "provider_id": provider["id"], "model_id": model_id, "tokens_used": tokens, "error": None}


async def _call_anthropic_format(provider, api_key, model_id, messages, system, max_tokens, temperature):
    """Anthropic Messages API format."""
    import httpx
    api      = provider["api"]
    base_url = api["base_url"]
    path     = api["chat_path"]
    url      = f"{base_url}{path}"

    headers = {
        "Content-Type": "application/json",
        "x-api-key":    api_key,
    }
    if api.get("api_version_header"):
        headers[api["api_version_header"]] = api.get("api_version_value", "2023-06-01")

    payload = {
        "model":       model_id,
        "max_tokens":  max_tokens,
        "system":      system,
        "messages":    messages,
        "temperature": temperature,
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = data["content"][0]["text"]
    tokens  = data.get("usage", {}).get("input_tokens", 0) + data.get("usage", {}).get("output_tokens", 0)
    return {"content": content, "provider_id": provider["id"], "model_id": model_id, "tokens_used": tokens, "error": None}


async def _call_gemini_format(provider, api_key, model_id, messages, system, max_tokens, temperature):
    """Google Gemini API format."""
    import httpx
    api      = provider["api"]
    base_url = api["base_url"]
    path     = api["chat_path"].replace("{model}", model_id)
    url      = f"{base_url}{path}?key={api_key}"

    # Convert messages to Gemini format
    gemini_messages = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        gemini_messages.append({"role": role, "parts": [{"text": m["content"]}]})

    payload = {
        "contents":          gemini_messages,
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig":  {"maxOutputTokens": max_tokens, "temperature": temperature},
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = data["candidates"][0]["content"]["parts"][0]["text"]
    tokens  = data.get("usageMetadata", {}).get("totalTokenCount", 0)
    return {"content": content, "provider_id": provider["id"], "model_id": model_id, "tokens_used": tokens, "error": None}


async def _call_cohere_format(provider, api_key, model_id, messages, system, max_tokens, temperature):
    """Cohere Chat API format."""
    import httpx
    api      = provider["api"]
    base_url = api["base_url"]
    path     = api["chat_path"]
    url      = f"{base_url}{path}"

    headers = {
        "Content-Type":  "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    # Convert messages to Cohere format
    chat_history = []
    last_user_msg = ""
    for m in messages:
        if m["role"] == "user":
            last_user_msg = m["content"]
        elif m["role"] == "assistant":
            chat_history.append({"role": "CHATBOT", "message": m["content"]})

    payload = {
        "model":        model_id,
        "message":      last_user_msg,
        "chat_history": chat_history,
        "preamble":     system,
        "max_tokens":   max_tokens,
        "temperature":  temperature,
    }

    async with httpx.AsyncClient(timeout=45.0) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    content = data.get("text", "")
    tokens  = data.get("meta", {}).get("tokens", {}).get("input_tokens", 0) + \
              data.get("meta", {}).get("tokens", {}).get("output_tokens", 0)
    return {"content": content, "provider_id": provider["id"], "model_id": model_id, "tokens_used": tokens, "error": None}


async def test_provider(provider: dict, api_key: str, model_id: str) -> dict:
    """
    Test a provider with a simple ping message.
    Returns { ok, latency_ms, error }.
    """
    import time
    start = time.time()
    result = await call_provider(
        provider, api_key, model_id,
        messages=[{"role": "user", "content": "Reply with exactly: OK"}],
        system_prompt="You are a test assistant. Reply with exactly what is asked.",
        max_tokens=10,
        temperature=0,
    )
    latency = round((time.time() - start) * 1000)
    if result.get("error"):
        return {"ok": False, "latency_ms": latency, "error": result["error"]}
    return {"ok": True, "latency_ms": latency, "response": result.get("content", "")[:50]}
