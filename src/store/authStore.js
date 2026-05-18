/**
 * authStore — global auth state via Zustand.
 * Session token stored in sessionStorage (cleared on tab/browser close).
 */

import { create } from 'zustand'

const TOKEN_KEY = 'sm_session'
const USER_KEY  = 'sm_user'

function loadFromSession() {
  try {
    return {
      token: sessionStorage.getItem(TOKEN_KEY) ?? null,
      user:  JSON.parse(sessionStorage.getItem(USER_KEY) ?? 'null'),
    }
  } catch {
    return { token: null, user: null }
  }
}

export const useAuthStore = create((set) => {
  const { token, user } = loadFromSession()

  return {
    token,
    user,
    isAuthenticated: !!(token && user),

    /** Derived — true when the logged-in user has the super-admin role */
    get isSuperAdmin() {
      return this.user?.role === 'super-admin'
    },

    setSession(sessionToken, userData) {
      sessionStorage.setItem(TOKEN_KEY, sessionToken)
      sessionStorage.setItem(USER_KEY, JSON.stringify(userData))
      set({ token: sessionToken, user: userData, isAuthenticated: true })
    },

    clearSession() {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(USER_KEY)
      set({ token: null, user: null, isAuthenticated: false })
    },

    updatePreferences(prefs) {
      set(state => {
        const updated = { ...state.user, preferences: { ...state.user?.preferences, ...prefs } }
        sessionStorage.setItem(USER_KEY, JSON.stringify(updated))
        return { user: updated }
      })
    },

    clearMustChangePassword() {
      set(state => {
        const updated = { ...state.user, mustChangePassword: false }
        sessionStorage.setItem(USER_KEY, JSON.stringify(updated))
        return { user: updated }
      })
    },
  }
})
