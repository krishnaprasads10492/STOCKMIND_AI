/**
 * generate-icons.js — Generate PWA icons from SVG
 * Run: node scripts/generate-icons.js
 * Requires: npm install sharp --save-dev
 *
 * If sharp is not available, icons will fall back to SVG in the manifest.
 */

import { createRequire } from 'module'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = join(__dirname, '..')
const ICONS_DIR = join(ROOT, 'public', 'icons')
const SVG_PATH  = join(ICONS_DIR, 'icon.svg')

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512]

async function generateIcons() {
  let sharp
  try {
    const require = createRequire(import.meta.url)
    sharp = require('sharp')
  } catch {
    console.log('[Icons] sharp not installed — run: npm install sharp --save-dev')
    console.log('[Icons] Creating placeholder PNG files for each size...')
    // Create minimal valid PNG placeholders (1x1 transparent)
    // These will be replaced when sharp is available
    createPlaceholders()
    return
  }

  const svgBuffer = readFileSync(SVG_PATH)
  for (const size of SIZES) {
    const outPath = join(ICONS_DIR, `icon-${size}.png`)
    await sharp(svgBuffer).resize(size, size).png().toFile(outPath)
    console.log(`[Icons] Generated ${size}x${size} → icon-${size}.png`)
  }
  console.log('[Icons] All icons generated successfully')
}

function createPlaceholders() {
  // Minimal 1x1 PNG in base64 (valid PNG, transparent)
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  for (const size of SIZES) {
    const outPath = join(ICONS_DIR, `icon-${size}.png`)
    if (!existsSync(outPath)) {
      writeFileSync(outPath, TINY_PNG)
      console.log(`[Icons] Placeholder ${size}x${size} created`)
    }
  }
  console.log('[Icons] Install sharp and re-run to generate proper icons from SVG')
}

generateIcons().catch(console.error)
