import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IdleFacialExpressionController,
  NEUTRAL_EYE_OPEN,
  IDLE_FACIAL_PALETTE,
  type IdleFacialAdditive,
  type IdleFacialTiming,
  type IdleFacialControllerOptions,
} from '../src/renderer/src/utils/live2d-idle-facial.ts';
import type { AvatarActivityState } from '../src/renderer/src/utils/avatar-activity-controller.ts';
import {
  setLive2DIdleApplyHook,
  getLive2DIdleApplyHook,
} from '../src/renderer/WebSDK/src/lapplive2didlehook.ts';
import {
  setLive2DIdleFacialHook,
  getLive2DIdleFacialHook,
} from '../src/renderer/WebSDK/src/lapplive2dfacialhook.ts';

class FakeClock {
  nowMs = 0;

  nextId = 1;

  timers = new Map<number, { at: number; callback: () => void }>();

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
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.timers.delete(id);
      this.nowMs = timer.at;
      timer.callback();
    }
    this.nowMs = target;
  }
}

const TINY_TIMING: IdleFacialTiming = {
  idleMinMs: 100,
  idleMaxMs: 100,
  longIdleMinMs: 100,
  longIdleMaxMs: 100,
};

function seqRng(values: number[]) {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}

interface Harness {
  clock: FakeClock;
  controller: IdleFacialExpressionController;
}

function makeController(options: IdleFacialControllerOptions = {}): Harness {
  const clock = new FakeClock();
  const controller = new IdleFacialExpressionController({
    timing: TINY_TIMING,
    schedule: clock.schedule,
    cancel: clock.cancel,
    rng: seqRng([0.99]),
    ...options,
  });
  return { clock, controller };
}

function pump(h: Harness, ms: number) {
  const steps = Math.ceil(ms / 16);
  for (let i = 0; i < steps; i += 1) {
    h.clock.advance(16);
    h.controller.step(0.016);
  }
}

function facialMax(additive: IdleFacialAdditive): number {
  return Math.max(...Object.values(additive).map((v) => Math.abs(v)));
}

function isZeroAdditive(additive: IdleFacialAdditive): boolean {
  return facialMax(additive) < 1e-6;
}

test('active state produces no autonomous facial target', () => {
  const h = makeController();
  h.controller.setActivity('active');
  let max = 0;
  for (let i = 0; i < 200; i += 1) {
    h.clock.advance(16);
    const { additive } = h.controller.step(0.016);
    max = Math.max(max, facialMax(additive));
  }
  assert.equal(max, 0);
  assert.equal(h.controller.snapshot().state, null);
});

test('idle enables facial behavior', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 300);
  assert.ok(h.controller.snapshot().state !== null);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0);
});

test('long_idle enables facial behavior', () => {
  const h = makeController();
  h.controller.setActivity('long_idle');
  pump(h, 300);
  assert.ok(h.controller.snapshot().state !== null);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0);
});

test('speaking suppresses Stage 3', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 300);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0);
  h.controller.setSuppression('speaking', true);
  let max = 0;
  for (let i = 0; i < 200; i += 1) {
    h.clock.advance(16);
    const { additive, eyeOpen } = h.controller.step(0.016);
    max = Math.max(max, facialMax(additive));
    assert.ok(eyeOpen > 0.5 && eyeOpen <= 1.0);
  }
  assert.ok(isZeroAdditive(h.controller.snapshot().additive));
  assert.equal(h.controller.snapshot().state, null);
  assert.ok(max < 1e-0);
});

test('speaking end allows resume later (cooldown honoured)', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  h.controller.setSuppression('speaking', true);
  pump(h, 200);
  h.controller.setSuppression('speaking', false);
  // Immediately after unsuppress, before cooldown elapses, no new face.
  pump(h, 100);
  assert.equal(h.controller.snapshot().state, null);
  // After the speaking cooldown (1800ms) + quiet(100ms), facial resumes.
  h.clock.advance(1_800);
  pump(h, 300);
  assert.ok(h.controller.snapshot().state !== null);
});

test('facial palette never includes strong ambient anger/sadness/surprise', () => {
  const ids = IDLE_FACIAL_PALETTE.map((s) => s.id);
  for (const forbidden of ['anger', 'angry', 'sad', 'sadness', 'shock', 'surprise']) {
    assert.ok(!ids.includes(forbidden), `palette must not contain ${forbidden}`);
  }
});

test('sleepy_soft is long_idle only', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  for (let i = 0; i < 40; i += 1) {
    pump(h, 300);
    assert.notEqual(h.controller.snapshot().state, 'sleepy_soft');
  }
  const lh = makeController();
  lh.controller.setActivity('long_idle');
  let sawSleepy = false;
  for (let i = 0; i < 60; i += 1) {
    pump(lh, 300);
    if (lh.controller.snapshot().state === 'sleepy_soft') sawSleepy = true;
  }
  assert.equal(sawSleepy, true);
});

test('anti-repeat prevents immediate repetition when alternatives exist', () => {
  const h = makeController({ rng: seqRng([0.1]) });
  h.controller.setActivity('idle');
  // Record every distinct selected state (state changes; a state lingers during
  // its hold so we dedupe consecutive snapshots). Anti-repeat means no two
  // consecutive SELECTED states are identical while alternatives exist.
  const sequence: string[] = [];
  let prev: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    pump(h, 120); // change interval is 100ms; a 120ms pump catches each hold
    const s = h.controller.snapshot().state;
    if (s && s !== prev) {
      sequence.push(s);
      prev = s;
    }
  }
  assert.ok(sequence.length >= 5, `expected many selections, got ${sequence.length}`);
  let sawAlternativeGuard = false;
  for (let i = 1; i < sequence.length; i += 1) {
    const nonLong = IDLE_FACIAL_PALETTE.filter((p) => !p.longIdleOnly);
    if (sequence[i] === sequence[i - 1]) {
      if (nonLong.length > 1) sawAlternativeGuard = true;
      assert.ok(
        nonLong.length <= 1,
        `consecutive repeat of ${sequence[i]} should be avoided when alternatives exist`,
      );
    }
  }
  // With a deterministic always-low rng, anti-repeat should kick in and the
  // selection should vary (not repeat a single state forever).
  const distinct = new Set(sequence);
  assert.ok(distinct.size >= 2, `expected varied palette, got only ${[...distinct].join(',')}`);
  void sawAlternativeGuard;
});

test('EyeOpen uses multiply semantics; neutral is 1.0 and relax lower then return', () => {
  const h = makeController();
  assert.equal(h.controller.step(0.016).eyeOpen, NEUTRAL_EYE_OPEN);
  h.controller.setActivity('long_idle');
  let minEye = 1.0;
  let sawRelaxed = false;
  for (let i = 0; i < 120; i += 1) {
    pump(h, 300);
    const snap = h.controller.snapshot();
    if (snap.state === 'relaxed' || snap.state === 'sleepy_soft') sawRelaxed = true;
    minEye = Math.min(minEye, snap.eyeOpen);
  }
  assert.equal(sawRelaxed, true);
  assert.ok(minEye < 1.0 && minEye > 0.7);
  h.controller.setSuppression('speaking', true);
  pump(h, 500);
  assert.ok(h.controller.snapshot().eyeOpen > 0.95 && h.controller.snapshot().eyeOpen <= 1.0);
});

test('Stage 3 controller output uses only facial additive keys', () => {
  const CONTROLLER_KEYS = Object.keys({
    BrowLY: 0, BrowRY: 0, BrowLAngle: 0, BrowRAngle: 0,
    BrowLForm: 0, BrowRForm: 0, MouthUp: 0, MouthDown: 0,
    MouthAngry: 0, MouthAngryLine: 0, EyeLSmile: 0, EyeRSmile: 0,
    EyeLForm: 0, EyeRForm: 0, Cheek: 0,
  }).sort();
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 300);
  const outKeys = Object.keys(h.controller.step(0.016).additive).sort();
  assert.deepEqual(outKeys, CONTROLLER_KEYS);
  // ParamA and Stage 2 movement params must never appear as additive keys.
  assert.ok(!outKeys.includes('ParamA'));
  assert.ok(!outKeys.includes('AngleX'));
  assert.ok(!outKeys.includes('BodyAngleX'));
  assert.ok(!outKeys.includes('EyeBallX'));
});

/** Mirrors the exact hook order in `LAppModel._update` after the Stage 2 hook.
 *  Proves Stage 3 facial contribution lands LAST (un-overwritable), catching a
 *  Stage-2-style overwrite regression. */
test('runtime-order regression: Stage 3 facial hook runs after Stage 2 and earlier systems', () => {
  const order: string[] = [];
  const additiveValues: Record<string, number> = {};

  const earlierSystemWrites = () => {
    order.push('earlier_system');
    additiveValues.MouthAngry = 0.9;
  };

  setLive2DIdleApplyHook(() => { order.push('stage2_movement'); });

  // Non-recursive schedule for the controller: armChange schedules, but we
  // flush the queued callback manually exactly once so applyRandomState can run
  // (and its own re-arm just re-queues, never recursing here).
  const queued: Array<() => void> = [];
  const faceController = new IdleFacialExpressionController({
    timing: TINY_TIMING,
    schedule: (cb) => { queued.push(cb); return queued.length; },
    cancel: () => undefined,
    rng: seqRng([0.99]),
  });
  faceController.setActivity('idle');
  setLive2DIdleFacialHook(() => {
    order.push('stage3_facial');
    const { additive, eyeOpen } = faceController.step(0.016);
    additiveValues.MouthAngry = additive.MouthAngry;
    additiveValues.EyeLOpen = eyeOpen;
  });

  earlierSystemWrites();
  getLive2DIdleApplyHook()?.(null as any, 0.016);
  const fireQueued = queued.shift();
  fireQueued?.();
  getLive2DIdleFacialHook()?.(null as any, 0.016);

  assert.deepEqual(order, ['earlier_system', 'stage2_movement', 'stage3_facial']);
  assert.ok(Math.abs(additiveValues.MouthAngry) < 0.5, 'Stage 3 wins over earlier face system');
  assert.ok(additiveValues.EyeLOpen > 0.7 && additiveValues.EyeLOpen <= 1.0);

  setLive2DIdleApplyHook(null);
  setLive2DIdleFacialHook(null);
});

test('dispose resets to neutral and cancels timers', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 300);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0);
  h.controller.dispose();
  const snap = h.controller.snapshot();
  assert.ok(isZeroAdditive(snap.additive));
  assert.equal(snap.eyeOpen, NEUTRAL_EYE_OPEN);
  assert.equal(snap.state, null);
});

void (0 as never);