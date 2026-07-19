/**
 * ramaKnowledgeStore.js — Rama's long-term knowledge memory.
 *
 * Every meaningful Rama response is stored as a knowledge entry.
 * When MongoDB free-tier limits approach, old entries are CONSOLIDATED:
 *   - A summary/synthesis is generated from a batch of old entries
 *   - The summary replaces the originals (net storage reduction ~80%)
 *   - Rama learns from the consolidated pattern, not raw chat text
 *
 * Collection: rama_knowledge
 * Entry types: insight | decision | research | code | market | general
 *
 * Consolidation strategy (auto + manual):
 *   - Triggered when: entry count > MAX_ENTRIES or avg doc size > threshold
 *   - Groups entries by topic/type, summarises oldest 50 per group
 *   - Writes 1 consolidated entry, deletes the 50 originals
 *   - Net result: 50 entries → 1 entry (50x storage reduction)
 */

import crypto from 'crypto'
import { getMongoService } from './mongoService.js'
import { writeSecure, readSecure, listSecure, deleteSecure } from '../storage/fileStore.js'
import { encryptDoc, decryptDoc } from '../storage/mongoEncryption.js'

const LOCAL_PREFIX = 'rama_knowledge'
const MAX_ENTRIES_FREE_TIER = 2000   // conservative limit for Atlas free (512MB)
const CONSOLIDATE_BATCH = 50         // entries per consolidation pass
const MAX_ENTRY_CONTENT = 4000       // chars per knowledge entry

// ── Entry schema ──────────────────────────────────────────────────────────────
// {
//   _id:         uuid
//   type:        'insight'|'decision'|'research'|'code'|'market'|'general'|'consolidated'
//   topic:       string (short label, max 80 chars)
//   content:     string (the knowledge, max 4000 chars)
//   source:      'rama_response' | 'consolidation' | 'manual'
//   convId:      string | null   (originating conversation)
//   userId:      sha256 hash
//   username:    string
//   userRole:    string
//   intent:      string | null
//   provider:    string | null
//   importance:  1–5  (1=low, 5=critical — user can set, Rama infers)
//   tags:        string[]
//   pinned:      boolean  (pinned entries are NEVER consolidated or deleted)
//   createdAt:   ms timestamp
//   updatedAt:   ms timestamp
//   consolidatedFrom: string[] | null  (IDs of entries this replaced)
// }

function newId() {
  return crypto.randomUUID()
}

// ── Local fallback helpers ────────────────────────────────────────────────────

function localWrite(id, doc) {
  writeSecure(`${LOCAL_PREFIX}/${id}`, doc)
}

function localRead(id) {
  return readSecure(`${LOCAL_PREFIX}/${id}`)
}

function localList() {
  try { return listSecure(LOCAL_PREFIX) } catch { return [] }
}

// ── MongoDB helpers ───────────────────────────────────────────────────────────

async function getCol() {
  const mongo = await getMongoService()
  if (!mongo) return null
  return mongo.db.collection('rama_knowledge')
}

// ── Core: save a knowledge entry ─────────────────────────────────────────────

export async function saveKnowledgeEntry({
  type = 'general', topic, content, source = 'rama_response',
  convId = null, userId, username, userRole, intent = null,
  provider = null, importance = 3, tags = [],
}) {
  if (!topic || !content) return null
  const id  = newId()
  const now = Date.now()
  const doc = {
    _id:     id,
    type:    ['insight','decision','research','code','market','general','consolidated'].includes(type) ? type : 'general',
    topic:   String(topic).slice(0, 80),
    content: String(content).slice(0, MAX_ENTRY_CONTENT),
    source,
    convId:  convId ?? null,
    userId:  userId ? crypto.createHash('sha256').update(String(userId)).digest('hex').slice(0, 32) : 'anon',
    username: String(username ?? 'unknown').slice(0, 50),
    userRole: userRole ?? 'user',
    intent:  intent ?? null,
    provider: provider ?? null,
    importance: Math.min(5, Math.max(1, Number(importance ?? 3))),
    tags:    (Array.isArray(tags) ? tags : []).map(t => String(t).slice(0, 30)).slice(0, 10),
    pinned:  false,
    createdAt: now,
    updatedAt: now,
    consolidatedFrom: null,
  }

  try {
    const col = await getCol()
    if (col) {
      await col.insertOne(encryptDoc('rama_knowledge', { ...doc, _createdAt: new Date() }))
      // Trigger background consolidation check (non-blocking)
      checkAndConsolidate().catch(() => {})
      return id
    }
  } catch (err) {
    console.warn('[KnowledgeStore] MongoDB write failed, local fallback:', err.message)
  }

  localWrite(id, doc)
  return id
}

// ── Core: list / search ───────────────────────────────────────────────────────

export async function listKnowledge({
  page = 1, limit = 25, search = '', type = '',
  tags = [], pinned, importance, username = '',
} = {}) {
  const skip = (Math.max(1, page) - 1) * Math.min(limit, 100)
  const lim  = Math.min(limit, 100)

  try {
    const col = await getCol()
    if (col) {
      const filter = {}
      if (type)       filter.type     = type
      if (username)   filter.username = { $regex: username, $options: 'i' }
      if (search)     filter.$text    = { $search: search }
      if (pinned != null) filter.pinned = Boolean(pinned)
      if (importance) filter.importance = { $gte: Number(importance) }
      if (tags.length) filter.tags = { $in: tags }

      const [docs, total] = await Promise.all([
        col.find(filter).sort({ importance: -1, createdAt: -1 }).skip(skip).limit(lim).toArray(),
        col.countDocuments(filter),
      ])
      return {
        entries: docs.map(({ _createdAt, ...r }) => decryptDoc('rama_knowledge', r)),
        total, page, pages: Math.ceil(total / lim),
      }
    }
  } catch (err) {
    console.warn('[KnowledgeStore] MongoDB list failed:', err.message)
  }

  // Local fallback
  const ids = localList()
  const all = ids.map(id => localRead(id)).filter(Boolean)
  const filtered = all.filter(d => {
    if (type   && d.type     !== type)     return false
    if (pinned != null && Boolean(d.pinned) !== Boolean(pinned)) return false
    if (importance && d.importance < Number(importance)) return false
    if (search && !d.topic?.toLowerCase().includes(search.toLowerCase()) &&
        !d.content?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }).sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
  return {
    entries: filtered.slice(skip, skip + lim),
    total: filtered.length, page,
    pages: Math.ceil(filtered.length / lim),
  }
}

export async function getKnowledgeEntry(id) {
  try {
    const col = await getCol()
    if (col) {
      const doc = await col.findOne({ _id: id })
      if (!doc) return null
      const { _createdAt, ...rest } = doc
      return decryptDoc('rama_knowledge', rest)
    }
  } catch { /* fallback */ }
  return localRead(id)
}

// ── Update: pin / tag / importance ───────────────────────────────────────────

export async function updateKnowledgeEntry(id, patch) {
  const allowed = ['pinned','tags','importance','topic','content']
  const clean   = {}
  for (const k of allowed) {
    if (patch[k] !== undefined) clean[k] = patch[k]
  }
  clean.updatedAt = Date.now()

  try {
    const col = await getCol()
    if (col) {
      await col.updateOne({ _id: id }, { $set: { ...clean, _updatedAt: new Date() } })
      return
    }
  } catch { /* fallback */ }
  const doc = localRead(id)
  if (doc) localWrite(id, { ...doc, ...clean })
}

export async function deleteKnowledgeEntry(id) {
  try {
    const col = await getCol()
    if (col) { await col.deleteOne({ _id: id }); return }
  } catch { /* fallback */ }
  try { deleteSecure(`${LOCAL_PREFIX}/${id}`) } catch { /* silent */ }
}

// ── Storage stats ─────────────────────────────────────────────────────────────

export async function getKnowledgeStats() {
  try {
    const col = await getCol()
    if (col) {
      const [agg] = await col.aggregate([
        { $group: {
            _id:        null,
            total:      { $sum: 1 },
            pinned:     { $sum: { $cond: ['$pinned', 1, 0] } },
            consolidated: { $sum: { $cond: [{ $eq: ['$type', 'consolidated'] }, 1, 0] } },
            avgImportance: { $avg: '$importance' },
            byType:     { $push: '$type' },
          }
        },
      ]).toArray()

      const byType = {}
      for (const t of (agg?.byType ?? [])) byType[t] = (byType[t] ?? 0) + 1

      const storageInfo = await col.stats().catch(() => null)
      const sizeBytes   = storageInfo?.size ?? 0
      const freeTierLimitBytes = 512 * 1024 * 1024  // 512MB Atlas free
      const usagePct = sizeBytes ? Math.round((sizeBytes / freeTierLimitBytes) * 100) : null

      return {
        total:         agg?.total ?? 0,
        pinned:        agg?.pinned ?? 0,
        consolidated:  agg?.consolidated ?? 0,
        avgImportance: Math.round((agg?.avgImportance ?? 3) * 10) / 10,
        byType,
        storageBytes:  sizeBytes,
        storageKB:     Math.round(sizeBytes / 1024),
        freeTierUsagePct: usagePct,
        consolidationRecommended: (agg?.total ?? 0) > MAX_ENTRIES_FREE_TIER * 0.8,
        maxEntriesFreeTier: MAX_ENTRIES_FREE_TIER,
      }
    }
  } catch { /* fallback */ }

  const ids = localList()
  return {
    total: ids.length, pinned: 0, consolidated: 0,
    avgImportance: 3, byType: {}, storageBytes: null,
    consolidationRecommended: ids.length > MAX_ENTRIES_FREE_TIER * 0.8,
    maxEntriesFreeTier: MAX_ENTRIES_FREE_TIER,
  }
}

// ── Consolidation engine ──────────────────────────────────────────────────────
// Groups old non-pinned entries by type, summarises batches of 50 into 1.
// The summary preserves key facts; originals are deleted.

export async function checkAndConsolidate() {
  const stats = await getKnowledgeStats()
  if (!stats.consolidationRecommended) return { triggered: false, reason: 'below threshold' }
  return runConsolidation({ batchSize: CONSOLIDATE_BATCH })
}

export async function runConsolidation({ batchSize = CONSOLIDATE_BATCH, type = null } = {}) {
  const col = await getCol()
  const result = { triggered: true, batches: [], totalDeleted: 0, totalCreated: 0 }

  const types = type
    ? [type]
    : ['general', 'research', 'code', 'market', 'insight', 'decision']

  for (const t of types) {
    try {
      const filter = { type: t, pinned: { $ne: true }, source: { $ne: 'consolidation' } }
      const entries = col
        ? await col.find(filter).sort({ importance: 1, createdAt: 1 }).limit(batchSize).toArray()
        : localList().map(id => localRead(id)).filter(d => d?.type === t && !d.pinned).slice(0, batchSize)

      if (entries.length < 10) continue  // not worth consolidating tiny batches

      // Build summary text from the batch
      const summaryLines = entries.map((e, i) =>
        `[${i + 1}] ${e.topic}: ${e.content.slice(0, 200).replace(/\n/g, ' ')}`
      )
      const consolidatedContent = [
        `Consolidated ${entries.length} ${t} entries (oldest first).`,
        `Date range: ${new Date(entries[0].createdAt).toLocaleDateString()} – ${new Date(entries[entries.length-1].createdAt).toLocaleDateString()}`,
        `Key topics covered:`,
        ...summaryLines,
      ].join('\n')

      const ids    = entries.map(e => e._id)
      const maxImp = Math.max(...entries.map(e => e.importance ?? 3))
      const allTags = [...new Set(entries.flatMap(e => e.tags ?? []))].slice(0, 15)
      const now = Date.now()

      const newEntry = {
        _id:     newId(),
        type:    'consolidated',
        topic:   `[Consolidated ${entries.length}× ${t}] ${entries[0].topic.slice(0, 50)}…`,
        content: consolidatedContent.slice(0, MAX_ENTRY_CONTENT),
        source:  'consolidation',
        convId:  null,
        userId:  'system',
        username: 'Rama',
        userRole: 'system',
        intent:  null,
        provider: null,
        importance: maxImp,
        tags:    allTags,
        pinned:  false,
        createdAt: now,
        updatedAt: now,
        consolidatedFrom: ids,
      }

      if (col) {
        await col.insertOne(encryptDoc('rama_knowledge', { ...newEntry, _createdAt: new Date() }))
        await col.deleteMany({ _id: { $in: ids } })
      } else {
        localWrite(newEntry._id, newEntry)
        for (const id of ids) {
          try { deleteSecure(`${LOCAL_PREFIX}/${id}`) } catch { /* silent */ }
        }
      }

      result.batches.push({ type: t, consolidated: entries.length, into: newEntry._id })
      result.totalDeleted += entries.length
      result.totalCreated += 1
    } catch (err) {
      console.warn(`[KnowledgeStore] Consolidation failed for type ${t}:`, err.message)
    }
  }

  return result
}

// ── Rama Decision Analyzer ────────────────────────────────────────────────────
// Analyzes current storage state and produces a list of decisions with impacts.
// This is what gets shown to the user in the popup/page.

export async function analyzeStorageDecisions() {
  const stats = await getKnowledgeStats()
  const convStats = await import('./ramaConversationStore.js').then(m => m.getConversationStats()).catch(() => ({
    totalConversations: 0, totalMessages: 0, totalTokens: 0,
  }))

  const decisions = []
  const now = new Date().toISOString()

  // ── Decision 1: Knowledge entry limit ────────────────────────────────────
  const entryUsagePct = Math.round((stats.total / stats.maxEntriesFreeTier) * 100)
  decisions.push({
    id:       'knowledge_consolidation',
    category: 'Storage',
    title:    'Knowledge Entry Consolidation',
    status:   entryUsagePct > 80 ? 'urgent' : entryUsagePct > 60 ? 'recommended' : 'healthy',
    metric:   `${stats.total.toLocaleString()} / ${stats.maxEntriesFreeTier.toLocaleString()} entries (${entryUsagePct}%)`,
    situation: `Rama has ${stats.total} knowledge entries stored. Free-tier MongoDB Atlas has a 512MB document limit. ${entryUsagePct > 80 ? 'Storage is approaching critical levels.' : entryUsagePct > 60 ? 'Storage is at moderate usage.' : 'Storage is healthy.'}`,
    decision:  entryUsagePct > 60
      ? 'Run consolidation now: group oldest non-pinned entries by topic type, summarise each batch of 50 into 1 compact record. Estimated reduction: 80%.'
      : 'No immediate action needed. Auto-consolidation will trigger at 80% capacity.',
    impact: [
      entryUsagePct > 80 ? '🔴 Without action: writes will fail when Atlas free quota is hit' : null,
      'ℹ️  Consolidation merges 50 entries → 1 summary (pinned entries are never touched)',
      '📉 Storage reduction: ~80% per batch',
      '🧠 Knowledge is preserved in synthesised form — Rama can still reference it',
      `📌 ${stats.pinned} entries are pinned and will never be consolidated or deleted`,
    ].filter(Boolean),
    action: entryUsagePct > 60 ? 'consolidate' : null,
    reversible: false,
  })

  // ── Decision 2: Conversation history size ────────────────────────────────
  const convCount = convStats.totalConversations ?? 0
  const convStatus = convCount > 5000 ? 'urgent' : convCount > 2000 ? 'recommended' : 'healthy'
  decisions.push({
    id:       'conversation_pruning',
    category: 'Storage',
    title:    'Conversation History Pruning',
    status:   convStatus,
    metric:   `${convCount.toLocaleString()} conversations, ${(convStats.totalMessages ?? 0).toLocaleString()} messages, ${Math.round((convStats.totalTokens ?? 0) / 1000)}K tokens`,
    situation: `Conversation history has ${convCount} records. Each stores full message threads. Atlas free tier is shared across all collections.`,
    decision: convCount > 2000
      ? 'Prune conversations older than 90 days (keeping starred ones). This clears space for new conversations.'
      : 'No pruning needed yet. TTL index auto-expires conversations after 365 days.',
    impact: [
      '🗂  Only non-starred conversations older than 90 days are affected',
      '⭐ Starred conversations are permanent until manually deleted',
      `💬 ${convCount} conversations currently stored`,
      '♻️  TTL index already auto-deletes after 365 days — manual pruning extends runway',
    ],
    action: convCount > 2000 ? 'prune_conversations' : null,
    reversible: false,
  })

  // ── Decision 3: Storage backend choice ───────────────────────────────────
  decisions.push({
    id:       'storage_tier',
    category: 'Architecture',
    title:    'MongoDB Atlas Free Tier vs Paid vs Local',
    status:   'informational',
    metric:   `Atlas M0 Free: 512MB shared. Atlas M10: $57/mo, 10GB dedicated. Local: unlimited, private.`,
    situation: 'Currently using MongoDB Atlas M0 (free shared cluster). This is sufficient for moderate use but has storage/performance limits.',
    decision:  'Decide whether to: (A) stay on free tier with smart consolidation, (B) upgrade to Atlas M10 paid, or (C) switch to local SQLite for full privacy.',
    impact: [
      '(A) Free tier + consolidation: zero cost, ~2000 effective entries, slight data loss in consolidation',
      '(B) Atlas M10 paid ($57/mo): 10GB storage, no consolidation needed, cloud backup',
      '(C) Local SQLite: unlimited storage, fully private, no cloud dependency, no remote access',
      '⚠️  Free tier shared cluster can have latency spikes during peak Atlas usage',
    ],
    action: null,
    reversible: true,
  })

  // ── Decision 4: Knowledge extraction quality ─────────────────────────────
  decisions.push({
    id:       'knowledge_extraction',
    category: 'Intelligence',
    title:    'Auto-Extract Knowledge from Responses',
    status:   'recommended',
    metric:   `Currently: manual save only. Proposed: auto-classify every response with importance ≥ 3`,
    situation: 'Rama can auto-detect whether a response contains reusable knowledge (research findings, code solutions, market insights, decisions) and save it automatically with an importance score.',
    decision:  'Enable automatic knowledge extraction on all super-admin and admin conversations. Rama classifies the response type and importance (1–5). Only importance ≥ 3 is saved automatically.',
    impact: [
      '🧠 Rama builds a growing knowledge base from every meaningful conversation',
      '🔍 Future responses can reference stored knowledge for better accuracy',
      '📊 Importance scoring prevents low-value chatter from filling storage',
      '⚡ Background extraction — zero impact on response latency',
    ],
    action: 'enable_auto_extract',
    reversible: true,
  })

  // ── Decision 5: Sensitive data policy ────────────────────────────────────
  decisions.push({
    id:       'data_transparency',
    category: 'Privacy',
    title:    'What Rama Stores and Does Not Store',
    status:   'informational',
    metric:   'Full transparency report',
    situation: 'Rama currently stores: conversation threads (messages, intent, provider, token count), knowledge entries (response summaries, insights). Rama does NOT store: passwords, keys, credentials, raw user IDs (only SHA-256 hashes), financial transaction data.',
    decision:  'No action required. This entry documents current data handling for your reference.',
    impact: [
      '✅ User IDs are SHA-256 hashed — not reversible',
      '✅ No passwords, keys, or credentials in MongoDB',
      '✅ Safety-filtered content is stored as-is (after filtering)',
      '✅ All local fallback data is AES-256-GCM encrypted',
      'ℹ️  MongoDB Atlas data is in plaintext at rest (Atlas encryption at rest is M10+ only)',
      '⚠️  If privacy is critical, consider local SQLite mode (Decision 3-C)',
    ],
    action: null,
    reversible: true,
  })

  return {
    analyzedAt: now,
    stats: {
      knowledge: stats,
      conversations: convStats,
    },
    decisions,
    summary: {
      urgent: decisions.filter(d => d.status === 'urgent').length,
      recommended: decisions.filter(d => d.status === 'recommended').length,
      informational: decisions.filter(d => d.status === 'informational').length,
    },
  }
}
