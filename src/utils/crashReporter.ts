// Lightweight client-side crash log.
// Captures uncaught errors, unhandled promise rejections and React render errors into a
// bounded localStorage ring buffer so problems on the static (GitHub Pages) build can be
// diagnosed without a logging backend. Inspect from DevTools: `window.__travelsphereCrashes()`.

const STORAGE_KEY = 'ts_crash_log';
const MAX_ENTRIES = 25;

export interface CrashEntry {
  time: string;
  kind: 'error' | 'unhandledrejection' | 'react';
  message: string;
  stack?: string;
  url: string;
  componentStack?: string;
}

// Strip anything that looks like a token / key / email before persisting.
const redact = (text = '') =>
  text
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(/(sk|pk|key|token|secret|password)[-_=:\s"']+[A-Za-z0-9._-]{8,}/gi, '$1=[redacted]')
    .replace(/[^\s@"']+@[^\s@"']+\.[a-z]{2,}/gi, '[email]')
    .slice(0, 4000);

export function getCrashLog(): CrashEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function clearCrashLog() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

export function recordCrash(kind: CrashEntry['kind'], err: unknown, componentStack?: string) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? 'Unknown error'));
  const entry: CrashEntry = {
    time: new Date().toISOString(),
    kind,
    message: redact(e.message),
    stack: redact(e.stack),
    url: location.pathname + location.hash, // no query string: may carry auth params
    componentStack: componentStack ? redact(componentStack) : undefined,
  };
  try {
    const log = [entry, ...getCrashLog()].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch { /* quota / private mode — ignore */ }
  console.error(`[crash:${kind}]`, e, componentStack || '');
}

let installed = false;
export function installCrashReporter() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => recordCrash('error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => recordCrash('unhandledrejection', ev.reason));
  (window as unknown as Record<string, unknown>).__travelsphereCrashes = getCrashLog;
}
