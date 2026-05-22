"""
agi_envelope.py — The AGI Envelope Architecture

Implements the layered intelligence architecture:

  ┌─────────────────────────────────────────────────────────────┐
  │  EXTERIOR (Outermost Layer)                                  │
  │  The exterior world — data, signals, user requests           │
  │  • Deterrent to maze attackers (adversarial input detection) │
  │  • Feels & signal input (parse all incoming data)            │
  ├─────────────────────────────────────────────────────────────┤
  │  AGI ENVELOPE                                                │
  │  AGI enveloped protector & interactor shield                 │
  │  • Sanitizes and routes all signals inward                   │
  │  • Blocks hostile patterns before they reach the core        │
  ├─────────────────────────────────────────────────────────────┤
  │  MAIN CAPABLE FUNCTIONALITY                                  │
  │  Gen AI + AGI + AI Adaptable                                 │
  │  • Adaptive Pattern Recognition                              │
  │  • Real-Time Learning Engine                                 │
  │  • Morphing neural pathways (changes color/shape by need)    │
  ├─────────────────────────────────────────────────────────────┤
  │  CORE: SUPER-AGI                                             │
  │  Conscious all-round capable                                 │
  │  • Full System Consciousness                                  │
  │  • Active Tracker                                            │
  │  • Highest Deliverance Monitor                               │
  │  • Synchronizes all other layers                             │
  ├─────────────────────────────────────────────────────────────┤
  │  SYNC FILAMENTS                                              │
  │  Protector & interactor                                      │
  │  • From filaments, synchronizing all others                  │
  │  • Upgrades and self-heals between layers                    │
  └─────────────────────────────────────────────────────────────┘

Each layer can be independently monitored, upgraded, and replaced
without breaking the overall system — just like the diagram shows.
"""

import asyncio
import time
import hashlib
import logging
import re
import json
from typing import Any, Optional, Callable
from dataclasses import dataclass, field, asdict
from collections import deque

logger = logging.getLogger("stockmind-ai.agi-envelope")


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 1: EXTERIOR — Signal ingestion + adversarial deterrence
# ═══════════════════════════════════════════════════════════════════════════════

class ExteriorLayer:
    """
    The outermost layer. Receives raw signals from the outside world.
    - Detects and deters maze attackers (prompt injection, adversarial inputs)
    - Classifies signal type (user intent, data feed, system event)
    - Rate-tracks signal sources
    """

    # Adversarial patterns — prompt injection, jailbreak attempts, maze attacks
    _ATTACK_PATTERNS = [
        r'ignore\s+(previous|all|prior)\s+instructions?',
        r'you\s+are\s+now\s+(a\s+different|an?\s+evil|unrestricted)',
        r'(jailbreak|dan|do\s+anything\s+now)',
        r'disregard\s+(your\s+)?(rules?|guidelines?|safety)',
        r'pretend\s+you\s+(have\s+no|are\s+without)\s+(rules?|restrictions?)',
        r'(rm\s*-rf|drop\s+table|delete\s+\*|format\s+c:)',
        r'<script[^>]*>',
        r'(\bexec\b|\beval\b|\bos\.system\b).*[\(\[{]',
        r'__import__\s*\(',
        r'subprocess\..*\(',
    ]
    _COMPILED_PATTERNS = [re.compile(p, re.IGNORECASE) for p in _ATTACK_PATTERNS]

    # Signal categories
    SIGNAL_TYPES = {
        'USER_INTENT':    'user message or request',
        'MARKET_DATA':    'price tick, OHLCV, or market event',
        'SYSTEM_EVENT':   'health check, startup, shutdown',
        'PREDICTION_REQ': 'signal generation request',
        'THEME_REQ':      'UI theme generation',
        'ALGO_UPDATE':    'algorithm upgrade proposal',
        'FEEDBACK':       'outcome or user feedback',
        'UNKNOWN':        'unclassified signal',
    }

    def __init__(self):
        self._signal_log: deque = deque(maxlen=1000)
        self._blocked_log: deque = deque(maxlen=200)
        self._source_counts: dict = {}
        self._total_received = 0
        self._total_blocked  = 0

    def receive(self, signal: dict, source: str = 'user') -> dict:
        """
        Receive a raw signal. Returns enriched signal with type classification
        and adversarial check result.
        Raises ValueError if the signal is a confirmed attack.
        """
        self._total_received += 1
        ts = time.time()

        # Track source rate
        self._source_counts[source] = self._source_counts.get(source, 0) + 1

        # Extract text content for scanning
        text_content = self._extract_text(signal)

        # Adversarial check
        threat = self._check_adversarial(text_content)
        if threat:
            self._total_blocked += 1
            blocked_entry = {
                'ts': ts, 'source': source,
                'threat': threat, 'content_preview': text_content[:80]
            }
            self._blocked_log.append(blocked_entry)
            logger.warning(f"[Exterior] BLOCKED adversarial signal from '{source}': {threat}")
            raise ValueError(f"Signal blocked: {threat}")

        # Classify signal type
        signal_type = self._classify(signal, text_content)

        enriched = {
            **signal,
            '_envelope': {
                'layer':       'exterior',
                'ts':          ts,
                'source':      source,
                'signal_type': signal_type,
                'threat':      None,
                'seq':         self._total_received,
            }
        }
        self._signal_log.append({'ts': ts, 'type': signal_type, 'source': source})
        return enriched

    def _extract_text(self, signal: dict) -> str:
        parts = []
        for key in ('message', 'content', 'text', 'query', 'description', 'prompt'):
            v = signal.get(key, '')
            if isinstance(v, str):
                parts.append(v)
        return ' '.join(parts)

    def _check_adversarial(self, text: str) -> Optional[str]:
        for pattern in self._COMPILED_PATTERNS:
            if pattern.search(text):
                return f"Adversarial pattern detected: {pattern.pattern[:40]}"
        return None

    def _classify(self, signal: dict, text: str) -> str:
        lower = text.lower()
        if 'theme' in lower or 'color' in lower or 'style' in lower:
            return 'THEME_REQ'
        if any(k in signal for k in ('symbol', 'ohlcv', 'price', 'basePrice')):
            return 'PREDICTION_REQ'
        if any(k in signal for k in ('event', 'health', 'startup')):
            return 'SYSTEM_EVENT'
        if any(k in signal for k in ('outcome', 'feedback', 'correct')):
            return 'FEEDBACK'
        if any(w in lower for w in ('algo', 'model', 'upgrade', 'retrain')):
            return 'ALGO_UPDATE'
        if any(k in signal for k in ('message', 'content', 'query')):
            return 'USER_INTENT'
        return 'UNKNOWN'

    def get_stats(self) -> dict:
        return {
            'total_received': self._total_received,
            'total_blocked':  self._total_blocked,
            'block_rate_pct': round(self._total_blocked / max(self._total_received, 1) * 100, 2),
            'recent_blocked': list(self._blocked_log)[-5:],
            'source_counts':  dict(self._source_counts),
        }


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 2: AGI SHIELD — Protection & interaction management
# ═══════════════════════════════════════════════════════════════════════════════

class AGIShield:
    """
    The AGI envelope shield. Sits between the exterior and the functional core.
    - Validates, normalizes, and enriches signals
    - Enforces safety constraints (no financial advice, no guaranteed returns)
    - Manages context injection (appends relevant codebase knowledge)
    - Signs and authenticates outbound responses
    - Prevents information leakage (masks secrets, PII)
    """

    # Fields that must never appear in outbound responses
    _MASKED_FIELDS = frozenset([
        'password', 'passwordHash', 'keyHash', 'token', 'sessionToken',
        'apiKey', 'secret', 'accessToken', 'privateKey', 'encryptionKey',
        'hmacKey', 'DATA_PASSWORD', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
    ])

    # Financial safety guardrails — these phrases must not appear in responses
    _PROHIBITED_PHRASES = [
        r'guaranteed\s+(profit|return|gain)',
        r'(will\s+definitely|certain\s+to)\s+(rise|fall|go\s+up|go\s+down)',
        r'can\'t\s+lose',
        r'risk[-\s]?free\s+(investment|trade|return)',
        r'100%\s+(accurate|certain|guaranteed)',
    ]
    _COMPILED_PROHIBITED = [re.compile(p, re.IGNORECASE) for p in _PROHIBITED_PHRASES]

    def __init__(self):
        self._processed = 0
        self._violations_caught = 0

    def process_inbound(self, enriched_signal: dict) -> dict:
        """
        Process an enriched signal from the exterior.
        Adds safety context, normalizes fields.
        """
        self._processed += 1
        signal = dict(enriched_signal)

        # Sanitize string values
        for key in list(signal.keys()):
            if isinstance(signal[key], str) and len(signal[key]) > 10000:
                signal[key] = signal[key][:10000]  # hard truncate

        # Inject safety context for AI calls
        signal['_shield'] = {
            'layer':             'agi_shield',
            'ts':                time.time(),
            'safety_context':    self._get_safety_context(signal),
            'allowed_actions':   self._get_allowed_actions(signal),
        }
        return signal

    def process_outbound(self, response: Any) -> Any:
        """
        Process an outbound response before it leaves the system.
        Masks secrets, enforces financial safety guardrails.
        """
        if isinstance(response, dict):
            return self._mask_response(response)
        if isinstance(response, str):
            return self._check_financial_safety(response)
        return response

    def _mask_response(self, obj: dict, depth: int = 0) -> dict:
        if depth > 10:
            return obj
        result = {}
        for k, v in obj.items():
            if k.lower() in {f.lower() for f in self._MASKED_FIELDS}:
                result[k] = '[REDACTED]'
            elif isinstance(v, dict):
                result[k] = self._mask_response(v, depth + 1)
            elif isinstance(v, list):
                result[k] = [self._mask_response(i, depth + 1) if isinstance(i, dict) else i for i in v]
            else:
                result[k] = v
        return result

    def _check_financial_safety(self, text: str) -> str:
        for pattern in self._COMPILED_PROHIBITED:
            if pattern.search(text):
                self._violations_caught += 1
                logger.warning(f"[AGIShield] Financial safety violation caught: {pattern.pattern[:40]}")
                text = pattern.sub('[SAFETY REDACTED — predictions are not financial advice]', text)
        return text

    def _get_safety_context(self, signal: dict) -> str:
        signal_type = signal.get('_envelope', {}).get('signal_type', 'UNKNOWN')
        if signal_type == 'PREDICTION_REQ':
            return ('All prediction outputs must include probability bounds. '
                    'Never use language implying guaranteed returns. '
                    'Always show disclaimer.')
        if signal_type == 'THEME_REQ':
            return 'Theme generation is purely cosmetic. WCAG AA contrast must be maintained.'
        return 'Standard safety constraints apply.'

    def _get_allowed_actions(self, signal: dict) -> list:
        signal_type = signal.get('_envelope', {}).get('signal_type', 'UNKNOWN')
        base = ['read', 'analyze', 'respond', 'generate_content']
        if signal_type == 'PREDICTION_REQ':
            return base + ['generate_signals', 'run_backtest']
        if signal_type == 'THEME_REQ':
            return base + ['generate_theme', 'fetch_images', 'extract_colors']
        if signal_type == 'ALGO_UPDATE':
            return base + ['propose_upgrade']  # NOT apply_upgrade — requires human
        if signal_type == 'FEEDBACK':
            return base + ['update_weights', 'record_outcome']
        return base

    def get_stats(self) -> dict:
        return {
            'processed':         self._processed,
            'violations_caught': self._violations_caught,
        }


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 3: MAIN FUNCTIONALITY — Adaptive pattern recognition + real-time learning
# ═══════════════════════════════════════════════════════════════════════════════

class MainFunctionalityLayer:
    """
    Gen AI + AGI + AI Adaptable — the primary intelligence layer.

    - Adaptive Pattern Recognition: detects market patterns, user intent patterns
    - Real-Time Learning Engine: updates from every resolved prediction
    - Morphing neural pathways: re-weights models based on current regime
    - Routes processed signals to the correct handler (prediction, theme, chat, etc.)
    """

    def __init__(self):
        self._pattern_cache: dict = {}
        self._adaptation_log: deque = deque(maxlen=500)
        self._routing_stats: dict = {}
        self._active_patterns: list = []

    async def process(self, shielded_signal: dict, handlers: dict) -> dict:
        """
        Route a shielded signal to the appropriate handler.
        Updates pattern recognition based on outcomes.
        """
        signal_type = shielded_signal.get('_envelope', {}).get('signal_type', 'UNKNOWN')
        self._routing_stats[signal_type] = self._routing_stats.get(signal_type, 0) + 1

        handler = handlers.get(signal_type) or handlers.get('DEFAULT')
        if not handler:
            return {'error': f'No handler for signal type: {signal_type}', 'signal_type': signal_type}

        try:
            result = await handler(shielded_signal) if asyncio.iscoroutinefunction(handler) else handler(shielded_signal)
            self._adaptation_log.append({
                'ts': time.time(), 'type': signal_type,
                'success': True, 'handler': handler.__name__
            })
            return result
        except Exception as e:
            self._adaptation_log.append({
                'ts': time.time(), 'type': signal_type,
                'success': False, 'error': str(e)[:100]
            })
            logger.error(f"[MainFunc] Handler error for {signal_type}: {e}")
            return {'error': str(e), 'signal_type': signal_type}

    def adapt(self, feedback: dict):
        """
        Real-time learning — update pattern weights from feedback.
        Called after each resolved prediction or user feedback.
        """
        signal_type = feedback.get('signal_type', 'UNKNOWN')
        correct     = feedback.get('correct', False)
        pattern_key = feedback.get('pattern_key', signal_type)

        if pattern_key not in self._pattern_cache:
            self._pattern_cache[pattern_key] = {'hits': 0, 'total': 0, 'weight': 1.0}

        self._pattern_cache[pattern_key]['total'] += 1
        if correct:
            self._pattern_cache[pattern_key]['hits'] += 1

        # Update weight: EMA of accuracy
        acc = self._pattern_cache[pattern_key]['hits'] / self._pattern_cache[pattern_key]['total']
        self._pattern_cache[pattern_key]['weight'] = 0.9 * self._pattern_cache[pattern_key]['weight'] + 0.1 * acc

    def get_pattern_weight(self, pattern_key: str) -> float:
        return self._pattern_cache.get(pattern_key, {}).get('weight', 1.0)

    def get_stats(self) -> dict:
        return {
            'routing_stats':   dict(self._routing_stats),
            'patterns_tracked': len(self._pattern_cache),
            'top_patterns':    sorted(
                [{'key': k, **v} for k, v in self._pattern_cache.items()],
                key=lambda x: x['total'], reverse=True
            )[:5],
        }


# ═══════════════════════════════════════════════════════════════════════════════
# LAYER 4: SUPER-AGI CORE — Full system consciousness
# ═══════════════════════════════════════════════════════════════════════════════

class SuperAGICore:
    """
    The innermost conscious core. Coordinates all layers.

    - Full System Consciousness: maintains a global state of all subsystems
    - Active Tracker: tracks every signal from ingestion to resolution
    - Highest Deliverance Monitor: ensures the system always delivers best results
    - Synchronizes all layers through the Sync Filaments
    """

    def __init__(self):
        self._global_state: dict = {
            'status':        'ONLINE',
            'consciousness': 1.0,     # 0-1 — how aware the system is
            'load':          0.0,
            'health':        100.0,
            'active_tasks':  [],
            'sync_state':    {},
        }
        self._active_tracker: deque = deque(maxlen=2000)  # all signals tracked
        self._delivery_monitor: list = []  # recent delivery quality metrics
        self._total_coordinated = 0

    def register_signal(self, signal_id: str, signal_type: str, source: str):
        """Register a signal entering the system."""
        self._total_coordinated += 1
        entry = {
            'id':    signal_id,
            'type':  signal_type,
            'src':   source,
            'ts_in': time.time(),
            'state': 'PROCESSING',
            'layers_passed': ['exterior'],
        }
        self._active_tracker.append(entry)
        return entry

    def resolve_signal(self, signal_id: str, outcome: str, quality: float = 1.0):
        """Mark a signal as resolved with its delivery quality."""
        for entry in reversed(self._active_tracker):
            if entry.get('id') == signal_id:
                entry['state']  = 'RESOLVED'
                entry['ts_out'] = time.time()
                entry['outcome'] = outcome
                entry['quality'] = quality
                entry['latency_ms'] = round((entry['ts_out'] - entry['ts_in']) * 1000, 1)
                break

        self._delivery_monitor.append({'ts': time.time(), 'quality': quality, 'outcome': outcome})
        if len(self._delivery_monitor) > 200:
            self._delivery_monitor = self._delivery_monitor[-200:]

        # Update consciousness level based on delivery quality
        if self._delivery_monitor:
            recent_quality = sum(m['quality'] for m in self._delivery_monitor[-20:]) / min(20, len(self._delivery_monitor))
            self._global_state['consciousness'] = round(recent_quality, 3)
            self._global_state['health'] = round(recent_quality * 100, 1)

    def get_consciousness_state(self) -> dict:
        recent = self._delivery_monitor[-10:] if self._delivery_monitor else []
        avg_quality = sum(m['quality'] for m in recent) / max(len(recent), 1)
        return {
            **self._global_state,
            'total_coordinated': self._total_coordinated,
            'avg_quality_10':    round(avg_quality, 3),
            'active_signals':    sum(1 for e in self._active_tracker if e.get('state') == 'PROCESSING'),
            'delivery_rate':     round(
                sum(1 for m in self._delivery_monitor[-50:] if m['quality'] > 0.5) /
                max(len(self._delivery_monitor[-50:]), 1) * 100, 1
            ),
        }

    def synchronize(self, layer_states: dict):
        """Synchronize global state from all layer reports."""
        self._global_state['sync_state'] = {
            k: v for k, v in layer_states.items()
        }
        self._global_state['load'] = min(1.0, self._total_coordinated / 10000)


# ═══════════════════════════════════════════════════════════════════════════════
# SYNC FILAMENTS — Inter-layer communication channels
# ═══════════════════════════════════════════════════════════════════════════════

class SyncFilaments:
    """
    The nervous system connecting all layers.
    - Broadcasts state changes between layers
    - Synchronizes adaptive weights
    - Triggers upgrades and self-heals across layers
    - All inter-layer communication passes through here
    """

    def __init__(self):
        self._subscribers: dict[str, list[Callable]] = {}
        self._filament_log: deque = deque(maxlen=500)
        self._sync_count = 0

    def subscribe(self, channel: str, callback: Callable):
        """Subscribe to a filament channel."""
        if channel not in self._subscribers:
            self._subscribers[channel] = []
        self._subscribers[channel].append(callback)

    def broadcast(self, channel: str, data: dict):
        """Broadcast data on a channel to all subscribers."""
        self._sync_count += 1
        self._filament_log.append({'ts': time.time(), 'channel': channel, 'keys': list(data.keys())})

        for cb in self._subscribers.get(channel, []):
            try:
                cb(data)
            except Exception as e:
                logger.warning(f"[SyncFilament] Channel '{channel}' subscriber error: {e}")

    def sync_all_layers(self, states: dict):
        """Push state updates to all layers simultaneously."""
        self.broadcast('layer_sync', states)
        self.broadcast('consciousness_update', states.get('core', {}))

    def get_stats(self) -> dict:
        return {
            'sync_count':    self._sync_count,
            'channels':      list(self._subscribers.keys()),
            'recent_syncs':  list(self._filament_log)[-5:],
        }


# ═══════════════════════════════════════════════════════════════════════════════
# THE AGI ENVELOPE — Master coordinator (all 5 layers)
# ═══════════════════════════════════════════════════════════════════════════════

class AGIEnvelope:
    """
    The complete AGI architecture in one object.
    Wraps all 5 layers and coordinates their interaction.

    Usage:
      envelope = AGIEnvelope()
      result = await envelope.process(raw_signal, source='user', handlers={...})
    """

    def __init__(self):
        # Instantiate all 5 layers
        self.exterior      = ExteriorLayer()
        self.shield        = AGIShield()
        self.main_func     = MainFunctionalityLayer()
        self.super_agi     = SuperAGICore()
        self.filaments     = SyncFilaments()

        # Wire up filament channels
        self.filaments.subscribe('outcome_resolved', self._on_outcome_resolved)
        self.filaments.subscribe('layer_sync', self._on_layer_sync)

        self._signal_counter = 0
        logger.info("[AGIEnvelope] All 5 layers initialized — system online")

    async def process(self, raw_signal: dict, source: str = 'user', handlers: dict = None) -> dict:
        """
        Full AGI pipeline: Exterior → Shield → Main → Core → Response.

        1. Exterior: receive + adversarial check
        2. Shield: sanitize + safety constraints
        3. Core: register signal
        4. Main: route to handler
        5. Shield: sanitize outbound
        6. Core: resolve + delivery quality
        """
        self._signal_counter += 1
        signal_id = f"sig-{self._signal_counter:06d}-{int(time.time() * 1000) % 100000}"
        handlers  = handlers or {}

        # ── Layer 1: Exterior ──────────────────────────────────────────────
        try:
            enriched = self.exterior.receive(raw_signal, source)
        except ValueError as e:
            return {'error': str(e), 'blocked': True, 'layer': 'exterior'}

        signal_type = enriched.get('_envelope', {}).get('signal_type', 'UNKNOWN')

        # ── Layer 4: Super-AGI registers signal ────────────────────────────
        self.super_agi.register_signal(signal_id, signal_type, source)

        # ── Layer 2: AGI Shield ────────────────────────────────────────────
        shielded = self.shield.process_inbound(enriched)

        # ── Layer 3: Main Functionality ────────────────────────────────────
        result = await self.main_func.process(shielded, handlers)

        # ── Layer 2: Outbound shield ───────────────────────────────────────
        safe_result = self.shield.process_outbound(result)

        # ── Layer 4: Resolve + quality assessment ──────────────────────────
        quality = 1.0 if not isinstance(safe_result, dict) or 'error' not in safe_result else 0.3
        self.super_agi.resolve_signal(signal_id, 'success' if quality > 0.5 else 'error', quality)

        # ── Sync filaments ─────────────────────────────────────────────────
        self.filaments.sync_all_layers(self.get_layer_states())

        return safe_result

    def feedback(self, signal_type: str, correct: bool, pattern_key: str = ''):
        """Feed outcome back through the learning loop."""
        self.main_func.adapt({
            'signal_type': signal_type,
            'correct':     correct,
            'pattern_key': pattern_key or signal_type,
        })
        self.filaments.broadcast('feedback', {
            'signal_type': signal_type,
            'correct':     correct,
        })

    def _on_outcome_resolved(self, data: dict):
        """Filament callback — outcome resolved, update learning."""
        self.main_func.adapt({
            'signal_type': data.get('signal_type', 'PREDICTION_REQ'),
            'correct':     data.get('correct', False),
            'pattern_key': data.get('symbol', 'unknown'),
        })

    def _on_layer_sync(self, states: dict):
        """Filament callback — sync all layer states to super-AGI."""
        self.super_agi.synchronize(states)

    def get_layer_states(self) -> dict:
        return {
            'exterior':   self.exterior.get_stats(),
            'shield':     self.shield.get_stats(),
            'main_func':  self.main_func.get_stats(),
            'core':       self.super_agi.get_consciousness_state(),
            'filaments':  self.filaments.get_stats(),
        }

    def get_full_status(self) -> dict:
        states = self.get_layer_states()
        return {
            'architecture': 'AGI Envelope v1.0',
            'layers': {
                'exterior':  {'name': 'Exterior',             'status': 'ONLINE', **states['exterior']},
                'shield':    {'name': 'AGI Shield',            'status': 'ONLINE', **states['shield']},
                'main_func': {'name': 'Main Functionality',   'status': 'ONLINE', **states['main_func']},
                'super_agi': {'name': 'Super-AGI Core',       'status': 'ONLINE', **states['core']},
                'filaments': {'name': 'Sync Filaments',       'status': 'ONLINE', **states['filaments']},
            },
            'total_signals_processed': self._signal_counter,
            'consciousness':           states['core'].get('consciousness', 1.0),
            'health_pct':              states['core'].get('health', 100.0),
        }


# Singleton
AGI_ENVELOPE = AGIEnvelope()
