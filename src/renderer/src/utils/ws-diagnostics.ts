/**
 * Diagnostic-only WebSocket incident recorder (BUG B device-side capture).
 *
 * - Always-on ring buffer (max 200 events, oldest evicted).
 * - Never changes lifecycle, timing, reconnect, state, or persistence.
 * - Never logs message content, drafts, tokens, credentials, cookies,
 *   auth headers, or secrets — only event names, timestamps, readyStates,
 *   close codes/reasons, message TYPES, counts, and connection IDs.
 * - Abnormal closes automatically snapshot into sessionStorage BEFORE any
 *   reconnect can overwrite connection state:
 *     - `mili-ws-last-incident` (latest snapshot)
 *     - `mili-ws-incidents` (up to 5 recent snapshots)
 * - Every function is fail-soft: recorder failure never affects the app.
 */

export interface WsDiagEvent {
  t: string;
  event: string;
  conn: string;
  readyState?: number | null;
  detail?: string;
}

export interface WsIncident {
  incidentAt: string;
  connectionId: string;
  closeCode: number | null;
  closeReason: string;
  readyStateAtClose: number | null;
  abnormal: boolean;
  reconnectScheduled: boolean;
  hadSendFailure: boolean;
  hadError: boolean;
  eventsBeforeClose: WsDiagEvent[];
}

const MAX_ENTRIES = 200;
const MAX_INCIDENTS = 5;
const LAST_INCIDENT_KEY = 'mili-ws-last-incident';
const INCIDENT_HISTORY_KEY = 'mili-ws-incidents';
const TAG = '[MILI-WS-DIAG]';
const DRAFT_LOG_DEBOUNCE_MS = 2000;

let connectionSeq = 0;
const entries: WsDiagEvent[] = [];
let activeConnId = 'ws0';
const connHadError = new Set<string>();
const connHadSendFailure = new Set<string>();
const lastDraftLogAt = new Map<string, number>();

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return 'unknown-time';
  }
}

export function nextConnectionId(): string {
  connectionSeq += 1;
  return `ws${connectionSeq}`;
}

/** Connection currently owned by the singleton service (may lag close). */
export function getActiveConnectionId(): string {
  return activeConnId;
}

export function setActiveConnectionId(connId: string): void {
  activeConnId = connId || activeConnId;
}

export function markConnError(connId: string): void {
  try {
    if (connId) connHadError.add(connId);
  } catch {
    // ignore
  }
}

export function markConnSendFailure(connId: string): void {
  try {
    if (connId) connHadSendFailure.add(connId);
  } catch {
    // ignore
  }
}

export function logWsDiag(
  event: string,
  conn: string,
  detail?: string,
  readyState?: number | null,
): void {
  try {
    const entry: WsDiagEvent = { t: nowIso(), event, conn };
    if (readyState !== undefined) entry.readyState = readyState;
    if (detail) entry.detail = detail;
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    try {
      // eslint-disable-next-line no-console
      console.debug(
        `${TAG} ${entry.t} ${event} ${conn}` +
          (readyState !== undefined && readyState !== null ? ` rs=${readyState}` : '') +
          (detail ? ` ${detail}` : ''),
      );
    } catch {
      // console unavailable: keep buffering silently.
    }
  } catch {
    // Logging must never break the app.
  }
}

/** Debounced draft-save log (key scope only, never draft text). */
export function logDraftSave(scopeKey: string): void {
  try {
    const now = Date.now();
    const last = lastDraftLogAt.get(scopeKey) || 0;
    if (now - last < DRAFT_LOG_DEBOUNCE_MS) return;
    lastDraftLogAt.set(scopeKey, now);
    logWsDiag('DRAFT_SAVE', getActiveConnectionId(), `scope=${scopeKey}`);
  } catch {
    // ignore
  }
}

export function getWsDiagLog(): WsDiagEvent[] {
  try {
    return entries.slice();
  } catch {
    return [];
  }
}

export function clearWsDiagLog(): void {
  try {
    entries.length = 0;
  } catch {
    // ignore
  }
}

function readStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A close is abnormal unless it is an explicit/normal shutdown:
 * code 1000 with no prior error/send-failure on that connection.
 * This records raw facts only — it does not conclude root cause.
 */
export function isAbnormalClose(
  code: number | null,
  connId: string,
): boolean {
  if (code !== 1000) return true;
  if (connHadError.has(connId)) return true;
  if (connHadSendFailure.has(connId)) return true;
  return false;
}

/**
 * Snapshot an incident. MUST be called from the onclose handler BEFORE
 * scheduleReconnect() so the old connection's facts survive resync.
 */
export function recordCloseIncident(options: {
  connId: string;
  code: number | null;
  reason: string;
  readyStateAtClose: number | null;
  reconnectScheduled: boolean;
}): WsIncident | null {
  try {
    const { connId, code, reason, readyStateAtClose, reconnectScheduled } = options;
    const abnormal = isAbnormalClose(code, connId);
    const incident: WsIncident = {
      incidentAt: nowIso(),
      connectionId: connId,
      closeCode: code,
      closeReason: String(reason || ''),
      readyStateAtClose,
      abnormal,
      reconnectScheduled,
      hadSendFailure: connHadSendFailure.has(connId),
      hadError: connHadError.has(connId),
      eventsBeforeClose: entries.slice(-50),
    };
    const payload = JSON.stringify(incident);
    writeStorage(LAST_INCIDENT_KEY, payload);
    let history: WsIncident[] = [];
    try {
      const raw = readStorage(INCIDENT_HISTORY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) history = parsed as WsIncident[];
    } catch {
      history = [];
    }
    history.unshift(incident);
    writeStorage(INCIDENT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_INCIDENTS)));
    logWsDiag(
      abnormal ? 'INCIDENT_SNAPSHOT_ABNORMAL' : 'INCIDENT_SNAPSHOT_NORMAL',
      connId,
      `code=${code} reason=${incident.closeReason}`,
      readyStateAtClose,
    );
    return incident;
  } catch {
    return null;
  }
}

export function getLastWsIncident(): WsIncident | null {
  try {
    const raw = readStorage(LAST_INCIDENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WsIncident;
  } catch {
    return null;
  }
}

export function getWsIncidentHistory(): WsIncident[] {
  try {
    const raw = readStorage(INCIDENT_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WsIncident[]) : [];
  } catch {
    return [];
  }
}

export function clearWsDiagnostics(): void {
  clearWsDiagLog();
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(LAST_INCIDENT_KEY);
      window.sessionStorage.removeItem(INCIDENT_HISTORY_KEY);
    }
  } catch {
    // ignore
  }
  try {
    connHadError.clear();
    connHadSendFailure.clear();
  } catch {
    // ignore
  }
}

/** Safe-to-send diagnostic report (metadata only, no content/secrets). */
export function exportWsDiagnostics(): string {
  try {
    return JSON.stringify(
      {
        exportedAt: nowIso(),
        ringBuffer: entries.slice(),
        lastIncident: getLastWsIncident(),
        incidentHistory: getWsIncidentHistory(),
      },
      null,
      1,
    );
  } catch {
    return '{"error":"export-failed"}';
  }
}

function installGlobalAccessor(): void {
  try {
    const w = window as unknown as Record<string, unknown>;
    if (!w.__MILI_WS_DIAG__) {
      w.__MILI_WS_DIAG__ = {
        get: getWsDiagLog,
        clear: clearWsDiagnostics,
        getLastWsIncident,
        getWsIncidentHistory,
        clearWsDiagnostics,
        exportWsDiagnostics,
        copy: () => {
          const text = exportWsDiagnostics();
          try {
            void navigator.clipboard?.writeText(text);
          } catch {
            // Clipboard may be unavailable; text is still returned.
          }
          return text;
        },
      };
    }
  } catch {
    // Non-browser environment (tests): skip global install.
  }
}

installGlobalAccessor();
