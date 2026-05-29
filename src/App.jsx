import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppShell } from '@components/AppShell.jsx'
import { ProtectedRoute } from '@components/ProtectedRoute.jsx'
import { ErrorBoundary } from '@components/ErrorBoundary.jsx'
import LoginPage from '@pages/Login/LoginPage.jsx'

// Lazy-load pages for code splitting
const DashboardPage   = lazy(() => import('@pages/Dashboard/DashboardPage.jsx'))
const PredictionsPage = lazy(() => import('@pages/Predictions/PredictionsPage.jsx'))
const HistoryPage     = lazy(() => import('@pages/History/HistoryPage.jsx'))
const FavouritesPage  = lazy(() => import('@pages/Favourites/FavouritesPage.jsx'))
const AdminPage       = lazy(() => import('@pages/Admin/AdminPage.jsx'))
const ConfiguratorPage = lazy(() => import('@pages/Configurator/ConfiguratorPage.jsx'))
const SettingsPage    = lazy(() => import('@pages/Settings/SettingsPage.jsx'))
const BacktestPage    = lazy(() => import('@pages/Backtest/BacktestPage.jsx'))
const StrategiesPage  = lazy(() => import('@pages/Strategies/StrategiesPage.jsx'))
const StrategyIntelligencePage = lazy(() => import('@pages/StrategyIntelligence/StrategyIntelligencePage.jsx'))
const JarvisPage      = lazy(() => import('@pages/Jarvis/JarvisPage.jsx'))
const AMIPage         = lazy(() => import('@pages/AMI/AMIPage.jsx'))
const MultibaggerPage = lazy(() => import('@pages/Multibagger/MultibaggerPage.jsx'))
const LearnPage       = lazy(() => import('@pages/Learn/LearnPage.jsx'))

function PageLoader() {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'200px', color:'var(--color-text-muted)', fontSize:'var(--text-sm)' }}>
      Loading…
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected — requires full auth */}
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={
              <Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>
            } />
            <Route path="/predictions" element={
              <Suspense fallback={<PageLoader />}><PredictionsPage /></Suspense>
            } />
            <Route path="/history" element={
              <Suspense fallback={<PageLoader />}><HistoryPage /></Suspense>
            } />
            <Route path="/favourites" element={
              <Suspense fallback={<PageLoader />}><FavouritesPage /></Suspense>
            } />
            <Route path="/settings" element={
              <Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>
            } />
            <Route path="/backtest" element={
              <Suspense fallback={<PageLoader />}><BacktestPage /></Suspense>
            } />
            <Route path="/strategies" element={
              <Suspense fallback={<PageLoader />}><StrategiesPage /></Suspense>
            } />
            <Route path="/strategy-intelligence" element={
              <Suspense fallback={<PageLoader />}><StrategyIntelligencePage /></Suspense>
            } />
            <Route path="/jarvis" element={
              <Suspense fallback={<PageLoader />}><JarvisPage /></Suspense>
            } />
            <Route path="/ami" element={
              <Suspense fallback={<PageLoader />}><AMIPage /></Suspense>
            } />
            <Route path="/multibagger" element={
              <Suspense fallback={<PageLoader />}><MultibaggerPage /></Suspense>
            } />
            <Route path="/learn" element={
              <Suspense fallback={<PageLoader />}><LearnPage /></Suspense>
            } />
            <Route path="/admin" element={
              <ProtectedRoute adminOnly>
                <Suspense fallback={<PageLoader />}><AdminPage /></Suspense>
              </ProtectedRoute>
            } />
            <Route path="/configurator" element={
              <ProtectedRoute adminOnly>
                <Suspense fallback={<PageLoader />}><ConfiguratorPage /></Suspense>
              </ProtectedRoute>
            } />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
