/**
 * tooltipStore — per-page tooltip preferences.
 * Persisted to localStorage under `sm_tooltips`.
 */

import { create } from 'zustand'

const STORE_KEY = 'sm_tooltips'

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} }
}

function persist(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    enabled:       state.enabled,
    showExamples:  state.showExamples,
    pageOverrides: state.pageOverrides,
  }))
}

export const useTooltipStore = create((set, get) => {
  const saved = load()
  return {
    enabled:       saved.enabled       ?? true,
    showExamples:  saved.showExamples  ?? true,
    pageOverrides: saved.pageOverrides ?? {},

    setGlobal(enabled, showExamples) {
      set(state => { const next = { ...state, enabled, showExamples }; persist(next); return { enabled, showExamples } })
    },

    setPageOverride(pageId, enabled, showExamples) {
      set(state => {
        const pageOverrides = { ...state.pageOverrides, [pageId]: { enabled, showExamples } }
        const next = { ...state, pageOverrides }; persist(next); return { pageOverrides }
      })
    },

    clearPageOverride(pageId) {
      set(state => {
        const pageOverrides = { ...state.pageOverrides }
        delete pageOverrides[pageId]
        const next = { ...state, pageOverrides }; persist(next); return { pageOverrides }
      })
    },

    getPageSettings(pageId) {
      const state = get()
      const override = state.pageOverrides[pageId]
      if (override != null) return override
      return { enabled: state.enabled, showExamples: state.showExamples }
    },
  }
})
