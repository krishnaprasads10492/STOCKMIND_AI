/**
 * authStore — global auth state via Zustand.
 * Session token stored in localStorage — survives tab/browser close AND
 * server restarts (backend persists sessions to encrypted disk).
 * Token is cleared only on explicit logout or when the server rejects it.
 */

import { create } from 'zustand'

const TOKEN_KEY = 'sm_session'
const USER_KEY  = 'sm_user'

function loadFromStorage() {
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY) ?? null,
      user:  JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'),
    }
  } catch {
    return { token: null, user: null }
  }
}

export const useAuthStore = create((set) => {
  const { token, user } = loadFromStorage()

  return {
    token,
    user,
    isAuthenticated: !!(token && user),

    /** Derived — true when the logged-in user has the super-admin role */
    get isSuperAdmin() {
      return this.user?.role === 'super-admin'
    },

    setSession(sessionToken, userData) {
      localStorage.setItem(TOKEN_KEY, sessionToken)
      localStorage.setItem(USER_KEY, JSON.stringify(userData))
      set({ token: sessionToken, user: userData, isAuthenticated: true })
    },

    clearSession() {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      set({ token: null, user: null, isAuthenticated: false })
    },

    updatePreferences(prefs) {
      set(state => {
        const updated = { ...state.user, preferences: { ...state.user?.preferences, ...prefs } }
        localStorage.setItem(USER_KEY, JSON.stringify(updated))
        return { user: updated }
      })
    },

    clearMustChangePassword() {
      set(state => {
        const updated = { ...state.user, mustChangePassword: false }
        localStorage.setItem(USER_KEY, JSON.stringify(updated))
        return { user: updated }
      })
    },
  }
})
