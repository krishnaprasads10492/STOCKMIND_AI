import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [react()],

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
    port: 3000,
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
        target:       'http://localhost:5000',
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
