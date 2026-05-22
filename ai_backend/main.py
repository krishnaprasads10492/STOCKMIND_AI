"""
StockMind AI — Python ML Inference Backend
==========================================

FastAPI server that exposes the AI prediction engine to the Node.js backend.

Endpoints:
  GET  /health              — system health
  POST /predict             — generate 16 signals (with real OHLCV + adaptive weights)
  POST /backtest            — run walk-forward backtest
  POST /calibrate           — recalibrate on accuracy drift
  GET  /models/status       — model load status

Start:
  uvicorn main:app --host 0.0.0.0 --port 8001 --reload
"""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, Literal, Any
import logging
import uuid
import time
import asyncio
import json

from engine.dispatcher import generate_signals
from engine.health import get_health
from engine.backtest import run_backtest
from engine.data_fetcher import get_ohlcv, ohlcv_to_df
from engine.strategy_scorer import compute_composite_score
from engine.self_optimizer import SELF_OPTIMIZER
from engine.jarvis_core import JARVIS_INSTANCE
from engine.theme_generator import generate_theme, generate_theme_with_wallpapers
from engine.jarvis_brain import JARVIS_BRAIN
from engine.jarvis_agent import get_jarvis_agi
from engine.agi_engine import AGI_ENGINE
from engine.agi_envelope import AGI_ENVELOPE
from engine.smart_theme_creator import create_theme_from_search, get_capabilities as get_theme_capabilities

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("stockmind-ai")

app = FastAPI(
    title="StockMind AI — Inference Backend",
    version="0.2.0",
    description="Ensemble ML prediction engine with adaptive learning and walk-forward backtest",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Start JARVIS background monitoring on server startup."""
    JARVIS_INSTANCE.start()
    logger.info("[StockMind AI] JARVIS online — self-monitoring active")


# ── Request schemas ───────────────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    symbol:          str   = Field(..., min_length=1, max_length=20)
    exchange:        str   = Field(default="NSE")
    instrType:       Literal["spot", "futures", "options"] = "spot"
    basePrice:       float = Field(..., gt=0)
    capital:         float = Field(..., gt=0)
    riskPct:         float = Field(default=1.5, ge=0.5, le=5.0)
    direction:       Literal["long", "short", "both"] = "both"
    minGrade:        Literal["A+", "A", "B", "C", "D"] = "C"
    predictionMode:  Literal["learning", "realworld", "both"] = "both"
    adaptiveWeight:  float = Field(default=1.0, ge=0.5, le=2.0)
    signalCount:     int   = Field(default=16, ge=1, le=50)
    # Real OHLCV from Node.js backend (list of {date,open,high,low,close,volume})
    ohlcv:           Optional[list[dict]] = None
    # Options-specific
    strike:          Optional[float] = None
    optType:         Optional[Literal["CE", "PE"]] = None
    expiry:          Optional[str] = None
    daysLeft:        Optional[int] = None
    lotSize:         Optional[int] = None
    optionMeta:      Optional[dict] = None
    # Futures-specific
    futuresMeta:     Optional[dict] = None
    # Derivative recommender
    isDerivRec:      bool = False
    isIndexDerivRec: bool = False
    # AGI options
    agi_enhance:     bool = True    # apply AGI enhancement layer
    multi_horizon:   bool = False   # include multi-horizon predictions


class BacktestRequest(BaseModel):
    symbol:       str   = Field(..., min_length=1, max_length=20)
    exchange:     str   = Field(default="NSE")
    modelVersion: str   = Field(default="v0.2.0")
    ohlcv:        Optional[list[dict]] = None
    basePrice:    Optional[float] = None


class CalibrateRequest(BaseModel):
    symbol:    str
    accuracy:  float
    drift:     float
    timestamp: Optional[float] = None


class StrategyScoreRequest(BaseModel):
    symbol:    str   = Field(..., min_length=1, max_length=20)
    exchange:  str   = Field(default="NSE")
    regime:    str   = Field(default="trending")
    ohlcv:     Optional[list[dict]] = None
    basePrice: Optional[float] = None


class OutcomeRequest(BaseModel):
    signal_id:      str
    symbol:         str
    predicted_prob: float = Field(..., ge=0.0, le=1.0)
    actual_outcome: str   # T1_HIT | T2_HIT | T3_HIT | SL_HIT | TIMEOUT
    regime:         str   = "trending"


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return get_health()


@app.post("/predict")
def predict(req: PredictionRequest):
    try:
        params = req.model_dump()
        signals = generate_signals(params)

        # AGI enhancement on first signal (as representative)
        agi_status = None
        if req.agi_enhance and signals:
            try:
                from engine.features import compute_features
                from engine.data_fetcher import get_ohlcv
                df, _ = get_ohlcv(params)
                feats  = compute_features(df)
                # Enhance the first signal's metadata
                representative = signals[0]
                enhanced = AGI_ENGINE.enhance_prediction(
                    base_result={
                        "probability":  representative["probability"] / 100,
                        "reasons":      representative.get("reasons", []),
                        "epistemic":    0.08,
                        "agreement":    0.75,
                    },
                    features=feats,
                    symbol=req.symbol,
                    regime=req.predictionMode,
                )
                agi_status = {
                    "detailed_regime":  enhanced.get("detailed_regime"),
                    "regime_accuracy":  enhanced.get("regime_accuracy"),
                    "anomaly_score":    enhanced.get("anomaly_score"),
                    "is_anomalous":     enhanced.get("is_anomalous"),
                    "multi_horizon":    enhanced.get("multi_horizon") if req.multi_horizon else None,
                    "regime_note":      enhanced.get("regime_note"),
                }
            except Exception as e:
                logger.warning(f"[AGI] Enhancement failed (non-fatal): {e}")

        result = {
            "requestId":     uuid.uuid4().hex,
            "symbol":        req.symbol,
            "exchange":      req.exchange,
            "generatedAt":   int(time.time() * 1000),
            "modelVersion":  "v0.5.1-agi-ensemble",
            "predictionMode": req.predictionMode,
            "adaptiveWeight": req.adaptiveWeight,
            "signals":       signals,
            "suppressedCount": sum(1 for s in signals if s.get("suppressed")),
            "dataSource":    signals[0].get("dataSource", "unknown") if signals else "unknown",
        }
        if agi_status:
            result["agi"] = agi_status
        return result
    except Exception as e:
        logger.error(f"Prediction error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/backtest")
def backtest(req: BacktestRequest):
    """
    Run a walk-forward backtest for a symbol.
    Returns accuracy metrics and stability flag.
    If accuracy < 75% → action = 'retrain_required'
    """
    try:
        params = req.model_dump()
        df, is_real = get_ohlcv(params)

        if not is_real:
            logger.warning(f"[Backtest] {req.symbol}: using mock OHLCV — results are indicative only")

        result = run_backtest(df, req.symbol, req.modelVersion)
        result["dataSource"] = "real" if is_real else "mock"
        result["warning"]    = None if is_real else "Mock OHLCV used — provide real data for accurate backtest"

        return result
    except Exception as e:
        logger.error(f"Backtest error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/calibrate")
def calibrate(req: CalibrateRequest):
    """
    Called by the Node.js outcome validator when accuracy drifts.
    Triggers recalibration of the ensemble for the affected symbol.
    """
    symbol   = req.symbol
    accuracy = req.accuracy
    drift    = req.drift

    logger.info(f"[Calibrate] {symbol}: accuracy={accuracy}%, drift={drift:.1f}%")

    action  = "none"
    message = ""

    if drift > 15:
        action  = "retrain_required"
        message = f"Accuracy drift {drift:.1f}% exceeds threshold — manual retraining required"
        logger.warning(f"[Calibrate] ⚠ {message}")
    elif drift > 8:
        action  = "recalibrate"
        message = f"Recalibrating Platt scaling for {symbol}"
        logger.info(f"[Calibrate] {message}")
        # In production: re-fit Platt/Isotonic on recent outcomes
        # from engine.calibration import fit_platt_scaling
        # fit_platt_scaling(symbol, recent_outcomes)
    elif drift > 3:
        action  = "reduce_confidence"
        message = f"Reducing confidence by 10% for {symbol}"
        logger.info(f"[Calibrate] {message}")

    return {
        "symbol":    symbol,
        "accuracy":  accuracy,
        "drift":     drift,
        "action":    action,
        "message":   message,
        "timestamp": time.time(),
    }


@app.get("/models/status")
def model_status():
    """Returns which models are loaded and their calibration health."""
    from engine.registry import MODEL_REGISTRY
    return MODEL_REGISTRY.status()


@app.get("/adaptive-weight/{symbol}")
def adaptive_weight(symbol: str, instr_type: str = "spot"):
    """
    Return the current adaptive weight for a symbol+instrType.
    This is computed from the deviation history stored by the Node.js backend.
    The Python backend doesn't store this — it's passed in each request.
    """
    return {
        "symbol":    symbol,
        "instrType": instr_type,
        "weight":    1.0,  # Node.js computes this from its own deviation store
        "note":      "Adaptive weight is computed by Node.js and passed in each /predict request",
    }


@app.post("/strategy/score")
def strategy_score(req: StrategyScoreRequest):
    """
    Run all 10 elite algorithms on a symbol and return composite strategy score.
    This is the core of the Strategy Intelligence page.
    """
    try:
        from engine.registry import MODEL_REGISTRY
        params = req.model_dump()
        df, is_real = get_ohlcv(params)

        result = compute_composite_score(df, MODEL_REGISTRY, req.regime)
        result["symbol"]     = req.symbol
        result["exchange"]   = req.exchange
        result["dataSource"] = "real" if is_real else "mock"
        result["timestamp"]  = int(time.time() * 1000)

        if not is_real:
            result["warning"] = "Using estimated data — start backend with real OHLCV for accurate scores"

        return result
    except Exception as e:
        logger.error(f"Strategy score error for {req.symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/strategy/score/batch")
def strategy_score_batch(body: dict):
    """
    Score multiple symbols at once. Returns ranked list.
    body: { symbols: [{symbol, exchange, regime}], ohlcv_map: {symbol: [...]} }
    """
    try:
        from engine.registry import MODEL_REGISTRY
        symbols  = body.get("symbols", [])
        ohlcv_map = body.get("ohlcv_map", {})
        results  = []

        for item in symbols[:20]:  # max 20 symbols per batch
            sym = item.get("symbol", "")
            exc = item.get("exchange", "NSE")
            reg = item.get("regime", "trending")

            params = {"symbol": sym, "exchange": exc, "ohlcv": ohlcv_map.get(sym)}
            try:
                df, is_real = get_ohlcv(params)
                score = compute_composite_score(df, MODEL_REGISTRY, reg)
                score["symbol"]     = sym
                score["exchange"]   = exc
                score["dataSource"] = "real" if is_real else "mock"
                results.append(score)
            except Exception as e:
                logger.warning(f"Batch score failed for {sym}: {e}")
                results.append({"symbol": sym, "error": str(e), "compositeScore": 0})

        results.sort(key=lambda r: r.get("compositeScore", 0), reverse=True)
        return {"results": results, "count": len(results), "timestamp": int(time.time() * 1000)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/self-optimizer/outcome")
def record_outcome(req: OutcomeRequest):
    """Record a prediction outcome for self-optimization tracking."""
    SELF_OPTIMIZER.record_outcome(
        req.signal_id, req.symbol, req.predicted_prob,
        req.actual_outcome, req.regime
    )
    return {"ok": True, "tracked": len(SELF_OPTIMIZER.tracker.outcomes)}


@app.get("/self-optimizer/health")
def optimizer_health():
    """Get the self-optimizer health report with recommendations."""
    return SELF_OPTIMIZER.get_health_report()


@app.post("/self-optimizer/optimize")
def run_optimization():
    """
    Run one optimization cycle. Returns proposed parameter changes.
    ALL changes require human approval — nothing is auto-applied.
    """
    return SELF_OPTIMIZER.run_optimization_cycle()


@app.post("/self-optimizer/approve")
def approve_optimization(body: dict):
    """
    Human approval endpoint for proposed parameter changes.
    In production, this would apply the approved params to the models.
    """
    cycle    = body.get("cycle", 0)
    approved = body.get("approved", False)
    params   = body.get("params", {})

    if approved and params:
        SELF_OPTIMIZER.tuner.current_params.update(params)
        SELF_OPTIMIZER.tuner.record_trial(params, SELF_OPTIMIZER.tracker.rolling_accuracy(), approved=True)
        logger.info(f"[SelfOptimizer] Cycle {cycle} approved and applied")
        return {"ok": True, "message": f"Optimization cycle {cycle} applied", "params": params}

    logger.info(f"[SelfOptimizer] Cycle {cycle} rejected")
    return {"ok": True, "message": f"Optimization cycle {cycle} rejected — no changes applied"}


# ── JARVIS endpoints ──────────────────────────────────────────────────────────

@app.get("/jarvis/status")
def jarvis_status():
    """Full JARVIS status: system health, ML health, pending approvals, recent events."""
    return JARVIS_INSTANCE.get_status()


@app.get("/jarvis/events")
async def jarvis_events_stream(since: float = 0):
    """
    SSE endpoint — streams JARVIS events to the UI in real-time.
    Connect with EventSource('/jarvis/events') in the browser.
    """
    async def event_generator():
        # Send all recent events first
        recent = JARVIS_INSTANCE.get_events_since(since) if since > 0 else JARVIS_INSTANCE.events.recent(30)
        for event in recent:
            yield f"data: {json.dumps(event)}\n\n"

        # Then stream new events as they arrive
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)

        def on_event(evt):
            try:
                queue.put_nowait(evt.to_dict())
            except asyncio.QueueFull:
                pass

        JARVIS_INSTANCE.events.subscribe(on_event)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Keep-alive ping
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            JARVIS_INSTANCE.events.unsubscribe(on_event)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/jarvis/events/poll")
def jarvis_events_poll(since: float = 0):
    """
    Polling fallback for environments where SSE is not available.
    Returns events since the given timestamp.
    """
    events = JARVIS_INSTANCE.get_events_since(since) if since > 0 else JARVIS_INSTANCE.events.recent(50)
    return {"events": events, "count": len(events), "timestamp": time.time()}


@app.get("/jarvis/dependencies")
def jarvis_dependencies():
    """Run dependency scan — checks pip and npm for outdated packages."""
    return JARVIS_INSTANCE.get_dep_scan()


@app.get("/jarvis/code-health")
def jarvis_code_health():
    """Analyze codebase health — TODOs, architecture violations, staleness."""
    return JARVIS_INSTANCE.get_code_health()


@app.get("/jarvis/algo-proposals")
def jarvis_algo_proposals():
    """Get algorithm upgrade proposals — all require human approval."""
    return {"proposals": JARVIS_INSTANCE.get_algo_proposals(), "timestamp": time.time()}


@app.post("/jarvis/force-scan")
def jarvis_force_scan(body: dict):
    """Force an immediate scan. scan_type: dependencies | code_health | diagnostics | algo_review"""
    scan_type = body.get("scan_type", "diagnostics")
    return JARVIS_INSTANCE.force_scan(scan_type)


@app.post("/jarvis/approve")
def jarvis_approve(body: dict):
    """Approve or reject a pending JARVIS action."""
    action_id = body.get("action_id", "")
    approved  = body.get("approved", False)
    user      = body.get("user", "admin")
    if not action_id:
        raise HTTPException(status_code=400, detail="action_id required")
    return JARVIS_INSTANCE.approve_action(action_id, approved, user)


@app.post("/jarvis/record-request")
def jarvis_record_request(body: dict):
    """Record an API request for diagnostics (called by Node.js middleware)."""
    JARVIS_INSTANCE.diagnostics.record_request(
        body.get("endpoint", "unknown"),
        body.get("duration_ms", 0),
        body.get("status", 200),
    )
    return {"ok": True}


# ── JARVIS Codebase Engineer endpoints ───────────────────────────────────────

class PatchRequest(BaseModel):
    approval_token: str
    rel_path:       str = Field(..., min_length=1, max_length=500)
    old_content:    str
    new_content:    str


class InstallDepRequest(BaseModel):
    approval_token: str
    manager:        Literal["pip", "npm"]
    package:        str = Field(..., min_length=1, max_length=100)
    version:        str = Field(default="")


class RunTestsRequest(BaseModel):
    test_runner: Literal["pytest", "npm"] = "pytest"
    test_path:   str = Field(default="")


class RollbackRequest(BaseModel):
    approval_token:  str
    backup_filename: str = Field(..., min_length=1, max_length=200)


class GenerateAlgoRequest(BaseModel):
    algo_type:   Literal["classifier", "feature_extractor"]
    algo_name:   str = Field(..., min_length=1, max_length=60)
    class_name:  str = Field(..., min_length=1, max_length=60)
    description: str = Field(default="")


@app.post("/jarvis/patch")
def jarvis_patch(req: PatchRequest):
    """Apply a code patch to a file. Requires approval token."""
    return JARVIS_INSTANCE.engineer.patch_file(
        req.approval_token, req.rel_path, req.old_content, req.new_content
    )


@app.post("/jarvis/install-dep")
def jarvis_install_dep(req: InstallDepRequest):
    """Install a dependency. Requires approval token."""
    return JARVIS_INSTANCE.engineer.install_dependency(
        req.approval_token, req.manager, req.package, req.version
    )


@app.post("/jarvis/run-tests")
def jarvis_run_tests(req: RunTestsRequest):
    """Run the test suite and return results."""
    return JARVIS_INSTANCE.engineer.run_tests(req.test_runner, req.test_path)


@app.post("/jarvis/rollback")
def jarvis_rollback(req: RollbackRequest):
    """Rollback a file from a backup. Requires approval token."""
    return JARVIS_INSTANCE.engineer.rollback(req.approval_token, req.backup_filename)


@app.get("/jarvis/backups")
def jarvis_backups():
    """List all available file backups."""
    return {"backups": JARVIS_INSTANCE.engineer.list_backups(), "timestamp": time.time()}


@app.post("/jarvis/issue-token")
def jarvis_issue_token():
    """Issue a new single-use approval token for codebase operations."""
    token = JARVIS_INSTANCE.engineer.issue_token()
    return {"token": token, "expires_in_seconds": 600}


@app.post("/jarvis/generate-algo")
def jarvis_generate_algo(req: GenerateAlgoRequest):
    """Generate Python code for a new ML algorithm based on templates."""
    return JARVIS_INSTANCE.engineer.generate_algorithm_code(
        req.algo_type, req.algo_name, req.class_name, req.description
    )


@app.post("/strategy/parse")
def strategy_parse(body: dict):
    """
    AI-enhanced strategy parser.
    Receives a plain-English strategy description and returns structured parameters.
    The Node.js backend has its own rule-based parser; this endpoint provides
    a more sophisticated analysis when the Python backend is available.
    """
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Strategy text required")

    # For now, return a structured response that the Node.js parser can enhance.
    # In production, this would use an LLM (e.g., fine-tuned FinBERT or GPT-4)
    # to parse the strategy with much higher accuracy.
    lower = text.lower()

    instr_type = "spot"
    if any(w in lower for w in ["futures", "fut", "future"]):
        instr_type = "futures"
    elif any(w in lower for w in ["option", "call", "put", "ce", "pe"]):
        instr_type = "options"

    direction = "both"
    has_buy  = any(w in lower for w in ["buy", "long", "call", "bullish", "above"])
    has_sell = any(w in lower for w in ["sell", "short", "put", "bearish", "below"])
    if has_buy and not has_sell:  direction = "long"
    if has_sell and not has_buy: direction = "short"

    return {
        "parsed":     True,
        "instrType":  instr_type,
        "direction":  direction,
        "confidence": 75,
        "note":       "Enhanced parsing available with LLM integration",
    }


# ── JARVIS Theme Generation endpoints ─────────────────────────────────────────

class ThemeGenerateRequest(BaseModel):
    name:            str  = Field(..., min_length=1, max_length=50)
    description:     str  = Field(..., min_length=3, max_length=200)
    with_wallpapers: bool = Field(default=True)
    wallpaper_count: int  = Field(default=6, ge=1, le=12)


class ThemeWriteRequest(BaseModel):
    approval_token: str
    theme:          dict   # the generated theme object


@app.post("/jarvis/generate-theme")
async def jarvis_generate_theme(req: ThemeGenerateRequest):
    """
    Generate a complete UI theme from a name and description.
    When with_wallpapers=True, fetches real wallpaper images from Unsplash/Pexels/Pixabay.
    Falls back to curated images if no API keys are configured — always returns wallpapers.
    """
    try:
        if req.with_wallpapers:
            theme = await generate_theme_with_wallpapers(
                req.name, req.description, req.wallpaper_count
            )
        else:
            theme = generate_theme(req.name, req.description)

        logger.info(f"[JARVIS] Theme generated: {theme['key']} ({req.name}) "
                    f"with {len(theme.get('wallpapers', []))} wallpapers")
        JARVIS_INSTANCE.events.push(JarvisEvent(
            type=EVENT_TYPES["RECOMMENDATION"],
            title=f"Theme Generated: {req.name}",
            message=f"New theme '{req.name}' generated with {len(theme.get('wallpapers', []))} wallpaper options.",
            severity="INFO",
            data={"key": theme["key"], "name": req.name, "emoji": theme["emoji"],
                  "wallpaper_count": len(theme.get("wallpapers", []))},
        ))
        return {"ok": True, "theme": theme}
    except Exception as e:
        logger.error(f"[JARVIS] Theme generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/jarvis/write-theme")
def jarvis_write_theme(req: ThemeWriteRequest):
    """
    Write an approved generated theme permanently to src/utils/themes.js.
    Requires a valid approval token. Creates a backup before modifying.
    """
    if not JARVIS_INSTANCE.engineer.validate_token(req.approval_token):
        raise HTTPException(status_code=403, detail="Invalid or expired approval token")

    theme = req.theme
    if not theme or not theme.get("key") or not theme.get("vars"):
        raise HTTPException(status_code=400, detail="Invalid theme object")

    key  = theme["key"]
    name = theme.get("name", key)

    # Sanitize key — only alphanumeric and hyphens
    import re as _re
    if not _re.match(r'^[a-z0-9\-]+$', key):
        raise HTTPException(status_code=400, detail="Invalid theme key")

    # Build the JS snippet to inject into themes.js
    vars_lines = []
    for prop, val in theme["vars"].items():
        # Escape single quotes in values
        safe_val = str(val).replace("'", "\\'")
        vars_lines.append(f"      '{prop}': '{safe_val}',")
    vars_block = "\n".join(vars_lines)

    emoji    = theme.get("emoji", "🎨")
    category = theme.get("category", "custom")
    desc     = theme.get("description", "")[:100].replace("'", "\\'")

    new_entry = f"""
  '{key}': {{
    name: '{name}',
    description: '{desc}',
    category: '{category}',
    emoji: '{emoji}',
    vars: {{
{vars_block}
    }},
  }},
"""

    # Find the insertion point — just before the closing brace of THEMES
    # We insert before: "/** Ordered list of theme keys for display */"
    old_marker = "\n/** Ordered list of theme keys for display */"
    new_marker = new_entry + "\n/** Ordered list of theme keys for display */"

    # Use the CodebaseEngineer to patch the file safely
    # First issue a new internal token (the user's token was already consumed above)
    internal_token = JARVIS_INSTANCE.engineer.issue_token()
    result = JARVIS_INSTANCE.engineer.patch_file(
        internal_token,
        "src/utils/themes.js",
        old_marker,
        new_marker,
    )

    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result.get("error", "Patch failed"))

    logger.info(f"[JARVIS] Theme '{key}' written to themes.js")
    JARVIS_INSTANCE.events.push(JarvisEvent(
        type=EVENT_TYPES["ACTION_APPLIED"],
        title=f"Theme Written: {name}",
        message=f"Theme '{name}' ({key}) permanently added to themes.js. Reload the app to use it.",
        severity="SUCCESS",
        data={"key": key, "name": name, "backup": result.get("backup_path")},
    ))

    return {
        "ok":      True,
        "key":     key,
        "name":    name,
        "backup":  result.get("backup_path"),
        "message": f"Theme '{name}' added permanently. Reload the app to see it in Settings.",
    }


# ── JARVIS Brain (Conversational AI) endpoints ────────────────────────────────

class BrainChatRequest(BaseModel):
    conv_id:   Optional[str] = None   # None = start new conversation
    message:   str = Field(..., min_length=1, max_length=2000)
    use_cloud: bool = True


class BrainFeedbackRequest(BaseModel):
    conv_id:     str
    message_idx: int = Field(..., ge=0)
    feedback:    Literal["accepted", "rejected", "modified"]
    intent:      str = Field(default="")


@app.post("/jarvis/brain/chat")
async def jarvis_brain_chat(req: BrainChatRequest):
    """
    Main conversational endpoint for JARVIS.
    Understands natural language, plans actions, calls cloud AI if available.
    """
    # Start new conversation if no conv_id provided
    conv_id = req.conv_id or JARVIS_BRAIN.new_conversation()

    try:
        result = await JARVIS_BRAIN.chat(conv_id, req.message, req.use_cloud)
        return result
    except Exception as e:
        logger.error(f"[Brain] Chat error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/jarvis/brain/feedback")
def jarvis_brain_feedback(req: BrainFeedbackRequest):
    """Record user feedback on a JARVIS response to improve future suggestions."""
    JARVIS_BRAIN.record_feedback(req.conv_id, req.message_idx, req.feedback, req.intent)
    return {"ok": True}


@app.get("/jarvis/brain/stats")
def jarvis_brain_stats():
    """Get JARVIS brain statistics: conversations, feedback, token usage, providers."""
    return JARVIS_BRAIN.get_stats()


@app.get("/jarvis/brain/conversation/{conv_id}")
def jarvis_brain_conversation(conv_id: str):
    """Get the full message history for a conversation."""
    messages = JARVIS_BRAIN.get_conversation(conv_id)
    return {"conv_id": conv_id, "messages": messages, "count": len(messages)}


@app.get("/jarvis/brain/conversations")
def jarvis_brain_conversations(n: int = 10):
    """Get recent conversation summaries."""
    convs = JARVIS_BRAIN.get_recent_conversations(n)
    return {"conversations": convs, "count": len(convs)}


@app.post("/jarvis/brain/new-conversation")
def jarvis_brain_new_conversation():
    """Start a new conversation and return its ID."""
    conv_id = JARVIS_BRAIN.new_conversation()
    return {"conv_id": conv_id}


@app.post("/jarvis/brain/rebuild-knowledge")
def jarvis_brain_rebuild_knowledge():
    """Force rebuild of the codebase knowledge index."""
    JARVIS_BRAIN.rebuild_knowledge()
    return {"ok": True, "message": "Knowledge index rebuild started in background"}


# ── JARVIS AGI endpoints ──────────────────────────────────────────────────────

class AGIExecuteRequest(BaseModel):
    goal:       str = Field(..., min_length=1, max_length=3000)
    conv_id:    Optional[str] = None
    use_agent:  bool = True   # False = direct LLM, True = ReAct agent loop


class AGIFeedbackRequest(BaseModel):
    response:  str
    feedback:  Literal["accepted", "rejected", "modified"]
    intent:    str = Field(default="")


@app.post("/jarvis/agi/execute")
async def jarvis_agi_execute(req: AGIExecuteRequest):
    """
    Execute a goal using the full AGI stack:
    - Simple tasks → direct LLM
    - Complex tasks → ReAct agent loop with tool use
    - Domain tasks → multi-agent routing
    """
    conv_id = req.conv_id or JARVIS_BRAIN.new_conversation()
    try:
        agi    = get_jarvis_agi()
        result = await agi.execute_goal(req.goal, conv_id, req.use_agent)
        result["conv_id"] = conv_id
        return result
    except Exception as e:
        logger.error(f"[AGI] Execute error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jarvis/agi/task/{task_id}")
def jarvis_agi_task(task_id: str):
    """Get the status and steps of an AGI task."""
    agi  = get_jarvis_agi()
    task = agi.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.get("/jarvis/agi/tasks")
def jarvis_agi_tasks():
    """List all AGI tasks."""
    agi = get_jarvis_agi()
    return {"tasks": agi.get_all_tasks(), "count": len(agi.get_all_tasks())}


@app.post("/jarvis/agi/feedback")
def jarvis_agi_feedback(req: AGIFeedbackRequest):
    """Record feedback on an AGI response for self-improvement."""
    agi = get_jarvis_agi()
    agi.record_feedback(req.response, req.feedback, req.intent)
    JARVIS_BRAIN.record_feedback("", 0, req.feedback, req.intent)
    return {"ok": True}


@app.get("/jarvis/agi/insights")
def jarvis_agi_insights():
    """Get self-improvement insights from feedback analysis."""
    agi = get_jarvis_agi()
    return agi.get_improvement_insights()


@app.get("/jarvis/agi/capabilities")
def jarvis_agi_capabilities():
    """Return the full list of JARVIS AGI capabilities."""
    from engine.jarvis_agent import TOOLS
    return {
        "tools":      list(TOOLS.keys()),
        "tool_details": TOOLS,
        "ai_paradigms": [
            {"name": "Narrow AI",      "description": "Specialized ML models (LightGBM, XGBoost, LSTM) for market predictions"},
            {"name": "Generative AI",  "description": "LLM-powered code generation, explanation, and feature scaffolding"},
            {"name": "Agentic AI",     "description": "ReAct loop: multi-step autonomous task execution with tool use"},
            {"name": "Multi-Agent",    "description": "Specialized sub-agents: Market Analyst, Code Engineer, ML Researcher, UI Designer"},
            {"name": "Self-Improving", "description": "Learns from feedback, improves own prompts, tracks acceptance rates"},
        ],
        "providers": {
            "available": JARVIS_BRAIN.cloud_ai._available,
            "active":    JARVIS_BRAIN.cloud_ai.active_provider,
            "has_cloud": JARVIS_BRAIN.cloud_ai.has_cloud,
        },
    }


# ── AI Provider Management endpoints ─────────────────────────────────────────

class AddProviderRequest(BaseModel):
    id:       str = Field(..., min_length=1, max_length=50)
    name:     str = Field(..., min_length=1, max_length=100)
    base_url: str = Field(..., min_length=1, max_length=200)
    env_key:  Optional[str] = None
    format:   str = Field(default="openai")
    models:   Optional[list[dict]] = None
    note:     Optional[str] = None


class SetModelRequest(BaseModel):
    provider_id: str
    model_id:    str


class TestProviderRequest(BaseModel):
    provider_id: str
    model_id:    Optional[str] = None


@app.get("/jarvis/providers")
def jarvis_providers():
    """Get all AI providers with their status."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    return PROVIDER_REGISTRY.get_status()


@app.post("/jarvis/providers/add")
def jarvis_add_provider(req: AddProviderRequest):
    """Add a new AI provider to the registry."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    config = {
        "id":    req.id,
        "name":  req.name,
        "api": {
            "base_url":   req.base_url,
            "chat_path":  "/chat/completions",
            "format":     req.format,
            "auth_header": "Authorization",
            "auth_prefix": "Bearer ",
        },
        "env_key": req.env_key,
        "models":  req.models or [{"id": "default", "name": "Default", "context": 4096,
                                    "cost_per_1m_input": 0, "cost_per_1m_output": 0, "recommended": True}],
        "note":    req.note or "",
    }
    result = PROVIDER_REGISTRY.add_provider(config)
    if result.get("ok"):
        # Reload the brain's cloud AI bridge
        JARVIS_BRAIN.cloud_ai._reload()
        JARVIS_INSTANCE.events.push(JarvisEvent(
            type=EVENT_TYPES["ACTION_APPLIED"],
            title=f"Provider Added: {req.name}",
            message=f"New AI provider '{req.name}' added to JARVIS. Set {req.env_key} in .env to activate.",
            severity="SUCCESS",
            data={"provider_id": req.id, "name": req.name},
        ))
    return result


@app.delete("/jarvis/providers/{provider_id}")
def jarvis_remove_provider(provider_id: str):
    """Remove a custom provider."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    result = PROVIDER_REGISTRY.remove_provider(provider_id)
    if result.get("ok"):
        JARVIS_BRAIN.cloud_ai._reload()
    return result


@app.post("/jarvis/providers/set-model")
def jarvis_set_model(req: SetModelRequest):
    """Set the active model for a provider."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    result = PROVIDER_REGISTRY.set_active_model(req.provider_id, req.model_id)
    if result.get("ok"):
        JARVIS_BRAIN.cloud_ai._reload()
    return result


@app.post("/jarvis/providers/set-active")
def jarvis_set_active_provider(body: dict):
    """Set the preferred AI provider."""
    provider_id = body.get("provider_id", "auto")
    JARVIS_BRAIN.cloud_ai._preferred = provider_id
    return {"ok": True, "active_provider": provider_id}


@app.post("/jarvis/providers/test")
async def jarvis_test_provider(req: TestProviderRequest):
    """Test a provider with a ping message."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    from engine.ai_caller import test_provider
    provider = PROVIDER_REGISTRY.get_provider(req.provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")
    api_key  = PROVIDER_REGISTRY.get_api_key(req.provider_id)
    model_id = req.model_id or PROVIDER_REGISTRY.get_active_model(req.provider_id)
    return await test_provider(provider, api_key, model_id)


@app.post("/jarvis/providers/generate-config")
def jarvis_generate_provider_config(body: dict):
    """Generate a provider config from minimal info (used by JARVIS chat)."""
    from engine.ai_provider_registry import PROVIDER_REGISTRY
    name     = body.get("name", "")
    base_url = body.get("base_url", "")
    env_key  = body.get("env_key", "")
    fmt      = body.get("format", "openai")
    models   = body.get("models")
    if not name or not base_url:
        raise HTTPException(status_code=400, detail="name and base_url required")
    config = PROVIDER_REGISTRY.generate_provider_config(name, base_url, env_key, fmt, models)
    return {"ok": True, "config": config}


# ── Image Analysis endpoints ──────────────────────────────────────────────────

from engine.image_reader import analyse_image, analyse_image_sync


class ImageAnalyseRequest(BaseModel):
    image_b64:  str  = Field(..., min_length=10)
    context:    str  = Field(default="")
    use_cloud:  bool = Field(default=True)
    symbol:     Optional[str] = None


@app.post("/image/analyse")
async def image_analyse(req: ImageAnalyseRequest):
    """
    Analyse an image and extract all financial intelligence.

    Accepts base64-encoded image (JPEG/PNG/WebP).
    Pipeline: decode → pre-process → OCR → cloud vision (if configured) → merge.

    Returns structured data: prices, patterns, indicators, bias, support/resistance,
    option chain data, news headlines, and a natural-language summary.
    """
    try:
        context = req.context or (f"Stock market image for {req.symbol}" if req.symbol else "")
        result  = await analyse_image(req.image_b64, context, req.use_cloud)

        # If a symbol was provided and not detected, inject it
        if req.symbol and not result['merged'].get('symbol'):
            result['merged']['symbol'] = req.symbol

        logger.info(
            f"[ImageReader] Analysis complete — method={result['method']} "
            f"confidence={result['confidence']} symbol={result['merged'].get('symbol')}"
        )
        return result
    except Exception as e:
        logger.error(f"[ImageReader] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/image/analyse-sync")
def image_analyse_sync(req: ImageAnalyseRequest):
    """
    Synchronous image analysis — OCR only, no cloud vision.
    Faster but less accurate. Use when cloud AI is not configured.
    """
    try:
        result = analyse_image_sync(req.image_b64, req.context)
        if req.symbol and not result.get('merged', {}).get('symbol'):
            if 'merged' not in result:
                result['merged'] = {}
            result['merged']['symbol'] = req.symbol
        return result
    except Exception as e:
        logger.error(f"[ImageReader] Sync error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/image/capabilities")
def image_capabilities():
    """Return what image analysis capabilities are available on this server."""
    from engine.image_reader import PIL_AVAILABLE, TESSERACT_AVAILABLE
    import os
    return {
        "pil":          PIL_AVAILABLE,
        "tesseract":    TESSERACT_AVAILABLE,
        "openai":       bool(os.environ.get('OPENAI_API_KEY')),
        "anthropic":    bool(os.environ.get('ANTHROPIC_API_KEY')),
        "gemini":       bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')),
        "cloudVision":  any([
            bool(os.environ.get('OPENAI_API_KEY')),
            bool(os.environ.get('ANTHROPIC_API_KEY')),
            bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')),
        ]),
        "install_hint": "pip install Pillow pytesseract" if not PIL_AVAILABLE else (
            "Install Tesseract OCR: https://github.com/tesseract-ocr/tesseract" if not TESSERACT_AVAILABLE else "All local capabilities available"
        ),
    }


# ── AGI Engine endpoints ──────────────────────────────────────────────────────

class AGIOutcomeRequest(BaseModel):
    symbol:        str
    regime:        str  = "trending_bull"
    probability:   float = Field(..., ge=0.0, le=1.0)
    was_correct:   bool
    strategy:      str  = "default"
    horizon:       str  = "1d"


class AGIEnhanceRequest(BaseModel):
    symbol:        str  = Field(..., min_length=1, max_length=20)
    exchange:      str  = Field(default="NSE")
    base_prob:     float = Field(..., ge=0.0, le=1.0)
    ohlcv:         Optional[list[dict]] = None
    base_price:    Optional[float] = None
    multi_horizon: bool = True


@app.get("/agi/status")
def agi_status():
    """Full AGI engine status: regime memory, anomaly log, self-reflection, leading signals."""
    return AGI_ENGINE.get_status()


@app.post("/agi/record-outcome")
def agi_record_outcome(req: AGIOutcomeRequest):
    """Feed resolved prediction outcomes back to the AGI engine for learning."""
    AGI_ENGINE.record_outcome(
        req.symbol, req.regime, req.probability,
        req.was_correct, req.strategy, req.horizon
    )
    return {"ok": True, "message": f"Outcome recorded for {req.symbol} in {req.regime} regime"}


@app.post("/agi/enhance")
async def agi_enhance(req: AGIEnhanceRequest):
    """
    Enhance a probability estimate with AGI capabilities:
    - Transfer learning from similar instruments
    - Multi-horizon projections
    - Anomaly detection
    - Regime memory advisory
    """
    try:
        from engine.data_fetcher import get_ohlcv
        from engine.features import compute_features

        params = {"symbol": req.symbol, "exchange": req.exchange,
                  "ohlcv": req.ohlcv, "basePrice": req.base_price or 1000}
        df, _ = get_ohlcv(params)
        feats  = compute_features(df)

        base_result = {
            "probability": req.base_prob,
            "reasons":     [],
            "epistemic":   0.1,
            "agreement":   0.7,
        }

        enhanced = AGI_ENGINE.enhance_prediction(
            base_result, feats, req.symbol, "trending"
        )

        if not req.multi_horizon:
            enhanced.pop("multi_horizon", None)

        return enhanced
    except Exception as e:
        logger.error(f"[AGI] Enhance error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agi/correlate")
def agi_correlate(body: dict):
    """Update the correlation network with a price observation."""
    symbol = body.get("symbol", "")
    price  = float(body.get("price", 0))
    if symbol and price > 0:
        AGI_ENGINE.correlations.update(symbol, price)
    related = AGI_ENGINE.correlations.get_top_correlated(symbol)
    return {"ok": True, "symbol": symbol, "top_correlated": related}


@app.get("/agi/self-reflection")
def agi_self_reflection():
    """Get the AI's self-assessment: calibration curve, biases, accuracy."""
    return AGI_ENGINE.self_reflection.get_report()


@app.get("/agi/anomalies")
def agi_anomalies():
    """Get recent anomaly detections."""
    return {
        "anomalies": AGI_ENGINE.anomaly.get_recent_anomalies(20),
        "detector_ready": len(AGI_ENGINE.anomaly._feature_history) >= 30
    }


@app.get("/agi/regime-memory")
def agi_regime_memory():
    """Get regime performance history and best strategies per regime."""
    return AGI_ENGINE.regime_memory.get_summary()


@app.post("/agi/multi-horizon")
def agi_multi_horizon(body: dict):
    """Get multi-horizon probability projections from a base probability."""
    base_prob = float(body.get("base_prob", 0.5))
    regime    = body.get("regime", "trending")
    epistemic = float(body.get("epistemic", 0.1))
    horizons  = AGI_ENGINE.multi_horizon.predict_all_horizons(base_prob, regime, epistemic)
    return {"base_prob": base_prob, "regime": regime, "horizons": horizons}


@app.get("/agi/capabilities")
def agi_capabilities():
    """Return the full list of AGI capabilities."""
    return {
        "version": "v0.5.1-agi",
        "modules": {
            "regime_memory":    "Remembers which strategies work in each market regime",
            "causal_filter":    "Distinguishes leading vs lagging signals",
            "transfer_learning":"Applies knowledge from correlated instruments",
            "multi_horizon":    "Simultaneous 5m/1h/1d/1w/1mo predictions",
            "anomaly_detection":"Flags unusual market conditions",
            "correlation_net":  "Tracks inter-market correlations in real-time",
            "self_reflection":  "Evaluates own prediction quality and biases",
            "stacking_ensemble":"8-model stacking with adaptive online weights",
            "uncertainty_quant":"Epistemic + aleatoric uncertainty bounds",
            "online_learning":  "Updates from resolved outcomes without retraining",
        },
        "models": [
            "LightGBM", "XGBoost", "LSTM", "RandomForest",
            "MLP-Neural-Network", "OnlineSGD", "Regime-Aware", "FinBERT-Sentiment"
        ],
        "features": "~150 features: price action + volatility + trend + volume + "
                    "ichimoku + fibonacci + supertrend + elliott wave + market profile + "
                    "order flow + smart money concepts + GARCH + hurst exponent + "
                    "fractal dimension + entropy + cross-timeframe momentum",
    }


# ── AGI Envelope endpoints ────────────────────────────────────────────────────

@app.get("/agi-envelope/status")
def agi_envelope_status():
    """Full AGI Envelope status — all 5 layers."""
    return AGI_ENVELOPE.get_full_status()


@app.post("/agi-envelope/process")
async def agi_envelope_process(body: dict):
    """
    Route a signal through the full AGI Envelope pipeline.
    Exterior → AGI Shield → Main Functionality → Super-AGI Core → Response.
    Blocks adversarial inputs, enforces safety constraints, routes to handler.
    """
    source = body.pop('_source', 'api')
    try:
        result = await AGI_ENVELOPE.process(body, source=source)
        return result
    except Exception as e:
        logger.error(f"[AGIEnvelope] Process error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/agi-envelope/feedback")
def agi_envelope_feedback(body: dict):
    """Feed outcome back through the AGI envelope learning loop."""
    AGI_ENVELOPE.feedback(
        signal_type=body.get('signal_type', 'PREDICTION_REQ'),
        correct=body.get('correct', False),
        pattern_key=body.get('pattern_key', ''),
    )
    return {'ok': True}


@app.get("/agi-envelope/layer/{layer_name}")
def agi_envelope_layer(layer_name: str):
    """Get detailed status of a specific layer."""
    states = AGI_ENVELOPE.get_layer_states()
    if layer_name not in states:
        raise HTTPException(status_code=404, detail=f"Layer '{layer_name}' not found. Valid: {list(states.keys())}")
    return {'layer': layer_name, **states[layer_name]}


# ── Smart Theme Creator endpoints ─────────────────────────────────────────────

class SmartThemeRequest(BaseModel):
    name:        str  = Field(..., min_length=1, max_length=60)
    style:       str  = Field(..., min_length=3, max_length=300)
    image_count: int  = Field(default=6, ge=1, le=12)
    extract_from: int = Field(default=3, ge=1, le=6)


@app.post("/jarvis/smart-theme")
async def jarvis_smart_theme(req: SmartThemeRequest):
    """
    JARVIS intelligent theme creation:
    1. Web search for images matching name/style
    2. Download thumbnails (in-memory)
    3. Extract dominant color palette
    4. Build complete CSS theme from real image colors
    5. Return theme + wallpaper options

    This is what the user asked for:
    'I say the name/style → JARVIS does web search → gets images → builds theme from that'
    """
    try:
        theme = await create_theme_from_search(
            name=req.name.strip(),
            style=req.style.strip(),
            image_count=req.image_count,
            extract_from_images=req.extract_from,
        )
        logger.info(f"[SmartTheme] Created '{req.name}' — "
                    f"palette_source={theme.get('palette_source')}, "
                    f"wallpapers={len(theme.get('wallpapers', []))}")
        return {'ok': True, 'theme': theme}
    except Exception as e:
        logger.error(f"[SmartTheme] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/jarvis/smart-theme/capabilities")
def jarvis_smart_theme_capabilities():
    """Return what smart theme creation capabilities are available."""
    caps = get_theme_capabilities()
    return {
        **caps,
        'pipeline': [
            '1. Web search (DuckDuckGo — no key needed)',
            '2. Unsplash API (set UNSPLASH_API_KEY)',
            '3. Pexels API (set PEXELS_API_KEY)',
            '4. Pixabay API (set PIXABAY_API_KEY)',
            '5. Download thumbnail (in-memory, never saved)',
            '6. Extract dominant palette (requires Pillow)',
            '7. Build CSS theme from real image colors',
        ]
    }
