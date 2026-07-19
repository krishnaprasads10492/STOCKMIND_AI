/**
 * ramaConversationStore.js — Persistent conversation storage for Rama AI.
 *
 * Stores every Rama conversation turn in MongoDB (`rama_conversations` collection)
 * with a local encrypted-file fallback when Atlas is unavailable.
 *
 * Schema (one document per conversation):
 * ─────────────────────────────────────────────────────────────────────────────
 *   _id          : conv_id (UUID from Python brain)
 *   userId       : hashed user id (no raw user data)
 *   username     : display name for admin table
 *   userRole     : 'super-admin' | 'admin' | 'user'
 *   startedAt    : timestamp (ms)
 *   lastMessageAt: timestamp (ms)
 *   messageCount : total messages (user + assistant)
 *   totalTokens  : cumulative tokens used
 *   provider     : last AI provider used
 *   title        : auto-generated from first user message (first 80 chars)
 *   starred      : boolean — admin can pin important conversations
 *   tags         : string[] — for categorization
 *   messages     : [{ role, content, intent, provider, tokens, ts, wasFiltered }]
 *
 * Security:
 *   - userId is a SHA-256 hash — never the raw DB user id
 *   - Safety-filtered content is stored as-is (after filtering)
 *   - No credentials, tokens, or keys ever reach this store
 * ─────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'crypto'
import { getMongoService } from './mongoService.js'
import { writeSecure, readSecure, existsSecure, listSecure } from '../storage/fileStore.js'

const LOCAL_PREFIX = 'rama_conversations'
const MAX_MESSAGES_PER_CONV = 200  // hard cap per conversation
const MAX_CONTENT_CHARS = 8_000    // per message content — prevents runaway storage

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashUserId(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32)
}

function autoTitle(firstUserMessage) {
  const clean = String(firstUserMessage ?? '').trim().replace(/\s+/g, ' ')
  return clean.length > 80 ? clean.slice(0, 77) + '…' : clean || 'New conversation'
}

function sanitizeMessage(msg) {
  return {
    role:        msg.role === 'assistant' ? 'assistant' : 'user',
    content:     String(msg.content ?? '').slice(0, MAX_CONTENT_CHARS),
    intent:      msg.intent     ?? null,
    provider:    msg.provider   ?? null,
    tokens:      Number(msg.tokens ?? 0),
    ts:          msg.ts ?? Date.now(),
    wasFiltered: Boolean(msg.wasFiltered),
  }
}

// ── Local fallback ────────────────────────────────────────────────────────────

function localRead(convId) {
  return readSecure(`${LOCAL_PREFIX}/${convId}`)
}

function localWrite(convId, doc) {
  writeSecure(`${LOCAL_PREFIX}/${convId}`, doc)
}

function localList() {
  try { return listSecure(LOCAL_PREFIX) } catch { return [] }
}

// ── MongoDB operations ────────────────────────────────────────────────────────

async function getCollection() {
  const mongo = await getMongoService()
  if (!mongo) return null
  return mongo.db.collection('rama_conversations')
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start or retrieve a conversation record. Called when a new conv_id is issued.
 */
export async function initConversation(convId, { userId, username, userRole }) {
  const doc = {
    _id:           convId,
    userId:        hashUserId(userId),
    username:      String(username ?? 'unknown').slice(0, 50),
    userRole:      ['super-admin', 'admin', 'user'].includes(userRole) ? userRole : 'user',
    startedAt:     Date.now(),
    lastMessageAt: Date.now(),
    messageCount:  0,
    totalTokens:   0,
    provider:      'local',
    title:         'New conversation',
    starred:       false,
    tags:          [],
    messages:      [],
  }

  try {
    const col = await getCollection()
    if (col) {
      await col.insertOne({ ...doc, _createdAt: new Date() })
      return
    }
  } catch { /* fallback */ }

  localWrite(convId, doc)
}

/**
 * Append a user + assistant exchange to a conversation.
 * Called after every successful /brain/chat response.
 *
 * @param {string} convId
 * @param {object} exchange  — { userMessage, assistantMessage, intent, provider, tokens, wasFiltered }
 * @param {object} meta      — { userId, username, userRole } (for auto-init if needed)
 */
export async function appendExchange(convId, exchange, meta = {}) {
  const now = Date.now()
  const userMsg = sanitizeMessage({
    role:    'user',
    content: exchange.userMessage,
    intent:  exchange.intent,
    ts:      now,
  })
  const assistantMsg = sanitizeMessage({
    role:        'assistant',
    content:     exchange.assistantMessage,
    intent:      exchange.intent,
    provider:    exchange.provider,
    tokens:      exchange.tokens ?? 0,
    ts:          now + 1,
    wasFiltered: exchange.wasFiltered ?? false,
  })

  try {
    const col = await getCollection()
    if (col) {
      // Upsert — creates the doc if initConversation was skipped
      await col.updateOne(
        { _id: convId },
        {
          $set: {
            lastMessageAt: now,
            provider:      exchange.provider ?? 'local',
            _updatedAt:    new Date(),
            // Set title from first user message if still default
            ...(exchange.isFirst ? {
              title:  autoTitle(exchange.userMessage),
              userId: hashUserId(meta.userId),
              username: String(meta.username ?? 'unknown').slice(0, 50),
              userRole: ['super-admin', 'admin', 'user'].includes(meta.userRole) ? meta.userRole : 'user',
              startedAt: now,
            } : {}),
          },
          $inc: {
            messageCount: 2,
            totalTokens:  Number(exchange.tokens ?? 0),
          },
          $push: {
            messages: {
              $each:  [userMsg, assistantMsg],
              $slice: -MAX_MESSAGES_PER_CONV,  // keep last N messages
            },
          },
          $setOnInsert: {
            starred:   false,
            tags:      [],
            _createdAt: new Date(),
          },
        },
        { upsert: true }
      )
      return
    }
  } catch (err) {
    console.warn('[RamaConvStore] MongoDB write failed, using local fallback:', err.message)
  }

  // Local fallback
  let doc = localRead(convId) ?? {
    _id:           convId,
    userId:        hashUserId(meta.userId ?? 'anon'),
    username:      String(meta.username ?? 'unknown').slice(0, 50),
    userRole:      meta.userRole ?? 'user',
    startedAt:     now,
    lastMessageAt: now,
    messageCount:  0,
    totalTokens:   0,
    provider:      exchange.provider ?? 'local',
    title:         autoTitle(exchange.userMessage),
    starred:       false,
    tags:          [],
    messages:      [],
  }

  if (doc.title === 'New conversation' && exchange.isFirst) {
    doc.title = autoTitle(exchange.userMessage)
  }

  doc.lastMessageAt = now
  doc.messageCount  = (doc.messageCount ?? 0) + 2
  doc.totalTokens   = (doc.totalTokens  ?? 0) + (exchange.tokens ?? 0)
  doc.provider      = exchange.provider ?? doc.provider
  doc.messages      = [...(doc.messages ?? []), userMsg, assistantMsg].slice(-MAX_MESSAGES_PER_CONV)
  localWrite(convId, doc)
}

/**
 * List conversations (paginated, sorted newest first).
 * @param {{ page, limit, search, userRole, username, starred }} opts
 */
export async function listConversations({ page = 1, limit = 25, search = '', userRole = '', username = '', starred } = {}) {
  const skip = (Math.max(1, page) - 1) * Math.min(limit, 100)
  const lim  = Math.min(limit, 100)

  try {
    const col = await getCollection()
    if (col) {
      const filter = {}
      if (userRole)  filter.userRole  = userRole
      if (username)  filter.username  = { $regex: username,   $options: 'i' }
      if (search)    filter.title     = { $regex: search,     $options: 'i' }
      if (starred != null) filter.starred = Boolean(starred)

      const [docs, total] = await Promise.all([
        col.find(filter, { projection: { messages: 0 } })
           .sort({ lastMessageAt: -1 })
           .skip(skip)
           .limit(lim)
           .toArray(),
        col.countDocuments(filter),
      ])

      return {
        conversations: docs.map(({ _createdAt, _updatedAt, ...rest }) => rest),
        total,
        page,
        pages: Math.ceil(total / lim),
      }
    }
  } catch (err) {
    console.warn('[RamaConvStore] MongoDB list failed, using local fallback:', err.message)
  }

  // Local fallback
  const ids  = localList()
  const all  = ids.map(id => localRead(id)).filter(Boolean)
  const filtered = all.filter(d => {
    if (userRole && d.userRole !== userRole) return false
    if (username && !d.username?.toLowerCase().includes(username.toLowerCase())) return false
    if (search   && !d.title?.toLowerCase().includes(search.toLowerCase())) return false
    if (starred != null && Boolean(d.starred) !== Boolean(starred)) return false
    return true
  }).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))

  const page_docs = filtered.slice(skip, skip + lim)
  return {
    conversations: page_docs,
    total: filtered.length,
    page,
    pages: Math.ceil(filtered.length / lim),
  }
}

/**
 * Get a single conversation including full message history.
 */
export async function getConversation(convId) {
  try {
    const col = await getCollection()
    if (col) {
      const doc = await col.findOne({ _id: convId })
      if (!doc) return null
      const { _createdAt, _updatedAt, ...rest } = doc
      return rest
    }
  } catch { /* fallback */ }
  return localRead(convId)
}

/**
 * Toggle starred state on a conversation.
 */
export async function starConversation(convId, starred) {
  try {
    const col = await getCollection()
    if (col) {
      await col.updateOne({ _id: convId }, { $set: { starred: Boolean(starred), _updatedAt: new Date() } })
      return
    }
  } catch { /* fallback */ }
  const doc = localRead(convId)
  if (doc) { doc.starred = Boolean(starred); localWrite(convId, doc) }
}

/**
 * Add or remove a tag from a conversation.
 */
export async function tagConversation(convId, tags) {
  const cleanTags = (Array.isArray(tags) ? tags : []).map(t => String(t).slice(0, 30)).slice(0, 10)
  try {
    const col = await getCollection()
    if (col) {
      await col.updateOne({ _id: convId }, { $set: { tags: cleanTags, _updatedAt: new Date() } })
      return
    }
  } catch { /* fallback */ }
  const doc = localRead(convId)
  if (doc) { doc.tags = cleanTags; localWrite(convId, doc) }
}

/**
 * Delete a conversation (super-admin only).
 */
export async function deleteConversation(convId) {
  try {
    const col = await getCollection()
    if (col) {
      await col.deleteOne({ _id: convId })
      return
    }
  } catch { /* fallback */ }
  try {
    const { deleteSecure } = await import('../storage/fileStore.js')
    deleteSecure(`${LOCAL_PREFIX}/${convId}`)
  } catch { /* silent */ }
}

/**
 * Get aggregate stats — total convs, messages, tokens, top users.
 */
export async function getConversationStats() {
  try {
    const col = await getCollection()
    if (col) {
      const [agg] = await col.aggregate([
        {
          $group: {
            _id:           null,
            totalConvs:    { $sum: 1 },
            totalMessages: { $sum: '$messageCount' },
            totalTokens:   { $sum: '$totalTokens' },
            byRole: {
              $push: '$userRole',
            },
          },
        },
      ]).toArray()

      const byRole = {}
      for (const r of (agg?.byRole ?? [])) {
        byRole[r] = (byRole[r] ?? 0) + 1
      }

      const recent = await col.find({}, { projection: { messages: 0 } })
        .sort({ lastMessageAt: -1 }).limit(5).toArray()

      return {
        totalConversations: agg?.totalConvs    ?? 0,
        totalMessages:      agg?.totalMessages ?? 0,
        totalTokens:        agg?.totalTokens   ?? 0,
        byRole,
        recentConversations: recent.map(({ _createdAt, _updatedAt, ...r }) => r),
      }
    }
  } catch { /* fallback */ }

  // Local fallback
  const ids  = localList()
  const all  = ids.map(id => localRead(id)).filter(Boolean)
  const byRole = {}
  let totalMessages = 0, totalTokens = 0
  for (const d of all) {
    byRole[d.userRole ?? 'user'] = (byRole[d.userRole ?? 'user'] ?? 0) + 1
    totalMessages += d.messageCount ?? 0
    totalTokens   += d.totalTokens  ?? 0
  }
  return {
    totalConversations: all.length,
    totalMessages,
    totalTokens,
    byRole,
    recentConversations: all.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)).slice(0, 5),
  }
}
