"""
image_reader.py — Universal image analysis engine for StockMind AI.

Extracts financial intelligence from images:
  - Stock charts (OHLCV patterns, trendlines, support/resistance)
  - Screenshots of trading terminals / broker apps
  - Financial statement snapshots
  - News headlines / social media screenshots
  - Option chain screenshots
  - Candlestick pattern recognition

Pipeline:
  1. Decode base64 image → PIL Image
  2. Pre-process (denoise, contrast, deskew)
  3. OCR text extraction (pytesseract if available, else basic)
  4. Vision AI analysis (cloud LLM with vision if configured)
  5. Pattern recognition (price levels, trendlines, indicators)
  6. Structured output for prediction engine
"""

import base64
import io
import re
import logging
from typing import Optional

logger = logging.getLogger("stockmind-ai.image_reader")

# ── Optional imports (graceful degradation) ───────────────────────────────────

try:
    from PIL import Image, ImageFilter, ImageEnhance
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.warning("[ImageReader] Pillow not installed — image pre-processing disabled")

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:
    TESSERACT_AVAILABLE = False
    logger.warning("[ImageReader] pytesseract not installed — OCR disabled")

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False

# ── Price / number extraction patterns ───────────────────────────────────────

_PRICE_RE   = re.compile(r'(?:₹|Rs\.?|INR|USD|\$)?\s*([0-9]{1,7}(?:[,_][0-9]{2,3})*(?:\.[0-9]{1,4})?)', re.IGNORECASE)
_PCT_RE     = re.compile(r'([+-]?\s*[0-9]{1,3}(?:\.[0-9]{1,2})?)\s*%')
_TICKER_RE  = re.compile(r'\b([A-Z]{2,12})(?:\.NS|\.BSE|FUT|CE|PE)?\b')
_DATE_RE    = re.compile(r'\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b')
_VOLUME_RE  = re.compile(r'(?:vol(?:ume)?|qty)[:\s]+([0-9,]+(?:\.[0-9]+)?[KkMmBb]?)', re.IGNORECASE)
_IV_RE      = re.compile(r'(?:iv|implied\s+vol(?:atility)?)[:\s]+([0-9]{1,3}(?:\.[0-9]{1,2})?)\s*%?', re.IGNORECASE)
_OI_RE      = re.compile(r'(?:oi|open\s+interest)[:\s]+([0-9,]+(?:\.[0-9]+)?[KkMmBb]?)', re.IGNORECASE)

# Candlestick / chart pattern keywords
_PATTERN_KEYWORDS = {
    'bullish': ['bullish', 'buy', 'long', 'breakout', 'support', 'hammer', 'engulfing bullish',
                'morning star', 'doji bullish', 'golden cross', 'oversold'],
    'bearish': ['bearish', 'sell', 'short', 'breakdown', 'resistance', 'shooting star',
                'engulfing bearish', 'evening star', 'death cross', 'overbought'],
    'neutral': ['consolidation', 'sideways', 'range', 'neutral', 'doji', 'spinning top'],
}

# Technical indicator keywords
_INDICATOR_KEYWORDS = ['rsi', 'macd', 'ema', 'sma', 'bollinger', 'atr', 'stochastic',
                       'adx', 'cci', 'obv', 'vwap', 'supertrend', 'ichimoku']


def _parse_number(s: str) -> Optional[float]:
    """Parse a number string that may contain commas or K/M/B suffixes."""
    s = s.replace(',', '').replace('_', '').strip()
    multiplier = 1
    if s.endswith(('K', 'k')): multiplier = 1_000;    s = s[:-1]
    elif s.endswith(('M', 'm')): multiplier = 1_000_000; s = s[:-1]
    elif s.endswith(('B', 'b')): multiplier = 1_000_000_000; s = s[:-1]
    try:
        return float(s) * multiplier
    except ValueError:
        return None


# ── Image pre-processing ──────────────────────────────────────────────────────

def _preprocess_image(img):
    """Enhance image for better OCR accuracy."""
    if not PIL_AVAILABLE:
        return img
    # Convert to RGB if needed
    if img.mode not in ('RGB', 'L'):
        img = img.convert('RGB')
    # Upscale small images for better OCR
    w, h = img.size
    if w < 800:
        scale = 800 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    # Enhance contrast
    img = ImageEnhance.Contrast(img).enhance(1.5)
    img = ImageEnhance.Sharpness(img).enhance(1.3)
    return img


def _decode_image(image_b64: str):
    """Decode base64 image string to PIL Image."""
    if not PIL_AVAILABLE:
        return None
    try:
        # Strip data URI prefix if present
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]
        raw = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(raw))
        return img
    except Exception as e:
        logger.warning(f"[ImageReader] Decode error: {e}")
        return None


# ── OCR text extraction ───────────────────────────────────────────────────────

def _extract_text_ocr(img) -> str:
    """Extract text from image using Tesseract OCR."""
    if not TESSERACT_AVAILABLE or not PIL_AVAILABLE or img is None:
        return ""
    try:
        # Use PSM 6 (uniform block of text) for financial data
        config = '--psm 6 --oem 3 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,:%+-/₹$@()'
        text = pytesseract.image_to_string(img, config=config)
        return text.strip()
    except Exception as e:
        logger.warning(f"[ImageReader] OCR error: {e}")
        return ""


# ── Structured data extraction from text ─────────────────────────────────────

def _extract_structured(text: str) -> dict:
    """Parse OCR text into structured financial data."""
    text_lower = text.lower()

    # Extract all price-like numbers
    raw_prices = [_parse_number(m.group(1)) for m in _PRICE_RE.finditer(text)]
    prices = sorted(set(p for p in raw_prices if p and 1 < p < 10_000_000), reverse=True)

    # Extract percentages
    pcts = [float(m.group(1).replace(' ', '')) for m in _PCT_RE.finditer(text)]

    # Extract tickers (uppercase 2-12 char words)
    tickers = list(dict.fromkeys(
        m.group(1) for m in _TICKER_RE.finditer(text)
        if m.group(1) not in {'THE', 'AND', 'FOR', 'NSE', 'BSE', 'MCX', 'NFO', 'BFO', 'CDS'}
    ))[:5]

    # Extract dates
    dates = [m.group(1) for m in _DATE_RE.finditer(text)][:5]

    # Extract volume
    vol_match = _VOLUME_RE.search(text)
    volume = _parse_number(vol_match.group(1)) if vol_match else None

    # Extract IV
    iv_match = _IV_RE.search(text)
    iv = float(iv_match.group(1)) if iv_match else None

    # Extract OI
    oi_match = _OI_RE.search(text)
    oi = _parse_number(oi_match.group(1)) if oi_match else None

    # Detect chart patterns
    detected_patterns = []
    bias = 'neutral'
    bull_score = sum(1 for kw in _PATTERN_KEYWORDS['bullish'] if kw in text_lower)
    bear_score = sum(1 for kw in _PATTERN_KEYWORDS['bearish'] if kw in text_lower)
    for kw in _PATTERN_KEYWORDS['bullish'] + _PATTERN_KEYWORDS['bearish'] + _PATTERN_KEYWORDS['neutral']:
        if kw in text_lower:
            detected_patterns.append(kw)
    if bull_score > bear_score:   bias = 'bullish'
    elif bear_score > bull_score: bias = 'bearish'

    # Detect indicators mentioned
    indicators = [ind for ind in _INDICATOR_KEYWORDS if ind in text_lower]

    # Infer price levels (highest = resistance, lowest = support)
    support    = prices[-1] if len(prices) >= 2 else None
    resistance = prices[0]  if prices else None
    current    = prices[1]  if len(prices) >= 3 else (prices[0] if prices else None)

    return {
        'prices':     prices[:10],
        'percentages': pcts[:5],
        'tickers':    tickers,
        'dates':      dates,
        'volume':     volume,
        'iv':         iv,
        'openInterest': oi,
        'patterns':   list(set(detected_patterns))[:8],
        'indicators': indicators,
        'bias':       bias,
        'bullScore':  bull_score,
        'bearScore':  bear_score,
        'support':    support,
        'resistance': resistance,
        'currentPrice': current,
        'rawText':    text[:2000],
    }


# ── Cloud vision analysis ─────────────────────────────────────────────────────

async def _cloud_vision_analysis(image_b64: str, context: str = "") -> Optional[dict]:
    """
    Send image to cloud LLM with vision capability for deep analysis.
    Tries providers in order: OpenAI GPT-4o → Anthropic Claude → Google Gemini.
    Returns None if no vision-capable provider is configured.
    """
    import os
    import json

    prompt = f"""You are a professional stock market analyst. Analyse this image and extract ALL financial information.

Context: {context or 'Stock market chart or financial data image'}

Extract and return a JSON object with these fields:
- symbol: detected stock/index symbol (string or null)
- currentPrice: current/last price (number or null)
- priceChange: price change amount (number or null)
- priceChangePct: price change percentage (number or null)
- high: day/period high (number or null)
- low: day/period low (number or null)
- open: open price (number or null)
- close: close/previous close (number or null)
- volume: trading volume (number or null)
- iv: implied volatility percentage (number or null)
- openInterest: open interest (number or null)
- support: key support level (number or null)
- resistance: key resistance level (number or null)
- trend: overall trend direction ("bullish"/"bearish"/"neutral"/"sideways")
- patterns: array of detected chart patterns (strings)
- indicators: array of technical indicators visible (strings)
- signals: array of trading signals detected (strings)
- timeframe: chart timeframe if visible (string or null)
- bias: trading bias ("bullish"/"bearish"/"neutral")
- confidence: confidence in analysis 0-100 (number)
- summary: 2-3 sentence analysis summary (string)
- keyLevels: array of important price levels with labels
- optionData: option chain data if visible (object or null)
- newsHeadlines: any news text visible (array of strings)

Return ONLY valid JSON, no markdown, no explanation."""

    # Try OpenAI GPT-4o vision
    openai_key = os.environ.get('OPENAI_API_KEY', '')
    if openai_key:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    'https://api.openai.com/v1/chat/completions',
                    headers={'Authorization': f'Bearer {openai_key}', 'Content-Type': 'application/json'},
                    json={
                        'model': 'gpt-4o',
                        'max_tokens': 1500,
                        'messages': [{
                            'role': 'user',
                            'content': [
                                {'type': 'text', 'text': prompt},
                                {'type': 'image_url', 'image_url': {
                                    'url': f'data:image/jpeg;base64,{image_b64}',
                                    'detail': 'high'
                                }}
                            ]
                        }]
                    }
                )
                if resp.status_code == 200:
                    content = resp.json()['choices'][0]['message']['content']
                    return json.loads(content)
        except Exception as e:
            logger.warning(f"[ImageReader] OpenAI vision failed: {e}")

    # Try Anthropic Claude vision
    anthropic_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if anthropic_key:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    'https://api.anthropic.com/v1/messages',
                    headers={
                        'x-api-key': anthropic_key,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    json={
                        'model': 'claude-3-5-sonnet-20241022',
                        'max_tokens': 1500,
                        'messages': [{
                            'role': 'user',
                            'content': [
                                {'type': 'image', 'source': {
                                    'type': 'base64',
                                    'media_type': 'image/jpeg',
                                    'data': image_b64
                                }},
                                {'type': 'text', 'text': prompt}
                            ]
                        }]
                    }
                )
                if resp.status_code == 200:
                    content = resp.json()['content'][0]['text']
                    return json.loads(content)
        except Exception as e:
            logger.warning(f"[ImageReader] Anthropic vision failed: {e}")

    # Try Google Gemini vision
    gemini_key = os.environ.get('GEMINI_API_KEY', os.environ.get('GOOGLE_API_KEY', ''))
    if gemini_key:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}',
                    headers={'Content-Type': 'application/json'},
                    json={
                        'contents': [{
                            'parts': [
                                {'text': prompt},
                                {'inline_data': {'mime_type': 'image/jpeg', 'data': image_b64}}
                            ]
                        }],
                        'generationConfig': {'maxOutputTokens': 1500}
                    }
                )
                if resp.status_code == 200:
                    content = resp.json()['candidates'][0]['content']['parts'][0]['text']
                    return json.loads(content)
        except Exception as e:
            logger.warning(f"[ImageReader] Gemini vision failed: {e}")

    return None


# ── Main analysis function ────────────────────────────────────────────────────

async def analyse_image(image_b64: str, context: str = "", use_cloud: bool = True) -> dict:
    """
    Full image analysis pipeline.
    Returns structured financial data extracted from the image.
    """
    result = {
        'ok':          True,
        'method':      'none',
        'ocr':         {},
        'vision':      None,
        'merged':      {},
        'confidence':  0,
        'warnings':    [],
    }

    # Step 1: Decode image
    img = _decode_image(image_b64) if PIL_AVAILABLE else None
    if img is None and not TESSERACT_AVAILABLE:
        result['warnings'].append('PIL/Tesseract not installed — install Pillow and pytesseract for local OCR')

    # Step 2: Pre-process
    if img is not None:
        img = _preprocess_image(img)
        result['imageSize'] = list(img.size)

    # Step 3: OCR extraction
    ocr_text = _extract_text_ocr(img)
    if ocr_text:
        result['ocr']    = _extract_structured(ocr_text)
        result['method'] = 'ocr'
        result['confidence'] = 40

    # Step 4: Cloud vision (if available and enabled)
    if use_cloud:
        try:
            vision_data = await _cloud_vision_analysis(image_b64, context)
            if vision_data:
                result['vision']     = vision_data
                result['method']     = 'cloud_vision'
                result['confidence'] = vision_data.get('confidence', 85)
        except Exception as e:
            result['warnings'].append(f'Cloud vision unavailable: {str(e)[:100]}')

    # Step 5: Merge OCR + vision results (vision takes priority)
    ocr  = result['ocr']
    vis  = result['vision'] or {}

    merged = {
        'symbol':        vis.get('symbol')       or (ocr.get('tickers', [None])[0]),
        'currentPrice':  vis.get('currentPrice') or ocr.get('currentPrice'),
        'priceChange':   vis.get('priceChange'),
        'priceChangePct': vis.get('priceChangePct') or (ocr.get('percentages', [None])[0]),
        'high':          vis.get('high'),
        'low':           vis.get('low'),
        'open':          vis.get('open'),
        'close':         vis.get('close'),
        'volume':        vis.get('volume')       or ocr.get('volume'),
        'iv':            vis.get('iv')           or ocr.get('iv'),
        'openInterest':  vis.get('openInterest') or ocr.get('openInterest'),
        'support':       vis.get('support')      or ocr.get('support'),
        'resistance':    vis.get('resistance')   or ocr.get('resistance'),
        'trend':         vis.get('trend')        or ocr.get('bias', 'neutral'),
        'bias':          vis.get('bias')         or ocr.get('bias', 'neutral'),
        'patterns':      vis.get('patterns')     or ocr.get('patterns', []),
        'indicators':    vis.get('indicators')   or ocr.get('indicators', []),
        'signals':       vis.get('signals', []),
        'timeframe':     vis.get('timeframe'),
        'keyLevels':     vis.get('keyLevels', []),
        'optionData':    vis.get('optionData'),
        'newsHeadlines': vis.get('newsHeadlines', []),
        'summary':       vis.get('summary', ''),
        'confidence':    result['confidence'],
        'allPrices':     ocr.get('prices', []),
        'dates':         ocr.get('dates', []),
        'rawText':       ocr.get('rawText', ''),
    }

    result['merged'] = merged
    return result


def analyse_image_sync(image_b64: str, context: str = "") -> dict:
    """Synchronous wrapper — OCR only, no cloud vision."""
    result = {'ok': True, 'method': 'none', 'ocr': {}, 'vision': None, 'merged': {}, 'confidence': 0, 'warnings': []}
    img = _decode_image(image_b64) if PIL_AVAILABLE else None
    if img:
        img = _preprocess_image(img)
        result['imageSize'] = list(img.size)
    ocr_text = _extract_text_ocr(img)
    if ocr_text:
        result['ocr']    = _extract_structured(ocr_text)
        result['method'] = 'ocr'
        result['confidence'] = 40
    result['merged'] = result['ocr']
    return result
