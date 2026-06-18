"""
doc_upgrade_analyser.py — AI-driven documentation upgrade analyser

Reads a tech doc (API docs, SDK changelog, integration guide),
compares it against the current implementation, and produces
structured ChangeProposals that the user reviews before anything is applied.

Each ChangeProposal includes:
  what        — what changed in the doc
  before      — current implementation (live code excerpt)
  after       — proposed new implementation
  merits      — why this improves things
  risks       — what could break
  effort      — low / medium / high
  components  — which files/layers are affected
  dependencies— IDs of other proposals this one requires or conflicts with
"""

from __future__ import annotations
import json
import time
import logging
import hashlib
from typing import Optional
from dataclasses import dataclass, field, asdict
from collections import deque

logger = logging.getLogger("stockmind-ai.doc-upgrade")

# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ChangeProposal:
    """A single atomic change proposal derived from a tech doc."""
    id:           str
    category:     str       # schema | ui | api | db | dependency | test
    provider:     str       # which resource/provider this affects (e.g. 'openai')
    title:        str
    what:         str       # what changed in the doc
    before:       str       # current implementation excerpt
    after:        str       # proposed new implementation
    merits:       str       # why this improves things
    risks:        str       # what could break
    effort:       str       # low | medium | high
    priority:     str       # critical | high | medium | low
    components:   list      # files/layers affected: [{file, section, type}]
    requires:     list      # IDs of proposals this DEPENDS ON (must also approve)
    conflicts:    list      # IDs of proposals that CONFLICT with this one
    patch_ops:    list      # actual patch operations [{file, old, new}] — applied on approval
    status:       str = 'pending'   # pending | approved | rejected | skipped
    applied_at:   Optional[float] = None
    reject_reason:Optional[str]   = None
    source_doc:   str = ''
    created_at:   float = field(default_factory=time.time)


@dataclass
class ChangeProposalSet:
    """A full set of proposals derived from one tech document."""
    set_id:      str
    doc_name:    str
    doc_type:    str       # api_docs | changelog | migration_guide | sdk_docs
    provider_id: str       # which provider/integration was analysed
    summary:     str       # AI summary of what changed
    proposals:   list      # list of ChangeProposal
    created_at:  float = field(default_factory=time.time)
    status:      str = 'pending_review'  # pending_review | partially_applied | applied | abandoned

    def pending(self):
        return [p for p in self.proposals if p.status == 'pending']

    def approved(self):
        return [p for p in self.proposals if p.status == 'approved']

    def rejected(self):
        return [p for p in self.proposals if p.status == 'rejected']


# ─────────────────────────────────────────────────────────────────────────────
# Combination Engine — resolves safe apply order given mix of approvals
# ─────────────────────────────────────────────────────────────────────────────

class CombinationEngine:
    """
    Given a set of approved + rejected proposals, determines:
      1. Which approved proposals are SAFE to apply (no broken dependencies)
      2. Which must be SKIPPED because a required proposal was rejected
      3. Which need PARTIAL ADAPTATION (approved but a peer was rejected)
      4. The correct apply ORDER (topological sort by dependency)

    Example combinations:
      A approved + B rejected, B depends on A   → A safe, B skipped
      A approved + B approved, A depends on B   → apply B first, then A
      A rejected + B approved, B requires A     → B skipped (warn user)
      A approved, conflicts with B rejected     → A safe (conflict gone)
      A approved, conflicts with B approved     → A wins (latest approved)
    """

    def resolve(self, proposals: list[ChangeProposal]) -> dict:
        """
        Resolve the apply plan for a mixed set of approved/rejected proposals.

        Returns:
          safe_to_apply:  ordered list of proposals to apply
          skipped:        list of {proposal, reason} — approved but dependency rejected
          conflicts_gone: list of proposals where conflict resolved via rejection
          warnings:       human-readable notes about the resolution
          apply_order:    topological order of safe_to_apply
        """
        approved_ids  = {p.id for p in proposals if p.status == 'approved'}
        rejected_ids  = {p.id for p in proposals if p.status == 'rejected'}
        proposals_map = {p.id: p for p in proposals}

        safe_to_apply = []
        skipped       = []
        warnings      = []

        for p in proposals:
            if p.status != 'approved':
                continue

            # Check dependencies
            missing_deps = [r for r in p.requires if r in rejected_ids]
            if missing_deps:
                dep_titles = [proposals_map[r].title for r in missing_deps if r in proposals_map]
                reason = f"Requires rejected proposal(s): {', '.join(dep_titles)}"
                skipped.append({'proposal': p, 'reason': reason})
                warnings.append(
                    f"⚠ '{p.title}' skipped — depends on rejected: {', '.join(dep_titles)}"
                )
                continue

            # Check conflicts — if conflicting proposal was also approved, warn
            active_conflicts = [c for c in p.conflicts if c in approved_ids]
            if active_conflicts:
                conf_titles = [proposals_map[c].title for c in active_conflicts if c in proposals_map]
                # Last-approved wins — keep this proposal, note the conflict
                warnings.append(
                    f"ℹ '{p.title}' has conflicts with other approved changes: "
                    f"{', '.join(conf_titles)}. Applied in order — later may override earlier."
                )

            safe_to_apply.append(p)

        # Topological sort by dependencies
        apply_order = self._topo_sort(safe_to_apply, proposals_map)

        return {
            'safe_to_apply': apply_order,
            'skipped':       skipped,
            'warnings':      warnings,
            'stats': {
                'total':        len(proposals),
                'approved':     len(approved_ids),
                'rejected':     len(rejected_ids),
                'safe_to_apply':len(apply_order),
                'skipped':      len(skipped),
            },
        }

    def _topo_sort(self, proposals: list, all_map: dict) -> list:
        """Topological sort — apply dependencies before dependents."""
        result   = []
        visited  = set()
        safe_ids = {p.id for p in proposals}

        def visit(p):
            if p.id in visited:
                return
            visited.add(p.id)
            # Visit required proposals first (only if they're in safe set)
            for req_id in p.requires:
                if req_id in safe_ids and req_id in all_map:
                    visit(all_map[req_id])
            result.append(p)

        for p in proposals:
            visit(p)

        return result


# ─────────────────────────────────────────────────────────────────────────────
# Doc Analyser — parses tech doc + generates proposals via AI
# ─────────────────────────────────────────────────────────────────────────────

# Current integration schema snapshot (what the app knows now)
CURRENT_SCHEMA_SNAPSHOT = {
    'auth_types':   ['none', 'apikey', 'bearer', 'oauth', 'uri', 'conn'],
    'field_types':  ['apiKey', 'apiSecret', 'baseUrl', 'defaultModel', 'orgId',
                     'host', 'port', 'database', 'user', 'password', 'uri',
                     'botToken', 'chatId', 'secret', 'url', 'redirectUrl', 'from'],
    'provider_ids': ['openai', 'anthropic', 'gemini', 'groq', 'xai', 'deepseek',
                     'mistral', 'together', 'perplexity', 'cohere', 'openrouter',
                     'ollama', 'lmstudio', 'yahoo_finance', 'zerodha', 'finnhub',
                     'alpha_vantage', 'twelve_data', 'polygon', 'binance',
                     'mongodb', 'postgres', 'redis', 'sqlite',
                     'newsapi', 'fred', 'world_bank',
                     'unsplash', 'pexels', 'pixabay',
                     'telegram', 'email_smtp', 'webhook'],
    'affected_files': {
        'schema':     'server/routes/configurator.js',
        'ui_fields':  'src/pages/Configurator/ConfiguratorPage.jsx',
        'ui_hints':   'src/pages/Configurator/ConfiguratorPage.jsx',
        'env_sync':   'server/routes/configurator.js (_syncToEnv)',
        'test_conn':  'server/routes/configurator.js (_testProvider)',
        'db_storage': 'server/storage/fileStore.js',
        'ai_routing': 'ai_backend/engine/ai_provider_registry.py',
    },
}


class DocUpgradeAnalyser:
    """
    Analyses a tech document and produces ChangeProposals.

    Pipeline:
      1. Parse document text (via DocIntelligenceEngine)
      2. Identify which providers/resources are mentioned
      3. Build AI prompt with current implementation + doc content
      4. AI generates structured proposals (JSON)
      5. Validate + enrich proposals (add patch_ops, dependencies)
      6. Return ChangeProposalSet
    """

    def __init__(self):
        self._active_sets: dict = {}   # set_id → ChangeProposalSet
        self.combo_engine = CombinationEngine()

    async def analyse_doc(self,
                          doc_text: str,
                          doc_name: str,
                          provider_id: str,
                          ai_caller=None) -> ChangeProposalSet:
        """
        Main entry point. Analyses doc_text and generates proposals.

        Args:
            doc_text:    extracted text from the uploaded document
            doc_name:    filename or URL
            provider_id: which provider this doc is about (e.g. 'openai')
            ai_caller:   optional async function(prompt) → str for LLM analysis

        Returns:
            ChangeProposalSet with all generated proposals
        """
        set_id = hashlib.sha256(f"{doc_name}{time.time()}".encode()).hexdigest()[:12]

        # Get current provider implementation
        current_impl = self._get_current_implementation(provider_id)

        # Build analysis prompt
        prompt = self._build_analysis_prompt(
            doc_text, doc_name, provider_id, current_impl
        )

        # Get AI analysis
        raw_proposals = []
        summary = f"Analysis of {doc_name} for {provider_id} integration"

        if ai_caller:
            try:
                ai_response = await ai_caller(prompt)
                parsed = self._parse_ai_response(ai_response, provider_id)
                raw_proposals = parsed.get('proposals', [])
                summary       = parsed.get('summary', summary)
            except Exception as e:
                logger.warning("[DocUpgrade] AI analysis failed: %s — using rule-based", e)
                raw_proposals = self._rule_based_proposals(doc_text, provider_id, current_impl)
        else:
            raw_proposals = self._rule_based_proposals(doc_text, provider_id, current_impl)

        # Build ChangeProposal objects
        proposals = []
        for i, rp in enumerate(raw_proposals):
            p = self._build_proposal(rp, provider_id, doc_name, i)
            proposals.append(p)

        # Infer dependencies between proposals
        self._infer_dependencies(proposals)

        proposal_set = ChangeProposalSet(
            set_id      = set_id,
            doc_name    = doc_name,
            doc_type    = self._detect_doc_type(doc_text, doc_name),
            provider_id = provider_id,
            summary     = summary,
            proposals   = proposals,
        )

        self._active_sets[set_id] = proposal_set
        logger.info("[DocUpgrade] Set %s: %d proposals for %s", set_id, len(proposals), provider_id)
        return proposal_set

    # ── Prompt builder ────────────────────────────────────────────────────────

    def _build_analysis_prompt(self, doc_text, doc_name, provider_id, current_impl) -> str:
        return f"""You are a senior software engineer analysing a technology documentation update.

CURRENT INTEGRATION (what the app has now for '{provider_id}'):
{json.dumps(current_impl, indent=2)}

CURRENT FILES AFFECTED:
- Schema:     server/routes/configurator.js (INTEGRATION_SCHEMA)
- UI Fields:  src/pages/Configurator/ConfiguratorPage.jsx
- Env Sync:   server/routes/configurator.js (_syncToEnv)
- Test Conn:  server/routes/configurator.js (_testProvider)
- AI Routing: ai_backend/engine/ai_provider_registry.py

DOCUMENT: {doc_name}
---
{doc_text[:8000]}
---

Analyse this document and identify ALL changes needed to keep the integration up to date.

For each change, provide a JSON proposal with these exact fields:
  category:   one of [schema, ui, api, db, dependency, test]
  title:      short description (max 60 chars)
  what:       what changed in the doc (specific — quote the doc)
  before:     current implementation excerpt (actual code snippet if possible)
  after:      proposed new implementation (actual code)
  merits:     why this upgrade is beneficial (security/performance/functionality)
  risks:      what could break or regress
  effort:     low | medium | high
  priority:   critical | high | medium | low
  components: list of {{file, section, type}} affected
  requires:   list of proposal titles that must also be approved for this to work
  conflicts:  list of proposal titles this conflicts with if both approved

Return a JSON object:
{{
  "summary": "one paragraph summary of all changes found",
  "proposals": [
    {{ ...proposal fields... }},
    ...
  ]
}}

Be specific. Quote actual field names, model names, auth headers, endpoint paths.
If the doc shows a new required field, include the exact field name and validation.
If an endpoint changed, show old vs new URL/params.
"""

    def _parse_ai_response(self, response: str, provider_id: str) -> dict:
        """Extract JSON from AI response."""
        import re
        # Try to find JSON block
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        return {'summary': response[:500], 'proposals': []}

    # ── Rule-based fallback ────────────────────────────────────────────────────

    def _rule_based_proposals(self, doc_text: str, provider_id: str,
                               current_impl: dict) -> list:
        """Generate proposals using pattern matching when AI is unavailable."""
        proposals = []
        text_lower = doc_text.lower()

        current_fields  = set(current_impl.get('fields', []))
        current_models  = set(current_impl.get('models', []))
        current_auth    = current_impl.get('authType', 'bearer')

        # Detect new fields mentioned in doc
        field_patterns = ['api_key', 'apikey', 'project_id', 'organization', 'org_id',
                          'access_token', 'client_id', 'client_secret', 'base_url',
                          'endpoint', 'region', 'account_id', 'workspace_id']
        for fp in field_patterns:
            if fp.replace('_', '') in text_lower.replace('_', '') and fp not in current_fields:
                camel = ''.join(w.capitalize() if i else w for i, w in enumerate(fp.split('_')))
                proposals.append({
                    'category': 'schema',
                    'title':    f"Add new field: {camel}",
                    'what':     f"Documentation mentions '{fp}' as a required or optional parameter",
                    'before':   f"fields: {list(current_fields)}",
                    'after':    f"fields: {sorted(current_fields | {camel})}",
                    'merits':   'Enables full API functionality as documented',
                    'risks':    'Existing configs without this field will work (field is optional)',
                    'effort':   'low',
                    'priority': 'medium',
                    'components': [{'file': 'server/routes/configurator.js', 'section': f'{provider_id} provider', 'type': 'schema'}],
                    'requires': [],
                    'conflicts': [],
                })

        # Detect model name changes
        import re
        model_refs = re.findall(r'(?:gpt|claude|gemini|llama|mistral|grok|qwen|deepseek)-[\w.\-]+', text_lower)
        new_models = set(model_refs) - current_models
        if new_models:
            proposals.append({
                'category': 'schema',
                'title':    f"Update model list for {provider_id}",
                'what':     f"Documentation references new models: {', '.join(list(new_models)[:5])}",
                'before':   f"models: {list(current_models)[:5]}",
                'after':    f"models: {sorted(current_models | new_models)[:10]}",
                'merits':   'Users can select the latest models from the configurator',
                'risks':    'Old models may still work — just updating the display list',
                'effort':   'low',
                'priority': 'low',
                'components': [{'file': 'server/routes/configurator.js', 'section': f'{provider_id} models array', 'type': 'schema'}],
                'requires': [],
                'conflicts': [],
            })

        # Detect auth changes
        if 'bearer' not in text_lower and 'authorization' not in text_lower and current_auth == 'bearer':
            if 'x-api-key' in text_lower or 'api-key header' in text_lower:
                proposals.append({
                    'category': 'api',
                    'title':    f"Auth header change: bearer → x-api-key",
                    'what':     "Documentation shows X-API-Key header instead of Authorization: Bearer",
                    'before':   f"authType: '{current_auth}'",
                    'after':    "authType: 'apikey'",
                    'merits':   'Uses the correct authentication method',
                    'risks':    'Existing configured keys will need re-test after this change',
                    'effort':   'medium',
                    'priority': 'high',
                    'components': [
                        {'file': 'server/routes/configurator.js', 'section': f'{provider_id} authType', 'type': 'schema'},
                        {'file': 'server/routes/configurator.js', 'section': '_testProvider', 'type': 'api'},
                    ],
                    'requires': [],
                    'conflicts': [],
                })

        return proposals

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _get_current_implementation(self, provider_id: str) -> dict:
        """Extract current implementation details for a provider."""
        # These are the known providers and their current config
        KNOWN = {
            'openai':     {'fields': ['apiKey','defaultModel','orgId'], 'authType': 'bearer', 'models': ['gpt-4o','gpt-4o-mini','gpt-4-turbo']},
            'anthropic':  {'fields': ['apiKey','defaultModel'], 'authType': 'bearer', 'models': ['claude-sonnet-4-5','claude-3-5-haiku-20241022']},
            'gemini':     {'fields': ['apiKey','defaultModel'], 'authType': 'apikey', 'models': ['gemini-2.0-flash','gemini-1.5-pro']},
            'groq':       {'fields': ['apiKey','defaultModel'], 'authType': 'bearer', 'models': ['llama-3.3-70b-versatile']},
            'xai':        {'fields': ['apiKey','defaultModel'], 'authType': 'bearer', 'models': ['grok-3','grok-3-fast']},
            'deepseek':   {'fields': ['apiKey','defaultModel'], 'authType': 'bearer', 'models': ['deepseek-chat','deepseek-reasoner']},
            'mistral':    {'fields': ['apiKey','defaultModel'], 'authType': 'bearer', 'models': ['mistral-large-latest']},
            'mongodb':    {'fields': ['uri','database'], 'authType': 'uri'},
            'postgres':   {'fields': ['host','port','database','user','password'], 'authType': 'conn'},
            'newsapi':    {'fields': ['apiKey'], 'authType': 'apikey'},
            'finnhub':    {'fields': ['apiKey'], 'authType': 'apikey'},
            'zerodha':    {'fields': ['apiKey','apiSecret','redirectUrl'], 'authType': 'oauth'},
        }
        return KNOWN.get(provider_id, {'fields': [], 'authType': 'unknown', 'models': []})

    def _build_proposal(self, raw: dict, provider_id: str,
                         doc_name: str, idx: int) -> ChangeProposal:
        pid = hashlib.sha256(f"{provider_id}{raw.get('title','')}{idx}".encode()).hexdigest()[:10]
        return ChangeProposal(
            id          = pid,
            category    = raw.get('category', 'schema'),
            provider    = provider_id,
            title       = raw.get('title', f'Change {idx+1}')[:80],
            what        = raw.get('what', '')[:1000],
            before      = raw.get('before', '')[:2000],
            after       = raw.get('after', '')[:2000],
            merits      = raw.get('merits', '')[:500],
            risks       = raw.get('risks', '')[:500],
            effort      = raw.get('effort', 'medium'),
            priority    = raw.get('priority', 'medium'),
            components  = raw.get('components', []),
            requires    = [],  # populated by _infer_dependencies
            conflicts   = [],
            patch_ops   = raw.get('patch_ops', []),
            source_doc  = doc_name,
        )

    def _infer_dependencies(self, proposals: list[ChangeProposal]):
        """Infer dependency relationships between proposals by title matching."""
        title_to_id = {p.title: p.id for p in proposals}
        for p in proposals:
            # Schema changes that a test connection depends on
            if p.category == 'test':
                for other in proposals:
                    if other.category == 'schema' and other.provider == p.provider:
                        if other.id not in p.requires:
                            p.requires.append(other.id)
            # UI changes depend on schema changes for the same provider
            if p.category == 'ui':
                for other in proposals:
                    if other.category == 'schema' and other.provider == p.provider:
                        if other.id not in p.requires:
                            p.requires.append(other.id)

    def _detect_doc_type(self, text: str, name: str) -> str:
        text_l = (text + name).lower()
        if any(w in text_l for w in ['changelog', 'release note', 'migration guide', 'breaking change']):
            return 'changelog'
        if any(w in text_l for w in ['getting started', 'quickstart', 'sdk reference']):
            return 'sdk_docs'
        if any(w in text_l for w in ['migration', 'upgrade guide', 'v2', 'v3']):
            return 'migration_guide'
        return 'api_docs'

    # ── Set management ─────────────────────────────────────────────────────────

    def get_set(self, set_id: str) -> Optional[ChangeProposalSet]:
        return self._active_sets.get(set_id)

    def apply_decisions(self, set_id: str, decisions: dict) -> dict:
        """
        Apply user decisions (approved/rejected) to a proposal set.
        decisions: {proposal_id: 'approved' | 'rejected', ...}
        Returns the combination resolution.
        """
        ps = self._active_sets.get(set_id)
        if not ps:
            return {'ok': False, 'error': 'Proposal set not found'}

        for p in ps.proposals:
            if p.id in decisions:
                status = decisions[p.id]
                if status in ('approved', 'rejected'):
                    p.status = status

        # Resolve combination
        resolution = self.combo_engine.resolve(ps.proposals)
        ps.status  = 'partially_applied' if resolution['stats']['approved'] > 0 else 'pending_review'

        return {'ok': True, 'set_id': set_id, 'resolution': resolution}

    def get_all_sets(self) -> list:
        return [
            {
                'set_id':      s.set_id,
                'doc_name':    s.doc_name,
                'provider_id': s.provider_id,
                'status':      s.status,
                'total':       len(s.proposals),
                'pending':     len(s.pending()),
                'approved':    len(s.approved()),
                'rejected':    len(s.rejected()),
                'created_at':  s.created_at,
            }
            for s in self._active_sets.values()
        ]


# Module-level singleton
_analyser = DocUpgradeAnalyser()

def get_doc_analyser() -> DocUpgradeAnalyser:
    return _analyser
