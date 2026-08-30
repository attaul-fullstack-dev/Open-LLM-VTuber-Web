/**
 * Mili Hidup Stage 4 — lightweight response-face bus.
 *
 * A tiny module-scoped pub/sub (no framework dependency) that carries one
 * signal from where a response's emotion is known (`use-audio-task`) to where
 * the face is actually applied (`use-live2d-idle-facial`). Both live in the same
 * component tree, so a plain bus is the lightest safe link and avoids threading
 * props or a whole new context through several layers.
 *
 * Message shape: a Stage 3 semantic face id, or `null` to release the
 * contextual response face and let Stage 3 idle resume. The optional
 * `activity` marks the kind of response activity that produced the signal
 * (used as a watchdog heartbeat so the safety hold is refreshed while the
 * same turn is still playing).
 */
export type ResponseFaceActivity = 'task' | 'audio_start' | 'audio_end' | 'text';

/** Why a turn-end release signal was sent (trace + diagnostics only). */
export type ResponseFaceReleaseReason =
  | 'turn_end'
  | 'interruption'
  | 'text_only_complete';

export type ResponseFacePayload = {
  faceId: string | null;
  activity?: ResponseFaceActivity;
  releaseReason?: ResponseFaceReleaseReason;
};

type Listener = (payload: ResponseFacePayload) => void;

const listeners = new Set<Listener>();
let lastPayload: ResponseFacePayload = { faceId: null };

export const responseFaceBus = {
  /** Publish a contextual response face (or null to release). */
  publish(payload: ResponseFacePayload): void {
    lastPayload = { ...payload };
    listeners.forEach((listener) => {
      try {
        listener(lastPayload);
      } catch {
        // a listener must never break the producer
      }
    });
  },

  /** Subscribe to response-face updates; returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Read the most recent payload (e.g. for tests / debug). */
  getLastPayload(): ResponseFacePayload {
    return { ...lastPayload };
  },

  clear(): void {
    listeners.clear();
    lastPayload = { faceId: null };
  },
};

// ---------------------------------------------------------------------------
// Turn-level latch decision (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * What the facial controller should do when a new response-face signal
 * arrives, given the face currently latched for the active response turn.
 *
 * The Stage 4 timing bug: a sentence WITHOUT an emotion marker resolved to
 * `neutral`, which released the contextual face mid-turn (live proof: face
 * held ~64ms at the end of the response). The fix is a turn-level latch:
 *
 * - `null`                → explicit turn-end / cancellation → release.
 * - `neutral` / `''`      → "no new emotion on this sentence". NEVER resets an
 *                           active face; it only refreshes the safety hold so a
 *                           long unmarked response doesn't time out mid-turn.
 * - a real face id        → claim it (replaces any previous face for the turn).
 */
export type ResponseFaceDecision =
  | { kind: 'keep' }
  | { kind: 'release' }
  | { kind: 'refresh'; faceId: string }
  | { kind: 'claim'; faceId: string; switchingFrom: string | null };

export function decideResponseFace(
  currentFaceId: string | null,
  incoming: string | null,
): ResponseFaceDecision {
  if (incoming === null) {
    return currentFaceId !== null ? { kind: 'release' } : { kind: 'keep' };
  }
  const face = incoming.trim();
  if (face === '' || face === 'neutral') {
    return currentFaceId !== null
      ? { kind: 'refresh', faceId: currentFaceId }
      : { kind: 'keep' };
  }
  if (currentFaceId === face) {
    return { kind: 'refresh', faceId: face };
  }
  return { kind: 'claim', faceId: face, switchingFrom: currentFaceId };
}

// ---------------------------------------------------------------------------
// Text-only / muted perceptual hold policy (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * When a response never actually plays audio (muted, or no audio bytes), there
 * is no playback lifecycle to hold the contextual face, so it would otherwise
 * be released the instant the (near-instant) turn completion arrives — live
 * proof: face visible for only ~50–100ms. Give it a bounded perceptual hold
 * instead: a comfortable minimum, scaled mildly with the visible response
 * length, capped so an emotion never lingers after a text response.
 */
export const TEXT_ONLY_HOLD_MIN_MS = 2_500;
export const TEXT_ONLY_HOLD_MAX_MS = 6_000;
export const TEXT_ONLY_HOLD_PER_CHAR_MS = 8;

export function pickTextOnlyHoldMs(visibleChars: number): number {
  const scaled = TEXT_ONLY_HOLD_MIN_MS
    + Math.max(0, visibleChars) * TEXT_ONLY_HOLD_PER_CHAR_MS;
  return Math.min(TEXT_ONLY_HOLD_MAX_MS, scaled);
}