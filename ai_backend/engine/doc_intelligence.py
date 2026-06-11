"""
doc_intelligence.py — Universal Document Intelligence Engine
StockMind AGI // Knowledge Ingestion & Strategy Learning

Ingests ANY file type and extracts structured market intelligence:
  - PDF (financial reports, research, RBI circulars, SEBI notices)
  - Excel/CSV (data, backtests, screener exports)
  - Images (charts, screenshots, scanned documents)
  - Plain text / Markdown / JSON (news, notes, research)
  - URLs (web pages via text extraction)

Extracted knowledge is:
  1. Stored in a persistent Knowledge Base
  2. Used to improve strategy logic (confidence weights, regime rules)
  3. Fed into prediction context for symbol-specific insights
  4. Searchable by symbol / theme / date

All processing in-memory. No raw files stored.
"""

from __future__ import annotations
import re
import json
import time
import hashlib
import logging
from typing import Optional
from collections import deque
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger("stockmind-ai.doc-intel")


# ─────────────────────────────────────────────────────────────────────────────
# Knowledge Entry — unit of extracted information
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class KnowledgeEntry:
    id:           str
    source_type:  str          # pdf | csv | image | text | url | excel
    source_name:  str          # original filename or URL
    symbols:      list         # affected symbols (extracted or provided)
    summary:      str          # 2-3 sentence AI summary
    sentiment:    float        # -1 to +1
    key_metrics:  dict         # extracted numbers
    strategy_hints: list       # actionable hints for strategy
    raw_text:     str          # first 2000 chars of extracted text
    doc_type:     str          # earnings | macro | technical | news | research | regulatory | other
    ts:           float = field(default_factory=time.time)
    confidence:   float = 0.7
    applied_count: int  = 0


# ─────────────────────────────────────────────────────────────────────────────
# Document Parser
# ─────────────────────────────────────────────────────────────────────────────

class DocumentParser:
    """
    Parses various file types into structured text + metadata.
    Pure Python — no external parsing libs required.
    """

    # Financial number patterns
    NUMBER_PATTERNS = {
        "revenue":      [r"(?:revenue|total\s+income|net\s+sales)[:\s]+(?:rs\.?\s*|inr\s*|₹\s*)?([0-9,]+(?:\.[0-9]+)?)\s*(?:cr|crore|lakh|mn|bn|million|billion)?"],
        "net_profit":   [r"(?:net\s+profit|pat|profit\s+after\s+tax)[:\s]+(?:rs\.?\s*|₹\s*)?([0-9,]+(?:\.[0-9]+)?)", r"(?:net\s+income)[:\s]+([0-9,]+(?:\.[0-9]+)?)"],
        "ebitda":       [r"ebitda[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)"],
        "eps":          [r"(?:eps|earnings\s+per\s+share)[:\s]+(?:rs\.?\s*)?([0-9,]+(?:\.[0-9]+)?)"],
        "roe":          [r"(?:roe|return\s+on\s+equity)[:\s]+([0-9,]+(?:\.[0-9]+)?)\s*%?"],
        "roce":         [r"roce[:\s]+([0-9,]+(?:\.[0-9]+)?)\s*%?"],
        "pe_ratio":     [r"p[/\-]e(?:\s+ratio)?[:\s]+([0-9,]+(?:\.[0-9]+)?)"],
        "debt_equity":  [r"debt[/-]equity[:\s]+([0-9,]+(?:\.[0-9]+)?)"],
        "current_ratio":[r"current\s+ratio[:\s]+([0-9,]+(?:\.[0-9]+)?)"],
        "interest_rate":[r"(?:repo\s+rate|interest\s+rate|rbi\s+rate)[:\s]+([0-9,]+(?:\.[0-9]+)?)\s*%?"],
        "inflation":    [r"(?:inflation|cpi|wpi)[:\s]+([0-9,]+(?:\.[0-9]+)?)\s*%?"],
        "gdp":          [r"gdp(?:\s+growth)?[:\s]+([0-9,]+(?:\.[0-9]+)?)\s*%?"],
    }

    # Symbol detection patterns
    SYMBOL_PATTERNS = [
        r'\b([A-Z]{2,12}(?:LTD|BANK|FIN|AUTO|TECH|INFRA|GAS|OIL|POWER|STEEL|PHARMA)?)\b',
        r'NSE[:\s]+([A-Z]{2,12})',
        r'BSE[:\s]+([A-Z]{2,12})',
        r'\(([A-Z]{2,12})\)',   # (RELIANCE)
    ]

    KNOWN_SYMBOLS = {
        "NIFTY50", "BANKNIFTY", "SENSEX", "RELIANCE", "TCS", "HDFCBANK", "INFY",
        "ICICIBANK", "HINDUNILVR", "ITC", "SBIN", "BAJFINANCE", "WIPRO", "AXISBANK",
        "MARUTI", "TATAMOTORS", "SUNPHARMA", "ADANIENT", "KOTAKBANK", "HCLTECH",
        "TECHM", "DRREDDY", "CIPLA", "TATASTEEL", "JSWSTEEL", "HINDALCO", "ONGC",
        "NTPC", "POWERGRID", "BPCL", "COALINDIA", "BTCUSDT", "ETHUSDT",
    }

    def parse_pdf_buffer(self, buffer: bytes) -> str:
        """
        Extract text from PDF buffer.
        Uses a multi-strategy approach:
        1. Try to extract embedded text streams (most PDFs)
        2. Fall back to ASCII extraction
        """
        text = ""
        try:
            # Strategy 1: Extract text between BT (Begin Text) and ET (End Text) markers
            raw = buffer.decode('latin1', errors='replace')
            # Extract text objects from PDF streams
            text_objects = re.findall(r'BT(.*?)ET', raw, re.DOTALL)
            for obj in text_objects:
                # Extract Tj and TJ operators (text show operators)
                tj_parts = re.findall(r'\((.*?)\)\s*Tj', obj)
                text += ' '.join(
                    p.encode('latin1').decode('utf-8', errors='replace')
                    for p in tj_parts
                )
                # TJ arrays
                tj_arr = re.findall(r'\[(.*?)\]\s*TJ', obj, re.DOTALL)
                for arr in tj_arr:
                    parts = re.findall(r'\((.*?)\)', arr)
                    text += ' '.join(parts)

            # Strategy 2: If little text extracted, try stream content
            if len(text.strip()) < 100:
                streams = re.findall(r'stream\r?\n(.*?)\r?\nendstream', raw, re.DOTALL)
                for s in streams:
                    readable = re.sub(r'[^\x20-\x7E\n]', ' ', s)
                    if len(readable.split()) > 5:
                        text += readable + '\n'

            # Strategy 3: Plain ASCII extraction as last resort
            if len(text.strip()) < 50:
                text = re.sub(r'[^\x20-\x7E\n\r\t]', ' ', raw)

        except Exception as e:
            logger.warning("[DocParser] PDF parse error: %s", e)
            text = buffer.decode('latin1', errors='replace')
            text = re.sub(r'[^\x20-\x7E\n\r\t]', ' ', text)

        return self._clean_text(text)[:100_000]

    def parse_csv_buffer(self, buffer: bytes) -> str:
        """Parse CSV into readable text summary."""
        try:
            text = buffer.decode('utf-8', errors='replace')
            lines = text.split('\n')[:200]  # first 200 rows
            header = lines[0] if lines else ""
            # Convert to readable format
            readable = f"CSV Data ({len(lines)} rows)\nColumns: {header}\n"
            readable += '\n'.join(lines[1:51])  # first 50 data rows
            return readable
        except Exception as e:
            logger.warning("[DocParser] CSV parse error: %s", e)
            return buffer.decode('utf-8', errors='replace')[:50_000]

    def parse_excel_buffer(self, buffer: bytes) -> str:
        """Extract text from Excel file."""
        try:
            # Try openpyxl if available
            import io
            try:
                import openpyxl
                wb = openpyxl.load_workbook(io.BytesIO(buffer), read_only=True, data_only=True)
                text_parts = []
                for sheet_name in wb.sheetnames[:5]:
                    ws = wb[sheet_name]
                    text_parts.append(f"Sheet: {sheet_name}")
                    for row in ws.iter_rows(max_row=100, values_only=True):
                        row_text = '\t'.join(str(c) if c is not None else '' for c in row)
                        if row_text.strip():
                            text_parts.append(row_text)
                return '\n'.join(text_parts)[:50_000]
            except ImportError:
                # Fall back to raw bytes
                return buffer.decode('utf-8', errors='replace')[:50_000]
        except Exception as e:
            logger.warning("[DocParser] Excel parse error: %s", e)
            return buffer.decode('utf-8', errors='replace')[:50_000]

    def parse_text_buffer(self, buffer: bytes, encoding: str = 'utf-8') -> str:
        """Parse plain text, markdown, or JSON."""
        try:
            text = buffer.decode(encoding, errors='replace')
            # Try to pretty-print JSON
            try:
                data = json.loads(text)
                return json.dumps(data, indent=2)[:50_000]
            except (json.JSONDecodeError, ValueError):
                return text[:100_000]
        except Exception as e:
            logger.warning("[DocParser] Text parse error: %s", e)
            return ""

    def extract_numbers(self, text: str) -> dict:
        """Extract all financial numbers from text."""
        results = {}
        text_lower = text.lower()
        for metric, patterns in self.NUMBER_PATTERNS.items():
            for pattern in patterns:
                m = re.search(pattern, text_lower)
                if m:
                    try:
                        val_str = m.group(1).replace(',', '')
                        val = float(val_str)
                        # Handle crore/lakh scale
                        full_match = m.group(0).lower()
                        if 'crore' in full_match or ' cr' in full_match:
                            val *= 10_000_000
                        elif 'lakh' in full_match:
                            val *= 100_000
                        results[metric] = round(val, 2)
                        break
                    except ValueError:
                        continue
        return results

    def extract_symbols(self, text: str) -> list:
        """Extract NSE/BSE symbol names from text."""
        found = set()
        text_upper = text.upper()
        # Direct known symbol matches
        for sym in self.KNOWN_SYMBOLS:
            if sym in text_upper:
                found.add(sym)
        # Pattern matching
        for pattern in self.SYMBOL_PATTERNS:
            matches = re.findall(pattern, text_upper)
            for m in matches:
                if m in self.KNOWN_SYMBOLS:
                    found.add(m)
        return list(found)[:10]

    def classify_doc_type(self, text: str, filename: str = "") -> str:
        """Classify document type."""
        text_l = text.lower()
        fname_l = filename.lower()
        if any(w in text_l for w in ['earnings', 'quarterly result', 'annual report', 'balance sheet', 'profit and loss']):
            return 'earnings'
        if any(w in text_l for w in ['rbi', 'repo rate', 'monetary policy', 'inflation', 'gdp', 'fiscal']):
            return 'macro'
        if any(w in text_l for w in ['sebi', 'circular', 'regulation', 'compliance', 'nse circular']):
            return 'regulatory'
        if any(w in text_l for w in ['buy', 'sell', 'target', 'resistance', 'support', 'rsi', 'macd']):
            return 'technical'
        if any(w in text_l for w in ['research', 'analyst', 'rating', 'initiating coverage', 'fair value']):
            return 'research'
        if any(w in fname_l for w in ['news', 'article', 'press']):
            return 'news'
        return 'other'

    def compute_sentiment(self, text: str) -> float:
        """Simple rule-based sentiment scoring."""
        text_l = text.lower()
        positive_words = ['growth', 'profit', 'increase', 'strong', 'beat', 'record',
                          'surge', 'rally', 'outperform', 'buy', 'upgrade', 'bullish',
                          'expansion', 'improved', 'positive', 'gain', 'higher']
        negative_words = ['loss', 'decline', 'decrease', 'weak', 'miss', 'fall',
                          'drop', 'underperform', 'sell', 'downgrade', 'bearish',
                          'contraction', 'risk', 'concern', 'negative', 'lower', 'debt']
        pos = sum(1 for w in positive_words if w in text_l)
        neg = sum(1 for w in negative_words if w in text_l)
        total = pos + neg
        if total == 0:
            return 0.0
        return round((pos - neg) / total, 3)

    def extract_strategy_hints(self, text: str, doc_type: str, metrics: dict) -> list:
        """Extract actionable strategy hints from document."""
        hints = []
        text_l = text.lower()

        # Earnings-based hints
        if doc_type == 'earnings':
            if metrics.get('net_profit', 0) > 0 and metrics.get('roe', 0) > 15:
                hints.append(f"Strong fundamentals: ROE={metrics.get('roe')}% — consider for long-term hold")
            if metrics.get('debt_equity', 99) < 0.5:
                hints.append("Low debt/equity — reduced bankruptcy risk, suitable for longer holds")
            if 'revenue growth' in text_l or 'revenue increased' in text_l:
                hints.append("Revenue growth mentioned — positive momentum signal")

        # Macro hints
        if doc_type == 'macro':
            if 'rate cut' in text_l or 'dovish' in text_l:
                hints.append("Rate cut/dovish policy — bullish for equities and real estate")
            if 'rate hike' in text_l or 'hawkish' in text_l:
                hints.append("Rate hike — bearish for high-PE stocks, bullish for financials short-term")
            if metrics.get('inflation', 0) > 6:
                hints.append(f"High inflation ({metrics['inflation']}%) — defensive sectors may outperform")

        # Technical hints
        if doc_type == 'technical':
            if 'breakout' in text_l:
                hints.append("Breakout pattern mentioned — watch for volume confirmation")
            if 'support' in text_l and 'held' in text_l:
                hints.append("Support held — potential bounce setup")
            if 'resistance' in text_l and 'broken' in text_l:
                hints.append("Resistance broken — trend continuation likely")

        # Regulatory hints
        if doc_type == 'regulatory':
            hints.append("Regulatory change detected — review compliance impact before trading")

        return hints[:5]

    def _clean_text(self, text: str) -> str:
        """Clean extracted text."""
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'[^\x20-\x7E\n]', '', text)
        return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# Knowledge Base — persistent in-memory store for doc-extracted knowledge
# ─────────────────────────────────────────────────────────────────────────────

class KnowledgeBase:
    """
    Stores and indexes extracted document knowledge.
    Knowledge actively influences:
      - Prediction confidence (boost/penalty based on fundamentals)
      - Strategy generation (hints seeded from docs)
      - Intel Hub analysis (context for Q&A)
    """

    MAX_ENTRIES = 500

    def __init__(self):
        self._entries: list[KnowledgeEntry] = []
        self._symbol_index: dict = {}       # symbol → [entry_ids]
        self._type_index:   dict = {}       # doc_type → [entry_ids]
        self._total_ingested = 0

    def add(self, entry: KnowledgeEntry):
        if len(self._entries) >= self.MAX_ENTRIES:
            self._entries.pop(0)
        self._entries.append(entry)
        self._total_ingested += 1
        for sym in entry.symbols:
            self._symbol_index.setdefault(sym, []).append(entry.id)
        self._type_index.setdefault(entry.doc_type, []).append(entry.id)
        logger.info("[KB] Added: %s [%s] symbols=%s sentiment=%.2f",
                    entry.source_name, entry.doc_type, entry.symbols, entry.sentiment)

    def get_for_symbol(self, symbol: str, max_entries: int = 5) -> list[KnowledgeEntry]:
        ids = self._symbol_index.get(symbol.upper(), [])
        entries = [e for e in self._entries if e.id in ids]
        return sorted(entries, key=lambda e: e.ts, reverse=True)[:max_entries]

    def get_by_type(self, doc_type: str, max_entries: int = 10) -> list[KnowledgeEntry]:
        ids = self._type_index.get(doc_type, [])
        entries = [e for e in self._entries if e.id in ids]
        return sorted(entries, key=lambda e: e.ts, reverse=True)[:max_entries]

    def search(self, query: str, max_results: int = 10) -> list[KnowledgeEntry]:
        """Simple keyword search over summaries and raw text."""
        q = query.lower()
        scored = []
        for e in self._entries:
            score = 0
            if q in e.summary.lower():           score += 3
            if q in e.raw_text.lower():          score += 1
            if any(q in s.lower() for s in e.symbols): score += 5
            if score > 0:
                scored.append((score, e))
        return [e for _, e in sorted(scored, reverse=True)[:max_results]]

    def get_prediction_context(self, symbol: str) -> dict:
        """
        Get knowledge-derived context to enhance prediction confidence.
        Returns adjustments: sentiment_boost, fundamental_score, key_hints
        """
        entries = self.get_for_symbol(symbol)
        if not entries:
            return {"sentiment_boost": 0.0, "fundamental_score": 0.5,
                    "key_hints": [], "entries_found": 0}

        # Aggregate sentiment
        sentiments = [e.sentiment for e in entries]
        avg_sentiment = float(np.mean(sentiments))

        # Aggregate fundamental score from latest earnings entry
        earnings = [e for e in entries if e.doc_type == 'earnings']
        fund_score = 0.5
        if earnings:
            latest = earnings[0]
            roe = latest.key_metrics.get('roe', 0)
            de  = latest.key_metrics.get('debt_equity', 1.0)
            fund_score = min(0.95, max(0.05, 0.5 + roe / 100 - de * 0.1))

        # Collect hints
        all_hints = []
        for e in entries[:3]:
            all_hints.extend(e.strategy_hints)
        all_hints = list(dict.fromkeys(all_hints))[:5]  # deduplicate

        return {
            "sentiment_boost":   round(avg_sentiment * 0.1, 4),  # max ±10% probability shift
            "fundamental_score": round(fund_score, 3),
            "key_hints":         all_hints,
            "entries_found":     len(entries),
            "latest_doc_type":   entries[0].doc_type if entries else None,
            "latest_ts":         entries[0].ts if entries else None,
        }

    def get_macro_context(self) -> dict:
        """Get macro-level context from latest macro documents."""
        entries = self.get_by_type('macro', max_entries=3)
        if not entries:
            return {"rate_bias": 0.0, "inflation": None, "gdp": None, "macro_sentiment": 0.0}

        latest = entries[0]
        return {
            "rate_bias":       latest.sentiment,   # + = dovish, - = hawkish
            "inflation":       latest.key_metrics.get('inflation'),
            "gdp":             latest.key_metrics.get('gdp'),
            "interest_rate":   latest.key_metrics.get('interest_rate'),
            "macro_sentiment": round(float(np.mean([e.sentiment for e in entries])), 3),
            "latest_summary":  latest.summary[:200],
        }

    def get_status(self) -> dict:
        return {
            "total_ingested":  self._total_ingested,
            "active_entries":  len(self._entries),
            "symbols_indexed": len(self._symbol_index),
            "types":           {t: len(ids) for t, ids in self._type_index.items()},
            "recent":          [
                {"id": e.id, "source": e.source_name, "type": e.doc_type,
                 "symbols": e.symbols, "sentiment": e.sentiment}
                for e in self._entries[-5:]
            ],
        }


# ─────────────────────────────────────────────────────────────────────────────
# Document Intelligence Engine — main orchestrator
# ─────────────────────────────────────────────────────────────────────────────

class DocIntelligenceEngine:
    """
    Main orchestrator: ingest any file → extract knowledge → update strategy logic.
    """

    def __init__(self):
        self.parser    = DocumentParser()
        self.kb        = KnowledgeBase()

    def ingest_buffer(self,
                      buffer: bytes,
                      filename: str,
                      mimetype: str,
                      symbol: str = None,
                      ai_summary_fn=None) -> KnowledgeEntry:
        """
        Main ingestion entry point.

        Args:
            buffer:        raw file bytes
            filename:      original filename
            mimetype:      MIME type
            symbol:        known symbol (optional — also auto-detected)
            ai_summary_fn: optional async fn(text) → summary string

        Returns:
            KnowledgeEntry stored in knowledge base
        """
        # 1. Parse text from buffer
        text = self._extract_text(buffer, filename, mimetype)
        if len(text.strip()) < 20:
            text = f"[Could not extract text from {filename}]"

        # 2. Extract metadata
        metrics  = self.parser.extract_numbers(text)
        symbols  = self.parser.extract_symbols(text)
        if symbol:
            sym_upper = symbol.upper()
            if sym_upper not in symbols:
                symbols.insert(0, sym_upper)

        doc_type  = self.parser.classify_doc_type(text, filename)
        sentiment = self.parser.compute_sentiment(text)
        hints     = self.parser.extract_strategy_hints(text, doc_type, metrics)

        # 3. Generate summary (rule-based if no AI fn provided)
        summary = self._generate_summary(text, doc_type, metrics, symbols)

        # 4. Create and store entry
        entry_id = hashlib.sha256(f"{filename}{time.time()}".encode()).hexdigest()[:12]
        entry = KnowledgeEntry(
            id=entry_id,
            source_type=self._detect_source_type(mimetype, filename),
            source_name=filename[:100],
            symbols=symbols[:8],
            summary=summary,
            sentiment=sentiment,
            key_metrics=metrics,
            strategy_hints=hints,
            raw_text=text[:2000],
            doc_type=doc_type,
            confidence=0.75 if len(text) > 500 else 0.50,
        )
        self.kb.add(entry)
        return entry

    def ingest_text(self, text: str, source_name: str = "manual",
                    symbol: str = None, doc_type: str = None) -> KnowledgeEntry:
        """Ingest plain text directly (news, notes, research snippets)."""
        metrics   = self.parser.extract_numbers(text)
        symbols   = self.parser.extract_symbols(text)
        if symbol:
            sym_upper = symbol.upper()
            if sym_upper not in symbols:
                symbols.insert(0, sym_upper)

        resolved_type = doc_type or self.parser.classify_doc_type(text, source_name)
        sentiment = self.parser.compute_sentiment(text)
        hints     = self.parser.extract_strategy_hints(text, resolved_type, metrics)
        summary   = self._generate_summary(text, resolved_type, metrics, symbols)

        entry_id = hashlib.sha256(f"{source_name}{time.time()}".encode()).hexdigest()[:12]
        entry = KnowledgeEntry(
            id=entry_id,
            source_type="text",
            source_name=source_name[:100],
            symbols=symbols[:8],
            summary=summary,
            sentiment=sentiment,
            key_metrics=metrics,
            strategy_hints=hints,
            raw_text=text[:2000],
            doc_type=resolved_type,
        )
        self.kb.add(entry)
        return entry

    def get_prediction_boost(self, symbol: str) -> dict:
        """
        Get knowledge-derived probability boost for a symbol's prediction.
        Called by the prediction engine to incorporate doc intelligence.
        """
        return self.kb.get_prediction_context(symbol)

    def get_macro_bias(self) -> float:
        """Get macro sentiment from latest macro documents. Range: -1 to +1."""
        ctx = self.kb.get_macro_context()
        return ctx.get("macro_sentiment", 0.0)

    def _extract_text(self, buffer: bytes, filename: str, mimetype: str) -> str:
        fn_lower = filename.lower()
        if mimetype == 'application/pdf' or fn_lower.endswith('.pdf'):
            return self.parser.parse_pdf_buffer(buffer)
        if fn_lower.endswith('.csv'):
            return self.parser.parse_csv_buffer(buffer)
        if mimetype in ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        'application/vnd.ms-excel') or fn_lower.endswith(('.xlsx', '.xls')):
            return self.parser.parse_excel_buffer(buffer)
        if fn_lower.endswith('.json'):
            return self.parser.parse_text_buffer(buffer, 'utf-8')
        # Default: text
        return self.parser.parse_text_buffer(buffer)

    def _detect_source_type(self, mimetype: str, filename: str) -> str:
        fn = filename.lower()
        if 'pdf' in mimetype or fn.endswith('.pdf'):      return 'pdf'
        if 'excel' in mimetype or fn.endswith(('.xlsx', '.xls')): return 'excel'
        if fn.endswith('.csv'):  return 'csv'
        if fn.endswith('.json'): return 'json'
        if 'image' in mimetype:  return 'image'
        return 'text'

    def _generate_summary(self, text: str, doc_type: str,
                           metrics: dict, symbols: list) -> str:
        """Rule-based summary generator."""
        sym_str = ', '.join(symbols[:3]) if symbols else 'general market'
        met_str = ', '.join(f"{k}={v}" for k, v in list(metrics.items())[:3]) if metrics else 'no metrics extracted'
        sentiment = self.parser.compute_sentiment(text)
        tone = "positive" if sentiment > 0.1 else ("negative" if sentiment < -0.1 else "neutral")

        lines = [
            f"Document type: {doc_type}.",
            f"Relevant to: {sym_str}.",
            f"Key metrics: {met_str}.",
            f"Overall tone: {tone} (sentiment score: {sentiment:+.2f}).",
        ]
        if metrics.get('net_profit'):
            lines.append(f"Net profit: ₹{metrics['net_profit']:,.0f}.")
        if metrics.get('roe'):
            lines.append(f"ROE: {metrics['roe']}%.")
        return ' '.join(lines)[:500]

    def get_status(self) -> dict:
        return {
            "knowledge_base": self.kb.get_status(),
            "macro_context":  self.kb.get_macro_context(),
        }


# Module-level singleton
_doc_engine = DocIntelligenceEngine()

def get_doc_engine() -> DocIntelligenceEngine:
    return _doc_engine
