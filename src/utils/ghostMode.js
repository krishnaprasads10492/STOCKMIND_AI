/**
 * ghostMode.js — complete zero-trace wipe of all app data from the device.
 *
 * Clears: localStorage (sm_ keys), sessionStorage, IndexedDB, Cache API,
 *         Service Workers, cookies, history state.
 *
 * Does NOT delete server-side encrypted data automatically —
 * that requires an explicit call to wipeServerData() with an admin token.
 *
 * All processing is LOCAL — no data is sent anywhere by this module.
 */

import { apiFetch } from '@services/apiClient.js'

// ── Local wipe helpers ────────────────────────────────────────────────────────

function clearLocalStorage() {
  try {
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('sm_')) keysToRemove.push(key)
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

function clearSessionStorageAll() {
  try {
    sessionStorage.clear()
  } catch { /* ignore */ }
}

async function clearIndexedDB() {
  try {
    if (!window.indexedDB) return
    const dbs = await window.indexedDB.databases?.() ?? []
    await Promise.allSettled(
      dbs.map(db => new Promise((resolve, reject) => {
        if (!db.name) { resolve(); return }
        const req = window.indexedDB.deleteDatabase(db.name)
        req.onsuccess = resolve
        req.onerror   = reject
        req.onblocked = resolve
      }))
    )
  } catch { /* ignore */ }
}

async function unregisterServiceWorkers() {
  try {
    if (!navigator.serviceWorker) return
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.allSettled(registrations.map(r => r.unregister()))
  } catch { /* ignore */ }
}

async function clearCacheAPI() {
  try {
    if (!window.caches) return
    const keys = await caches.keys()
    await Promise.allSettled(keys.map(k => caches.delete(k)))
  } catch { /* ignore */ }
}

function clearCookies() {
  try {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const name = cookie.split('=')[0].trim()
      if (!name) continue
      // Clear for current path and root
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`
    }
  } catch { /* ignore */ }
}

function replaceHistoryState() {
  try {
    // Replace all history entries so back button leads nowhere
    window.history.replaceState(null, '', window.location.href)
    // Push a blank state so the current entry is also cleared
    window.history.pushState(null, '', 'about:blank')
  } catch { /* ignore */ }
}

function overwriteDOM() {
  try {
    document.body.innerHTML = ''
    document.head.innerHTML = ''
    document.title = ''
  } catch { /* ignore */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Activate Ghost Mode — complete zero-trace wipe of all local app data.
 * After calling this, the page navigates to about:blank.
 *
 * Steps:
 * 1. Clear all localStorage keys starting with 'sm_'
 * 2. Clear sessionStorage
 * 3. Clear all IndexedDB databases
 * 4. Unregister all service workers
 * 5. Clear Cache API caches
 * 6. Clear cookies for localhost
 * 7. Replace history state (no back button)
 * 8. Overwrite DOM with blank page
 * 9. Navigate to about:blank
 */
export async function activateGhostMode() {
  // Run all wipes in parallel where possible
  clearLocalStorage()
  clearSessionStorageAll()
  clearCookies()

  await Promise.allSettled([
    clearIndexedDB(),
    unregisterServiceWorkers(),
    clearCacheAPI(),
  ])

  replaceHistoryState()
  overwriteDOM()

  // Final navigation — leaves no trace in browser history
  try {
    window.location.replace('about:blank')
  } catch {
    window.location.href = 'about:blank'
  }
}

/**
 * Wipe all server-side encrypted data files.
 * Requires a valid super-admin session token.
 * POST /api/ghost/wipe
 *
 * @param {string} token — super-admin session token
 */
export async function wipeServerData(token) {
  const res = await apiFetch('/api/ghost/wipe', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ confirm: true }),
    timeoutMs: 15_000,
  })
  return res.json()
}

/**
 * Wipe a specific user's server-side data.
 * Requires admin session token.
 * POST /api/ghost/wipe-user
 *
 * @param {string} targetUserId
 * @param {string} token — admin session token
 */
export async function wipeUserData(targetUserId, token) {
  const res = await apiFetch('/api/ghost/wipe-user', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ userId: targetUserId }),
    timeoutMs: 15_000,
  })
  return res.json()
}
