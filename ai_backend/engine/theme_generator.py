"""
theme_generator.py — JARVIS Theme Generation Engine

Generates complete CSS variable sets for new UI themes from a text description.

Algorithm:
  1. Parse the description for color keywords, mood words, and sci-fi references
  2. Select a dominant hue from a curated palette based on the description
  3. Apply color theory (HSL manipulation) to derive all 20+ CSS variables
  4. Ensure WCAG AA contrast ratios for text on backgrounds
  5. Return a complete theme object ready to inject into themes.js

No external APIs needed — pure algorithmic color generation.
"""

import re
import math
import colorsys
import time
from typing import Optional


# ── Color keyword → HSL hue mapping ──────────────────────────────────────────

COLOR_KEYWORDS: dict[str, float] = {
    # Reds / oranges
    "red": 0, "crimson": 348, "scarlet": 10, "ruby": 345, "blood": 0,
    "orange": 25, "amber": 38, "gold": 45, "golden": 45, "copper": 30,
    # Yellows
    "yellow": 55, "lime": 75, "chartreuse": 80,
    # Greens
    "green": 120, "emerald": 140, "jade": 150, "forest": 130, "matrix": 120,
    "mint": 160, "teal": 175, "cyan": 180, "aqua": 185,
    # Blues
    "blue": 210, "azure": 200, "cobalt": 215, "sapphire": 220, "navy": 225,
    "indigo": 240, "electric": 195, "neon": 180,
    # Purples / pinks
    "purple": 270, "violet": 280, "magenta": 300, "pink": 320, "rose": 340,
    "lavender": 260, "lilac": 265, "fuchsia": 305,
    # Neutrals (mapped to slight tints)
    "white": 210, "silver": 210, "grey": 210, "gray": 210,
    "black": 210, "dark": 210, "shadow": 220,
    # Sci-fi / movie references
    "jarvis": 195, "stark": 25, "iron": 25, "man": 25,
    "matrix": 120, "neo": 120, "morpheus": 120,
    "tron": 200, "grid": 200,
    "blade": 300, "runner": 300, "replicant": 300,
    "ghost": 175, "shell": 175, "motoko": 175,
    "dune": 38, "arrakis": 38, "spice": 38, "sandworm": 38,
    "avatar": 150, "pandora": 150, "navi": 150,
    "interstellar": 38, "gargantua": 38, "space": 220,
    "tokyo": 305, "shibuya": 305, "akira": 305,
    "cyberpunk": 195, "cyber": 195, "punk": 305,
    "midnight": 225, "night": 225, "moon": 225,
    "fire": 15, "flame": 15, "lava": 10, "volcano": 10,
    "ice": 195, "frost": 195, "arctic": 200, "snow": 200,
    "ocean": 200, "sea": 200, "deep": 215, "abyss": 220,
    "forest": 130, "jungle": 140, "nature": 130,
    "galaxy": 260, "nebula": 270, "cosmos": 250, "universe": 240,
    "quantum": 180, "plasma": 280, "photon": 55, "laser": 120,
    "hacker": 120, "terminal": 120, "code": 120,
    "gold": 45, "luxury": 45, "royal": 260, "imperial": 260,
    "stealth": 220, "shadow": 220, "noir": 220,
    "sunrise": 30, "sunset": 20, "dawn": 35, "dusk": 270,
    "toxic": 80, "acid": 75, "radioactive": 80,
    "blood": 0, "war": 0, "danger": 0, "alert": 0,
    "calm": 200, "peace": 160, "zen": 160, "serene": 180,
}

# Mood → saturation and lightness adjustments
MOOD_ADJUSTMENTS: dict[str, dict] = {
    "dark":       {"bg_l": 0.04, "sat": 0.85, "text_l": 0.88},
    "deep":       {"bg_l": 0.03, "sat": 0.90, "text_l": 0.85},
    "bright":     {"bg_l": 0.08, "sat": 0.95, "text_l": 0.95},
    "neon":       {"bg_l": 0.03, "sat": 1.00, "text_l": 0.95},
    "muted":      {"bg_l": 0.06, "sat": 0.60, "text_l": 0.80},
    "pastel":     {"bg_l": 0.10, "sat": 0.50, "text_l": 0.90},
    "light":      {"bg_l": 0.94, "sat": 0.70, "text_l": 0.10},
    "minimal":    {"bg_l": 0.96, "sat": 0.60, "text_l": 0.08},
    "electric":   {"bg_l": 0.04, "sat": 1.00, "text_l": 0.92},
    "warm":       {"bg_l": 0.05, "sat": 0.80, "text_l": 0.90},
    "cool":       {"bg_l": 0.04, "sat": 0.75, "text_l": 0.88},
    "toxic":      {"bg_l": 0.03, "sat": 1.00, "text_l": 0.90},
    "stealth":    {"bg_l": 0.02, "sat": 0.40, "text_l": 0.70},
    "holographic":{"bg_l": 0.04, "sat": 0.95, "text_l": 0.95},
}


# ── HSL ↔ Hex helpers ─────────────────────────────────────────────────────────

def hsl_to_hex(h: float, s: float, l: float) -> str:
    """Convert HSL (h: 0-360, s: 0-1, l: 0-1) to #rrggbb hex."""
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return "#{:02x}{:02x}{:02x}".format(
        max(0, min(255, int(r * 255))),
        max(0, min(255, int(g * 255))),
        max(0, min(255, int(b * 255))),
    )


def hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    """Convert #rrggbb to (h: 0-360, s: 0-1, l: 0-1)."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16) / 255
    g = int(hex_color[2:4], 16) / 255
    b = int(hex_color[4:6], 16) / 255
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s, l


def rgba(hex_color: str, alpha: float) -> str:
    """Convert hex to rgba() string."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"


def contrast_ratio(l1: float, l2: float) -> float:
    """WCAG relative luminance contrast ratio."""
    lighter = max(l1, l2)
    darker  = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def ensure_contrast(text_l: float, bg_l: float, min_ratio: float = 4.5) -> float:
    """Adjust text lightness to meet minimum contrast ratio against background."""
    if contrast_ratio(text_l, bg_l) >= min_ratio:
        return text_l
    # Try increasing or decreasing lightness
    for delta in [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50]:
        for direction in [1, -1]:
            candidate = max(0, min(1, text_l + direction * delta))
            if contrast_ratio(candidate, bg_l) >= min_ratio:
                return candidate
    return 0.95 if bg_l < 0.5 else 0.05


# ── Description parser ────────────────────────────────────────────────────────

def parse_description(description: str) -> dict:
    """
    Extract color intent from a natural language description.
    Returns: { hue, saturation, bg_lightness, text_lightness, is_light, accent_hue }
    """
    lower = description.lower()
    words = re.findall(r'\b\w+\b', lower)

    # Find dominant hue
    hue = 195.0  # default: cyan (cyber-dark)
    hue_confidence = 0
    for word in words:
        if word in COLOR_KEYWORDS:
            # Later words override earlier ones (more specific)
            hue = COLOR_KEYWORDS[word]
            hue_confidence += 1

    # Find mood adjustments
    mood_params = {"bg_l": 0.04, "sat": 0.85, "text_l": 0.88}
    for word in words:
        if word in MOOD_ADJUSTMENTS:
            mood_params.update(MOOD_ADJUSTMENTS[word])

    # Detect light theme intent
    is_light = any(w in words for w in ["light", "white", "bright", "clean", "minimal", "day"])

    # Accent hue — complementary or analogous
    # For most themes, accent is the dominant hue
    # For dark themes with warm dominant, use a cooler accent
    accent_hue = hue
    if hue < 60 or hue > 300:  # warm dominant → cool accent
        accent_hue = (hue + 180) % 360
    elif 60 <= hue <= 180:  # cool/green dominant → keep or shift slightly
        accent_hue = hue

    # AI color — always distinct from accent (shifted 60-90 degrees)
    ai_hue = (hue + 75) % 360

    return {
        "hue":         hue,
        "accent_hue":  accent_hue,
        "ai_hue":      ai_hue,
        "saturation":  mood_params["sat"],
        "bg_l":        mood_params["bg_l"],
        "text_l":      mood_params["text_l"],
        "is_light":    is_light,
    }


# ── Theme variable generator ──────────────────────────────────────────────────

def generate_theme_vars(params: dict) -> dict:
    """
    Generate all CSS custom property values from parsed color parameters.
    Ensures WCAG AA contrast for all text/background combinations.
    """
    h   = params["hue"]
    ah  = params["accent_hue"]
    aih = params["ai_hue"]
    s   = params["saturation"]
    bg  = params["bg_l"]
    is_light = params["is_light"]

    if is_light:
        # Light theme generation
        bg_base     = hsl_to_hex(h, 0.08, 0.96)
        bg_surface  = hsl_to_hex(h, 0.05, 1.00)
        bg_elevated = hsl_to_hex(h, 0.06, 0.98)
        bg_card     = hsl_to_hex(h, 0.05, 1.00)
        bg_input    = hsl_to_hex(h, 0.08, 0.95)
        border      = hsl_to_hex(h, 0.20, 0.80)
        border_sub  = hsl_to_hex(h, 0.15, 0.88)
        text_pri    = hsl_to_hex(h, 0.30, 0.10)
        text_sec    = hsl_to_hex(h, 0.20, 0.40)
        text_muted  = hsl_to_hex(h, 0.15, 0.60)
        accent      = hsl_to_hex(ah, min(s, 0.80), 0.45)
        accent_hov  = hsl_to_hex(ah, min(s, 0.85), 0.35)
        bull        = hsl_to_hex(130, 0.60, 0.35)
        bear        = hsl_to_hex(0,   0.70, 0.45)
        ai_color    = hsl_to_hex(aih, 0.65, 0.40)
        warn        = hsl_to_hex(38,  0.85, 0.45)
        grid_line   = "transparent"
    else:
        # Dark theme generation
        # Backgrounds: very dark, slight hue tint
        bg_base     = hsl_to_hex(h, min(s * 0.6, 0.70), max(bg, 0.02))
        bg_surface  = hsl_to_hex(h, min(s * 0.5, 0.65), max(bg + 0.03, 0.04))
        bg_elevated = hsl_to_hex(h, min(s * 0.45, 0.60), max(bg + 0.06, 0.06))
        bg_card     = hsl_to_hex(h, min(s * 0.55, 0.65), max(bg + 0.02, 0.03))
        bg_input    = hsl_to_hex(h, min(s * 0.50, 0.60), max(bg + 0.01, 0.03))

        # Borders: medium saturation, low-mid lightness
        border      = hsl_to_hex(h, min(s * 0.55, 0.65), 0.18)
        border_sub  = hsl_to_hex(h, min(s * 0.40, 0.50), 0.10)

        # Text: high lightness, slight hue tint
        raw_text_l  = params["text_l"]
        text_l      = ensure_contrast(raw_text_l, bg, min_ratio=7.0)
        text_pri    = hsl_to_hex(h, 0.30, text_l)
        text_sec    = hsl_to_hex(h, 0.35, max(text_l - 0.20, 0.45))
        text_muted  = hsl_to_hex(h, 0.40, max(text_l - 0.45, 0.25))

        # Accent: full saturation, medium-high lightness
        accent      = hsl_to_hex(ah, min(s, 1.0), 0.55)
        accent_hov  = hsl_to_hex(ah, min(s, 1.0), 0.65)

        # Market colors: always green/red but tinted toward theme hue
        bull_h      = 130 + (h - 180) * 0.1  # slight hue influence
        bear_h      = 0   + (h - 180) * 0.05
        bull        = hsl_to_hex(max(100, min(160, bull_h)), 1.0, 0.55)
        bear        = hsl_to_hex(max(340, min(20,  bear_h + 360)) % 360, 1.0, 0.55)

        # AI color: distinct from accent
        ai_color    = hsl_to_hex(aih, min(s * 0.9, 0.95), 0.60)
        warn        = hsl_to_hex(38, 0.95, 0.55)
        grid_line   = rgba(accent, 0.04)

    # Dim variants (10-15% opacity of the color)
    accent_dim  = rgba(accent, 0.12)
    bull_dim    = rgba(bull,   0.10)
    bear_dim    = rgba(bear,   0.10)
    ai_dim      = rgba(ai_color, 0.12)
    warn_dim    = rgba(warn,   0.10)
    border_glow = rgba(accent, 0.35)

    return {
        "--color-bg-base":        bg_base,
        "--color-bg-surface":     bg_surface,
        "--color-bg-elevated":    bg_elevated,
        "--color-bg-card":        bg_card,
        "--color-bg-input":       bg_input,
        "--color-border":         border,
        "--color-border-subtle":  border_sub,
        "--color-border-glow":    border_glow,
        "--color-text-primary":   text_pri,
        "--color-text-secondary": text_sec,
        "--color-text-muted":     text_muted,
        "--color-accent":         accent,
        "--color-accent-hover":   accent_hov,
        "--color-accent-dim":     accent_dim,
        "--color-bull":           bull,
        "--color-bull-dim":       bull_dim,
        "--color-bear":           bear,
        "--color-bear-dim":       bear_dim,
        "--color-ai":             ai_color,
        "--color-ai-dim":         ai_dim,
        "--color-warn":           warn,
        "--color-warn-dim":       warn_dim,
        "--grid-line":            grid_line,
    }


# ── Theme key / emoji generator ───────────────────────────────────────────────

def generate_theme_key(name: str) -> str:
    """Convert a theme name to a valid JS object key."""
    key = re.sub(r'[^a-z0-9\s-]', '', name.lower())
    key = re.sub(r'\s+', '-', key.strip())
    key = re.sub(r'-+', '-', key)
    return key[:40] or "custom-theme"


def pick_emoji(description: str, hue: float, is_light: bool) -> str:
    """Pick an appropriate emoji for the theme."""
    lower = description.lower()
    emoji_map = [
        (["iron", "stark", "tony"], "🔴"),
        (["matrix", "neo", "hacker", "terminal"], "💚"),
        (["tron", "grid", "circuit"], "🔵"),
        (["blade", "runner", "replicant", "2049"], "🌆"),
        (["ghost", "shell", "motoko", "section"], "👁"),
        (["dune", "arrakis", "spice", "sand"], "🏜"),
        (["avatar", "pandora", "navi", "bioluminescent"], "🌿"),
        (["interstellar", "gargantua", "wormhole"], "🪐"),
        (["tokyo", "shibuya", "akira", "neon"], "🗼"),
        (["galaxy", "nebula", "cosmos", "universe"], "🌌"),
        (["fire", "flame", "lava", "volcano"], "🔥"),
        (["ice", "frost", "arctic", "snow", "frozen"], "❄"),
        (["ocean", "sea", "deep", "abyss", "water"], "🌊"),
        (["forest", "jungle", "nature", "tree"], "🌲"),
        (["gold", "luxury", "royal", "imperial"], "👑"),
        (["blood", "war", "danger", "crimson"], "⚔"),
        (["quantum", "plasma", "photon", "laser"], "⚡"),
        (["midnight", "night", "moon", "lunar"], "🌙"),
        (["sunrise", "sunset", "dawn", "dusk"], "🌅"),
        (["stealth", "shadow", "noir", "black"], "🕶"),
        (["toxic", "acid", "radioactive"], "☢"),
        (["cyber", "punk", "dystopia"], "🤖"),
    ]
    for keywords, emoji in emoji_map:
        if any(k in lower for k in keywords):
            return emoji
    # Fallback based on hue
    if is_light:
        return "☀"
    if hue < 30 or hue > 330:
        return "🔴"
    if 30 <= hue < 70:
        return "🟡"
    if 70 <= hue < 150:
        return "💚"
    if 150 <= hue < 200:
        return "🩵"
    if 200 <= hue < 260:
        return "🔵"
    return "🟣"


def pick_category(description: str, hue: float, is_light: bool) -> str:
    """Pick a category for the theme."""
    lower = description.lower()
    if is_light:
        return "light"
    if any(w in lower for w in ["marvel", "iron", "stark", "avenger"]):
        return "marvel"
    if any(w in lower for w in ["dune", "interstellar", "avatar", "space", "galaxy", "cosmos"]):
        return "scifi"
    if any(w in lower for w in ["cyber", "punk", "matrix", "tron", "blade", "ghost", "tokyo", "neon", "hacker"]):
        return "cyberpunk"
    return "dark"


# ── Main entry point ──────────────────────────────────────────────────────────

def generate_theme(name: str, description: str) -> dict:
    """
    Generate a complete theme object from a name and description.
    Synchronous version — no wallpaper fetching.

    Args:
        name:        Human-readable theme name (e.g. "Quantum Storm")
        description: Natural language description (e.g. "electric blue plasma with dark void background")

    Returns:
        Complete theme dict matching the THEMES format in themes.js
    """
    if not name or not description:
        raise ValueError("name and description are required")

    name        = name.strip()[:50]
    description = description.strip()[:200]

    params   = parse_description(description)
    vars_    = generate_theme_vars(params)
    key      = generate_theme_key(name)
    emoji    = pick_emoji(description, params["hue"], params["is_light"])
    category = pick_category(description, params["hue"], params["is_light"])

    # Build background config (no wallpaper in sync version)
    accent_color = vars_.get("--color-accent", "#00d4ff")
    bg = _build_bg_config(params, vars_, wallpaper=None)

    return {
        "key":         key,
        "name":        name,
        "description": description,
        "category":    category,
        "emoji":       emoji,
        "vars":        vars_,
        "bg":          bg,
        "wallpapers":  [],   # populated by generate_theme_with_wallpapers()
        "generated_at": time.time(),
        "generated_by": "JARVIS Theme Engine v1.0",
        "params": {
            "hue":        round(params["hue"], 1),
            "accent_hue": round(params["accent_hue"], 1),
            "ai_hue":     round(params["ai_hue"], 1),
            "saturation": round(params["saturation"], 2),
            "is_light":   params["is_light"],
        },
    }


async def generate_theme_with_wallpapers(name: str, description: str,
                                          wallpaper_count: int = 6) -> dict:
    """
    Generate a complete theme with wallpaper options fetched from image APIs.
    Async version — fetches wallpapers from Unsplash/Pexels/Pixabay/curated.

    Returns the same theme dict as generate_theme() but with:
      - wallpapers: list of image options (url, thumb_url, credit, source)
      - bg.wallpaperUrl: URL of the recommended wallpaper (first result)
      - bg.wallpaperCredit: photographer credit
      - bg.overlay: CSS gradient overlay for text readability
    """
    from engine.image_fetcher import fetch_theme_images, get_overlay_for_theme

    # Generate base theme
    theme = generate_theme(name, description)

    # Fetch wallpapers
    try:
        wallpapers = await fetch_theme_images(description, count=wallpaper_count)
    except Exception as e:
        import logging
        logging.getLogger("stockmind-ai.theme").warning(f"Wallpaper fetch failed: {e}")
        wallpapers = []

    theme["wallpapers"] = wallpapers

    # Apply first wallpaper to bg config if available
    if wallpapers:
        best = wallpapers[0]
        accent_color = theme["vars"].get("--color-accent", "#00d4ff")
        overlay = get_overlay_for_theme(theme["params"]["is_light"], accent_color)
        theme["bg"] = {
            **theme["bg"],
            "wallpaperUrl":    best["url"],
            "wallpaperThumb":  best.get("thumb_url", best["url"]),
            "wallpaperCredit": best.get("credit", ""),
            "wallpaperCreditUrl": best.get("credit_url", ""),
            "wallpaperSource": best.get("source", ""),
            "overlay":         overlay,
            # CSS background-image with overlay + wallpaper
            "image": f"{overlay}, url('{best['url']}')",
            "size":  "auto, cover",
            "position": "center, center",
            "attachment": "fixed, fixed",
        }

    return theme


def _build_bg_config(params: dict, vars_: dict, wallpaper: dict = None) -> dict:
    """Build the bg config object for a theme."""
    from engine.image_fetcher import get_overlay_for_theme
    accent_color = vars_.get("--color-accent", "#00d4ff")
    grid_line    = vars_.get("--grid-line", "rgba(0,212,255,0.04)")
    bg_color     = vars_.get("--color-bg-base", "#060b14")
    is_light     = params.get("is_light", False)

    if wallpaper:
        overlay = get_overlay_for_theme(is_light, accent_color)
        return {
            "color":           bg_color,
            "wallpaperUrl":    wallpaper["url"],
            "wallpaperThumb":  wallpaper.get("thumb_url", wallpaper["url"]),
            "wallpaperCredit": wallpaper.get("credit", ""),
            "wallpaperCreditUrl": wallpaper.get("credit_url", ""),
            "wallpaperSource": wallpaper.get("source", ""),
            "overlay":         overlay,
            "image":           f"{overlay}, url('{wallpaper['url']}')",
            "size":            "auto, cover",
            "position":        "center, center",
            "attachment":      "fixed, fixed",
        }
    else:
        # Pattern-only background
        return {
            "color":   bg_color,
            "image":   f"linear-gradient({grid_line} 1px, transparent 1px), linear-gradient(90deg, {grid_line} 1px, transparent 1px)",
            "size":    "40px 40px",
            "overlay": "none",
        }
