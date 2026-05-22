"""
integrations.py — Python-side external resource configuration.

Mirrors server/config/integrations.js for the Python AI backend.
All external API endpoints, keys, and options in one place.
"""

import os
from typing import Optional

def env(key: str, fallback: str = '') -> str:
    return os.environ.get(key, fallback)

def env_bool(key: str, fallback: bool = False) -> bool:
    v = os.environ.get(key)
    if v is None: return fallback
    return v.lower() in ('true', '1', 'yes')

def env_int(key: str, fallback: int = 0) -> int:
    try: return int(os.environ.get(key, fallback))
    except: return fallback


# ── Market data ───────────────────────────────────────────────────────────────

YAHOO_FINANCE = {
    'id':       'yahoo_finance',
    'enabled':  True,
    'base_url': 'https://query1.finance.yahoo.com',
    'alt_url':  'https://query2.finance.yahoo.com',
    'timeout':  10,
    'retries':  2,
}

ALPHA_VANTAGE = {
    'id':       'alpha_vantage',
    'enabled':  env_bool('ALPHA_VANTAGE_ENABLED', bool(env('ALPHA_VANTAGE_KEY'))),
    'base_url': 'https://www.alphavantage.co',
    'api_key':  env('ALPHA_VANTAGE_KEY', env('VITE_ALPHA_VANTAGE_KEY')),
    'timeout':  15,
    'retries':  1,
    'rate_limit_per_day': 25,
}

TWELVE_DATA = {
    'id':       'twelve_data',
    'enabled':  env_bool('TWELVE_DATA_ENABLED', bool(env('TWELVE_DATA_KEY'))),
    'base_url': 'https://api.twelvedata.com',
    'api_key':  env('TWELVE_DATA_KEY', env('VITE_TWELVE_DATA_KEY')),
    'timeout':  10,
    'retries':  1,
    'rate_limit_per_day': 800,
}

STOOQ = {
    'id':       'stooq',
    'enabled':  True,
    'base_url': 'https://stooq.com',
    'timeout':  12,
    'retries':  1,
}

FINNHUB = {
    'id':       'finnhub',
    'enabled':  env_bool('FINNHUB_ENABLED', bool(env('FINNHUB_KEY'))),
    'base_url': 'https://finnhub.io/api/v1',
    'api_key':  env('FINNHUB_KEY', env('VITE_FINNHUB_KEY')),
    'timeout':  5,
    'retries':  2,
    'rate_limit_per_min': 60,
}

# Priority order for OHLCV fetching
MARKET_DATA_PRIORITY = ['yahoo_finance', 'stooq', 'alpha_vantage', 'twelve_data', 'finnhub']

MARKET_DATA_REGISTRY = {
    'yahoo_finance': YAHOO_FINANCE,
    'alpha_vantage': ALPHA_VANTAGE,
    'twelve_data':   TWELVE_DATA,
    'stooq':         STOOQ,
    'finnhub':       FINNHUB,
}

def get_active_market_source() -> dict:
    for src_id in MARKET_DATA_PRIORITY:
        src = MARKET_DATA_REGISTRY.get(src_id, {})
        if src.get('enabled'):
            return src
    return YAHOO_FINANCE


# ── Macro / Economic ──────────────────────────────────────────────────────────

FRED = {
    'id':       'fred',
    'enabled':  env_bool('FRED_ENABLED', bool(env('FRED_API_KEY'))),
    'base_url': 'https://api.stlouisfed.org/fred',
    'api_key':  env('FRED_API_KEY'),
    'timeout':  10,
    'retries':  2,
    'series': {
        'fed_rate':    'FEDFUNDS',
        'cpi':         'CPIAUCSL',
        'gdp':         'GDP',
        'unemployment':'UNRATE',
        'vix':         'VIXCLS',
        'india_gdp':   'MKTGDPINA646NWDB',
    }
}


# ── AI / LLM ──────────────────────────────────────────────────────────────────

OPENAI_CFG = {
    'id':           'openai',
    'enabled':      env_bool('OPENAI_ENABLED', bool(env('OPENAI_API_KEY'))),
    'base_url':     'https://api.openai.com/v1',
    'api_key':      env('OPENAI_API_KEY'),
    'default_model':'gpt-4o-mini',
    'vision_model': 'gpt-4o',
    'timeout':      30,
    'retries':      2,
}

ANTHROPIC_CFG = {
    'id':           'anthropic',
    'enabled':      env_bool('ANTHROPIC_ENABLED', bool(env('ANTHROPIC_API_KEY'))),
    'base_url':     'https://api.anthropic.com/v1',
    'api_key':      env('ANTHROPIC_API_KEY'),
    'default_model':'claude-3-5-haiku-20241022',
    'vision_model': 'claude-3-5-sonnet-20241022',
    'timeout':      30,
    'retries':      2,
}

GEMINI_CFG = {
    'id':           'gemini',
    'enabled':      env_bool('GEMINI_ENABLED', bool(env('GEMINI_API_KEY') or env('GOOGLE_API_KEY'))),
    'base_url':     'https://generativelanguage.googleapis.com/v1beta',
    'api_key':      env('GEMINI_API_KEY', env('GOOGLE_API_KEY')),
    'default_model':'gemini-1.5-flash',
    'vision_model': 'gemini-1.5-flash',
    'timeout':      30,
    'retries':      2,
}

GROQ_CFG = {
    'id':           'groq',
    'enabled':      env_bool('GROQ_ENABLED', bool(env('GROQ_API_KEY'))),
    'base_url':     'https://api.groq.com/openai/v1',
    'api_key':      env('GROQ_API_KEY'),
    'default_model':'llama-3.3-70b-versatile',
    'timeout':      15,
    'retries':      2,
}

DEEPSEEK_CFG = {
    'id':           'deepseek',
    'enabled':      env_bool('DEEPSEEK_ENABLED', bool(env('DEEPSEEK_API_KEY'))),
    'base_url':     'https://api.deepseek.com/v1',
    'api_key':      env('DEEPSEEK_API_KEY'),
    'default_model':'deepseek-chat',
    'timeout':      30,
    'retries':      2,
}

OLLAMA_CFG = {
    'id':           'ollama',
    'enabled':      env_bool('OLLAMA_ENABLED', False),
    'base_url':     env('OLLAMA_BASE_URL', 'http://localhost:11434/v1'),
    'api_key':      '',
    'default_model': env('OLLAMA_DEFAULT_MODEL', 'llama3.2'),
    'timeout':      60,
    'retries':      1,
}

LLM_PRIORITY = ['openai', 'anthropic', 'groq', 'deepseek', 'gemini', 'ollama']
LLM_REGISTRY = {
    'openai':    OPENAI_CFG,
    'anthropic': ANTHROPIC_CFG,
    'gemini':    GEMINI_CFG,
    'groq':      GROQ_CFG,
    'deepseek':  DEEPSEEK_CFG,
    'ollama':    OLLAMA_CFG,
}

def get_active_llm(prefer: Optional[str] = None) -> Optional[dict]:
    prefer = prefer or env('JARVIS_AI_PROVIDER', 'auto')
    if prefer != 'auto':
        cfg = LLM_REGISTRY.get(prefer)
        if cfg and cfg['enabled']:
            return cfg
    for provider_id in LLM_PRIORITY:
        cfg = LLM_REGISTRY.get(provider_id, {})
        if cfg.get('enabled') and cfg.get('api_key'):
            return cfg
    return None


# ── Image / Wallpaper ─────────────────────────────────────────────────────────

UNSPLASH_CFG = {
    'id':       'unsplash',
    'enabled':  env_bool('UNSPLASH_ENABLED', bool(env('UNSPLASH_API_KEY'))),
    'base_url': 'https://api.unsplash.com',
    'api_key':  env('UNSPLASH_API_KEY'),
    'timeout':  10,
    'retries':  1,
    'rate_limit_per_hour': 50,
}

PEXELS_CFG = {
    'id':       'pexels',
    'enabled':  env_bool('PEXELS_ENABLED', bool(env('PEXELS_API_KEY'))),
    'base_url': 'https://api.pexels.com/v1',
    'api_key':  env('PEXELS_API_KEY'),
    'timeout':  10,
    'retries':  1,
    'rate_limit_per_hour': 200,
}

PIXABAY_CFG = {
    'id':       'pixabay',
    'enabled':  env_bool('PIXABAY_ENABLED', bool(env('PIXABAY_API_KEY'))),
    'base_url': 'https://pixabay.com/api',
    'api_key':  env('PIXABAY_API_KEY'),
    'timeout':  10,
    'retries':  1,
    'rate_limit_per_min': 100,
}

IMAGE_PRIORITY = ['unsplash', 'pexels', 'pixabay']
IMAGE_REGISTRY = {'unsplash': UNSPLASH_CFG, 'pexels': PEXELS_CFG, 'pixabay': PIXABAY_CFG}

def get_active_image_sources() -> list:
    return [cfg for cfg in IMAGE_REGISTRY.values() if cfg['enabled']]


# ── Status summary ────────────────────────────────────────────────────────────

def get_integration_status() -> list:
    all_cfgs = {
        **MARKET_DATA_REGISTRY,
        'fred': FRED,
        **LLM_REGISTRY,
        **IMAGE_REGISTRY,
    }
    return [
        {
            'id':      k,
            'enabled': v.get('enabled', False),
            'has_key': bool(v.get('api_key', True)),
        }
        for k, v in all_cfgs.items()
    ]
