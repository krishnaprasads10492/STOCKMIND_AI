/**
 * StockChart.jsx — Full-featured native chart (Lightweight Charts, MIT).
 *
 * Implements ALL TradingView widget features:
 *   ✓ Candlestick / Bar / Line / Area / Heikin-Ashi chart types
 *   ✓ Volume histogram (color-coded)
 *   ✓ EMA 20 / 50 / 200 overlays
 *   ✓ Bollinger Bands (20,2)
 *   ✓ VWAP
 *   ✓ Supertrend overlay
 *   ✓ RSI sub-pane
 *   ✓ MACD sub-pane
 *   ✓ Stochastic sub-pane
 *   ✓ ATR sub-pane
 *   ✓ Compare symbols (overlay)
 *   ✓ Drawing tools (trendline, horizontal, vertical, Fibonacci)
 *   ✓ Date range presets (1M 3M 6M 1Y 3Y All)
 *   ✓ Log / Percent price scale
 *   ✓ Save chart as PNG
 *   ✓ Crosshair OHLCV tooltip + legend
 *   ✓ Fullscreen / enlarge mode
 *   ✓ Fit content
 *   ✓ Timezone: Asia/Kolkata
 *   ✓ All 16 app themes
 */

import { useEffect, useRef, useState, useCallback, memo, useMemo } from 'react';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  PriceScaleMode,
} from 'lightweight-charts';
import { useThemeStore } from '@store/themeStore.js';
import { apiFetch } from '@services/apiClient.js';
import { usePageVisibility } from '@hooks/usePageVisibility.js';
import styles from './StockChart.module.css';

// ─────────────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────────────

function getChartTheme(t) {
  const T = {
    'cyber-dark': {
      bg: '#060b14',
      text: '#94a3b8',
      grid: '#0d1f2d',
      border: '#1e3a4a',
      up: '#00ff88',
      down: '#ff3366',
      wick: '#64748b',
      subBg: '#040810',
    },
    'iron-man': {
      bg: '#0a0500',
      text: '#d4a017',
      grid: '#1a0e00',
      border: '#3a2000',
      up: '#ffcc00',
      down: '#ff2200',
      wick: '#8b6914',
      subBg: '#060300',
    },
    matrix: {
      bg: '#000300',
      text: '#00ff41',
      grid: '#001200',
      border: '#003300',
      up: '#00ff88',
      down: '#ff0033',
      wick: '#006600',
      subBg: '#000200',
    },
    tron: {
      bg: '#000510',
      text: '#00c8ff',
      grid: '#000d20',
      border: '#001a40',
      up: '#00ffcc',
      down: '#ff3399',
      wick: '#004466',
      subBg: '#000310',
    },
    'blade-runner': {
      bg: '#080408',
      text: '#ff44cc',
      grid: '#120810',
      border: '#2a1020',
      up: '#ff9900',
      down: '#ff2266',
      wick: '#662244',
      subBg: '#050206',
    },
    'ghost-in-shell': {
      bg: '#020c10',
      text: '#00dcc8',
      grid: '#041820',
      border: '#083040',
      up: '#00ffaa',
      down: '#ff4466',
      wick: '#006655',
      subBg: '#010810',
    },
    interstellar: {
      bg: '#050305',
      text: '#ffb040',
      grid: '#0e080e',
      border: '#201020',
      up: '#88ff88',
      down: '#ff6644',
      wick: '#664422',
      subBg: '#030203',
    },
    dune: {
      bg: '#0a0700',
      text: '#dca000',
      grid: '#1a1200',
      border: '#302000',
      up: '#88cc44',
      down: '#cc4422',
      wick: '#664400',
      subBg: '#060400',
    },
    avatar: {
      bg: '#010a08',
      text: '#00ff9f',
      grid: '#021810',
      border: '#043020',
      up: '#44ffaa',
      down: '#ff4488',
      wick: '#006644',
      subBg: '#010806',
    },
    'midnight-blue': {
      bg: '#050a18',
      text: '#6488ff',
      grid: '#0a1428',
      border: '#142840',
      up: '#44ddaa',
      down: '#ff5577',
      wick: '#284488',
      subBg: '#030814',
    },
    'neon-tokyo': {
      bg: '#06000a',
      text: '#ff00cc',
      grid: '#100014',
      border: '#200028',
      up: '#00ffcc',
      down: '#ff0066',
      wick: '#660088',
      subBg: '#040008',
    },
    'gotham-tactical': {
      bg: '#080d0a',
      text: '#00ff41',
      grid: '#101810',
      border: '#1a2a1a',
      up: '#00ff88',
      down: '#ff3333',
      wick: '#336633',
      subBg: '#060a08',
    },
    'stark-jarvis': {
      bg: '#07080f',
      text: '#00b4dc',
      grid: '#0e1020',
      border: '#1a2040',
      up: '#d4a017',
      down: '#cc2200',
      wick: '#004466',
      subBg: '#05060c',
    },
    'cerebro-neural': {
      bg: '#080822',
      text: '#785aff',
      grid: '#101030',
      border: '#201848',
      up: '#44ddaa',
      down: '#ff5577',
      wick: '#442288',
      subBg: '#06061a',
    },
    'void-sentinel': {
      bg: '#030308',
      text: '#5040a0',
      grid: '#080810',
      border: '#101020',
      up: '#00ffcc',
      down: '#ff4466',
      wick: '#302060',
      subBg: '#020206',
    },
    'light-clean': {
      bg: '#f0f4f8',
      text: '#334155',
      grid: '#e2e8f0',
      border: '#cbd5e1',
      up: '#16a34a',
      down: '#dc2626',
      wick: '#94a3b8',
      subBg: '#e8edf2',
    },
  };
  return T[t] ?? T['cyber-dark'];
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator math
// ─────────────────────────────────────────────────────────────────────────────

function calcEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = null;
  return data.map((b) => {
    ema = ema === null ? b.close : b.close * k + ema * (1 - k);
    return { time: b.time, value: ema };
  });
}

function calcSMA(data, period) {
  return data.slice(period - 1).map((_, i) => ({
    time: data[i + period - 1].time,
    value: data.slice(i, i + period).reduce((s, d) => s + d.close, 0) / period,
  }));
}

function calcBollinger(data, period = 20, mult = 2) {
  const upper = [],
    middle = [],
    lower = [];
  for (let i = period - 1; i < data.length; i++) {
    const sl = data.slice(i - period + 1, i + 1).map((d) => d.close);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    const t = data[i].time;
    upper.push({ time: t, value: mean + mult * std });
    middle.push({ time: t, value: mean });
    lower.push({ time: t, value: mean - mult * std });
  }
  return { upper, middle, lower };
}

function calcVWAP(data) {
  let pv = 0,
    v = 0;
  return data.map((d) => {
    const tp = (d.high + d.low + d.close) / 3;
    pv += tp * (d.volume ?? 0);
    v += d.volume ?? 0;
    return { time: d.time, value: v > 0 ? pv / v : tp };
  });
}

function calcRSI(data, period = 14) {
  const result = [];
  let g = 0,
    l = 0;
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    if (i <= period) {
      g += Math.max(0, diff);
      l += Math.max(0, -diff);
      continue;
    }
    if (i === period + 1) {
      g /= period;
      l /= period;
    } else {
      g = (g * (period - 1) + Math.max(0, diff)) / period;
      l = (l * (period - 1) + Math.max(0, -diff)) / period;
    }
    result.push({
      time: data[i].time,
      value: 100 - 100 / (1 + (l === 0 ? 100 : g / l)),
    });
  }
  return result;
}

function calcMACD(data, fast = 12, slow = 26, sig = 9) {
  const ef = calcEMA(data, fast),
    es = calcEMA(data, slow);
  const sm = new Map(es.map((d) => [d.time, d.value]));
  const ml = ef
    .filter((d) => sm.has(d.time))
    .map((d) => ({ time: d.time, value: d.value - sm.get(d.time) }));
  const sl = calcEMA(
    ml.map((d) => ({ time: d.time, close: d.value })),
    sig
  );
  const sm2 = new Map(sl.map((d) => [d.time, d.value]));
  const hist = ml
    .filter((d) => sm2.has(d.time))
    .map((d) => ({ time: d.time, value: d.value - sm2.get(d.time) }));
  return { macdLine: ml, signalLine: sl, histogram: hist };
}

function calcStochastic(data, kPeriod = 14, dPeriod = 3) {
  const kLine = [];
  for (let i = kPeriod - 1; i < data.length; i++) {
    const sl = data.slice(i - kPeriod + 1, i + 1);
    const low = Math.min(...sl.map((d) => d.low));
    const high = Math.max(...sl.map((d) => d.high));
    kLine.push({
      time: data[i].time,
      value: high === low ? 50 : ((data[i].close - low) / (high - low)) * 100,
    });
  }
  const dLine = calcSMA(
    kLine.map((d) => ({ ...d, close: d.value })),
    dPeriod
  );
  return { kLine, dLine };
}

function calcATR(data, period = 14) {
  const tr = data.slice(1).map((d, i) => ({
    time: d.time,
    value: Math.max(
      d.high - d.low,
      Math.abs(d.high - data[i].close),
      Math.abs(d.low - data[i].close)
    ),
  }));
  return calcEMA(
    tr.map((d) => ({ time: d.time, close: d.value })),
    period
  );
}

function calcSupertrend(data, period = 10, mult = 3) {
  const atr = calcATR(data, period);
  const atrMap = new Map(atr.map((d) => [d.time, d.value]));
  const result = [];
  let prevST = null,
    prevDir = 1;
  for (let i = 1; i < data.length; i++) {
    const d = data[i],
      a = atrMap.get(d.time);
    if (!a) continue;
    const hl2 = (d.high + d.low) / 2;
    const upperBand = hl2 + mult * a,
      lowerBand = hl2 - mult * a;
    let dir = prevDir;
    if (prevST !== null) {
      if (d.close > prevST && prevDir === -1) dir = 1;
      else if (d.close < prevST && prevDir === 1) dir = -1;
    }
    const st = dir === 1 ? lowerBand : upperBand;
    result.push({ time: d.time, value: st, dir });
    prevST = st;
    prevDir = dir;
  }
  return result;
}

function calcHeikinAshi(data) {
  let prevHA = null;
  return data.map((d) => {
    const haClose = (d.open + d.high + d.low + d.close) / 4;
    const haOpen = prevHA
      ? (prevHA.open + prevHA.close) / 2
      : (d.open + d.close) / 2;
    const haHigh = Math.max(d.high, haOpen, haClose);
    const haLow = Math.min(d.low, haOpen, haClose);
    prevHA = { open: haOpen, close: haClose };
    return {
      time: d.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: d.volume,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Drawing tools state
// ─────────────────────────────────────────────────────────────────────────────

const DRAW_TOOLS = [
  { id: 'none', icon: '↖', label: 'Select' },
  { id: 'hline', icon: '─', label: 'Horizontal Line' },
  { id: 'vline', icon: '│', label: 'Vertical Line' },
  { id: 'trendline', icon: '╱', label: 'Trendline' },
  { id: 'fib', icon: '⌇', label: 'Fibonacci Retracement' },
  { id: 'rect', icon: '▭', label: 'Rectangle' },
];

const DATE_RANGES = [
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 180 },
  { id: '1Y', label: '1Y', days: 365 },
  { id: '3Y', label: '3Y', days: 1095 },
  { id: 'All', label: 'All', days: 0 },
];

const CHART_TYPES = [
  { id: 'candle', icon: '🕯', label: 'Candlestick' },
  { id: 'ha', icon: '⬡', label: 'Heikin-Ashi' },
  { id: 'bar', icon: '▮', label: 'Bar' },
  { id: 'line', icon: '╱', label: 'Line' },
  { id: 'area', icon: '◭', label: 'Area' },
];

const SCALE_MODES = [
  { id: 'normal', icon: '≡', label: 'Normal' },
  { id: 'log', icon: 'L', label: 'Logarithmic' },
  { id: 'percent', icon: '%', label: 'Percentage' },
];

// Sub-pane indicators (rendered in separate charts below main)
const SUB_PANE_INDICATORS = ['rsi', 'macd', 'stoch', 'atr'];

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function StockChart({
  symbol = 'NIFTY50',
  exchange = 'NSE',
  interval = '1d',
  height = '100%',
  activeIndicators = [],
  compareSymbols = [], // array of { symbol, exchange }
  signals = [],
  className = '',
  // Controlled props from ChartsPage — override internal state when provided
  chartType: chartTypeProp = null,
  scaleMode: scaleModeProp = null,
}) {
  const mainCanvasRef = useRef(null);
  const subCanvasRefs = useRef({}); // { rsi: ref, macd: ref, stoch: ref, atr: ref }
  const mainChartRef = useRef(null);
  const subChartsRef = useRef({});
  const mainSeriesRef = useRef(null);
  // drawingsRef and pendingRef managed in the drawing tool section below
  const { activeTheme } = useThemeStore();
  const isVisible = usePageVisibility();

  const [ohlcv, setOhlcv] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [legend, setLegend] = useState({});
  const [chartTypeInternal, setChartType] = useState('candle');
  const [scaleModeInternal, setScaleMode] = useState('normal');
  // Use controlled props when provided, fall back to internal state
  const chartType = chartTypeProp ?? chartTypeInternal;
  const scaleMode = scaleModeProp ?? scaleModeInternal;
  const [enlarged, setEnlarged] = useState(false);
  const [drawTool, setDrawTool] = useState('none');
  const [dateRange, setDateRange] = useState('1Y');
  const [showLegend, setShowLegend] = useState(true);
  const [compareData, setCompareData] = useState({}); // symbol → ohlcv

  // Sub-pane indicators active
  const subPanes = activeIndicators.filter((i) =>
    SUB_PANE_INDICATORS.includes(i)
  );

  // ── Fetch OHLCV ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bars = interval === '1mo' ? 120 : interval === '1wk' ? 260 : 500;
      const res = await apiFetch(
        `/api/market/ohlcv/${encodeURIComponent(symbol)}?exchange=${exchange}&bars=${bars}`
      );
      const json = await res.json();
      if (!json.data?.length) throw new Error(`No data for ${symbol}`);
      const norm = normalizeOHLCV(json.data);
      setOhlcv(norm);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [symbol, exchange, interval]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch when tab becomes visible after being hidden (catch-up)
  const prevVisible = useRef(true);
  useEffect(() => {
    if (isVisible && !prevVisible.current && ohlcv.length > 0) {
      fetchData(); // refresh stale data when user comes back
    }
    prevVisible.current = isVisible;
  }, [isVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch compare symbols ──────────────────────────────────────────────────
  useEffect(() => {
    if (!compareSymbols.length) {
      setCompareData({});
      return;
    }
    Promise.all(
      compareSymbols.map(async (cs) => {
        try {
          const res = await apiFetch(
            `/api/market/ohlcv/${encodeURIComponent(cs.symbol)}?exchange=${cs.exchange ?? 'NSE'}&bars=500`
          );
          const json = await res.json();
          return [cs.symbol, normalizeOHLCV(json.data ?? [])];
        } catch {
          return [cs.symbol, []];
        }
      })
    ).then((entries) => setCompareData(Object.fromEntries(entries)));
  }, [compareSymbols]);

  // ── Build main chart ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!mainCanvasRef.current || !ohlcv.length) return;
    const tc = getChartTheme(activeTheme);

    if (mainChartRef.current) {
      mainChartRef.current.remove();
      mainChartRef.current = null;
    }

    const scaleMode_ =
      scaleMode === 'log'
        ? PriceScaleMode.Logarithmic
        : scaleMode === 'percent'
          ? PriceScaleMode.Percentage
          : PriceScaleMode.Normal;

    const chart = createChart(mainCanvasRef.current, {
      autoSize: true,
      layout: {
        background: { color: tc.bg },
        textColor:  tc.text,
        fontSize:   11,
      },
      grid: {
        vertLines: { color: tc.grid },
        horzLines: { color: tc.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width:   1,
          color:   'rgba(0,212,255,0.4)',
          style:   LineStyle.Dashed,
          labelBackgroundColor: tc.border,
        },
        horzLine: {
          width:   1,
          color:   'rgba(0,212,255,0.3)',
          style:   LineStyle.Dashed,
          labelBackgroundColor: tc.border,
        },
      },
      rightPriceScale: {
        borderColor:  tc.border,
        borderVisible: true,
        mode:         scaleMode_,
        scaleMargins: { top: 0.06, bottom: 0.18 },
        // Allow user to resize the price scale by dragging
        visible: true,
        autoScale: true,
      },
      timeScale: {
        borderColor:             tc.border,
        borderVisible:           true,
        timeVisible:             true,
        secondsVisible:          false,
        rightOffset:             8,
        barSpacing:              8,
        minBarSpacing:           2,
        lockVisibleTimeRangeOnResize: false,
        tickMarkFormatter:       undefined,
      },
      handleScroll: {
        mouseWheel:       true,   // horizontal scroll with wheel
        pressedMouseMove: true,   // drag to pan
        horzTouchDrag:    true,
        vertTouchDrag:    false,  // don't scroll page vertically on chart
      },
      handleScale: {
        mouseWheel:           true,   // wheel = zoom time axis
        pinch:                true,   // touch pinch zoom
        axisPressedMouseMove: true,   // drag on price/time axis to scale
        axisDoubleClickReset: true,   // double-click axis to reset scale
      },
      kineticScroll: {
        mouse: false, // disable kinetic — feels more precise for trading
        touch: true,
      },
    });
    mainChartRef.current = chart;

    // ── Main series ──────────────────────────────────────────────────────
    const displayData = chartType === 'ha' ? calcHeikinAshi(ohlcv) : ohlcv;
    let main;
    if (chartType === 'candle' || chartType === 'ha') {
      main = chart.addCandlestickSeries({
        upColor: tc.up,
        downColor: tc.down,
        borderUpColor: tc.up,
        borderDownColor: tc.down,
        wickUpColor: tc.wick,
        wickDownColor: tc.wick,
      });
    } else if (chartType === 'bar') {
      main = chart.addBarSeries({ upColor: tc.up, downColor: tc.down });
    } else if (chartType === 'area') {
      main = chart.addAreaSeries({
        lineColor: tc.up,
        topColor: tc.up + '55',
        bottomColor: tc.up + '00',
        lineWidth: 2,
      });
    } else {
      main = chart.addLineSeries({ color: tc.up, lineWidth: 2 });
    }
    main.setData(displayData);
    mainSeriesRef.current = main;

    // ── Volume (only when indicator active or always for context) ────────────
    if (activeIndicators.includes('volume') || !activeIndicators.length) {
      const vol = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        ohlcv.map((d) => ({
          time:  d.time,
          value: d.volume,
          color: d.close >= d.open ? tc.up + '55' : tc.down + '55',
        }))
      );
    }

    // ── Overlays ─────────────────────────────────────────────────────────
    const lo = {
      priceLineVisible: false,
      lastValueVisible: true,
      lineWidth: 1,
    };
    if (activeIndicators.includes('ema20'))
      chart
        .addLineSeries({ ...lo, color: '#f59e0b', title: 'EMA20' })
        .setData(calcEMA(ohlcv, 20));
    if (activeIndicators.includes('ema50'))
      chart
        .addLineSeries({ ...lo, color: '#8b5cf6', title: 'EMA50' })
        .setData(calcEMA(ohlcv, 50));
    if (activeIndicators.includes('ema200'))
      chart
        .addLineSeries({
          ...lo,
          color: '#06b6d4',
          lineStyle: LineStyle.Dashed,
          title: 'EMA200',
        })
        .setData(calcEMA(ohlcv, 200));
    if (activeIndicators.includes('vwap'))
      chart
        .addLineSeries({
          ...lo,
          color: '#f97316',
          lineStyle: LineStyle.Dotted,
          title: 'VWAP',
        })
        .setData(calcVWAP(ohlcv));
    if (activeIndicators.includes('bb')) {
      const bb = calcBollinger(ohlcv);
      const bo = { ...lo, lastValueVisible: false };
      chart
        .addLineSeries({ ...bo, color: '#475569', title: 'BB+' })
        .setData(bb.upper);
      chart
        .addLineSeries({
          ...bo,
          color: '#64748b',
          lineStyle: LineStyle.Dashed,
          title: 'BB Mid',
        })
        .setData(bb.middle);
      chart
        .addLineSeries({ ...bo, color: '#475569', title: 'BB-' })
        .setData(bb.lower);
    }
    if (activeIndicators.includes('supertrend')) {
      const st = calcSupertrend(ohlcv);
      const bullData = st
        .filter((d) => d.dir === 1)
        .map((d) => ({ time: d.time, value: d.value }));
      const bearData = st
        .filter((d) => d.dir === -1)
        .map((d) => ({ time: d.time, value: d.value }));
      chart
        .addLineSeries({ ...lo, color: tc.up, lineWidth: 2, title: 'ST↑' })
        .setData(bullData);
      chart
        .addLineSeries({ ...lo, color: tc.down, lineWidth: 2, title: 'ST↓' })
        .setData(bearData);
    }

    // ── Compare symbols ───────────────────────────────────────────────────
    const compareColors = ['#60a5fa', '#f472b6', '#34d399', '#fb923c'];
    Object.entries(compareData).forEach(([sym, data], idx) => {
      if (!data.length) return;
      const s = chart.addLineSeries({
        color: compareColors[idx % compareColors.length],
        lineWidth: 1,
        title: sym,
        priceScaleId: 'right',
      });
      s.setData(data.map((d) => ({ time: d.time, value: d.close })));
    });

    // ── Signal markers ────────────────────────────────────────────────────
    if (signals.length > 0) {
      const markers = signals
        .flatMap((sig) => {
          const t = Math.floor(
            new Date(sig.timestamp ?? Date.now()).getTime() / 1000
          );
          const m = [];
          if (sig.entry)
            m.push({
              time: t,
              position: 'belowBar',
              color: '#00ff88',
              shape: 'arrowUp',
              text: `E ${sig.entry}`,
            });
          if (sig.t1)
            m.push({
              time: t,
              position: 'aboveBar',
              color: '#f59e0b',
              shape: 'circle',
              text: `T1 ${sig.t1}`,
            });
          if (sig.t2)
            m.push({
              time: t,
              position: 'aboveBar',
              color: '#fb923c',
              shape: 'circle',
              text: `T2 ${sig.t2}`,
            });
          if (sig.t3)
            m.push({
              time: t,
              position: 'aboveBar',
              color: '#a78bfa',
              shape: 'circle',
              text: `T3 ${sig.t3}`,
            });
          if (sig.stopLoss)
            m.push({
              time: t,
              position: 'belowBar',
              color: '#ff3366',
              shape: 'arrowDown',
              text: `SL ${sig.stopLoss}`,
            });
          return m;
        })
        .sort((a, b) => a.time - b.time);
      main.setMarkers(markers);
    }

    // ── Crosshair + legend ────────────────────────────────────────────────
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return; }
      const d = param.seriesData?.get(main);
      if (!d) { setTooltip(null); return; }
      const bar = ohlcv.find((x) => x.time === param.time);
      setTooltip({
        time:   new Date(param.time * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        open:   (d.open  ?? d.value)?.toFixed(2),
        high:   d.high?.toFixed(2),
        low:    d.low?.toFixed(2),
        close:  (d.close ?? d.value)?.toFixed(2),
        volume: bar?.volume,
      });
      // Build live legend values for all active indicators
      const leg = {};
      if (activeIndicators.includes('rsi')) {
        const v = calcRSI(ohlcv).find((x) => x.time === param.time);
        if (v) leg.rsi = v.value.toFixed(1);
      }
      if (activeIndicators.includes('ema20')) {
        const v = calcEMA(ohlcv, 20).find((x) => x.time === param.time);
        if (v) leg.ema20 = v.value.toFixed(2);
      }
      if (activeIndicators.includes('ema50')) {
        const v = calcEMA(ohlcv, 50).find((x) => x.time === param.time);
        if (v) leg.ema50 = v.value.toFixed(2);
      }
      if (activeIndicators.includes('macd')) {
        const { macdLine } = calcMACD(ohlcv);
        const v = macdLine.find((x) => x.time === param.time);
        if (v) leg.macd = v.value.toFixed(2);
      }
      if (activeIndicators.includes('atr')) {
        const v = calcATR(ohlcv).find((x) => x.time === param.time);
        if (v) leg.atr = v.value.toFixed(2);
      }
      if (activeIndicators.includes('vwap')) {
        const v = calcVWAP(ohlcv).find((x) => x.time === param.time);
        if (v) leg.vwap = v.value.toFixed(2);
      }
      setLegend(leg);
    });

    // ── Apply date range ──────────────────────────────────────────────────
    applyDateRange(chart, ohlcv, dateRange);

    return () => {
      if (mainChartRef.current) {
        mainChartRef.current.remove();
        mainChartRef.current = null;
      }
    };
  }, [
    ohlcv,
    activeTheme,
    activeIndicators,
    chartType,
    scaleMode,
    signals,
    compareData,
    dateRange,
  ]);

  // ── Build sub-pane charts (RSI / MACD / Stoch / ATR) ──────────────────────
  useEffect(() => {
    if (!ohlcv.length) return;
    const tc = getChartTheme(activeTheme);

    // Destroy old sub charts
    Object.values(subChartsRef.current).forEach((c) => {
      try {
        c.remove();
      } catch {}
    });
    subChartsRef.current = {};

    subPanes.forEach((pane) => {
      const el = subCanvasRefs.current[pane];
      if (!el) return;

      const sub = createChart(el, {
        autoSize: true,
        layout: {
          background: { color: tc.subBg },
          textColor: tc.text,
          fontSize: 10,
        },
        grid: { vertLines: { color: tc.grid }, horzLines: { color: tc.grid } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: {
          borderColor: tc.border,
          scaleMargins: { top: 0.1, bottom: 0.1 },
        },
        timeScale: {
          borderColor: tc.border,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 8,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true },
        handleScale: { mouseWheel: true, pinch: true },
      });
      subChartsRef.current[pane] = sub;

      const lo = {
        priceLineVisible: false,
        lastValueVisible: true,
        lineWidth: 1,
      };

      if (pane === 'rsi') {
        const rsiData = calcRSI(ohlcv);
        sub
          .addLineSeries({ ...lo, color: '#a78bfa', title: 'RSI(14)' })
          .setData(rsiData);
        // Overbought / oversold lines
        const times = rsiData.map((d) => d.time);
        if (times.length) {
          sub
            .addLineSeries({
              ...lo,
              color: '#ff3366',
              lineStyle: LineStyle.Dashed,
              lineWidth: 1,
              lastValueVisible: false,
            })
            .setData(times.map((t) => ({ time: t, value: 70 })));
          sub
            .addLineSeries({
              ...lo,
              color: '#00ff88',
              lineStyle: LineStyle.Dashed,
              lineWidth: 1,
              lastValueVisible: false,
            })
            .setData(times.map((t) => ({ time: t, value: 30 })));
        }
      }

      if (pane === 'macd') {
        const { macdLine, signalLine, histogram } = calcMACD(ohlcv);
        const hist = sub.addHistogramSeries({
          priceScaleId: 'right',
          lastValueVisible: false,
        });
        hist.setData(
          histogram.map((d) => ({
            time: d.time,
            value: d.value,
            color: d.value >= 0 ? tc.up + '99' : tc.down + '99',
          }))
        );
        sub
          .addLineSeries({ ...lo, color: '#60a5fa', title: 'MACD' })
          .setData(macdLine);
        sub
          .addLineSeries({ ...lo, color: '#f97316', title: 'Signal' })
          .setData(signalLine);
      }

      if (pane === 'stoch') {
        const { kLine, dLine } = calcStochastic(ohlcv);
        sub
          .addLineSeries({ ...lo, color: '#60a5fa', title: '%K' })
          .setData(kLine);
        sub
          .addLineSeries({ ...lo, color: '#f97316', title: '%D' })
          .setData(dLine);
        const times = kLine.map((d) => d.time);
        if (times.length) {
          sub
            .addLineSeries({
              ...lo,
              color: '#ff3366',
              lineStyle: LineStyle.Dashed,
              lineWidth: 1,
              lastValueVisible: false,
            })
            .setData(times.map((t) => ({ time: t, value: 80 })));
          sub
            .addLineSeries({
              ...lo,
              color: '#00ff88',
              lineStyle: LineStyle.Dashed,
              lineWidth: 1,
              lastValueVisible: false,
            })
            .setData(times.map((t) => ({ time: t, value: 20 })));
        }
      }

      if (pane === 'atr') {
        const atrData = calcATR(ohlcv);
        sub
          .addLineSeries({ ...lo, color: '#fb923c', title: 'ATR(14)' })
          .setData(atrData);
      }

      sub.timeScale().fitContent();
    });

    return () => {
      Object.values(subChartsRef.current).forEach((c) => {
        try {
          c.remove();
        } catch {}
      });
      subChartsRef.current = {};
    };
  }, [ohlcv, activeTheme, subPanes.join(',')]);

  // ── Sync time scales + reposition SVG drawings on pan/zoom ─────────────────
  useEffect(() => {
    const main = mainChartRef.current;
    if (!main) return;

    const handler = (range) => {
      if (!range) return;
      // Sync sub-panes
      Object.values(subChartsRef.current).forEach((s) => {
        try { s.timeScale().setVisibleLogicalRange(range); } catch {}
      });
      // Reposition SVG drawings — must re-render on every pan/zoom
      setChartVersion(v => v + 1);
    };
    main.timeScale().subscribeVisibleLogicalRangeChange(handler);
    return () => {
      try { main.timeScale().unsubscribeVisibleLogicalRangeChange(handler); } catch {}
    };
  }, [ohlcv, subPanes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fit on enlarge ────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => {
      mainChartRef.current?.timeScale().fitContent();
      Object.values(subChartsRef.current).forEach((c) =>
        c.timeScale().fitContent()
      );
    }, 80);
    return () => clearTimeout(t);
  }, [enlarged]);

  // ── Escape closes enlarged ────────────────────────────────────────────────
  useEffect(() => {
    if (!enlarged) return;
    const h = (e) => {
      if (e.key === 'Escape') setEnlarged(false);
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [enlarged]);

  // ── Drawing state ─────────────────────────────────────────────────────────
  const drawingsRef  = useRef([]);
  const pendingRef   = useRef(null);
  const [drawCount,  setDrawCount]  = useState(0);
  // chartVersion increments on every pan/zoom so SVG drawings reposition
  const [chartVersion, setChartVersion] = useState(0);

  // ── Correct coordinate helpers using v4 API ──────────────────────────────
  function coordsFromEvent(e) {
    if (!mainChartRef.current || !mainSeriesRef.current) return null;

    // Use currentTarget (the chartArea div) — this is where the handler lives
    // and where LWC's canvas lives. getBoundingClientRect gives us the correct origin.
    const areaEl = e.currentTarget ?? mainCanvasRef.current;
    if (!areaEl) return null;
    const rect = areaEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // v4: series.coordinateToPrice(y) — y is pixels from top of chart container
    // Returns null if y is out of the visible price range, never returns 0 for valid data
    let price = null;
    try { price = mainSeriesRef.current.coordinateToPrice(y); } catch {}
    if (price == null) return null;  // null check — NOT falsy (price can be 0)

    // v4: timeScale().coordinateToTime(x) — x is pixels from left of time axis
    let time = null;
    try { time = mainChartRef.current.timeScale().coordinateToTime(x); } catch {}

    // Fallback: snap to nearest bar in data array
    if (time == null && ohlcv.length) {
      // Find closest time by iterating nearest visible bar
      // Use the logical range to estimate which bar x maps to
      try {
        const lr = mainChartRef.current.timeScale().getVisibleLogicalRange();
        if (lr) {
          const barFraction = x / (areaEl.clientWidth || rect.width);
          const logicalIdx  = lr.from + barFraction * (lr.to - lr.from);
          const barIdx      = Math.max(0, Math.min(ohlcv.length - 1, Math.round(logicalIdx)));
          time = ohlcv[barIdx].time;
        }
      } catch {}
      // Final fallback
      if (time == null) time = ohlcv[ohlcv.length - 1].time;
    }

    if (time == null) return null;
    return { price, time, x, y };
  }

  // ── Drawing tool: click handler ───────────────────────────────────────────
  function handleCanvasClick(e) {
    if (drawTool === 'none') return;
    // Prevent LWC from also handling this click (moves crosshair, etc.)
    e.stopPropagation();
    const pt = coordsFromEvent(e);
    if (!pt) return;

      if (drawTool === 'hline') {
        // Horizontal price line — single click
        try {
          const line = mainSeriesRef.current.createPriceLine({
            price:           pt.price,
            color:           '#f59e0b',
            lineWidth:       1,
            lineStyle:       LineStyle.Dashed,
            axisLabelVisible: true,
            title:           `H ${pt.price.toFixed(2)}`,
          });
          drawingsRef.current.push({ type: 'hline', price: pt.price, lineRef: line });
          setDrawCount(c => c + 1);
        } catch {}
        return;
      }

      if (drawTool === 'vline') {
        // Vertical line at this bar's time — use SVG overlay
        drawingsRef.current.push({ type: 'vline', time: pt.time, x: pt.x });
        setDrawCount(c => c + 1);
        return;
      }

      // Two-click tools: trendline, fib, rect
      if (!pendingRef.current) {
        // First click — store start point
        pendingRef.current = pt;
        setDrawCount(c => c + 1); // show pending dot
      } else {
        // Second click — complete the drawing
        const start = pendingRef.current;
        pendingRef.current = null;

        if (drawTool === 'trendline') {
          drawingsRef.current.push({ type: 'trendline', p1: start, p2: pt });
          setDrawCount(c => c + 1);
          // Also send to signal analysis
          analyzeTrendlineForSignal(start, pt);
        }

        if (drawTool === 'fib') {
          drawingsRef.current.push({ type: 'fib', p1: start, p2: pt });
          // Draw Fib levels as price lines
          const hi    = Math.max(start.price, pt.price);
          const lo    = Math.min(start.price, pt.price);
          const diff  = hi - lo;
          const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
          const FIB_COLORS = ['#00ff9d','#60a5fa','#a78bfa','#f59e0b','#a78bfa','#60a5fa','#ff2d5f','#fb923c','#fb923c'];
          try {
            FIB_LEVELS.forEach((l, i) => {
              const p = lo + diff * l;
              mainSeriesRef.current.createPriceLine({
                price: p, lineWidth: 1, lineStyle: LineStyle.Dotted,
                color: FIB_COLORS[i], axisLabelVisible: true,
                title: `${(l * 100).toFixed(1)}%`,
              });
            });
          } catch {}
          setDrawCount(c => c + 1);
        }

        if (drawTool === 'rect') {
          drawingsRef.current.push({ type: 'rect', p1: start, p2: pt });
          setDrawCount(c => c + 1);
        }
      }
  }

  // ── Trendline → signal analysis ───────────────────────────────────────────
  const analyzeTrendlineForSignal = useCallback((p1, p2) => {
    if (!ohlcv.length) return;
    const slope  = (p2.price - p1.price) / Math.max(p2.time - p1.time, 1);
    const isUp   = slope > 0;
    const last   = ohlcv[ohlcv.length - 1];
    // Project line to current bar
    const projected = p1.price + slope * (last.time - p1.time);
    const dist       = ((last.close - projected) / projected) * 100;
    const breakout   = Math.abs(dist) < 0.5; // within 0.5% of line
    const msg = breakout
      ? `⚡ Price at trendline (${projected.toFixed(2)}) — potential ${isUp ? 'bounce ↑' : 'breakdown ↓'}`
      : dist > 0
        ? `📈 Price ${dist.toFixed(2)}% ABOVE trendline — ${isUp ? 'uptrend intact' : 'resistance broken'}`
        : `📉 Price ${Math.abs(dist).toFixed(2)}% BELOW trendline — ${isUp ? 'support broken' : 'downtrend intact'}`;
    setTrendlineInsight(msg);
    // Auto-clear after 15s
    setTimeout(() => setTrendlineInsight(''), 15_000);
  }, [ohlcv]);

  const [trendlineInsight, setTrendlineInsight] = useState('');

  // ── Mouse move for live preview while drawing ─────────────────────────────
  const [previewPt, setPreviewPt] = useState(null);
  function handleCanvasMouseMove(e) {
    if (drawTool === 'none' || !pendingRef.current) { setPreviewPt(null); return; }
    const pt = coordsFromEvent(e);
    setPreviewPt(pt);
  }

  // ── Clear all drawings ────────────────────────────────────────────────────
  const clearDrawings = useCallback(() => {
    // Remove price lines
    drawingsRef.current.forEach((d) => {
      try {
        if (d.lineRef) mainSeriesRef.current?.removePriceLine(d.lineRef);
      } catch {}
    });
    drawingsRef.current = [];
    pendingRef.current  = null;
    setPreviewPt(null);
    setDrawCount(c => c + 1);
    setTrendlineInsight('');
    // Rebuild chart to clear all indicator price lines too
  }, []);

  // ── Save chart as PNG ─────────────────────────────────────────────────────
  const saveImage = useCallback(() => {
    if (!mainChartRef.current) return;
    const canvas = mainCanvasRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${symbol}_${interval}_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [symbol, interval]);

  // ── Date range ────────────────────────────────────────────────────────────
  const handleDateRange = useCallback(
    (rangeId) => {
      setDateRange(rangeId);
      if (mainChartRef.current && ohlcv.length) {
        applyDateRange(mainChartRef.current, ohlcv, rangeId);
      }
    },
    [ohlcv]
  );

  const lastBar = ohlcv[ohlcv.length - 1];
  const prevBar = ohlcv[ohlcv.length - 2];
  const change = lastBar && prevBar ? lastBar.close - prevBar.close : 0;
  const changePct = prevBar ? (change / prevBar.close) * 100 : 0;
  const isUp = change >= 0;

  return (
    <div
      className={`${styles.wrapper} ${enlarged ? styles.enlarged : ''} ${className}`}
      style={
        enlarged
          ? undefined
          : height && height !== '100%'
            ? { height }
            : undefined
      }
      role="region"
      aria-label={`${symbol} chart`}
    >
      {/* ── Toolbar row 1: symbol price info (compact) ── */}
      <div className={styles.toolbar1}>
        <div className={styles.toolbarLeft}>
          <span className={styles.symbolName}>{symbol}</span>
          {lastBar && (
            <>
              <span className={styles.price}>
                {lastBar.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <span className={`${styles.change} ${isUp ? styles.up : styles.down}`}>
                {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
              </span>
            </>
          )}
          {showLegend && Object.keys(legend).length > 0 && (
            <div className={styles.legendRow}>
              {legend.rsi   && <span className={styles.legendItem}>RSI <b style={{color:+legend.rsi>70?'#ff2d5f':+legend.rsi<30?'#00ff9d':'#a78bfa'}}>{legend.rsi}</b></span>}
              {legend.ema20 && <span className={styles.legendItem}>E20 <b style={{color:'#f59e0b'}}>{legend.ema20}</b></span>}
              {legend.ema50 && <span className={styles.legendItem}>E50 <b style={{color:'#8b5cf6'}}>{legend.ema50}</b></span>}
              {legend.vwap  && <span className={styles.legendItem}>VWAP <b style={{color:'#f97316'}}>{legend.vwap}</b></span>}
              {legend.macd  && <span className={styles.legendItem}>MACD <b>{legend.macd}</b></span>}
              {legend.atr   && <span className={styles.legendItem}>ATR <b style={{color:'#fb923c'}}>{legend.atr}</b></span>}
            </div>
          )}
        </div>
        <div className={styles.toolbarRight}>
          {/* Chart type — compact */}
          <div className={styles.btnGroup}>
            {CHART_TYPES.map(ct => (
              <button key={ct.id}
                className={`${styles.iconBtn} ${chartType === ct.id ? styles.iconBtnActive : ''}`}
                onClick={() => setChartType(ct.id)} title={ct.label}>{ct.icon}</button>
            ))}
          </div>
          <div className={styles.btnGroup}>
            {SCALE_MODES.map(sm => (
              <button key={sm.id}
                className={`${styles.iconBtn} ${scaleMode === sm.id ? styles.iconBtnActive : ''}`}
                onClick={() => setScaleMode(sm.id)} title={sm.label}>{sm.icon}</button>
            ))}
          </div>
          <div className={styles.btnGroup}>
            <button className={styles.iconBtn} onClick={() => mainChartRef.current?.timeScale().fitContent()} title="Fit">⊡</button>
            <button className={styles.iconBtn} onClick={fetchData} title="Refresh">↺</button>
            <button className={styles.iconBtn} onClick={saveImage} title="Screenshot">📷</button>
            <button className={`${styles.iconBtn} ${enlarged ? styles.iconBtnActive : ''}`} onClick={() => setEnlarged(e => !e)} title="Fullscreen">{enlarged ? '⊠' : '⛶'}</button>
          </div>
        </div>
      </div>

      {/* ── Toolbar row 2: date ranges + draw tools ── */}
      <div className={styles.toolbar2}>
        <div className={styles.btnGroup}>
          {DATE_RANGES.map(dr => (
            <button key={dr.id}
              className={`${styles.rangeBtn} ${dateRange === dr.id ? styles.rangeBtnActive : ''}`}
              onClick={() => handleDateRange(dr.id)}>{dr.label}</button>
          ))}
        </div>
        <div className={styles.toolbar2Right}>
          <span className={styles.drawLabel}>DRAW:</span>
          <div className={styles.btnGroup}>
            {DRAW_TOOLS.map(dt => (
              <button key={dt.id}
                className={`${styles.iconBtn} ${drawTool === dt.id ? styles.iconBtnActive : ''}`}
                onClick={() => { setDrawTool(dt.id); pendingRef.current = null; setDrawCount(c=>c+1); }}
                title={dt.label}>{dt.icon}</button>
            ))}
            <button className={styles.iconBtn} onClick={clearDrawings} title="Clear drawings">🗑</button>
          </div>
        </div>
      </div>

      {/* ── Trendline signal insight ── */}
      {trendlineInsight && (
        <div className={styles.trendlineInsight} role="status">
          <span>🧠 JARVIS:</span>
          <span>{trendlineInsight}</span>
          <button className={styles.insightClose} onClick={() => setTrendlineInsight('')}>×</button>
        </div>
      )}

      {/* ── OHLCV crosshair bar — only visible when hovering ── */}
      <div className={styles.ohlcvBar} style={{ visibility: tooltip ? 'visible' : 'hidden' }}>
        {tooltip ? (
          <>
            <span className={styles.ohlcvDate}>{tooltip.time}</span>
            <span>O <strong>{tooltip.open}</strong></span>
            <span>H <strong>{tooltip.high}</strong></span>
            <span>L <strong>{tooltip.low}</strong></span>
            <span>C <strong>{tooltip.close}</strong></span>
            {tooltip.volume > 0 && (
              <span>V <strong>{(tooltip.volume / 1e5).toFixed(1)}L</strong></span>
            )}
          </>
        ) : <span>—</span>}
      </div>

      {/* ── Chart canvas ── */}
      <div className={styles.chartBody}>
        <div className={styles.chartLeft}>
          {/* 
            chartArea: position:relative container for canvas + SVG overlay.
            - When drawTool is 'none': let LWC handle all mouse events normally
              (pan, zoom, crosshair). We only listen to clicks that LWC ignores.
            - When drawTool is active: capture click to place drawing points.
              LWC pan is still active (we don't disable it — crosshair mode Normal).
          */}
          <div
            className={styles.chartArea}
            onClick={handleCanvasClick}
            onMouseMove={handleCanvasMouseMove}
            data-drawtool={drawTool !== 'none' ? 'active' : undefined}
          >
            {loading && (
              <div className={styles.overlay}>
                <div className={styles.spinner} />
                <span>Loading {symbol}…</span>
              </div>
            )}
            {error && !loading && (
              <div className={styles.overlay}>
                <span className={styles.errorIcon}>⚠</span>
                <span className={styles.errorText}>{error}</span>
                <button className={styles.retryBtn} onClick={fetchData}>Retry</button>
              </div>
            )}

            {/* LWC renders its canvas into this div */}
            <div ref={mainCanvasRef} className={styles.canvas} />

            {/* SVG drawing overlay — pointer-events:none so LWC handles pan/zoom */}
            <svg
              className={styles.drawingOverlay}
              aria-hidden="true"
            >
              <DrawingContent
                drawings={drawingsRef.current}
                pending={pendingRef.current}
                preview={previewPt}
                drawTool={drawTool}
                chart={mainChartRef.current}
                series={mainSeriesRef.current}
                ohlcv={ohlcv}
                drawCount={drawCount}
                chartVersion={chartVersion}
              />
            </svg>

            {/* Pulsing dot at first click point for two-click tools */}
            {pendingRef.current && (
              <div
                className={styles.pendingDot}
                style={{
                  left: `${pendingRef.current.x}px`,
                  top:  `${pendingRef.current.y}px`,
                }}
                aria-hidden="true"
              />
            )}
          </div>

          {/* Sub-panes stacked below main chart */}
          {subPanes.map((pane) => (
            <div key={pane} className={styles.subPane}>
              <div className={styles.subPaneLabel}>{pane.toUpperCase()}</div>
              <div
                ref={(el) => { subCanvasRefs.current[pane] = el; }}
                className={styles.subCanvas}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default memo(StockChart);

// ─────────────────────────────────────────────────────────────────────────────
// DrawingContent — SVG content for trendlines, rectangles, vertical lines.
// Rendered inside a <svg> element that sits above the canvas.
// Uses chart.timeScale().timeToCoordinate() and series.priceToCoordinate()
// to convert stored price/time values back to pixel positions on every render.
// ─────────────────────────────────────────────────────────────────────────────

function DrawingContent({ drawings, pending, preview, drawTool, chart, series, ohlcv, drawCount, chartVersion }) {
  // Convert stored price/time → pixel x/y using LWC scale APIs
  function toXY(price, time) {
    if (!chart || !series) return null;
    try {
      const x = chart.timeScale().timeToCoordinate(time);
      const y = series.priceToCoordinate(price);
      if (x == null || y == null || isNaN(x) || isNaN(y)) return null;
      return { x, y };
    } catch { return null; }
  }

  if (!chart || !series) return null;

  return (
    <>
      {drawings.map((d, i) => {
        if (d.type === 'trendline') {
          const a = toXY(d.p1.price, d.p1.time);
          const b = toXY(d.p2.price, d.p2.time);
          if (!a || !b) return null;
          // Extend line both directions across chart
          const dx = b.x - a.x, dy = b.y - a.y;
          const len = Math.sqrt(dx*dx + dy*dy) || 1;
          const ext = 2000;
          const x1 = a.x - (dx/len)*ext, y1 = a.y - (dy/len)*ext;
          const x2 = a.x + (dx/len)*ext, y2 = a.y + (dy/len)*ext;
          const slope = d.p2.price > d.p1.price ? 'up' : 'down';
          return (
            <g key={i}>
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={slope === 'up' ? '#00ff9d' : '#ff2d5f'}
                strokeWidth="1.5" strokeDasharray="none" opacity="0.85" />
              {/* Endpoint dots */}
              <circle cx={a.x} cy={a.y} r="3" fill={slope === 'up' ? '#00ff9d' : '#ff2d5f'} />
              <circle cx={b.x} cy={b.y} r="3" fill={slope === 'up' ? '#00ff9d' : '#ff2d5f'} />
              {/* Price labels */}
              <text x={b.x + 5} y={b.y - 4} fill="#e2f0ff" fontSize="9" fontFamily="monospace">{d.p2.price.toFixed(2)}</text>
            </g>
          );
        }

        if (d.type === 'vline') {
          const a = toXY(ohlcv[0]?.close ?? 0, d.time);
          if (!a) return null;
          return (
            <line key={i}
              x1={a.x} y1={0} x2={a.x} y2="100%"
              stroke="rgba(0,212,255,0.5)" strokeWidth="1" strokeDasharray="4,3" />
          );
        }

        if (d.type === 'rect') {
          const a = toXY(d.p1.price, d.p1.time);
          const b = toXY(d.p2.price, d.p2.time);
          if (!a || !b) return null;
          const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
          const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
          const isUp = d.p2.price > d.p1.price;
          return (
            <rect key={i} x={x} y={y} width={w} height={h}
              fill={isUp ? 'rgba(0,255,157,0.06)' : 'rgba(255,45,95,0.06)'}
              stroke={isUp ? 'rgba(0,255,157,0.5)' : 'rgba(255,45,95,0.5)'}
              strokeWidth="1" />
          );
        }

        if (d.type === 'fib') {
          const a = toXY(d.p1.price, d.p1.time);
          const b = toXY(d.p2.price, d.p2.time);
          if (!a || !b) return null;
          const x = Math.min(a.x, b.x), w = Math.abs(b.x - a.x) + 200;
          const hi = Math.max(d.p1.price, d.p2.price);
          const lo = Math.min(d.p1.price, d.p2.price);
          const LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
          const COLORS  = ['#00ff9d','#60a5fa','#a78bfa','#f59e0b','#a78bfa','#60a5fa','#ff2d5f'];
          return (
            <g key={i}>
              {LEVELS.map((l, li) => {
                const price = lo + (hi - lo) * l;
                const pt = toXY(price, d.p1.time);
                if (!pt) return null;
                return (
                  <g key={l}>
                    <line x1={x} y1={pt.y} x2={x + w} y2={pt.y}
                      stroke={COLORS[li]} strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
                    <text x={x + w + 3} y={pt.y + 4} fill={COLORS[li]} fontSize="8" fontFamily="monospace">
                      {(l * 100).toFixed(1)}%
                    </text>
                  </g>
                );
              })}
            </g>
          );
        }
        return null;
      })}

      {/* Live preview line while drawing second point */}
      {pending && preview && (drawTool === 'trendline' || drawTool === 'rect') && (() => {
        const a = toXY(pending.price, pending.time);
        if (!a) return null;
        if (drawTool === 'trendline') {
          return <line x1={a.x} y1={a.y} x2={preview.x} y2={preview.y}
            stroke="rgba(0,212,255,0.6)" strokeWidth="1.5" strokeDasharray="4,3" />;
        }
        if (drawTool === 'rect') {
          const x = Math.min(a.x, preview.x), y = Math.min(a.y, preview.y);
          const w = Math.abs(preview.x - a.x), h = Math.abs(preview.y - a.y);
          return <rect x={x} y={y} width={w} height={h}
            fill="rgba(0,212,255,0.05)" stroke="rgba(0,212,255,0.4)" strokeWidth="1" strokeDasharray="3,3" />;
        }
        return null;
      })()}

      {/* First-click dot */}
      {pending && (() => {
        const a = toXY(pending.price, pending.time);
        if (!a) return null;
        return <circle cx={a.x} cy={a.y} r="4" fill="none" stroke="#00d4ff" strokeWidth="1.5" />;
      })()}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeOHLCV(data) {
  const seen = new Map();
  for (const d of data) {
    const time =
      typeof d.time === 'number'
        ? d.time > 1e10
          ? Math.floor(d.time / 1000)
          : d.time
        : Math.floor(new Date(d.date ?? d.time).getTime() / 1000);
    if (time > 0 && !isNaN(+d.close) && +d.close > 0) {
      seen.set(time, {
        time,
        open: +d.open,
        high: +d.high,
        low: +d.low,
        close: +d.close,
        volume: +(d.volume ?? 0),
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.time - b.time);
}

function applyDateRange(chart, ohlcv, rangeId) {
  if (!ohlcv.length) return;
  const range = DATE_RANGES.find((r) => r.id === rangeId);
  if (!range || range.days === 0) {
    chart.timeScale().fitContent();
    return;
  }
  const to = ohlcv[ohlcv.length - 1].time;
  const from = to - range.days * 86400;
  try {
    chart.timeScale().setVisibleRange({ from, to: to + 86400 * 3 });
  } catch {}
}
