/**
 * Mili Hidup Stage 4 — per-assistant-turn lifecycle state (pure).
 *
 * Why this exists: `useAudioTask` is mounted by several components (the canvas,
 * the websocket handler, every `useInterrupt` consumer), so release / audio
 * evidence must live in ONE shared place — not per-hook-instance refs. The
 * live bugs this fixes:
 *
 *   1. An audio response was misclassified as text-only because the instance
 *      that performed the release was NOT the instance that played the audio
 *      (per-instance `audioPlayedRef` was false there) → spurious text_only_hold.
 *   2. Every mounted instance ran its own turn-completion effect → a storm of
 *      duplicate `release_signal`s / `frontend-playback-complete` messages.
 *
 * This module is a pure state machine: the hook owns ONE module-level state
 * instance and applies the side effects (audio stop, publish, timer). Tests
 * drive the pure functions directly with their own state objects.
 *
 * Lifecycle contract:
 *   - `beginTurnTask()`   → starts/continues a turn. If the PREVIOUS turn was
 *     already finalized, the per-turn state (audioPlayed, responseChars) resets.
 *   - `markAudioPlayed()` → first real `audio_start` of the turn latches
 *     `audioPlayed = true` for the WHOLE turn (never reset by later sentences).
 *   - `decideTurnFinalize(reason)` → exactly ONE authoritative finalize per
 *     turn; repeats return `already_released`.
 *
 * The audio-vs-text-only distinction uses REAL playback evidence (an
 * `audio_start` event), never `hasAudio` metadata.
 */
import { pickTextOnlyHoldMs } from './response-face-bus';

export type TurnFinalizeReason = 'playback_complete' | 'interruption';

export type TurnFinalizeDecision =
  | { kind: 'already_released' }
  | { kind: 'release_now'; releaseReason: 'turn_end' | 'interruption' }
  | { kind: 'text_only_hold'; holdMs: number };

export interface ResponseTurnState {
  /** True once this turn's authoritative finalize has been performed. */
  releaseHandled: boolean;
  /** Latched true for the whole turn after the first real audio_start. */
  audioPlayed: boolean;
  /** Visible response length so far (scales the text-only perceptual hold). */
  responseChars: number;
}

export function createTurnState(): ResponseTurnState {
  return { releaseHandled: false, audioPlayed: false, responseChars: 0 };
}

/**
 * A response task begins (a new sentence of the current turn, or the first
 * sentence of a NEW turn). If the previous turn was already finalized, reset
 * the per-turn state; a new turn must never inherit the old turn's audio
 * evidence or release flag.
 */
export function beginTurnTask(state: ResponseTurnState): void {
  if (state.releaseHandled) {
    state.audioPlayed = false;
    state.responseChars = 0;
  }
  state.releaseHandled = false;
}

/**
 * Record that real audio actually started playing. Returns true only on the
 * false→true transition so callers can trace it once. Once true it stays true
 * for the entire turn — later sentences must NOT reset it.
 */
export function markAudioPlayed(state: ResponseTurnState): boolean {
  const changed = !state.audioPlayed;
  state.audioPlayed = true;
  return changed;
}

/** Accumulate visible response length for the text-only hold scaling. */
export function addResponseChars(state: ResponseTurnState, chars: number): void {
  state.responseChars += Math.max(0, chars);
}

/**
 * Finalize the current assistant turn. Returns exactly ONE authoritative
 * decision per turn; every later call (duplicate completion callbacks from
 * other mounted hook instances, duplicate backend signals) is
 * `already_released`. Audio turns release immediately; a turn with no real
 * audio playback (muted/text-only) gets a bounded perceptual hold.
 */
export function decideTurnFinalize(
  state: ResponseTurnState,
  reason: TurnFinalizeReason,
): TurnFinalizeDecision {
  if (state.releaseHandled) return { kind: 'already_released' };
  state.releaseHandled = true;
  if (reason === 'playback_complete' && !state.audioPlayed) {
    return { kind: 'text_only_hold', holdMs: pickTextOnlyHoldMs(state.responseChars) };
  }
  return {
    kind: 'release_now',
    releaseReason: reason === 'interruption' ? 'interruption' : 'turn_end',
  };
}
