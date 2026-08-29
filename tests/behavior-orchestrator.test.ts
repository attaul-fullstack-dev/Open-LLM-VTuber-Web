import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIOR_PRIORITY,
  resolveBehaviorOwnership,
} from '@/utils/behavior-orchestrator';
import type { BehaviorOwnershipInput } from '@/utils/behavior-orchestrator';

const base = (over: Partial<BehaviorOwnershipInput> = {}): BehaviorOwnershipInput => ({
  activityState: 'idle',
  responseFaceActive: false,
  responseInProgress: false,
  isDragging: false,
  isMotionPlaying: false,
  interrupted: false,
  sessionActive: true,
  ...over,
});

test('BEHAVIOR_PRIORITY follows the documented conflict-matrix order', () => {
  assert.ok(BEHAVIOR_PRIORITY.interruption > BEHAVIOR_PRIORITY.response);
  assert.ok(BEHAVIOR_PRIORITY.response > BEHAVIOR_PRIORITY.speaking);
  assert.ok(BEHAVIOR_PRIORITY.speaking > BEHAVIOR_PRIORITY.drag);
  assert.ok(BEHAVIOR_PRIORITY.drag >= BEHAVIOR_PRIORITY.intentional_motion);
  assert.ok(BEHAVIOR_PRIORITY.intentional_motion > BEHAVIOR_PRIORITY.idle_face);
  assert.ok(BEHAVIOR_PRIORITY.idle_face > BEHAVIOR_PRIORITY.idle_movement);
  assert.ok(BEHAVIOR_PRIORITY.idle_movement > BEHAVIOR_PRIORITY.neutral);
});

// 1+2 — active user prevents idle face AND idle movement
test('active user prevents Stage 3 idle facial selection', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'active' }));
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.faceOwner, 'user_active');
});

test('active user prevents Stage 2 idle movement', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'active' }));
  assert.equal(b.canRunIdleMovement(), false);
  assert.equal(b.isUserActive(), true);
});

// 3+4 — idle / long_idle allow both channels
test('idle allows Stage 2 + Stage 3 to run together', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'idle' }));
  assert.equal(b.canRunIdleFace(), true);
  assert.equal(b.canRunIdleMovement(), true);
  assert.equal(b.canRunIdleFace(), b.canRunIdleMovement() && b.owner !== 'neutral');
});

test('long_idle allows long-idle behavior (face + movement)', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'long_idle' }));
  assert.equal(b.canRunIdleFace(), true);
  assert.equal(b.canRunIdleMovement(), true);
  assert.equal(b.faceOwner, 'long_idle');
});

// 5+6 — Stage 4 response face overrides / cannot be overwritten by Stage 3 idle
test('Stage 4 response face overrides Stage 3 idle face', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'idle',
    responseFaceActive: true,
  }));
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.faceOwner, 'response');
  assert.equal(b.isResponseOwned(), true);
});

test('Stage 3 cannot run idle face while response is active', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'long_idle',
    responseFaceActive: true,
  }));
  assert.equal(b.canRunIdleFace(), false);
});

// 7+8 — release at response end lets idle resume only through idle lifecycle
test('Stage 4 releases and idle can resume after response ends', () => {
  const released = resolveBehaviorOwnership(base({ activityState: 'idle' }));
  assert.equal(released.canRunIdleFace(), true);
  assert.equal(released.lifecycle, 'idle');
});

test('no immediate idle face while a response is still in progress', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'long_idle',
    responseInProgress: true,
    responseFaceActive: false,
  }));
  assert.equal(b.canRunIdleFace(), false);
});

// 10+11 — speaking suppresses idle face but not the contextual response face
test('speaking suppresses Stage 3 idle face', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'speaking' }));
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.canRunIdleMovement(), false);
});

test('speaking does NOT suppress the Stage 4 contextual face', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'speaking',
    responseFaceActive: true,
  }));
  assert.equal(b.isResponseOwned(), true);
  assert.equal(b.faceOwner, 'response');
  assert.equal(b.canRunIdleFace(), false); // idle still blocked, but face is response-owned
});

// 12 — lip channel always lip-sync only
test('lip channel is always owned by lip-sync', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'speaking' }));
  assert.equal(b.lipOwner, 'lip_sync');
});

// 13 — Stage 2 safe movement may continue while a response FACE is latched
test('safe Stage 2 movement may continue while response face is active', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'idle',
    responseFaceActive: true,
  }));
  assert.equal(b.canRunIdleMovement(), true);
  assert.equal(b.movementOwner, 'idle_movement');
});

// 14 — drag suppresses Stage 2 movement
test('drag suppresses Stage 2 autonomous movement', () => {
  const b = resolveBehaviorOwnership(base({ isDragging: true }));
  assert.equal(b.canRunIdleMovement(), false);
  assert.equal(b.movementOwner, 'drag');
});

// 15+16 — interruption is authoritative; clears response transient
test('user interruption releases response ownership and blocks autonomous', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'idle',
    responseFaceActive: true,
    interrupted: true,
  }));
  assert.equal(b.lifecycle, 'interruption');
  assert.equal(b.faceOwner, 'interruption');
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.canRunIdleMovement(), false);
  assert.equal(b.isInterrupted(), true);
});

// 17 — session switch clears transient ownership
test('session switch clears transient ownership and suppresses autonomous', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'long_idle',
    responseFaceActive: true,
    sessionActive: false,
  }));
  assert.equal(b.lifecycle, 'session_switch');
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.canRunIdleMovement(), false);
});

// 18+19+20 — proactive flows use the same ownership model
test('proactive response (long_idle + response in progress) yields idle behavior', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'long_idle',
    responseInProgress: true,
  }));
  assert.equal(b.isResponseOwned(), true);
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.canRunIdleMovement(), false);
});

test('proactive response suppresses idle face while speaking', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'speaking',
    responseInProgress: true,
  }));
  assert.equal(b.canRunIdleFace(), false);
  assert.equal(b.canRunIdleMovement(), false);
});

test('proactive completion returns to normal long-idle lifecycle', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'long_idle' }));
  assert.equal(b.canRunIdleFace(), true);
  assert.equal(b.canRunIdleMovement(), true);
  assert.equal(b.lifecycle, 'idle');
  assert.equal(b.faceOwner, 'long_idle');
});

// 21+22 — text-only / audio hold block idle face until release
test('text-only Stage 4 hold blocks idle face until released', () => {
  const held = resolveBehaviorOwnership(base({ activityState: 'idle', responseFaceActive: true }));
  assert.equal(held.canRunIdleFace(), false);
  const released = resolveBehaviorOwnership(base({ activityState: 'idle' }));
  assert.equal(released.canRunIdleFace(), true);
});

test('audio lifecycle blocks idle face until released', () => {
  const audio = resolveBehaviorOwnership(base({ activityState: 'speaking', responseFaceActive: true }));
  assert.equal(audio.canRunIdleFace(), false);
  const done = resolveBehaviorOwnership(base({ activityState: 'idle' }));
  assert.equal(done.canRunIdleFace(), true);
});

// 23 — ownership never gets stuck: once released + idle, autonomous resumes
test('after release ownership is not stuck and idle resumes', () => {
  const b = resolveBehaviorOwnership(base({ activityState: 'idle' }));
  assert.equal(b.canRunIdleFace(), true);
  assert.equal(b.owner, 'idle_face');
});

// conflict matrix A–I consolidated
test('conflict matrix: explicit motion suppresses Stage 2 movement', () => {
  const b = resolveBehaviorOwnership(base({ isMotionPlaying: true }));
  assert.equal(b.canRunIdleMovement(), false);
  assert.equal(b.movementOwner, 'intentional_motion');
});

test('conflict matrix: long_idle + proactive yields to response', () => {
  const b = resolveBehaviorOwnership(base({
    activityState: 'long_idle',
    responseInProgress: true,
  }));
  assert.equal(b.isResponseOwned(), true);
  assert.equal(b.canRunIdleMovement(), false);
});