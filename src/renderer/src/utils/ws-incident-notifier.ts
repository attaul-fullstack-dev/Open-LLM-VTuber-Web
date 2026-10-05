/**
 * Incident popup policy — pure, dependency-free, unit-testable.
 *
 * The WebSocket incident recorder (utils/ws-diagnostics.ts) already decides
 * what counts as an incident (isAbnormalClose / recordCloseIncident). This
 * module only answers a narrower question: SHOULD THE USER BE INTERRUPTED
 * with the incident popup, and how often?
 *
 * Rules are deliberately conservative:
 * - normal startup / normal reconnect never pops up
 * - a normal (code 1000, no prior error) close never pops up
 * - one incident episode produces exactly one popup, no matter how many
 *   WS_CLOSE / reconnect / history reload / WS_OPEN events follow it
 * - a genuinely new incident after an episode ends may pop up again
 */

export type IncidentKind =
  | 'abnormal_close'
  | 'send_failure'
  | 'error'
  | 'reconnect_failed';

export interface IncidentFacts {
  /** Websocket connection id, e.g. "ws3". */
  connectionId: string;
  /** Close code when known. */
  closeCode?: number | null;
  /** True when the recorder marked this close abnormal. */
  abnormal?: boolean;
  /** Recorder flags for the connection that just ended. */
  hadError?: boolean;
  hadSendFailure?: boolean;
  /** True when the client scheduled a reconnect. */
  reconnectScheduled?: boolean;
  /** True when the app is deliberately closing (no incident at all). */
  explicitlyDisconnected?: boolean;
}

export interface IncidentDecision {
  /** Show the popup? */
  notify: boolean;
  /** Stable key used for dedup. Empty when not notifying. */
  key: string;
  /** Short machine reason, for the UI and for tests. */
  reason: string;
}

/** Default WebSocket normal-closure code. */
export const NORMAL_CLOSE_CODE = 1000;

/**
 * Build the dedup key for an incident. Facts only, no time and no
 * randomness, so the same incident always maps to the same key.
 */
export function incidentKey(kind: IncidentKind, facts: IncidentFacts): string {
  const conn = facts.connectionId || 'ws?';
  if (kind === 'abnormal_close') {
    return `${kind}:${conn}:code=${facts.closeCode ?? 'null'}:abnormal=${
      facts.abnormal ? 1 : 0
    }:err=${facts.hadError ? 1 : 0}:sf=${facts.hadSendFailure ? 1 : 0}`;
  }
  return `${kind}:${conn}`;
}

/**
 * Decide whether this event deserves an interruptive popup.
 *
 * This never inspects message content: only connection-level facts.
 */
export function decideIncidentNotification(
  kind: IncidentKind,
  facts: IncidentFacts,
): IncidentDecision {
  // A deliberate shutdown is never an incident.
  if (facts.explicitlyDisconnected) {
    return { notify: false, key: '', reason: 'explicit_disconnect' };
  }

  if (kind === 'abnormal_close') {
    // Mirror the recorder's own definition: code 1000 with no prior
    // error/send failure is a normal close, not an incident.
    const abnormalByRecorder =
      facts.abnormal ??
      (facts.closeCode !== NORMAL_CLOSE_CODE ||
        Boolean(facts.hadError) ||
        Boolean(facts.hadSendFailure));
    if (!abnormalByRecorder) {
      return { notify: false, key: '', reason: 'normal_close' };
    }
    return {
      notify: true,
      key: incidentKey(kind, facts),
      reason: facts.hadSendFailure
        ? 'close_after_send_failure'
        : facts.hadError
          ? 'close_after_error'
          : 'abnormal_close',
    };
  }

  if (kind === 'reconnect_failed') {
    // A connect attempt that died before opening is a real failure, but it
    // is reported without a close snapshot, so it is keyed on its own.
    return { notify: true, key: incidentKey(kind, facts), reason: 'reconnect_failed' };
  }

  // send_failure / error: only meaningful while a turn could have been lost.
  return {
    notify: true,
    key: incidentKey(kind, facts),
    reason: kind === 'send_failure' ? 'send_failure' : 'error',
  };
}

/**
 * One-popup-per-episode dedup.
 *
 * `notify` returns true only the first time a given key is seen. Keys are
 * forgotten through `forgetConnection`, which the caller must invoke when a
 * connection opens again — that is what lets a *new* incident pop up later.
 */
export class IncidentPopupGate {
  private readonly seen = new Set<string>();
  private readonly limit: number;

  constructor(limit = 50) {
    this.limit = limit;
  }

  notify(kind: IncidentKind, facts: IncidentFacts): IncidentDecision {
    const decision = decideIncidentNotification(kind, facts);
    if (!decision.notify) return decision;
    if (this.seen.has(decision.key)) {
      return { notify: false, key: decision.key, reason: 'duplicate' };
    }
    this.seen.add(decision.key);
    // Bounded memory: drop the oldest keys first (Set preserves insertion order).
    while (this.seen.size > this.limit) {
      const oldest = this.seen.values().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
    return decision;
  }

  /** Called when a connection opens: allows a later incident to pop up again. */
  forgetConnection(connectionId: string): void {
    for (const key of Array.from(this.seen)) {
      if (key.includes(`:${connectionId}`) || key.includes(`${connectionId}:`)) {
        this.seen.delete(key);
      }
    }
  }

  /** Test/inspection helper. */
  hasSeen(key: string): boolean {
    return this.seen.has(key);
  }

  reset(): void {
    this.seen.clear();
  }
}