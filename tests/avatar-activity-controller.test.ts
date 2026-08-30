import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AvatarActivityController,
} from '../src/renderer/src/utils/avatar-activity-controller.ts';
import type { AvatarActivityState } from '../src/renderer/src/utils/avatar-activity-controller.ts';

class FakeClock {
  nowMs = 0;

  nextId = 1;

  timers = new Map<number, { at: number; callback: () => void }>();

  now = () => this.nowMs;

  schedule = (callback: () => void, delayMs: number) => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { at: this.nowMs + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  cancel = (handle: ReturnType<typeof setTimeout>) => {
    this.timers.delete(handle as unknown as number);
  };

  advance(ms: number) {
    const target = this.nowMs + ms;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.nowMs = timer.at;
      timer.callback();
    }
    this.nowMs = target;
  }
}

const createHarness = () => {
  const clock = new FakeClock();
  const transitions: AvatarActivityState[] = [];
  const controller = new AvatarActivityController({
    thresholds: { idleAfterMs: 30_000, longIdleAfterMs: 120_000 },
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  controller.subscribe((state) => transitions.push(state));
  controller.start();
  return { clock, controller, transitions };
};

test('initial state is active, then transitions to idle and long_idle', () => {
  const { clock, controller } = createHarness();
  assert.equal(controller.getState(), 'active');
  clock.advance(29_999);
  assert.equal(controller.getState(), 'active');
  clock.advance(1);
  assert.equal(controller.getState(), 'idle');
  clock.advance(90_000);
  assert.equal(controller.getState(), 'long_idle');
});

test('user activity resets idle and long_idle to active and rearms timing', () => {
  const { clock, controller } = createHarness();
  clock.advance(30_000);
  controller.markUserActivity();
  assert.equal(controller.getState(), 'active');
  clock.advance(120_000);
  assert.equal(controller.getState(), 'long_idle');
  controller.markUserActivity();
  assert.equal(controller.getState(), 'active');
  assert.equal(controller.getLastUserActivityAt(), 150_000);
});

test('speaking overrides active and returns to active before idle threshold', () => {
  const { clock, controller } = createHarness();
  clock.advance(5_000);
  const token = controller.beginSpeaking();
  assert.equal(controller.getState(), 'speaking');
  clock.advance(10_000);
  controller.endSpeaking(token);
  assert.equal(controller.getState(), 'active');
});

test('speaking overrides idle and returns to elapsed idle state', () => {
  const { clock, controller } = createHarness();
  clock.advance(40_000);
  assert.equal(controller.getState(), 'idle');
  const token = controller.beginSpeaking();
  assert.equal(controller.getState(), 'speaking');
  clock.advance(10_000);
  controller.endSpeaking(token);
  assert.equal(controller.getState(), 'idle');
});

test('speaking returns to long_idle when total user inactivity crossed threshold', () => {
  const { clock, controller } = createHarness();
  clock.advance(110_000);
  const token = controller.beginSpeaking();
  clock.advance(15_000);
  assert.equal(controller.getState(), 'speaking');
  controller.endSpeaking(token);
  assert.equal(controller.getState(), 'long_idle');
});

test('assistant/proactive activity has no reset path while user activity does', () => {
  const { clock, controller } = createHarness();
  const originalActivity = controller.getLastUserActivityAt();
  clock.advance(40_000);
  const proactivePlayback = controller.beginSpeaking();
  clock.advance(1_000);
  controller.endSpeaking(proactivePlayback);
  assert.equal(controller.getLastUserActivityAt(), originalActivity);
  assert.equal(controller.getState(), 'idle');
  controller.markUserActivity();
  assert.equal(controller.getLastUserActivityAt(), 41_000);
  assert.equal(controller.getState(), 'active');
});

test('overlapping audio tokens keep speaking until every playback finishes', () => {
  const { controller } = createHarness();
  const first = controller.beginSpeaking();
  const second = controller.beginSpeaking();
  controller.endSpeaking(first);
  assert.equal(controller.getState(), 'speaking');
  controller.endSpeaking(second);
  assert.equal(controller.getState(), 'active');
});

test('interruption ends all speaking and derives the correct state', () => {
  const { clock, controller } = createHarness();
  clock.advance(40_000);
  controller.beginSpeaking();
  controller.endAllSpeaking();
  assert.equal(controller.getState(), 'idle');
  controller.markUserActivity();
  assert.equal(controller.getState(), 'active');
});

test('stop cleans timers and prevents post-unmount transitions', () => {
  const { clock, controller, transitions } = createHarness();
  controller.stop();
  assert.equal(clock.timers.size, 0);
  clock.advance(200_000);
  assert.deepEqual(transitions, []);
});

test('starting twice (as reconnect/remount protection) does not duplicate timers', () => {
  const { clock, controller, transitions } = createHarness();
  controller.start();
  assert.equal(clock.timers.size, 1);
  clock.advance(30_000);
  assert.deepEqual(transitions, ['idle']);
});
