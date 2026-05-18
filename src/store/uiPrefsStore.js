/**
 * uiPrefsStore — per-page UI learning preferences.
 *
 * Controls:
 *   - infoTooltips: show/hide ⓘ icons globally
 *   - showExamples: show/hide examples inside tooltips
 *   - pageTooltips: per-page override (page → boolean)
 *
 * Persisted to localStorage so preferences survive page refresh.
 */

import { create } from 'zustand'

const STORE_KEY = 'sm_ui_prefs'

function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') } catch { return {} }
}

function save(state) {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    infoTooltips: state.infoTooltips,
    showExamples: state.showExamples,
    pageTooltips: state.pageTooltips,
  }))
}

export const useUiPrefsStore = create((set, get) => {
  const saved = load()
  return {
    infoTooltips: saved.infoTooltips ?? true,   // global on/off
    showExamples: saved.showExamples ?? true,   // show examples in tooltips
    pageTooltips: saved.pageTooltips ?? {},     // { pageName: boolean }

    setInfoTooltips(enabled) {
      set({ infoTooltips: enabled })
      save({ ...get(), infoTooltips: enabled })
    },

    setShowExamples(enabled) {
      set({ showExamples: enabled })
      save({ ...get(), showExamples: enabled })
    },

    setPageTooltips(page, enabled) {
      const pageTooltips = { ...get().pageTooltips, [page]: enabled }
      set({ pageTooltips })
      save({ ...get(), pageTooltips })
    },

    isTooltipVisible(page) {
      const s = get()
      if (!s.infoTooltips) return false
      if (page && page in s.pageTooltips) return s.pageTooltips[page]
      return true
    },
  }
})
