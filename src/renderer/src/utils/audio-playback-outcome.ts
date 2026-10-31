/**
 * Audio playback outcome + Live2D isolation (pure).
 *
 * Why this exists: `useAudioTask` used to treat "the turn finished" as proof
 * that audio played. A broken Live2D model could throw from
 * `startRandomMotion("Talk")` BEFORE the <audio> element existed, abort the
 * whole segment, and still let `frontend-playback-complete` travel to the
 * backend — a silent response that looked delivered.
 *
 * This module keeps the honest facts:
 *   - per-segment outcomes (played / failed / skipped / text-only / interrupted
 *     / timed out) in delivery order,
 *   - an aggregate that reports `failed` whenever ANY segment failed,
 *   - the completion frame carrying that aggregate explicitly,
 *   - Live2D motion/lip-sync entry points that can never throw into the audio
 *     path (playback must survive any model problem).
 *
 * The completion frame keeps its `type` (the backend waits for that exact
 * message), and only ADDS fields, so an older backend ignores them.
 */

export type AudioPlaybackOutcome =
  | 'played'
  | 'failed'
  | 'skipped'
  | 'text_only'
  | 'interrupted'
  | 'timed_out';

export type AudioPlaybackSummary =
  | 'played'
  | 'failed'
  | 'skipped'
  | 'text_only'
  | 'interrupted';

/**
 * Identity of the backend turn whose audio is in the queue/report.
 *
 * `requestId` names one attempt, `msgId` names the logical message, and
 * `attempt` distinguishes a retried delivery of the same message. All three
 * are optional because a pre-identity backend sends none of them.
 */
export interface PlaybackIdentity {
  requestId: string;
  msgId: string | null;
  attempt: number | null;
}

export interface PlaybackIdentitySource {
  requestId?: unknown;
  msgId?: unknown;
  attempt?: unknown;
  request_id?: unknown;
  turn?: unknown;
  turn_id?: unknown;
  msg_id?: unknown;
  id?: unknown;
}

export interface AudioPlaybackReport {
  /** Every segment outcome in the order the segments actually ran. */
  order: AudioPlaybackOutcome[];
  played: number;
  failed: number;
  skipped: number;
  textOnly: number;
  interrupted: number;
  timedOut: number;
  /** Short, user-safe description of the first real failure (if any). */
  lastFailureReason: string | null;
  /** Turn identity carried by the current audio segments, if the server sent one. */
  identity: PlaybackIdentity | null;
}

const textId = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const wholeNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : null
);

/**
 * Read a server frame's turn identity. The protocol aliases are accepted so
 * the same helper works for audio frames and `backend-synth-complete`.
 * Never invents an id: a frame without one yields null.
 */
export function readPlaybackIdentity(
  source: PlaybackIdentitySource | null | undefined,
): PlaybackIdentity | null {
  if (!source || typeof source !== 'object') return null;
  const requestId = textId(source.request_id)
    || textId(source.turn)
    || textId(source.turn_id)
    || textId(source.requestId);
  const msgId = textId(source.msg_id)
    || textId(source.id)
    || textId(source.msgId);
  const attempt = wholeNumber(source.attempt);
  if (!requestId && !msgId) return null;
  return {
    requestId,
    msgId: msgId || null,
    attempt,
  };
}

/**
 * Did a completion frame name the turn whose audio this client is handling?
 *
 * A legacy completion (no identity) is accepted for compatibility. With
 * identity on both sides, ANY conflicting field makes the frame stale: the
 * request id is authoritative per attempt, msg id per logical message, and
 * the attempt must agree when both sides report one.
 */
export function samePlaybackIdentity(
  left: PlaybackIdentity | null | undefined,
  right: PlaybackIdentity | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.requestId === right.requestId
    && left.msgId === right.msgId
    && left.attempt === right.attempt;
}

export function playbackIdentityMatches(
  current: PlaybackIdentity | null | undefined,
  completion: PlaybackIdentity | null | undefined,
): boolean {
  if (!completion) return true;
  if (!current) return true;
  if (
    current.requestId && completion.requestId
    && current.requestId !== completion.requestId
  ) {
    return false;
  }
  if (current.msgId && completion.msgId && current.msgId !== completion.msgId) {
    return false;
  }
  if (
    current.attempt !== null && completion.attempt !== null
    && current.attempt !== completion.attempt
  ) {
    return false;
  }
  return true;
}

export function createAudioPlaybackReport(): AudioPlaybackReport {
  return {
    order: [],
    played: 0,
    failed: 0,
    skipped: 0,
    textOnly: 0,
    interrupted: 0,
    timedOut: 0,
    lastFailureReason: null,
    identity: null,
  };
}

/** Reset in place: the report object is shared by every mounted hook instance. */
export function resetAudioPlaybackReport(report: AudioPlaybackReport): void {
  report.order.length = 0;
  report.played = 0;
  report.failed = 0;
  report.skipped = 0;
  report.textOnly = 0;
  report.interrupted = 0;
  report.timedOut = 0;
  report.lastFailureReason = null;
  report.identity = null;
}

/**
 * Remember which turn the queued audio belongs to. Returns true only when a
 * usable identity was supplied.
 */
export function setAudioPlaybackIdentity(
  report: AudioPlaybackReport,
  identity: PlaybackIdentity | null | undefined,
): boolean {
  if (!identity) return false;
  report.identity = identity;
  return true;
}

export function recordAudioOutcome(
  report: AudioPlaybackReport,
  outcome: AudioPlaybackOutcome,
  failureReason?: string,
): void {
  report.order.push(outcome);
  switch (outcome) {
    case 'played':
      report.played += 1;
      break;
    case 'failed':
      report.failed += 1;
      break;
    case 'timed_out':
      report.timedOut += 1;
      break;
    case 'skipped':
      report.skipped += 1;
      break;
    case 'text_only':
      report.textOnly += 1;
      break;
    case 'interrupted':
      report.interrupted += 1;
      break;
    default:
      break;
  }
  if (
    (outcome === 'failed' || outcome === 'timed_out')
    && !report.lastFailureReason
  ) {
    report.lastFailureReason = failureReason
      ? String(failureReason).slice(0, 160)
      : outcome === 'timed_out'
        ? 'timeout'
        : 'unknown';
  }
}

/**
 * One truthful answer for the turn.
 *
 * A single failed (or timed-out) segment dominates: the turn must never be
 * reported as `played`. An interruption dominates a partial playback for the
 * same reason. Only a turn with real `playing` evidence and no failure is
 * allowed to claim `played`.
 */
export function summarizeAudioPlayback(
  report: AudioPlaybackReport,
  interrupted = false,
): AudioPlaybackSummary {
  if (report.failed > 0 || report.timedOut > 0) return 'failed';
  if (interrupted || report.interrupted > 0) return 'interrupted';
  if (report.played > 0) return 'played';
  if (report.skipped > 0) return 'skipped';
  return 'text_only';
}

export interface PlaybackCompletionOptions {
  /** The turn was interrupted by the user (or another client). */
  interrupted?: boolean;
  /**
   * Identity from the server's `backend-synth-complete` frame. Only that
   * frame proves which turn the backend is currently waiting for; the audio
   * payload is not used as a fallback because a server that did not stamp
   * synth-complete may still wait for an untagged completion.
   */
  identity?: PlaybackIdentity | null;
}

/**
 * The lifecycle message the backend waits for. It deliberately keeps
 * `type: 'frontend-playback-complete'` (removing it would leave the backend
 * waiting for its timeout) and adds the outcome so "turn finished" is no
 * longer indistinguishable from "audio played".
 *
 * Identity fields are additive: a pre-identity backend sends a bare
 * synth-complete frame, this builder then emits a bare completion, and the
 * legacy handshake is unchanged.
 */
export function buildPlaybackCompletionFrame(
  report: AudioPlaybackReport,
  options: PlaybackCompletionOptions = {},
): Record<string, unknown> {
  const outcome = summarizeAudioPlayback(report, options.interrupted);
  const failedSegments = report.failed + report.timedOut;
  const frame: Record<string, unknown> = {
    type: 'frontend-playback-complete',
    audio_outcome: outcome,
    audio_segments: report.order.length,
    audio_played_segments: report.played,
    audio_failed_segments: failedSegments,
  };
  if (outcome === 'failed' && report.lastFailureReason) {
    frame.audio_failure_reason = report.lastFailureReason;
  }
  const identity = options.identity;
  if (identity) {
    if (identity.requestId) {
      frame.request_id = identity.requestId;
      frame.turn = identity.requestId;
    }
    if (identity.msgId) {
      frame.msg_id = identity.msgId;
      frame.id = identity.msgId;
    }
    if (identity.attempt !== null) frame.attempt = identity.attempt;
  }
  return frame;
}

/** Compact description of a rejected play()/setup error. Never throws. */
export function describePlaybackFailure(
  error: unknown,
  fallback = 'playback-failed',
): string {
  try {
    if (error && typeof error === 'object') {
      const name = 'name' in error ? String((error as { name?: unknown }).name ?? '') : '';
      const message = 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : '';
      const text = [name, message].filter(Boolean).join(': ');
      if (text) return text.slice(0, 160);
      return String(error).slice(0, 160);
    }
    if (typeof error === 'string' && error) return error.slice(0, 160);
    return fallback;
  } catch {
    return fallback;
  }
}

/** Human-readable MediaError code (used for the `error` event path). */
export function describeMediaError(code: number | null | undefined): string {
  switch (code) {
    case 1:
      return 'media-error-1 (ABORTED)';
    case 2:
      return 'media-error-2 (NETWORK)';
    case 3:
      return 'media-error-3 (DECODE)';
    case 4:
      return 'media-error-4 (SRC_NOT_SUPPORTED)';
    default:
      return `media-error-${code ?? 'unknown'}`;
  }
}

/**
 * Watchdog for one segment. Long enough that a legitimate long sentence is
 * never cut off, short enough that a wedged element cannot keep the queue (and
 * therefore `frontend-playback-complete`) pending forever.
 */
export function playbackWatchdogMs(durationSeconds: number | null | undefined): number {
  const MIN_MS = 15_000;
  const MAX_MS = 120_000;
  if (
    typeof durationSeconds === 'number'
    && Number.isFinite(durationSeconds)
    && durationSeconds > 0
  ) {
    return Math.min(MAX_MS, Math.max(MIN_MS, durationSeconds * 1000 * 1.5 + 5_000));
  }
  return 45_000;
}

// ---------------------------------------------------------------------------
// Live2D isolation
//
// These helpers are the ONLY place the audio path touches the model. They
// catch everything and return a boolean, so a broken/missing model can never
// abort audio creation, playback, or the completion signal.
// ---------------------------------------------------------------------------

export interface Live2DPlaybackModel {
  startRandomMotion?: (group: string, priority: number) => void;
  _wavFileHandler?: {
    _initialized?: boolean;
    _lastRms?: number;
    start?: (audioDataUrl: string) => void;
    update?: (deltaTimeSeconds: number) => unknown;
  } | null;
}

/** Start the "Talk" motion, or return false. Never throws. */
export function startTalkMotionSafely(
  model: Live2DPlaybackModel | null | undefined,
  group: string,
  priority: number,
): boolean {
  if (!model || typeof model.startRandomMotion !== 'function') return false;
  try {
    model.startRandomMotion(group, priority);
    return true;
  } catch (error) {
    console.warn('Live2D motion failed; audio playback continues without it', error);
    return false;
  }
}

const LIP_SYNC_SCALE = 2.0;

/** Start WAV-driven lip sync, or return false. Never throws. */
export function startLipSyncSafely(
  model: Live2DPlaybackModel | null | undefined,
  audioDataUrl: string,
): boolean {
  const handler = model?._wavFileHandler;
  if (!handler || typeof handler.start !== 'function') return false;
  try {
    if (!handler._initialized) {
      handler._initialized = true;
      if (typeof handler.update === 'function') {
        const originalUpdate = handler.update.bind(handler);
        handler.update = function patchedUpdate(deltaTimeSeconds: number) {
          const result = originalUpdate(deltaTimeSeconds);
          handler._lastRms = Math.min(2.0, (handler._lastRms ?? 0) * LIP_SYNC_SCALE);
          return result;
        };
      }
    }
    handler.start(audioDataUrl);
    return true;
  } catch (error) {
    console.warn('Live2D lip sync failed; audio playback continues without it', error);
    return false;
  }
}
