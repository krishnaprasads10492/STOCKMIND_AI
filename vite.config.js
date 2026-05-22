import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Include build assets in cache
      includeAssets: ['favicon.ico', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name:             'StockMind AI',
        short_name:       'StockMind',
        description:      'AI-powered stock market prediction and analysis — free for everyone',
        theme_color:      '#00d4ff',
        background_color: '#060b14',
        display:          'standalone',
        orientation:      'any',
        start_url:        '/',
        scope:            '/',
        lang:             'en',
        categories:       ['finance', 'business', 'utilities'],
        icons: [
          { src: '/icons/icon-72.png',   sizes: '72x72',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-96.png',   sizes: '96x96',   type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-128.png',  sizes: '128x128', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-144.png',  sizes: '144x144', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-152.png',  sizes: '152x152', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-192.png',  sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icons/icon-384.png',  sizes: '384x384', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png',  sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
        shortcuts: [
          {
            name: 'Predictions',
            short_name: 'Predict',
            description: 'Generate trading signals',
            url: '/predictions',
            icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
          },
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            description: 'Market overview',
            url: '/dashboard',
            icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
          },
          {
            name: 'JARVIS',
            short_name: 'JARVIS',
            description: 'AI assistant',
            url: '/jarvis',
            icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
          },
        ],
        screenshots: [
          {
            src: '/screenshots/desktop.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'StockMind AI Dashboard',
          },
          {
            src: '/screenshots/mobile.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'StockMind AI on Mobile',
          },
        ],
      },
      workbox: {
        // Precache all static assets
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Runtime caching strategies
        runtimeCaching: [
          {
            // API calls — network first, cache as fallback
            urlPattern: /^https?:\/\/localhost:\d+\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName:         'api-cache',
              expiration:        { maxEntries: 100, maxAgeSeconds: 5 * 60 },
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Unsplash / image CDN — cache first
            urlPattern: /^https:\/\/images\.unsplash\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName:  'wallpaper-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Pexels images
            urlPattern: /^https:\/\/images\.pexels\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName:  'wallpaper-cache',
              expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Yahoo Finance quotes — stale-while-revalidate (fast + fresh)
            urlPattern: /^https:\/\/query\d\.finance\.yahoo\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName:  'market-data-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Skip waiting so updates apply immediately
        skipWaiting:     true,
        clientsClaim:    true,
        // Offline fallback page (the SPA itself handles this)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      // Dev mode — enable PWA in development for testing
      devOptions: {
        enabled: false,   // enable manually when testing PWA
        type:    'module',
      },
    }),
  ],

  resolve: {
    alias: {
      '@':           path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages':      path.resolve(__dirname, './src/pages'),
      '@hooks':      path.resolve(__dirname, './src/hooks'),
      '@services':   path.resolve(__dirname, './src/services'),
      '@store':      path.resolve(__dirname, './src/store'),
      '@utils':      path.resolve(__dirname, './src/utils'),
      '@assets':     path.resolve(__dirname, './src/assets'),
      '@types':      path.resolve(__dirname, './src/types'),
    },
  },

  server: {
    port: 4098,
    open: true,
    cors: true,
    // Warm up the most-used modules so first page load is instant
    warmup: {
      clientFiles: [
        './src/App.jsx',
        './src/pages/Login/LoginPage.jsx',
        './src/pages/Dashboard/DashboardPage.jsx',
        './src/pages/Predictions/PredictionsPage.jsx',
        './src/components/AppShell.jsx',
        './src/store/authStore.js',
        './src/store/marketStore.js',
      ],
    },
    proxy: {
      '/api': {
        target:       'http://localhost:4098',
        changeOrigin: true,
      },
    },
  },
// OutDir will always be build.
  build: {
    outDir:    'build',     
    sourcemap: false,
    target:    ['es2020', 'chrome87', 'firefox78', 'safari14'],
    minify:    'esbuild',
    // Skip gzip size reporting — saves ~1s on every build
    reportCompressedSize: false,
    cssCodeSplit:  true,
    cssMinify:     true,
    // Raise warning limit — recharts is legitimately large
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        entryFileNames:  'assets/[name]-[hash].js',
        chunkFileNames:  'assets/[name]-[hash].js',
        assetFileNames:  'assets/[name]-[hash][extname]',
        manualChunks: {
          // Stable vendor chunks — cached aggressively by the browser
          'vendor-react':   ['react', 'react-dom'],
          'vendor-router':  ['react-router-dom'],
          'vendor-charts':  ['recharts'],
          'vendor-zustand': ['zustand'],
        },
      },
    },
  },

  envPrefix: 'VITE_',

  optimizeDeps: {
    // Pre-bundle on startup — eliminates waterfall requests in dev
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'zustand',
      'recharts',
    ],
    // Exclude large optional deps that are rarely used on first load
    exclude: [],
  },
})
