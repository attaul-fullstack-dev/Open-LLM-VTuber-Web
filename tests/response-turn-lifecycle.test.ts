import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTurnState,
  beginTurnTask,
  markAudioPlayed,
  addResponseChars,
  decideTurnFinalize,
  type ResponseTurnState,
} from '../src/renderer/src/utils/response-turn-lifecycle.ts';
import {
  TEXT_ONLY_HOLD_MIN_MS,
  TEXT_ONLY_HOLD_MAX_MS,
} from '../src/renderer/src/utils/response-face-bus.ts';

test('real audio_start permanently marks the turn as audio-played until turn end', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  assert.equal(state.audioPlayed, false);
  // First real audio_start → latched true (transition logged once).
  assert.equal(markAudioPlayed(state), true);
  assert.equal(state.audioPlayed, true);
  // Later sentences (new tasks) must NOT reset it.
  beginTurnTask(state);
  beginTurnTask(state);
  assert.equal(state.audioPlayed, true, 'later sentences must not reset audio-played');
  // Repeated audio_start is not a new transition.
  assert.equal(markAudioPlayed(state), false);
  assert.equal(state.audioPlayed, true);
});

test('audio-enabled response NEVER enters text_only_hold', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  markAudioPlayed(state);
  addResponseChars(state, 140);
  const decision = decideTurnFinalize(state, 'playback_complete');
  assert.deepEqual(decision, { kind: 'release_now', releaseReason: 'turn_end' });
});

test('audio response releases at authoritative turn completion', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  markAudioPlayed(state);
  addResponseChars(state, 60);
  const first = decideTurnFinalize(state, 'playback_complete');
  assert.equal(first.kind, 'release_now');
  // Duplicate completion callbacks cannot create a second logical completion.
  const second = decideTurnFinalize(state, 'playback_complete');
  assert.equal(second.kind, 'already_released');
});

test('truly muted/text-only response DOES enter text_only_hold within 2.5-6s', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  addResponseChars(state, 80); // visible text, but NO audio played
  const decision = decideTurnFinalize(state, 'playback_complete');
  assert.equal(decision.kind, 'text_only_hold');
  if (decision.kind === 'text_only_hold') {
    assert.ok(
      decision.holdMs >= TEXT_ONLY_HOLD_MIN_MS && decision.holdMs <= TEXT_ONLY_HOLD_MAX_MS,
      `holdMs=${decision.holdMs} must stay in [${TEXT_ONLY_HOLD_MIN_MS}, ${TEXT_ONLY_HOLD_MAX_MS}]`,
    );
  }
});

test('new assistant turn resets turnHadAudioPlayback', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  markAudioPlayed(state);
  assert.equal(decideTurnFinalize(state, 'playback_complete').kind, 'release_now');
  // A task of the NEXT turn resets the per-turn state.
  beginTurnTask(state);
  assert.equal(state.audioPlayed, false, 'new turn must not inherit audio evidence');
  assert.equal(state.releaseHandled, false);
  assert.equal(state.responseChars, 0);
});

test('interruption releases immediately (never text_only_hold)', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  const decision = decideTurnFinalize(state, 'interruption');
  assert.deepEqual(decision, { kind: 'release_now', releaseReason: 'interruption' });
});

test('duplicate finalize callbacks yield exactly ONE authoritative decision', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  markAudioPlayed(state);
  const authoritative: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const decision = decideTurnFinalize(state, 'playback_complete');
    if (decision.kind === 'release_now') authoritative.push('release');
    if (decision.kind === 'text_only_hold') authoritative.push('hold');
  }
  assert.deepEqual(authoritative, ['release'], 'exactly one authoritative completion per turn');
  assert.equal(state.releaseHandled, true);
});

test('release remains idempotent as defense-in-depth', () => {
  const state: ResponseTurnState = createTurnState();
  beginTurnTask(state);
  // No audio: first finalize schedules the text-only hold decision…
  assert.equal(decideTurnFinalize(state, 'playback_complete').kind, 'text_only_hold');
  // …and every later call (duplicate backend signal / other hook instance) is a no-op.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(decideTurnFinalize(state, 'playback_complete').kind, 'already_released');
  }
});
