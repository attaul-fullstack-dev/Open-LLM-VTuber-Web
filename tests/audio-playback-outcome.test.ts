import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPlaybackCompletionFrame,
  createAudioPlaybackReport,
  describeMediaError,
  describePlaybackFailure,
  playbackIdentityMatches,
  playbackWatchdogMs,
  readPlaybackIdentity,
  recordAudioOutcome,
  resetAudioPlaybackReport,
  samePlaybackIdentity,
  setAudioPlaybackIdentity,
  startLipSyncSafely,
  startTalkMotionSafely,
  summarizeAudioPlayback,
} from '../src/renderer/src/utils/audio-playback-outcome.ts';
import {
  beginTurnTask,
  createTurnState,
  decideCompletionSend,
  decideTurnFinalize,
} from '../src/renderer/src/utils/response-turn-lifecycle.ts';

// ---------------------------------------------------------------------------
// One test per audited path: no audio bytes, mute, broken/missing Live2D,
// rejected play(), media error, timeout, multi-frame aggregation, duplicate
// completion. These are pure-logic regressions; the browser harness covers
// the wiring separately.
// ---------------------------------------------------------------------------

test('audio=null is reported as text_only, never as played', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'text_only');

  assert.equal(summarizeAudioPlayback(report), 'text_only');
  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.type, 'frontend-playback-complete');
  assert.equal(frame.audio_outcome, 'text_only');
  assert.equal(frame.audio_segments, 1);
  assert.equal(frame.audio_played_segments, 0);
  assert.equal(frame.audio_failed_segments, 0);
});

test('muted / voice-output-off is reported as skipped, not played', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'skipped');

  assert.equal(summarizeAudioPlayback(report), 'skipped');
  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.audio_outcome, 'skipped');
  assert.equal(frame.audio_played_segments, 0);
  assert.equal(frame.audio_failed_segments, 0);
  assert.equal(frame.audio_failure_reason, undefined);
});

test('missing Live2D model cannot throw and never blocks playback', () => {
  assert.equal(startTalkMotionSafely(null, 'Talk', 3), false);
  assert.equal(startTalkMotionSafely(undefined, 'Talk', 3), false);
  assert.equal(startTalkMotionSafely({}, 'Talk', 3), false);

  let called = 0;
  const working = {
    startRandomMotion(group: string, priority: number) {
      called += 1;
      assert.equal(group, 'Talk');
      assert.equal(priority, 3);
    },
  };
  assert.equal(startTalkMotionSafely(working, 'Talk', 3), true);
  assert.equal(called, 1);
});

test('a model whose assets failed throws from startRandomMotion — isolated', () => {
  // The exact failure observed in the browser harness: the model object exists
  // but its Cubism model is null, so getMotionCount() throws.
  const broken = {
    startRandomMotion() {
      throw new TypeError("Cannot read properties of null (reading 'getMotionCount')");
    },
  };

  let result: boolean | null = null;
  assert.doesNotThrow(() => {
    result = startTalkMotionSafely(broken, 'Talk', 3);
  });
  assert.equal(result, false, 'the failure is absorbed, not propagated to audio');
});

test('broken lip sync is isolated from audio too', () => {
  const broken = {
    _wavFileHandler: {
      start() {
        throw new Error('no PCM data');
      },
    },
  };
  let result: boolean | null = null;
  assert.doesNotThrow(() => {
    result = startLipSyncSafely(broken, 'data:audio/wav;base64,AAAA');
  });
  assert.equal(result, false);

  let startedWith = '';
  const working = {
    _wavFileHandler: {
      start(url: string) {
        startedWith = url;
      },
    },
  };
  assert.equal(startLipSyncSafely(working, 'data:audio/wav;base64,BBBB'), true);
  assert.equal(startedWith, 'data:audio/wav;base64,BBBB');
});

test('rejected play() is a failure and the completion says so', () => {
  const reason = describePlaybackFailure(
    { name: 'NotAllowedError', message: 'play() failed because the user did not interact' },
    'play-rejected',
  );
  assert.match(reason, /NotAllowedError/);

  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'failed', reason);

  assert.equal(summarizeAudioPlayback(report), 'failed');
  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.audio_outcome, 'failed', 'a rejected play is never a success');
  assert.equal(frame.audio_failed_segments, 1);
  assert.equal(frame.audio_played_segments, 0);
  assert.match(String(frame.audio_failure_reason), /NotAllowedError/);
});

test('media error is described and reported as failed', () => {
  assert.equal(describeMediaError(4), 'media-error-4 (SRC_NOT_SUPPORTED)');
  assert.equal(describeMediaError(3), 'media-error-3 (DECODE)');
  assert.equal(describeMediaError(null), 'media-error-unknown');

  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'failed', describeMediaError(3));
  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.audio_outcome, 'failed');
  assert.equal(frame.audio_failure_reason, 'media-error-3 (DECODE)');
});

test('timeout counts as a failure and keeps the watchdog bounded', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'timed_out', 'timeout');

  assert.equal(summarizeAudioPlayback(report), 'failed');
  assert.equal(buildPlaybackCompletionFrame(report).audio_outcome, 'failed');
  assert.equal(buildPlaybackCompletionFrame(report).audio_failure_reason, 'timeout');

  assert.equal(playbackWatchdogMs(null), 45_000);
  assert.equal(playbackWatchdogMs(Number.NaN), 45_000);
  assert.equal(playbackWatchdogMs(3.36), 15_000, 'short clips still get a safe floor');
  assert.equal(playbackWatchdogMs(100), 120_000, 'long clips are capped');
});

test('multi-frame outcomes aggregate in order and any failure dominates', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'played');
  recordAudioOutcome(report, 'failed', 'media-error-4 (SRC_NOT_SUPPORTED)');
  recordAudioOutcome(report, 'text_only');

  assert.deepEqual(report.order, ['played', 'failed', 'text_only']);
  assert.equal(report.played, 1);
  assert.equal(report.failed, 1);
  assert.equal(summarizeAudioPlayback(report), 'failed');

  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.audio_segments, 3);
  assert.equal(frame.audio_played_segments, 1);
  assert.equal(frame.audio_failed_segments, 1);
  assert.equal(frame.audio_outcome, 'failed');
});

test('several fully played frames report played with the real segment count', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'played');
  recordAudioOutcome(report, 'played');
  recordAudioOutcome(report, 'played');

  const frame = buildPlaybackCompletionFrame(report);
  assert.equal(frame.audio_outcome, 'played');
  assert.equal(frame.audio_segments, 3);
  assert.equal(frame.audio_played_segments, 3);
});

test('an interrupted turn never claims a successful playback', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'played');
  recordAudioOutcome(report, 'interrupted');

  assert.equal(summarizeAudioPlayback(report), 'interrupted');
  assert.equal(
    buildPlaybackCompletionFrame(report, { interrupted: true }).audio_outcome,
    'interrupted',
  );

  const state = createTurnState();
  beginTurnTask(state);
  decideTurnFinalize(state, 'interruption');
  assert.equal(state.interrupted, true);
  assert.equal(
    buildPlaybackCompletionFrame(report, { interrupted: state.interrupted }).audio_outcome,
    'interrupted',
  );
});

test('completion is sent exactly once per turn even with duplicate signals', () => {
  const state = createTurnState();
  beginTurnTask(state);
  assert.equal(decideCompletionSend(state), true);
  assert.equal(decideCompletionSend(state), false);
  assert.equal(decideCompletionSend(state), false);

  // A genuinely new turn (previous one finalized) may send again.
  decideTurnFinalize(state, 'playback_complete');
  assert.equal(beginTurnTask(state), true);
  assert.equal(decideCompletionSend(state), true);
});

test('a new turn resets the outcome report instead of inheriting failure', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'failed', 'media-error-2 (NETWORK)');
  assert.equal(summarizeAudioPlayback(report), 'failed');

  resetAudioPlaybackReport(report);
  assert.equal(summarizeAudioPlayback(report), 'text_only');
  assert.equal(report.order.length, 0);
  assert.equal(report.lastFailureReason, null);
});

test('completion echoes the backend turn identity so the backend can match it', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'failed', 'media-error-4');
  const identity = readPlaybackIdentity({
    request_id: 'turn-new',
    msg_id: 'msg-1',
    attempt: 2,
  });

  assert.deepEqual(identity, {
    requestId: 'turn-new',
    msgId: 'msg-1',
    attempt: 2,
  });
  const frame = buildPlaybackCompletionFrame(report, { identity });
  assert.equal(frame.type, 'frontend-playback-complete');
  assert.equal(frame.request_id, 'turn-new');
  assert.equal(frame.turn, 'turn-new');
  assert.equal(frame.msg_id, 'msg-1');
  assert.equal(frame.id, 'msg-1');
  assert.equal(frame.attempt, 2);
  assert.equal(frame.audio_outcome, 'failed');
});

test('a legacy backend frame produces a legacy untagged completion', () => {
  const report = createAudioPlaybackReport();
  recordAudioOutcome(report, 'played');
  assert.equal(readPlaybackIdentity({ type: 'backend-synth-complete' }), null);

  const frame = buildPlaybackCompletionFrame(report, { identity: null });
  assert.equal(frame.type, 'frontend-playback-complete');
  assert.equal(frame.request_id, undefined);
  assert.equal(frame.msg_id, undefined);
  assert.equal(frame.attempt, undefined);
});

test('a completion from an older turn cannot match the current audio report', () => {
  const current = readPlaybackIdentity({
    request_id: 'turn-new',
    msg_id: 'msg-new',
    attempt: 1,
  });
  const stale = readPlaybackIdentity({
    request_id: 'turn-old',
    msg_id: 'msg-old',
    attempt: 1,
  });
  assert.equal(playbackIdentityMatches(current, stale), false);
  assert.equal(playbackIdentityMatches(current, current), true);
  assert.equal(playbackIdentityMatches(current, null), true, 'legacy is still accepted');
  assert.equal(playbackIdentityMatches(null, stale), true, 'nothing to contradict');

  const retry = readPlaybackIdentity({
    request_id: 'turn-new',
    msg_id: 'msg-new',
    attempt: 2,
  });
  assert.equal(playbackIdentityMatches(current, retry), false, 'an attempt mismatch is stale');
  assert.equal(samePlaybackIdentity(current, retry), false);
});

test('audio report identity follows the current turn and resets per turn', () => {
  const report = createAudioPlaybackReport();
  const identity = readPlaybackIdentity({
    request_id: 'turn-new',
    msg_id: 'msg-1',
    attempt: 1,
  });
  assert.equal(setAudioPlaybackIdentity(report, identity), true);
  assert.deepEqual(report.identity, identity);

  recordAudioOutcome(report, 'failed', 'media-error-3');
  resetAudioPlaybackReport(report);
  assert.equal(report.identity, null);
  assert.equal(summarizeAudioPlayback(report), 'text_only');
  assert.equal(report.lastFailureReason, null);
});

test('source contract: the hook matches completion identity before releasing', () => {
  const hook = readFileSync(
    new URL('../src/renderer/src/hooks/utils/use-audio-task.ts', import.meta.url),
    'utf8',
  );
  assert.match(hook, /playbackIdentityMatches\(\s*playbackReport\.identity/);
  assert.match(hook, /identity: backendSynthCompleteIdentity/);
  assert.match(hook, /noteIncomingAudioFrame/);
});

test('source contract: Live2D is isolated and completion is outcome-driven', () => {
  const hook = readFileSync(
    new URL('../src/renderer/src/hooks/utils/use-audio-task.ts', import.meta.url),
    'utf8',
  );

  assert.match(hook, /startTalkMotionSafely\(model/, 'motion must go through the safe helper');
  assert.match(hook, /startLipSyncSafely\(model/, 'lip sync must go through the safe helper');
  assert.doesNotMatch(
    hook,
    /Live2D manager not found'\);\s*resolve\(\)/,
    'a missing Live2D manager must not resolve the segment before audio is created',
  );
  assert.doesNotMatch(
    hook,
    /Live2D model not found at index 0'\);\s*resolve\(\)/,
    'a missing model must not resolve the segment before audio is created',
  );
  assert.match(hook, /buildPlaybackCompletionFrame\(playbackReport/, 'completion carries the outcome');
  assert.match(hook, /decideCompletionSend\(turnState\)/, 'completion has a once-per-turn guard');
  assert.match(hook, /type: 'frontend-playback-complete'|buildPlaybackCompletionFrame/, 'completion is not removed');
  assert.match(hook, /finish\('failed'/, 'playback failure has an explicit path');
});
