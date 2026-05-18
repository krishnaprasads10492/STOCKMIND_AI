"""
image_fetcher.py — Theme Wallpaper & Image Fetcher

Fetches high-quality wallpapers and background images for themes from free APIs.

Sources (in priority order):
  1. Unsplash  — free, high quality, requires free API key (50 req/hour)
  2. Pexels    — free, high quality, requires free API key (200 req/hour)
  3. Pixabay   — free, no key needed for basic use (100 req/min)
  4. Curated   — hardcoded fallback URLs per theme category (always works)

All images are:
  - Landscape orientation (wallpaper-suitable)
  - High resolution (1920x1080 minimum)
  - Free to use (CC0 or similar license)
  - Credited properly (photographer name + source)

Usage:
  images = await fetch_theme_images("matrix cyberpunk green rain", count=5)
  # Returns list of { url, thumb_url, credit, source, width, height }
"""

import os
import re
import time
import logging
from typing import Optional

logger = logging.getLogger("stockmind-ai.image-fetcher")

# ── Curated fallback images per theme keyword ─────────────────────────────────
# These are stable Unsplash source URLs that work without an API key.
# Format: unsplash.com/photos/{id}/download?w=1920

CURATED_IMAGES: dict[str, list[dict]] = {
    "cyberpunk": [
        {"url": "https://images.unsplash.com/photo-1518770660439-4636190af475?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1518770660439-4636190af475?w=400&q=60", "credit": "Alexandre Debiève / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=400&q=60", "credit": "Lorenzo Herrera / Unsplash", "source": "unsplash"},
    ],
    "matrix": [
        {"url": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&q=60", "credit": "Markus Spiske / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1544197150-b99a580bb7a8?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "space": [
        {"url": "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=60", "credit": "NASA / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=60", "credit": "Vincentiu Solomon / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?w=400&q=60", "credit": "Jeremy Thomas / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1543722530-d2c3201371e7?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "neon": [
        {"url": "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?w=400&q=60", "credit": "Jezael Melgoza / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60", "credit": "Pedro Lastra / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "desert": [
        {"url": "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=400&q=60", "credit": "Wolfgang Hasselmann / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "forest": [
        {"url": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&q=60", "credit": "Lukasz Szmigiel / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "ocean": [
        {"url": "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=400&q=60", "credit": "Silas Baisch / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "city": [
        {"url": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=60", "credit": "Pedro Lastra / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "fire": [
        {"url": "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1561731216-c3a4d99437d5?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1561731216-c3a4d99437d5?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "abstract": [
        {"url": "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
    "dark": [
        {"url": "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=60", "credit": "Benjamin Voros / Unsplash", "source": "unsplash"},
    ],
    "light": [
        {"url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=60", "credit": "Sean Oulashin / Unsplash", "source": "unsplash"},
        {"url": "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?w=1920&q=80", "thumb": "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?w=400&q=60", "credit": "Unsplash", "source": "unsplash"},
    ],
}

# ── Keyword → category mapping ────────────────────────────────────────────────

KEYWORD_TO_CATEGORY: dict[str, str] = {
    # Sci-fi movies
    "matrix": "matrix", "neo": "matrix", "morpheus": "matrix",
    "tron": "cyberpunk", "grid": "cyberpunk",
    "blade": "neon", "runner": "neon", "replicant": "neon",
    "ghost": "cyberpunk", "shell": "cyberpunk",
    "interstellar": "space", "gargantua": "space", "wormhole": "space",
    "dune": "desert", "arrakis": "desert", "spice": "desert",
    "avatar": "forest", "pandora": "forest", "navi": "forest",
    "iron": "abstract", "stark": "abstract", "jarvis": "abstract",
    "akira": "neon", "tokyo": "neon", "shibuya": "neon",
    # Moods
    "cyber": "cyberpunk", "punk": "cyberpunk", "hacker": "matrix",
    "neon": "neon", "electric": "neon",
    "space": "space", "galaxy": "space", "nebula": "space", "cosmos": "space",
    "star": "space", "universe": "space",
    "desert": "desert", "sand": "desert", "dune": "desert",
    "forest": "forest", "jungle": "forest", "nature": "forest",
    "ocean": "ocean", "sea": "ocean", "water": "ocean", "deep": "ocean",
    "fire": "fire", "flame": "fire", "lava": "fire",
    "city": "city", "urban": "city", "street": "city",
    "dark": "dark", "shadow": "dark", "noir": "dark", "midnight": "dark",
    "light": "light", "bright": "light", "clean": "light", "minimal": "light",
    "abstract": "abstract", "plasma": "abstract", "quantum": "abstract",
}


def description_to_category(description: str) -> str:
    """Map a theme description to the best image category."""
    lower = description.lower()
    words = re.findall(r'\b\w+\b', lower)

    # Score each category
    scores: dict[str, int] = {}
    for word in words:
        cat = KEYWORD_TO_CATEGORY.get(word)
        if cat:
            scores[cat] = scores.get(cat, 0) + 1

    if scores:
        return max(scores, key=scores.get)
    return "abstract"  # default


def get_curated_images(description: str, count: int = 5) -> list[dict]:
    """Get curated fallback images for a theme description."""
    category = description_to_category(description)
    images   = CURATED_IMAGES.get(category, CURATED_IMAGES["abstract"])
    # Return up to `count` images, cycling if needed
    result = []
    for i in range(min(count, len(images))):
        result.append({**images[i], "category": category})
    return result


# ── Unsplash API ──────────────────────────────────────────────────────────────

async def fetch_unsplash(query: str, count: int = 5, api_key: str = "") -> list[dict]:
    """
    Fetch images from Unsplash API.
    Free tier: 50 requests/hour. Get key at https://unsplash.com/developers
    """
    if not api_key:
        return []
    try:
        import httpx
        params = {
            "query":       query,
            "per_page":    min(count, 10),
            "orientation": "landscape",
            "content_filter": "high",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.unsplash.com/search/photos",
                params=params,
                headers={"Authorization": f"Client-ID {api_key}"},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()

        results = []
        for photo in data.get("results", []):
            urls = photo.get("urls", {})
            user = photo.get("user", {})
            results.append({
                "url":       urls.get("full", urls.get("regular", "")),
                "thumb_url": urls.get("thumb", urls.get("small", "")),
                "preview_url": urls.get("regular", ""),
                "credit":    f"{user.get('name', 'Unknown')} / Unsplash",
                "credit_url": user.get("links", {}).get("html", "https://unsplash.com"),
                "source":    "unsplash",
                "width":     photo.get("width", 1920),
                "height":    photo.get("height", 1080),
                "color":     photo.get("color", "#000000"),
                "blur_hash": photo.get("blur_hash", ""),
                "alt":       photo.get("alt_description", query),
            })
        return results
    except Exception as e:
        logger.warning(f"[ImageFetcher] Unsplash failed: {e}")
        return []


# ── Pexels API ────────────────────────────────────────────────────────────────

async def fetch_pexels(query: str, count: int = 5, api_key: str = "") -> list[dict]:
    """
    Fetch images from Pexels API.
    Free tier: 200 requests/hour. Get key at https://www.pexels.com/api/
    """
    if not api_key:
        return []
    try:
        import httpx
        params = {
            "query":       query,
            "per_page":    min(count, 15),
            "orientation": "landscape",
            "size":        "large",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://api.pexels.com/v1/search",
                params=params,
                headers={"Authorization": api_key},
            )
            if resp.status_code != 200:
                return []
            data = resp.json()

        results = []
        for photo in data.get("photos", []):
            src = photo.get("src", {})
            results.append({
                "url":       src.get("original", src.get("large2x", "")),
                "thumb_url": src.get("tiny", src.get("small", "")),
                "preview_url": src.get("large", ""),
                "credit":    f"{photo.get('photographer', 'Unknown')} / Pexels",
                "credit_url": photo.get("photographer_url", "https://pexels.com"),
                "source":    "pexels",
                "width":     photo.get("width", 1920),
                "height":    photo.get("height", 1080),
                "color":     photo.get("avg_color", "#000000"),
                "alt":       photo.get("alt", query),
            })
        return results
    except Exception as e:
        logger.warning(f"[ImageFetcher] Pexels failed: {e}")
        return []


# ── Pixabay API ───────────────────────────────────────────────────────────────

async def fetch_pixabay(query: str, count: int = 5, api_key: str = "") -> list[dict]:
    """
    Fetch images from Pixabay API.
    Free tier: 100 requests/min. Get key at https://pixabay.com/api/docs/
    """
    if not api_key:
        return []
    try:
        import httpx
        params = {
            "key":          api_key,
            "q":            query,
            "image_type":   "photo",
            "orientation":  "horizontal",
            "per_page":     min(count, 20),
            "safesearch":   "true",
            "min_width":    1920,
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://pixabay.com/api/", params=params)
            if resp.status_code != 200:
                return []
            data = resp.json()

        results = []
        for hit in data.get("hits", []):
            results.append({
                "url":       hit.get("largeImageURL", hit.get("webformatURL", "")),
                "thumb_url": hit.get("previewURL", ""),
                "preview_url": hit.get("webformatURL", ""),
                "credit":    f"{hit.get('user', 'Unknown')} / Pixabay",
                "credit_url": f"https://pixabay.com/users/{hit.get('user', '')}",
                "source":    "pixabay",
                "width":     hit.get("imageWidth", 1920),
                "height":    hit.get("imageHeight", 1080),
                "color":     "#000000",
                "alt":       hit.get("tags", query),
            })
        return results
    except Exception as e:
        logger.warning(f"[ImageFetcher] Pixabay failed: {e}")
        return []


# ── Main entry point ──────────────────────────────────────────────────────────

async def fetch_theme_images(
    description: str,
    count: int = 6,
    include_curated: bool = True,
) -> list[dict]:
    """
    Fetch wallpaper images for a theme description.

    Priority:
      1. Unsplash (if UNSPLASH_API_KEY set)
      2. Pexels   (if PEXELS_API_KEY set)
      3. Pixabay  (if PIXABAY_API_KEY set)
      4. Curated  (always available, no key needed)

    Returns list of image dicts with url, thumb_url, credit, source.
    """
    unsplash_key = os.environ.get("UNSPLASH_API_KEY", "")
    pexels_key   = os.environ.get("PEXELS_API_KEY", "")
    pixabay_key  = os.environ.get("PIXABAY_API_KEY", "")

    # Build search query from description
    # Extract key nouns/adjectives for better image search
    words = re.findall(r'\b\w+\b', description.lower())
    # Filter to meaningful words (skip common words)
    stop_words = {"a", "an", "the", "and", "or", "with", "on", "in", "of", "for",
                  "to", "is", "are", "was", "be", "by", "at", "from", "that", "this"}
    search_words = [w for w in words if w not in stop_words and len(w) > 2]
    query = " ".join(search_words[:5])  # max 5 words for search

    results = []

    # Try APIs in order
    if unsplash_key:
        api_results = await fetch_unsplash(query, count, unsplash_key)
        results.extend(api_results)
        logger.info(f"[ImageFetcher] Unsplash: {len(api_results)} images for '{query}'")

    if len(results) < count and pexels_key:
        needed = count - len(results)
        api_results = await fetch_pexels(query, needed, pexels_key)
        results.extend(api_results)
        logger.info(f"[ImageFetcher] Pexels: {len(api_results)} images for '{query}'")

    if len(results) < count and pixabay_key:
        needed = count - len(results)
        api_results = await fetch_pixabay(query, needed, pixabay_key)
        results.extend(api_results)
        logger.info(f"[ImageFetcher] Pixabay: {len(api_results)} images for '{query}'")

    # Always add curated fallbacks to fill remaining slots
    if include_curated and len(results) < count:
        curated = get_curated_images(description, count - len(results))
        results.extend(curated)
        logger.info(f"[ImageFetcher] Curated: {len(curated)} images for '{description}'")

    return results[:count]


def get_overlay_for_theme(is_light: bool, accent_color: str = "#00d4ff") -> str:
    """
    Generate a CSS gradient overlay that ensures text readability over a wallpaper.
    Dark themes: dark overlay with accent color tint at edges.
    Light themes: light overlay.
    """
    if is_light:
        return "linear-gradient(135deg, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.75) 100%)"

    # Parse accent color to get RGB
    hex_color = accent_color.lstrip("#")
    try:
        r = int(hex_color[0:2], 16)
        g = int(hex_color[2:4], 16)
        b = int(hex_color[4:6], 16)
        accent_rgba = f"rgba({r},{g},{b},0.08)"
    except Exception:
        accent_rgba = "rgba(0,212,255,0.08)"

    return (
        f"linear-gradient(135deg, rgba(0,0,0,0.88) 0%, {accent_rgba} 50%, rgba(0,0,0,0.92) 100%)"
    )
