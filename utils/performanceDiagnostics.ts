import { useSettingsStore } from '../store/useSettingsStore';
import type { PerformanceDiagnosticsApi, PerformanceSummaryEntry, PerformanceTraceEvent } from '../types';

type TraceDetail = Record<string, unknown>;

type ActiveFlow = {
  id: string;
  name: string;
  startedAt: number;
  detail?: TraceDetail;
  phases: Array<{
    name: string;
    atMs: number;
    detail?: TraceDetail;
  }>;
};

const MAX_STORED_EVENTS = 2000;
const MAX_STORED_SAMPLES = 400;
const SUMMARY_LOG_INTERVAL = 20;
const ENV_ENABLED =
  typeof process !== 'undefined' &&
  (process.env.IMH_PERF_DIAGNOSTICS === '1' || process.env.IMH_PERF_DIAGNOSTICS === 'true');

const traceEvents: PerformanceTraceEvent[] = [];
const durationSamples = new Map<string, number[]>();
const activeFlows = new Map<string, ActiveFlow>();

let flowCounter = 0;
let longTaskObserverStarted = false;
let longTaskObserver: PerformanceObserver | null = null;
let consoleLoggingEnabled = ENV_ENABLED;

const now = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
};

const roundMs = (value: number): number => Math.round(value * 100) / 100;

const sanitizeDetail = (detail?: TraceDetail): TraceDetail | undefined => {
  if (!detail) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(detail).filter(([, value]) => value !== undefined)
  );
};

export const isPerformanceDiagnosticsEnabled = (): boolean => {
  try {
    return ENV_ENABLED || Boolean(useSettingsStore.getState().performanceDiagnosticsEnabled);
  } catch {
    return ENV_ENABLED;
  }
};

const computePercentile = (samples: number[], percentile: number): number => {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1)
  );
  return roundMs(sorted[index] ?? 0);
};

const getSummaryEntries = (): PerformanceSummaryEntry[] => {
  return [...durationSamples.entries()]
    .filter(([, samples]) => samples.length > 0)
    .map(([name, samples]) => ({
      name,
      count: samples.length,
      lastMs: roundMs(samples[samples.length - 1] ?? 0),
      minMs: roundMs(Math.min(...samples)),
      p50Ms: computePercentile(samples, 50),
      p95Ms: computePercentile(samples, 95),
      maxMs: roundMs(Math.max(...samples)),
    }))
    .sort((left, right) => right.p95Ms - left.p95Ms || right.maxMs - left.maxMs);
};

const pushEvent = (event: PerformanceTraceEvent): void => {
  traceEvents.push(event);
  if (traceEvents.length > MAX_STORED_EVENTS) {
    traceEvents.splice(0, traceEvents.length - MAX_STORED_EVENTS);
  }

  if (event.durationMs > 0) {
    const samples = durationSamples.get(event.name) ?? [];
    samples.push(event.durationMs);
    if (samples.length > MAX_STORED_SAMPLES) {
      samples.splice(0, samples.length - MAX_STORED_SAMPLES);
    }
    durationSamples.set(event.name, samples);

    if (
      consoleLoggingEnabled &&
      (samples.length === 1 ||
        samples.length % SUMMARY_LOG_INTERVAL === 0 ||
        event.durationMs >= 50)
    ) {
      const summary = getSummaryEntries().find((entry) => entry.name === event.name);
      if (summary) {
        console.debug('[perf]', summary.name, summary);
      }
    }
  } else if (consoleLoggingEnabled) {
    console.debug('[perf]', event.name, event.detail ?? {});
  }
};

const recordEvent = (
  name: string,
  durationMs: number,
  detail?: TraceDetail
): PerformanceTraceEvent | null => {
  if (!isPerformanceDiagnosticsEnabled()) {
    return null;
  }

  const endedAt = now();
  const sanitizedDetail = sanitizeDetail(detail);
  const event: PerformanceTraceEvent = {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    startedAt: roundMs(endedAt - durationMs),
    endedAt: roundMs(endedAt),
    durationMs: roundMs(Math.max(0, durationMs)),
    detail: sanitizedDetail,
  };

  pushEvent(event);
  return event;
};

export const recordPerformanceCounter = (name: string, detail?: TraceDetail): void => {
  recordEvent(name, 0, detail);
};

export const recordPerformanceDuration = (
  name: string,
  durationMs: number,
  detail?: TraceDetail
): void => {
  recordEvent(name, durationMs, detail);
};

export const beginPerformanceFlow = (name: string, detail?: TraceDetail): string | null => {
  if (!isPerformanceDiagnosticsEnabled()) {
    return null;
  }

  const id = `${name}-${Date.now()}-${++flowCounter}`;
  activeFlows.set(id, {
    id,
    name,
    startedAt: now(),
    detail: sanitizeDetail(detail),
    phases: [],
  });

  recordPerformanceCounter(`${name}.start`, { flowId: id, ...sanitizeDetail(detail) });
  return id;
};

export const markPerformanceFlow = (
  flowId: string | null | undefined,
  phase: string,
  detail?: TraceDetail
): void => {
  if (!flowId || !isPerformanceDiagnosticsEnabled()) {
    return;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return;
  }

  const atMs = roundMs(now() - flow.startedAt);
  const sanitizedDetail = sanitizeDetail(detail);
  flow.phases.push({ name: phase, atMs, detail: sanitizedDetail });
  recordPerformanceCounter(`${flow.name}.${phase}`, { flowId, atMs, ...sanitizedDetail });
};

export const finishPerformanceFlow = (
  flowId: string | null | undefined,
  detail?: TraceDetail
): void => {
  if (!flowId || !isPerformanceDiagnosticsEnabled()) {
    return;
  }

  const flow = activeFlows.get(flowId);
  if (!flow) {
    return;
  }

  activeFlows.delete(flowId);
  const sanitizedDetail = sanitizeDetail(detail);
  recordPerformanceDuration(`${flow.name}.total`, now() - flow.startedAt, {
    flowId,
    ...flow.detail,
    ...sanitizedDetail,
    phases: flow.phases,
  });
};

export const finishPerformanceFlowAfterNextPaint = (
  flowId: string | null | undefined,
  detail?: TraceDetail,
  frames = 2
): void => {
  if (!flowId || !isPerformanceDiagnosticsEnabled()) {
    return;
  }

  let remainingFrames = Math.max(1, Math.floor(frames));
  const tick = () => {
    remainingFrames -= 1;
    if (remainingFrames <= 0) {
      finishPerformanceFlow(flowId, detail);
      return;
    }

    window.requestAnimationFrame(tick);
  };

  window.requestAnimationFrame(tick);
};

export const createProfilerOnRender =
  (name: string) =>
  (
    _id: string,
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number,
    startTime: number,
    commitTime: number
  ) => {
    recordPerformanceDuration(`${name}.react-commit`, actualDuration, {
      phase,
      baseDuration: roundMs(baseDuration),
      startTime: roundMs(startTime),
      commitTime: roundMs(commitTime),
    });
  };

export const clearPerformanceDiagnostics = (): void => {
  traceEvents.splice(0, traceEvents.length);
  durationSamples.clear();
  activeFlows.clear();
};

export const getPerformanceTraceEvents = (limit = MAX_STORED_EVENTS): PerformanceTraceEvent[] => {
  return traceEvents.slice(Math.max(0, traceEvents.length - limit));
};

export const getPerformanceSummary = (): PerformanceSummaryEntry[] => getSummaryEntries();

export const printPerformanceSummary = (): void => {
  const summary = getSummaryEntries();
  if (summary.length === 0) {
    console.info('[perf] No samples collected yet.');
    return;
  }

  console.table(summary);
};

export const setPerformanceConsoleLogging = (enabled: boolean): void => {
  consoleLoggingEnabled = Boolean(enabled);
};

const attachLongTaskObserver = (): void => {
  if (
    longTaskObserverStarted ||
    typeof window === 'undefined' ||
    typeof PerformanceObserver === 'undefined'
  ) {
    return;
  }

  longTaskObserverStarted = true;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      if (!isPerformanceDiagnosticsEnabled()) {
        return;
      }

      for (const entry of list.getEntries()) {
        recordPerformanceDuration('renderer.longtask', entry.duration, {
          entryType: entry.entryType,
          name: entry.name,
          startTime: roundMs(entry.startTime),
        });
      }
    });

    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskObserver = null;
  }
};

export const initializePerformanceDiagnostics = (): PerformanceDiagnosticsApi => {
  attachLongTaskObserver();

  const api: PerformanceDiagnosticsApi = {
    isEnabled: isPerformanceDiagnosticsEnabled,
    getEvents: getPerformanceTraceEvents,
    getSummary: getPerformanceSummary,
    printSummary: printPerformanceSummary,
    clear: clearPerformanceDiagnostics,
    setConsoleLogging: setPerformanceConsoleLogging,
  };

  if (typeof window !== 'undefined') {
    window.__IMH_PERF__ = api;
  }

  return api;
};

