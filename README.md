# StockMind AI

AI-powered stock market analysis, prediction, and portfolio intelligence platform.

## Tech Stack

- **React 19** — UI
- **Vite** — build tooling
- **Vitest** — testing
- **ESLint + Prettier** — code quality
- **Netlify** — deployment

## Getting Started

```bash
npm install
npm run dev        # dev server on :3000
npm run build      # production build → build/
npm run preview    # preview production build locally
npm run test       # run tests once
npm run test:watch # run tests in watch mode
```

## Project Structure

```
src/
├── components/    # shared UI components
├── pages/         # route-level page components
├── hooks/         # custom React hooks
├── services/      # API clients (market data, AI inference)
├── store/         # global state (Zustand / Context)
├── utils/         # pure helper functions
├── types/         # shared type definitions
├── App.jsx
└── main.jsx
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

All client-side env vars must be prefixed with `VITE_`.

## Deployment (Netlify)

Configured via `netlify.toml`. Connect the repo in Netlify — it will pick up:

- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **SPA redirect:** all routes → `index.html`
