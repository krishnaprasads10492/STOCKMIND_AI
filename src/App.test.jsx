import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import App from './App'

// ── Mock hooks that make network calls ────────────────────────────────────────
vi.mock('@hooks/useSystemHealth.js', () => ({
  useSystemHealth: () => ({ health: { level: 'full' }, loading: false }),
}))

test('renders app logo', () => {
  render(<App />)
  expect(screen.getByText('StockMind AI')).toBeInTheDocument()
})

test('renders placeholder heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: /AI Market Intelligence/i })).toBeInTheDocument()
})

test('renders non-removable disclaimer', () => {
  render(<App />)
  // Disclaimer must always be present — Section 16.3.1
  expect(screen.getByRole('note', { name: /disclaimer/i })).toBeInTheDocument()
})

test('renders main content region', () => {
  render(<App />)
  expect(screen.getByRole('main')).toBeInTheDocument()
})
