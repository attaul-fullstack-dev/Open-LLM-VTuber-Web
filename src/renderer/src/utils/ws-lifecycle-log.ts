/**
 * Diagnostic-only browser lifecycle + WebSocket liveness logging.
 *
 * Purpose: close the instrumentation blind spot that made the abnormal-close
 * (1006) investigation ambiguous. We could not distinguish "the socket was
 * idle and a middlebox dropped it" from "the tab was frozen and the socket
 * went unresponsive", because the recorder never saw a single browser
 * lifecycle transition.
 *
 * This module ONLY observes. It never changes lifecycle, timing, reconnect,
 * state, persistence, or any WebSocket behaviour. Every function is fail-soft:
 * a failure here must never affect the app.
 *
 * Privacy contract (same rules as the existing recorder):
 * - never log chat content, drafts, prompts, LLM output, tokens or secrets;
 * - never log a message payload — only a sanitised message TYPE, a byte count
 *   and a boolean flag;
 * - record only timestamps, event names, visibility state and readyState.
 *
 * All DOM access is dependency-injected so the logic is testable under the
 * Node test runner with no browser environment.
 */

/** Lifecycle transitions that matter for socket liveness. */
export const LIFECYCLE_EVENTS = [
  "visibilitychange",
  "pagehide",
  "pageshow",
  "freeze",
  "resume",
] as const;

export type LifecycleEventName = (typeof LIFECYCLE_EVENTS)[number];

/** Event name used in the diagnostic ring buffer. */
export const LIFECYCLE_DIAG_EVENT = "LIFECYCLE";

/** Minimal shape we need from a DOM-ish event target. */
export interface LifecycleEventTarget {
  addEventListener(type: string, listener: (event?: unknown) => void): void;
  removeEventListener(type: string, listener: (event?: unknown) => void): void;
}

/** Current-state probes, injected so this stays testable and fail-soft. */
export interface LifecycleProbe {
  /** document.visibilityState, when available. */
  visibilityState?: () => string | null | undefined;
  /** document.hidden, when available. */
  hidden?: () => boolean | null | undefined;
  /** Current WebSocket readyState, when a socket exists. */
  readyState?: () => number | null | undefined;
}

/** Sanitised, privacy-safe view of one lifecycle transition. */
export interface LifecycleDetail {
  name: LifecycleEventName;
  visibilityState: string | null;
  hidden: boolean | null;
  /** PageTransitionEvent.persisted — true when restored from bfcache. */
  persisted: boolean | null;
  readyState: number | null;
}

const SAFE_TOKEN = /[^a-z0-9_-]/gi;

/**
 * Reduce an arbitrary string to a short, safe token.
 * Anything unexpected collapses to "unknown", so a hostile or noisy value can
 * never widen the diagnostic surface.
 */
export function sanitizeToken(value: unknown, max = 24): string {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(SAFE_TOKEN, "")
    .slice(0, max);
  return cleaned.length > 0 ? cleaned : "unknown";
}

function safeString(value: unknown): string | null {
  try {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? sanitizeToken(trimmed) : null;
  } catch {
    return null;
  }
}

function safeBool(value: unknown): boolean | null {
  try {
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

function safeReadyState(value: unknown): number | null {
  try {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * Build the privacy-safe detail record for one lifecycle transition.
 * Pure: no globals, no DOM.
 */
export function readLifecycleDetail(
  name: LifecycleEventName,
  probe: LifecycleProbe = {},
  event?: unknown,
): LifecycleDetail {
  const persisted = (event as { persisted?: unknown } | undefined)?.persisted;
  return {
    name,
    visibilityState: safeString(safeCall(probe.visibilityState)),
    hidden: safeBool(safeCall(probe.hidden)),
    persisted: typeof persisted === "boolean" ? persisted : null,
    readyState: safeReadyState(safeCall(probe.readyState)),
  };
}

/**
 * Render a lifecycle detail as the recorder's `detail=` string.
 * Shape mirrors the existing recorder (`code=`, `reason=`, `scope=`).
 */
export function formatLifecycleDetail(detail: LifecycleDetail): string {
  const parts = [`event=${detail.name}`];
  if (detail.visibilityState !== null)
    parts.push(`visibility=${detail.visibilityState}`);
  if (detail.hidden !== null) parts.push(`hidden=${detail.hidden ? 1 : 0}`);
  if (detail.persisted !== null)
    parts.push(`persisted=${detail.persisted ? 1 : 0}`);
  parts.push(`readyState=${detail.readyState ?? "na"}`);
  return parts.join(" ");
}

function safeCall<T>(fn: (() => T) | undefined): T | undefined {
  try {
    return typeof fn === "function" ? fn() : undefined;
  } catch {
    return undefined;
  }
}

/** Callback shape used to hand a record to the diagnostic recorder. */
export type LifecycleLogger = (
  detail: LifecycleDetail,
  formatted: string,
) => void;

export interface InstallLifecycleOptions {
  /** Document-like target that emits `visibilitychange`. */
  doc?: LifecycleEventTarget | null;
  /** Window-like target that emits the page/freeze/resume transitions. */
  win?: LifecycleEventTarget | null;
  probe?: LifecycleProbe;
  log?: LifecycleLogger;
}

/**
 * Install listeners ONCE per window.
 *
 * Repeated calls are idempotent: the existing installation's uninstaller is
 * returned instead of adding a second set of listeners, so a re-render, a
 * StrictMode double-effect, or a hot reload cannot duplicate entries.
 */
const installed = new WeakMap<object, () => void>();

export function installLifecycleLogging(
  options: InstallLifecycleOptions = {},
): () => void {
  const { doc, win, probe = {}, log } = options;
  const owner = (win ?? doc ?? null) as object | null;

  if (owner) {
    const existing = installed.get(owner);
    if (existing) return existing;
  }

  const emit = (name: LifecycleEventName, event?: unknown): void => {
    try {
      const detail = readLifecycleDetail(name, probe, event);
      if (typeof log === "function") log(detail, formatLifecycleDetail(detail));
    } catch {
      // Diagnostics must never break the app.
    }
  };

  const bindings: Array<[LifecycleEventTarget, LifecycleEventName]> = [];
  if (doc) bindings.push([doc, "visibilitychange"]);
  if (win) {
    bindings.push([win, "pagehide"]);
    bindings.push([win, "pageshow"]);
    bindings.push([win, "freeze"]);
    bindings.push([win, "resume"]);
  }

  const attached: Array<
    [LifecycleEventTarget, LifecycleEventName, (event?: unknown) => void]
  > = [];
  for (const [target, name] of bindings) {
    const listener = (event?: unknown) => emit(name, event);
    try {
      target.addEventListener(name, listener);
      attached.push([target, name, listener]);
    } catch {
      // A target that refuses one event must not block the others.
    }
  }

  let uninstalled = false;
  const uninstall = () => {
    if (uninstalled) return;
    uninstalled = true;
    for (const [target, name, listener] of attached) {
      try {
        target.removeEventListener(name, listener);
      } catch {
        // ignore
      }
    }
    attached.length = 0;
    if (owner) installed.delete(owner);
  };

  if (owner) installed.set(owner, uninstall);
  return uninstall;
}

/** Test/diagnostic helper: is logging currently installed for this window? */
export function isLifecycleLoggingInstalled(owner: object): boolean {
  try {
    return installed.has(owner);
  } catch {
    return false;
  }
}

/**
 * Privacy-safe description of an INBOUND WebSocket frame.
 *
 * Records the message TYPE only, plus a size class. Never the payload, never
 * any field of the payload. An unparseable or binary frame yields
 * `type=unknown` with `bytes` still reported, which is exactly what we need to
 * tell "browser received nothing" apart from "browser received something we
 * could not classify".
 */
export function describeInboundFrame(data: unknown): { detail: string } {
  const bytes = frameByteLength(data);
  let type = "unknown";
  try {
    if (typeof data === "string") {
      const parsed = JSON.parse(data) as unknown;
      const rawType = (parsed as { type?: unknown } | null | undefined)?.type;
      type = sanitizeToken(rawType, 32);
    }
  } catch {
    type = "unknown";
  }
  return { detail: `type=${type} bytes=${bytes}` };
}

function frameByteLength(data: unknown): number {
  try {
    if (typeof data === "string") return data.length;
    const size = (data as { size?: unknown } | null | undefined)?.size;
    if (typeof size === "number" && Number.isFinite(size))
      return Math.max(0, Math.trunc(size));
    if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer)
      return data.byteLength;
  } catch {
    // fall through
  }
  return -1;
}
