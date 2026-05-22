# StockMind AI — Mobile Guide

## What's implemented (works right now)

### PWA — Progressive Web App
The app is a fully installable PWA. No app store needed.

**Android (Chrome, Edge, Samsung Internet)**
1. Open `http://your-ip:5000` in Chrome on your phone
2. Chrome shows "Add to Home Screen" banner automatically
3. Tap → app installs like a native app with an icon on your home screen
4. Opens full-screen, no browser chrome
5. Works offline for cached pages

**iOS (Safari only — Chrome on iOS can't install PWAs)**
1. Open `http://your-ip:5000` in Safari
2. Tap the **Share** button (box with arrow)
3. Scroll down → tap **"Add to Home Screen"**
4. Tap **Add** — app installs with the StockMind icon
5. Opens in standalone mode (no Safari UI)

**What you get with PWA:**
- ✅ Home screen icon with splash screen
- ✅ Full-screen, no browser chrome
- ✅ Offline support (cached predictions, charts, theme)
- ✅ Background sync (predictions saved even when offline)
- ✅ Fast load (Workbox caching)
- ✅ App shortcuts (Predictions, Dashboard, JARVIS from home screen)
- ✅ Works on iPhone, iPad, Android, Windows, Mac

---

## Access the app on your phone from your laptop

Your server runs on localhost — your phone can't reach it directly.
Two options:

### Option A: Same WiFi (easiest)
```bash
# On your laptop, find your local IP
ipconfig   # Windows — look for "IPv4 Address" under your WiFi adapter

# Start the server (it binds to all interfaces by default)
node start.js --dev

# On your phone: open http://192.168.x.x:5000
# (replace with your laptop's actual IP)
```

### Option B: ngrok (reach from anywhere)
```bash
# Install ngrok: https://ngrok.com/download
ngrok http 5000

# ngrok gives you a URL like https://abc123.ngrok.io
# Open that on your phone
# ⚠ Only for testing — don't expose prod to public internet
```

---

## Going to the App Store (Capacitor)

If you want a real `.apk` for Google Play or `.ipa` for App Store:

### Setup (one time)
```bash
# Install Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# Initialize
npx cap init "StockMind AI" "com.stockmind.ai" --web-dir=build

# Build the web app first
npm run build

# Add platforms
npx cap add android
npx cap add ios          # Mac only

# Copy web assets to native projects
npx cap sync
```

### Build Android APK
```bash
# Open Android Studio
npx cap open android

# In Android Studio:
# Build → Generate Signed Bundle/APK → APK
# Follow wizard to sign with your keystore
```

### Build iOS IPA (Mac required)
```bash
# Open Xcode
npx cap open ios

# In Xcode:
# Product → Archive → Distribute App
```

### After any code change
```bash
npm run build    # rebuild web app
npx cap sync     # push new assets to native projects
```

### Native features with Capacitor plugins
```bash
# Biometric auth (fingerprint/Face ID)
npm install @capacitor/biometrics

# Push notifications
npm install @capacitor/push-notifications

# Camera (for image analysis)
npm install @capacitor/camera

# Haptic feedback
npm install @capacitor/haptics
```

---

## Mobile UI features implemented

| Feature | Status |
|---------|--------|
| Bottom tab navigation | ✅ Auto-shows on ≤640px |
| Safe area insets (notch, home bar) | ✅ env(safe-area-inset-*) |
| Touch targets (44px minimum) | ✅ WCAG 2.5.5 compliant |
| Smooth momentum scrolling | ✅ -webkit-overflow-scrolling: touch |
| No double-tap zoom | ✅ touch-action: manipulation |
| Landscape mode | ✅ Collapses to icon nav |
| Tablet layout (769–1024px) | ✅ Icon-only sidenav |
| Font zoom prevention (iOS) | ✅ min font-size 16px |
| Pull-to-refresh safe | ✅ overscroll-behavior: contain |
| Modal sheets | ✅ Bottom sheet on mobile |
| PWA install banner | ✅ Android prompt + iOS instructions |
| Offline fallback | ✅ Workbox service worker |
| Theme persistence | ✅ localStorage survives reinstall |
| Glassmorphism bottom nav | ✅ backdrop-filter: blur |

---

## Testing checklist before deploying to phone

```
[ ] Open DevTools → Toggle device toolbar (Ctrl+Shift+M)
[ ] Test at iPhone 15 Pro (393x852)
[ ] Test at Samsung S24 (360x780)
[ ] Test landscape orientation (both)
[ ] Test with keyboard open (check layout doesn't break)
[ ] Run Lighthouse → PWA score should be 90+
[ ] Check "Add to Home Screen" works
[ ] Verify offline mode (DevTools → Network → Offline)
```

Run Lighthouse audit:
```bash
# Chrome DevTools → Lighthouse → Mobile → Generate report
# Target scores: Performance 80+, PWA 90+, Accessibility 90+
```
