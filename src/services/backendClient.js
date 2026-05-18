/**
 * backendClient.js — typed wrappers around the local Express backend.
 */

import { apiFetch, ApiError } from './apiClient.js'
import { useAuthStore } from '@store/authStore.js'

const BASE = '/api'

function authHeaders() {
  const token = useAuthStore.getState().token
  return token ? { 'x-session-token': token } : {}
}

/**
 * Safe fetch — returns the JSON body even on 4xx errors (so callers can read error messages).
 * Only throws on network failures or 5xx.
 */
async function safeFetch(url, options = {}) {
  try {
    const res = await apiFetch(url, options)
    return res.json()
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      // Return the error message as a plain object so the UI can display it
      return { error: err.message }
    }
    throw err // re-throw network/5xx errors
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export function loginStep1(username, password) {
  return safeFetch(`${BASE}/auth/login/step1`, {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function loginStep2(stepToken, key) {
  return safeFetch(`${BASE}/auth/login/step2`, {
    method: 'POST',
    body: JSON.stringify({ stepToken, key }),
  })
}

export async function logoutApi() {
  await apiFetch(`${BASE}/auth/logout`, {
    method: 'POST',
    headers: authHeaders(),
  }).catch(() => {})
}

// ── Users ─────────────────────────────────────────────────────────────────────

export function fetchUsers() {
  return safeFetch(`${BASE}/users`, { headers: authHeaders() })
}

export function createUserApi(fields) {
  return safeFetch(`${BASE}/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(fields),
  })
}

export function updatePreferencesApi(userId, prefs) {
  return safeFetch(`${BASE}/users/${userId}/preferences`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(prefs),
  })
}

export function fetchMe() {
  return safeFetch(`${BASE}/auth/me`, { headers: authHeaders() })
}

// ── Predictions ───────────────────────────────────────────────────────────────

export function savePredictions(batch) {
  return safeFetch(`${BASE}/predictions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(batch),
  })
}

export function fetchPredictionHistory(symbol, limit = 50) {
  return safeFetch(
    `${BASE}/predictions/${encodeURIComponent(symbol)}?limit=${limit}`,
    { headers: authHeaders() }
  )
}

export function fetchAccuracy(symbol, days = 30) {
  return safeFetch(
    `${BASE}/predictions/${encodeURIComponent(symbol)}/accuracy?days=${days}`,
    { headers: authHeaders() }
  )
}

// ── Auth extras ───────────────────────────────────────────────────────────────

/**
 * Generate a new 12-digit access key for the current user.
 * Requires password re-verification.
 */
export function generateKeyApi(password, daysValid = 30) {
  return safeFetch(`${BASE}/auth/keygen`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ password, daysValid }),
  })
}

/**
 * Generate a key using a Step-1 token (pre-session, on the login page).
 * No full session needed — Step-1 token proves identity.
 */
export function generateKeyWithStepToken(stepToken, daysValid = 30) {
  return safeFetch(`${BASE}/auth/keygen-with-step-token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ stepToken, daysValid }),
  })
}

/**
 * Generate a key using username + password directly (no stepToken needed).
 * Used when the user has no stepToken or it expired.
 * Returns the key AND a fresh stepToken so login can continue.
 */
export function generateKeyWithCredentials(username, password, daysValid = 30) {
  return safeFetch(`${BASE}/auth/keygen-with-credentials`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ username, password, daysValid }),
  })
}

/**
 * Change own password.
 */
export function changePasswordApi(currentPassword, newPassword) {
  return safeFetch(`${BASE}/auth/change-password`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ currentPassword, newPassword }),
  })
}

// ── Admin user management ─────────────────────────────────────────────────────

export function generateKeyForUserApi(userId, daysValid = 30) {
  return safeFetch(`${BASE}/users/${encodeURIComponent(userId)}/keygen`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ daysValid }),
  })
}

export function resetPasswordApi(userId, newPassword) {
  return safeFetch(`${BASE}/users/${encodeURIComponent(userId)}/reset-password`, {
    method:  'POST',
    headers: authHeaders(),
    body:    JSON.stringify({ newPassword }),
  })
}

export function deactivateUserApi(userId) {
  return safeFetch(`${BASE}/users/${encodeURIComponent(userId)}`, {
    method:  'DELETE',
    headers: authHeaders(),
  })
}

export function reactivateUserApi(userId) {
  return safeFetch(`${BASE}/users/${encodeURIComponent(userId)}/activate`, {
    method:  'PATCH',
    headers: authHeaders(),
  })
}
