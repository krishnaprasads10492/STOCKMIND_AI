"""
smart_theme_creator.py — JARVIS Intelligent Theme Creator

Full pipeline:
  1. Receive theme name/style from user (e.g. "Blade Runner 2049 neon rain")
  2. Web search for related images (DuckDuckGo + Unsplash + Pexels + Pixabay)
  3. Download image thumbnails (in-memory, never saved to disk)
  4. Extract dominant color palette from each image using quantization
  5. Score palettes for aesthetic quality (contrast, vibrancy, uniqueness)
  6. Build complete CSS theme from the extracted palette
  7. Return theme + wallpaper options back to JARVIS

This makes JARVIS's Theme Studio truly intelligent —
  user says "Dune spice trade"  → JARVIS finds desert/amber/ochre images
                                 → extracts sandy gold, warm brown, deep sky blue
                                 → builds a complete Dune-inspired theme
"""

import os
import io
import re
import math
import time
import logging
import colorsys
import hashlib
from typing import Optional

logger = logging.getLogger("stockmind-ai.smart-theme")

# ── Optional imports ──────────────────────────────────────────────────────────

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


# ═══════════════════════════════════════════════════════════════════════════════
# Step 1 + 2: Web search for images related to the theme
# ═══════════════════════════════════════════════════════════════════════════════

async def search_web_images(query: str, count: int = 8) -> list[dict]:
    """
    Search for images related to the theme using multiple sources.
    Returns list of {url, thumb_url, source, credit}.
    Priority: DuckDuckGo → Unsplash API → Pexels API → Pixabay API → Curated
    """
    if not HTTPX_AVAILABLE:
        logger.warning("[SmartTheme] httpx not installed — using curated images only")
        return _get_curated_fallback(query, count)

    results = []

    # 1. Try DuckDuckGo image search (no API key needed)
    ddg = await _search_duckduckgo(query, min(count, 6))
    results.extend(ddg)
    logger.info(f"[SmartTheme] DuckDuckGo: {len(ddg)} images for '{query}'")

    # 2. Try Unsplash API if key available
    if len(results) < count:
        key = os.environ.get('UNSPLASH_API_KEY', '')
        if key:
            uns = await _search_unsplash(query, count - len(results), key)
            results.extend(uns)
            logger.info(f"[SmartTheme] Unsplash: {len(uns)} images")

    # 3. Try Pexels API if key available
    if len(results) < count:
        key = os.environ.get('PEXELS_API_KEY', '')
        if key:
            pex = await _search_pexels(query, count - len(results), key)
            results.extend(pex)
            logger.info(f"[SmartTheme] Pexels: {len(pex)} images")

    # 4. Curated fallback
    if len(results) < count:
        cur = _get_curated_fallback(query, count - len(results))
        results.extend(cur)
        logger.info(f"[SmartTheme] Curated: {len(cur)} images")

    return results[:count]


async def _search_duckduckgo(query: str, count: int = 5) -> list[dict]:
    """
    Search DuckDuckGo images (no API key required).
    Uses the imdl (image search) endpoint with safe search.
    """
    results = []
    try:
        # DuckDuckGo requires a token from the main page first
        search_query = f"{query} wallpaper 4k"
        encoded = search_query.replace(' ', '+')

        async with httpx.AsyncClient(
            timeout=10.0,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/html',
            },
            follow_redirects=True,
        ) as client:
            # Get vqd token
            resp = await client.get(f'https://duckduckgo.com/?q={encoded}&iax=images&ia=images')
            if resp.status_code != 200:
                return results

            # Extract vqd
            vqd_match = re.search(r"vqd='([^']+)'", resp.text)
            if not vqd_match:
                vqd_match = re.search(r'vqd=([^&"]+)', resp.text)
            if not vqd_match:
                return results

            vqd = vqd_match.group(1)

            # Image search
            img_resp = await client.get(
                'https://duckduckgo.com/i.js',
                params={
                    'l':   'us-en',
                    'o':   'json',
                    'q':   search_query,
                    'vqd': vqd,
                    'f':   ',,,,,',
                    'p':   '1',
                }
            )
            if img_resp.status_code != 200:
                return results

            data = img_resp.json()
            for img in data.get('results', [])[:count]:
                url = img.get('image', '')
                thumb = img.get('thumbnail', url)
                if url and (url.startswith('https://') or url.startswith('http://')):
                    results.append({
                        'url':      url,
                        'thumb_url': thumb,
                        'source':   'duckduckgo',
                        'credit':   img.get('source', 'Web'),
                        'title':    img.get('title', query),
                        'width':    img.get('width', 1920),
                        'height':   img.get('height', 1080),
                    })
    except Exception as e:
        logger.warning(f"[SmartTheme] DuckDuckGo search failed: {e}")
    return results


async def _search_unsplash(query: str, count: int, api_key: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                'https://api.unsplash.com/search/photos',
                params={'query': query, 'per_page': min(count, 10), 'orientation': 'landscape'},
                headers={'Authorization': f'Client-ID {api_key}'}
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
        return [{
            'url':      p['urls']['full'],
            'thumb_url': p['urls']['thumb'],
            'source':   'unsplash',
            'credit':   f"{p['user']['name']} / Unsplash",
            'color':    p.get('color', '#000000'),
        } for p in data.get('results', [])]
    except Exception as e:
        logger.warning(f"[SmartTheme] Unsplash failed: {e}")
        return []


async def _search_pexels(query: str, count: int, api_key: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                'https://api.pexels.com/v1/search',
                params={'query': query, 'per_page': min(count, 15), 'orientation': 'landscape'},
                headers={'Authorization': api_key}
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
        return [{
            'url':      p['src']['original'],
            'thumb_url': p['src']['tiny'],
            'source':   'pexels',
            'credit':   f"{p['photographer']} / Pexels",
            'color':    p.get('avg_color', '#000000'),
        } for p in data.get('photos', [])]
    except Exception as e:
        logger.warning(f"[SmartTheme] Pexels failed: {e}")
        return []


def _get_curated_fallback(query: str, count: int) -> list[dict]:
    """Map query keywords to curated Unsplash images."""
    from engine.image_fetcher import get_curated_images
    return get_curated_images(query, count)


# ═══════════════════════════════════════════════════════════════════════════════
# Step 3 + 4: Download thumbnail + extract dominant color palette
# ═══════════════════════════════════════════════════════════════════════════════

async def download_and_extract_palette(image_url: str, n_colors: int = 8) -> list[tuple]:
    """
    Download an image thumbnail and extract dominant colors.
    Returns list of (R, G, B) tuples sorted by dominance.
    Never saves to disk — processes in memory only.
    """
    if not PIL_AVAILABLE or not HTTPX_AVAILABLE:
        return []

    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            resp = await client.get(image_url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; StockMindAI/1.0 ThemeCreator)',
            })
            if resp.status_code != 200:
                return []
            image_bytes = resp.content

        # Process in memory
        img = Image.open(io.BytesIO(image_bytes))
        return extract_palette_from_image(img, n_colors)

    except Exception as e:
        logger.warning(f"[SmartTheme] Palette extraction failed for {image_url[:60]}: {e}")
        return []


def extract_palette_from_image(img, n_colors: int = 8) -> list[tuple]:
    """
    Extract dominant colors from a PIL Image using median cut quantization.
    Returns list of (R, G, B) tuples.
    """
    # Resize to small thumbnail for fast processing
    img = img.convert('RGB').resize((150, 100), Image.LANCZOS)

    # Use quantize to find dominant colors
    try:
        quantized = img.quantize(colors=n_colors, method=Image.Quantize.MEDIANCUT)
        palette   = quantized.getpalette()[:n_colors * 3]
        colors    = [(palette[i], palette[i+1], palette[i+2]) for i in range(0, len(palette), 3)]

        # Filter out near-black and near-white (they're boring)
        interesting = []
        for r, g, b in colors:
            brightness = (r + g + b) / 765  # 0-1
            if 0.08 < brightness < 0.92:
                interesting.append((r, g, b))

        # Sort by saturation (most vibrant first)
        def saturation(c):
            h, s, v = colorsys.rgb_to_hsv(c[0]/255, c[1]/255, c[2]/255)
            return s

        interesting.sort(key=saturation, reverse=True)
        return interesting[:n_colors] if interesting else colors[:n_colors]

    except Exception:
        # Fallback: sample pixels directly
        pixels = list(img.getdata())
        step   = max(1, len(pixels) // (n_colors * 10))
        sampled = pixels[::step]
        # Cluster by quantization bucket
        buckets: dict = {}
        for r, g, b in sampled:
            key = (r // 32, g // 32, b // 32)
            if key not in buckets:
                buckets[key] = []
            buckets[key].append((r, g, b))
        top_buckets = sorted(buckets.items(), key=lambda x: len(x[1]), reverse=True)[:n_colors]
        return [
            tuple(int(sum(c[i] for c in bucket) // len(bucket)) for i in range(3))
            for _, bucket in top_buckets
        ]


# ═══════════════════════════════════════════════════════════════════════════════
# Step 5: Score and select the best palette
# ═══════════════════════════════════════════════════════════════════════════════

def score_palette(colors: list[tuple]) -> float:
    """
    Score a color palette for aesthetic quality.
    Higher score = better for a dark UI theme.
    Criteria:
      - Vibrancy: at least one highly saturated color
      - Contrast: dark background potential
      - Uniqueness: colors are distinct from each other
      - UI suitability: not too many near-blacks or near-whites
    """
    if not colors:
        return 0.0

    score = 0.0

    # Vibrancy: check max saturation
    saturations = []
    for r, g, b in colors:
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        saturations.append(s)
    max_sat = max(saturations) if saturations else 0
    score += max_sat * 40  # up to 40 points

    # Contrast potential: check if we have both dark and light colors
    brightnesses = [(r + g + b) / 765 for r, g, b in colors]
    if min(brightnesses) < 0.2 and max(brightnesses) > 0.6:
        score += 30  # good contrast range

    # Uniqueness: check hue spread
    hues = []
    for r, g, b in colors:
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        if s > 0.1:  # only count somewhat saturated colors
            hues.append(h * 360)

    if len(hues) >= 2:
        hue_spread = max(hues) - min(hues)
        score += min(hue_spread / 360 * 20, 20)  # up to 20 points

    # Penalize if too many near-grays
    gray_count = sum(1 for r, g, b in colors
                     if colorsys.rgb_to_hsv(r/255, g/255, b/255)[1] < 0.15)
    score -= gray_count * 2

    return max(0, min(100, score))


def select_best_palette(all_palettes: list[list[tuple]]) -> list[tuple]:
    """Select the highest-scoring palette from multiple image palettes."""
    if not all_palettes:
        return []
    scored = [(score_palette(p), p) for p in all_palettes if p]
    if not scored:
        return []
    return max(scored, key=lambda x: x[0])[1]


def merge_palettes(palettes: list[list[tuple]], n: int = 6) -> list[tuple]:
    """
    Merge multiple palettes into one rich combined palette.
    Picks the most distinct colors across all palettes.
    """
    all_colors = [c for p in palettes for c in p]
    if not all_colors:
        return []

    # Convert to HSV for clustering
    hsv_colors = []
    for r, g, b in all_colors:
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        if s > 0.15 and 0.1 < v < 0.95:  # filter grays and extremes
            hsv_colors.append((h, s, v, r, g, b))

    if not hsv_colors:
        return all_colors[:n]

    # Sort by saturation × value (most vibrant)
    hsv_colors.sort(key=lambda c: c[1] * c[2], reverse=True)

    # Pick n most distinct colors (minimum 60° hue difference)
    selected = []
    for h, s, v, r, g, b in hsv_colors:
        if len(selected) >= n:
            break
        # Check if this color is distinct enough from already selected
        too_close = any(
            abs(h - sel_h) < 0.15 or abs(h - sel_h) > 0.85  # handle hue wrap
            for sel_h, _, _, _, _, _ in selected
        )
        if not too_close or not selected:
            selected.append((h, s, v, r, g, b))

    return [(r, g, b) for _, _, _, r, g, b in selected] or all_colors[:n]


# ═══════════════════════════════════════════════════════════════════════════════
# Step 6: Build CSS theme from extracted palette
# ═══════════════════════════════════════════════════════════════════════════════

def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f'#{r:02x}{g:02x}{b:02x}'


def rgba_from_rgb(r: int, g: int, b: int, alpha: float) -> str:
    return f'rgba({r},{g},{b},{alpha})'


def darken(r: int, g: int, b: int, factor: float) -> tuple:
    return (max(0, int(r * factor)), max(0, int(g * factor)), max(0, int(b * factor)))


def lighten(r: int, g: int, b: int, amount: int) -> tuple:
    return (min(255, r + amount), min(255, g + amount), min(255, b + amount))


def build_theme_from_palette(
    name: str,
    description: str,
    palette: list[tuple],
    wallpaper_url: str = '',
    wallpaper_credit: str = '',
) -> dict:
    """
    Build a complete CSS theme from an extracted color palette.

    Strategy:
    - Darkest color → background base
    - Most saturated color → accent
    - Second most saturated → AI/secondary color
    - Green-ish tint → bull color
    - Red-ish tint → bear color
    - Desaturated light → text color
    """
    import re as _re
    from engine.theme_generator import (
        generate_theme_key, pick_emoji, pick_category,
        hsl_to_hex, rgba, ensure_contrast
    )

    if not palette:
        # Fallback: use theme_generator's description-based generation
        from engine.theme_generator import generate_theme
        return generate_theme(name, description)

    # ── Classify palette colors by role ────────────────────────────────────

    # Sort by value (brightness)
    by_brightness = sorted(palette, key=lambda c: (c[0] + c[1] + c[2]))
    # Sort by saturation
    by_saturation = sorted(palette, key=lambda c: colorsys.rgb_to_hsv(c[0]/255, c[1]/255, c[2]/255)[1], reverse=True)

    # Background: darkest color, made even darker
    bg_rgb    = darken(*by_brightness[0], 0.5) if by_brightness else (8, 8, 20)
    surf_rgb  = darken(*by_brightness[0], 0.65) if by_brightness else (15, 15, 30)
    elev_rgb  = darken(*by_brightness[0], 0.75) if len(by_brightness) > 0 else (20, 20, 40)
    card_rgb  = darken(*by_brightness[0], 0.58)

    # Accent: most saturated color
    accent_rgb = by_saturation[0] if by_saturation else (0, 212, 255)
    # AI: second most saturated (or shifted hue of accent)
    ai_rgb = by_saturation[1] if len(by_saturation) > 1 else lighten(*accent_rgb, 50)

    # Border: slightly lighter than bg, tinted toward accent
    border_rgb = tuple(min(255, bg_rgb[i] + 30 + accent_rgb[i] // 8) for i in range(3))

    # Text: very light, slightly tinted toward accent hue
    acc_h, acc_s, acc_v = colorsys.rgb_to_hsv(accent_rgb[0]/255, accent_rgb[1]/255, accent_rgb[2]/255)
    text_r, text_g, text_b = [int(c * 255) for c in colorsys.hsv_to_rgb(acc_h, 0.15, 0.92)]

    # Bull: find greenish color or generate
    bull_rgb = (0, 255, 136)  # default green
    for r, g, b in palette:
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        if 0.22 < h < 0.45 and s > 0.5:  # green-ish
            bull_rgb = (r, g, b)
            break

    # Bear: find reddish color or generate
    bear_rgb = (255, 51, 102)  # default red
    for r, g, b in palette:
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        if (h < 0.05 or h > 0.95) and s > 0.5:  # red-ish
            bear_rgb = (r, g, b)
            break

    # ── Build CSS vars ───────────────────────────────────────────────────────

    def h(rgb): return rgb_to_hex(*rgb)
    def ra(rgb, a): return rgba_from_rgb(*rgb, a)

    vars_ = {
        '--color-bg-base':            h(bg_rgb),
        '--color-bg-surface':         h(surf_rgb),
        '--color-bg-elevated':        h(elev_rgb),
        '--color-bg-card':            h(card_rgb),
        '--color-bg-input':           h(darken(*bg_rgb, 0.9)),
        '--color-border':             h(border_rgb),
        '--color-border-subtle':      h(darken(*border_rgb, 0.6)),
        '--color-border-glow':        ra(accent_rgb, 0.35),
        '--color-text-primary':       rgb_to_hex(text_r, text_g, text_b),
        '--color-text-secondary':     h(lighten(*darken(*accent_rgb, 0.7), 20)),
        '--color-text-muted':         h(darken(*accent_rgb, 0.5)),
        '--color-accent':             h(accent_rgb),
        '--color-accent-hover':       h(lighten(*accent_rgb, 30)),
        '--color-accent-dim':         ra(accent_rgb, 0.12),
        '--color-bull':               h(bull_rgb),
        '--color-bull-dim':           ra(bull_rgb, 0.10),
        '--color-bear':               h(bear_rgb),
        '--color-bear-dim':           ra(bear_rgb, 0.10),
        '--color-ai':                 h(ai_rgb),
        '--color-ai-dim':             ra(ai_rgb, 0.12),
        '--color-warn':               '#ffaa00',
        '--color-warn-dim':           'rgba(255,170,0,0.10)',
        '--grid-line':                ra(accent_rgb, 0.04),
        '--shadow-glow-accent':       f'0 0 20px {ra(accent_rgb, 0.5)}',
        '--shadow-glow-ai':           f'0 0 24px {ra(ai_rgb, 0.4)}',
        '--palette-source':           'image-extraction',
        '--palette-colors':           ','.join(h(c) for c in palette[:6]),
    }

    # ── Build theme object ───────────────────────────────────────────────────

    key      = generate_theme_key(name)
    emoji    = pick_emoji(description, acc_h * 360, False)
    category = pick_category(description, acc_h * 360, False)

    # Background config with wallpaper if available
    bg_color = h(bg_rgb)
    if wallpaper_url:
        from engine.image_fetcher import get_overlay_for_theme
        overlay = get_overlay_for_theme(False, h(accent_rgb))
        bg_cfg = {
            'color':           bg_color,
            'wallpaperUrl':    wallpaper_url,
            'wallpaperCredit': wallpaper_credit,
            'overlay':         overlay,
            'image':           f"{overlay}, url('{wallpaper_url}')",
            'size':            'auto, cover',
            'position':        'center, center',
            'attachment':      'fixed, fixed',
        }
    else:
        grid_line = ra(accent_rgb, 0.04)
        bg_cfg = {
            'color':   bg_color,
            'image':   f"linear-gradient({grid_line} 1px, transparent 1px), linear-gradient(90deg, {grid_line} 1px, transparent 1px)",
            'size':    '40px 40px',
            'overlay': 'none',
        }

    return {
        'key':          key,
        'name':         name,
        'description':  description,
        'category':     category,
        'emoji':        emoji,
        'vars':         vars_,
        'bg':           bg_cfg,
        'wallpapers':   [],
        'palette':      [h(c) for c in palette[:8]],
        'generated_at': time.time(),
        'generated_by': 'JARVIS Smart Theme Creator v1.0 (image-extracted palette)',
        'palette_source': 'image_extraction',
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Main entry: Full JARVIS theme creation pipeline
# ═══════════════════════════════════════════════════════════════════════════════

async def create_theme_from_search(
    name: str,
    style: str,
    image_count: int = 5,
    extract_from_images: int = 3,
) -> dict:
    """
    Full JARVIS intelligent theme creation pipeline:
      1. Search web for images matching the style
      2. Download thumbnails for top N images
      3. Extract color palettes from each
      4. Merge into one rich representative palette
      5. Build complete CSS theme
      6. Return theme + all image options as wallpapers

    Args:
      name:                 Theme name (e.g. "Blade Runner 2049")
      style:                Style description (e.g. "neon rain cyberpunk Los Angeles")
      image_count:          How many images to search for
      extract_from_images:  How many images to actually analyze for color

    Returns:
      Complete theme dict ready to inject into themes.js
    """
    logger.info(f"[SmartTheme] Creating theme '{name}' from style: '{style}'")

    # Step 1+2: Search for images
    search_query = f"{name} {style} wallpaper aesthetic"
    images = await search_web_images(search_query, count=image_count)
    logger.info(f"[SmartTheme] Found {len(images)} images for '{search_query}'")

    # Step 3+4: Extract palettes from top images
    palettes = []
    best_wallpaper = None
    best_credit = ''

    if PIL_AVAILABLE and images:
        for img in images[:extract_from_images]:
            url = img.get('thumb_url') or img.get('url', '')
            if not url:
                continue
            palette = await download_and_extract_palette(url, n_colors=8)
            if palette:
                palettes.append(palette)
                if best_wallpaper is None:
                    best_wallpaper = img.get('url', '')
                    best_credit    = img.get('credit', '')
                logger.info(f"[SmartTheme] Extracted {len(palette)} colors from {url[:50]}")
    else:
        if not PIL_AVAILABLE:
            logger.warning("[SmartTheme] PIL not installed — skipping color extraction, install Pillow")
        best_wallpaper = images[0].get('url', '') if images else ''
        best_credit    = images[0].get('credit', '') if images else ''

    # Step 5: Merge palettes or fall back to description-based
    if palettes:
        merged_palette = merge_palettes(palettes, n=6)
        logger.info(f"[SmartTheme] Merged palette: {[rgb_to_hex(*c) for c in merged_palette]}")
        theme = build_theme_from_palette(name, style, merged_palette, best_wallpaper, best_credit)
    else:
        # Fallback: description-based algorithmic generation
        from engine.theme_generator import generate_theme
        theme = generate_theme(name, style)
        if best_wallpaper:
            from engine.image_fetcher import get_overlay_for_theme
            overlay = get_overlay_for_theme(False, theme['vars'].get('--color-accent', '#00d4ff'))
            theme['bg'] = {
                **theme['bg'],
                'wallpaperUrl':    best_wallpaper,
                'wallpaperCredit': best_credit,
                'overlay':         overlay,
            }

    # Attach all found images as wallpaper options
    theme['wallpapers'] = [{
        'url':       img.get('url', ''),
        'thumb_url': img.get('thumb_url', img.get('url', '')),
        'credit':    img.get('credit', ''),
        'source':    img.get('source', ''),
        'title':     img.get('title', name),
    } for img in images if img.get('url')]

    theme['search_query'] = search_query
    theme['images_found'] = len(images)
    theme['palettes_extracted'] = len(palettes)

    logger.info(f"[SmartTheme] Theme '{name}' created — "
                f"palette_source={theme.get('palette_source','desc')}, "
                f"wallpapers={len(theme['wallpapers'])}")
    return theme


def get_capabilities() -> dict:
    """Return current capabilities of the smart theme creator."""
    return {
        'pil_available':     PIL_AVAILABLE,
        'httpx_available':   HTTPX_AVAILABLE,
        'duckduckgo':        HTTPX_AVAILABLE,  # no key needed
        'unsplash_api':      bool(os.environ.get('UNSPLASH_API_KEY')),
        'pexels_api':        bool(os.environ.get('PEXELS_API_KEY')),
        'pixabay_api':       bool(os.environ.get('PIXABAY_API_KEY')),
        'color_extraction':  PIL_AVAILABLE,
        'install_hint': (
            'pip install Pillow httpx' if not PIL_AVAILABLE
            else ('pip install httpx' if not HTTPX_AVAILABLE else 'All capabilities available')
        ),
    }
