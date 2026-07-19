/**
 * @fileoverview JARVIS client — connects to the self-healing AI intelligence system.
 * Uses SSE for live event streaming with polling fallback.
 */

import { apiFetch } from './apiClient.js'

/** @param {string} token */
export async function fetchJarvisStatus(token) {
  const res = await apiFetch('/api/jarvis/status', {
    headers: { 'x-session-token': token },
    timeoutMs: 15_000,
  })
  return res.json()
}

export async function fetchNodeHealth(token) {
  const res = await apiFetch('/api/jarvis/node-health', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function fetchDependencies(token) {
  const res = await apiFetch('/api/jarvis/dependencies', {
    headers: { 'x-session-token': token },
    timeoutMs: 60_000,
  })
  return res.json()
}

export async function fetchCodeHealth(token) {
  const res = await apiFetch('/api/jarvis/code-health', {
    headers: { 'x-session-token': token },
    timeoutMs: 30_000,
  })
  return res.json()
}

export async function fetchAlgoProposals(token) {
  const res = await apiFetch('/api/jarvis/algo-proposals', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function forceScan(scanType, token) {
  const res = await apiFetch('/api/jarvis/force-scan', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ scan_type: scanType }),
    timeoutMs: 90_000,
  })
  return res.json()
}

export async function approveJarvisAction(actionId, approved, token) {
  const res = await apiFetch('/api/jarvis/approve', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ action_id: actionId, approved }),
  })
  return res.json()
}

export async function pollEvents(since, token) {
  const res = await apiFetch(`/api/jarvis/events/poll?since=${since}`, {
    headers: { 'x-session-token': token },
    timeoutMs: 10_000,
  })
  return res.json()
}

/**
 * Create an SSE connection to the JARVIS live event stream.
 * Falls back to polling if SSE fails.
 * @param {string} token
 * @param {function} onEvent  — called with each event object
 * @param {function} onError  — called on connection error
 * @returns {{ close: function }} — call close() to disconnect
 */
export function connectJarvisStream(token, onEvent, onError) {
  // SSE via fetch (works through the Express proxy with auth header)
  let closed = false
  let pollTimer = null
  let lastTs = Date.now() / 1000 - 60  // last 60 seconds on connect

  async function startPolling() {
    if (closed) return
    try {
      const data = await pollEvents(lastTs, token)
      if (data.events?.length) {
        for (const evt of data.events) {
          onEvent(evt)
          lastTs = Math.max(lastTs, evt.timestamp ?? lastTs)
        }
      }
      lastTs = data.timestamp ?? lastTs
    } catch (err) {
      onError?.(err)
    }
    if (!closed) {
      pollTimer = setTimeout(startPolling, 5_000)
    }
  }

  // Try native EventSource first (simplest, but no custom headers)
  // Since we need auth headers, use fetch-based polling instead
  startPolling()

  return {
    close() {
      closed = true
      clearTimeout(pollTimer)
    },
  }
}

/**
 * Ask JARVIS to generate a theme from a name and description.
 * @param {string} name
 * @param {string} description
 * @param {string} token
 * @returns {Promise<{ ok: boolean, theme: object }>}
 */
export async function generateTheme(name, description, token) {
  const res = await apiFetch('/api/jarvis/generate-theme', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ name, description }),
    timeoutMs: 15_000,
  })
  return res.json()
}

/**
 * Write an approved generated theme permanently to themes.js.
 * Requires admin role and a valid approval token.
 * @param {string} approvalToken
 * @param {object} theme
 * @param {string} token
 * @returns {Promise<{ ok: boolean, key: string, message: string }>}
 */
export async function writeTheme(approvalToken, theme, token) {
  const res = await apiFetch('/api/jarvis/write-theme', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ approval_token: approvalToken, theme }),
    timeoutMs: 30_000,
  })
  return res.json()
}

/**
 * Issue an approval token for a codebase operation.
 * @param {string} token
 * @returns {Promise<{ token: string, expires_in_seconds: number }>}
 */
export async function issueApprovalToken(token) {
  const res = await apiFetch('/api/jarvis/issue-token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({}),
  })
  return res.json()
}

// ── Brain chat ────────────────────────────────────────────────────────────────

export async function brainChat(message, convId, useCloud = true, token) {
  const res = await apiFetch('/api/jarvis/brain/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ message, conv_id: convId ?? null, use_cloud: useCloud }),
    timeoutMs: 45_000,
  })
  return res.json()
}

export async function brainFeedback(convId, messageIdx, feedback, intent, token) {
  const res = await apiFetch('/api/jarvis/brain/feedback', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ conv_id: convId, message_idx: messageIdx, feedback, intent: intent ?? '' }),
  })
  return res.json()
}

export async function fetchBrainStats(token) {
  const res = await apiFetch('/api/jarvis/brain/stats', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function newConversation(token) {
  const res = await apiFetch('/api/jarvis/brain/new-conversation', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({}),
  })
  return res.json()
}

// ── AGI ───────────────────────────────────────────────────────────────────────

export async function agiExecute(goal, convId, useAgent = true, token) {
  const res = await apiFetch('/api/jarvis/agi/execute', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ goal, conv_id: convId ?? null, use_agent: useAgent }),
    timeoutMs: 120_000,
  })
  return res.json()
}

export async function fetchAGITask(taskId, token) {
  const res = await apiFetch(`/api/jarvis/agi/task/${taskId}`, {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function fetchAGICapabilities(token) {
  const res = await apiFetch('/api/jarvis/agi/capabilities', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function agiFeedback(response, feedback, intent, token) {
  const res = await apiFetch('/api/jarvis/agi/feedback', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ response, feedback, intent: intent ?? '' }),
  })
  return res.json()
}

export async function fetchAGIInsights(token) {
  const res = await apiFetch('/api/jarvis/agi/insights', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

// ── Provider management ───────────────────────────────────────────────────────

export async function fetchProviders(token) {
  const res = await apiFetch('/api/jarvis/providers', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function addProvider(config, token) {
  const res = await apiFetch('/api/jarvis/providers/add', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify(config),
  })
  return res.json()
}

export async function setActiveModel(providerId, modelId, token) {
  const res = await apiFetch('/api/jarvis/providers/set-model', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ provider_id: providerId, model_id: modelId }),
  })
  return res.json()
}

export async function setActiveProvider(providerId, token) {
  const res = await apiFetch('/api/jarvis/providers/set-active', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ provider_id: providerId }),
  })
  return res.json()
}

export async function testProvider(providerId, modelId, token) {
  const res = await apiFetch('/api/jarvis/providers/test', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ provider_id: providerId, model_id: modelId }),
    timeoutMs: 30_000,
  })
  return res.json()
}

export async function generateProviderConfig(name, baseUrl, envKey, format, token) {
  const res = await apiFetch('/api/jarvis/providers/generate-config', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ name, base_url: baseUrl, env_key: envKey, format }),
  })
  return res.json()
}

// ── Self-optimization (super-admin only) ──────────────────────────────────────

export async function triggerSelfOptimize(token) {
  const res = await apiFetch('/api/jarvis/brain/self-optimize', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({}),
    timeoutMs: 60_000,
  })
  return res.json()
}

// ── Conversation Store ────────────────────────────────────────────────────────

export async function fetchConversationStore({ page = 1, limit = 25, search = '', userRole = '', username = '', starred } = {}, token) {
  const params = new URLSearchParams({ page, limit })
  if (search)   params.set('search',   search)
  if (userRole) params.set('userRole', userRole)
  if (username) params.set('username', username)
  if (starred != null) params.set('starred', String(starred))
  const res = await apiFetch(`/api/jarvis/brain/conversation-store?${params}`, {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function fetchConversationStoreStats(token) {
  const res = await apiFetch('/api/jarvis/brain/conversation-store/stats', {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function fetchConversationDetail(convId, token) {
  const res = await apiFetch(`/api/jarvis/brain/conversation-store/${convId}`, {
    headers: { 'x-session-token': token },
  })
  return res.json()
}

export async function starConversationInStore(convId, starred, token) {
  const res = await apiFetch(`/api/jarvis/brain/conversation-store/${convId}/star`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ starred }),
  })
  return res.json()
}

export async function tagConversationInStore(convId, tags, token) {
  const res = await apiFetch(`/api/jarvis/brain/conversation-store/${convId}/tags`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-session-token': token },
    body:    JSON.stringify({ tags }),
  })
  return res.json()
}

export async function deleteConversationFromStore(convId, token) {
  const res = await apiFetch(`/api/jarvis/brain/conversation-store/${convId}`, {
    method:  'DELETE',
    headers: { 'x-session-token': token },
  })
  return res.json()
}
