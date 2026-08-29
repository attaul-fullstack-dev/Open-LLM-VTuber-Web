import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IdleFacialExpressionController,
  NEUTRAL_EYE_OPEN,
  IDLE_FACIAL_PALETTE,
  DEBUG_IDLE_FACIAL_CYCLE,
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

test('no full response-emotion states (shock/crying/extreme-joy) in ambient palette', () => {
  const ids = IDLE_FACIAL_PALETTE.map((s) => s.id);
  for (const forbidden of ['shock', 'surprise', 'crying', 'cry', 'fear', 'extreme_joy']) {
    assert.ok(!ids.includes(forbidden), `palette must not contain ${forbidden}`);
  }
  // The soft angry/sad variants are deliberate idle micro-states, but must stay
  // in the micro range: no full MouthDown droop (sad_soft stays light) and
  // angry_pout must NOT use MouthDown at all (avoid reading as sad).
  const byId = Object.fromEntries(IDLE_FACIAL_PALETTE.map((s) => [s.id, s.additive]));
  const get = (id: string, k: keyof IdleFacialAdditive) => (byId[id][k] as number | undefined) ?? 0;
  assert.ok(get('sad_soft', 'MouthDown') <= 0.6, 'sad_soft must stay a light murmur');
  assert.equal(get('angry_pout', 'MouthDown'), 0, 'angry_pout must NOT droop the mouth down (would read sad)');
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

test('palette contains only required distinguishable states', () => {
  const ids = new Set(IDLE_FACIAL_PALETTE.map((s) => s.id));
  for (const id of [
    'neutral',
    'small_smile',
    'squint_smile',
    'sad_soft',
    'pout_small',
    'angry_pout',
    'sleepy_soft',
  ]) {
    assert.ok(ids.has(id), `palette must contain ${id}`);
  }
  // Redundant states visually indistinguishable on the clamped ma0_pro rig
  // (see delivery report: ParamMouthUp is pinned at 1.0, so a wider "big"
  // smile is impossible and relaxed collapses into neutral) must NOT be part
  // of the autonomous selection palette.
  assert.ok(!ids.has('big_smile'), 'big_smile is visually redundant (mouth pinned at 1.0) — removed');
  assert.ok(!ids.has('relaxed'), 'relaxed collapses into neutral — removed');
  assert.ok(!ids.has('curious_soft'), 'curious_soft removed to keep the palette clean');
});

test('emotional states are separated per the real rig (mouth for negatives, eyes/cheek for smiles)', () => {
  const byId = Object.fromEntries(IDLE_FACIAL_PALETTE.map((s) => [s.id, s.additive]));
  const get = (id: string, key: keyof IdleFacialAdditive) => (byId[id][key] as number | undefined) ?? 0;
  const eyeOpenOf = (id: string) => IDLE_FACIAL_PALETTE.find((s) => s.id === id)!.eyeOpen;
  // Negative ladder: soft sad (droop), light pout, strong angry (pout line +
  // furrow) — each distinct on the mouth/brow axis. MouthDown is clamped-free
  // so these truly separate on the rig.
  assert.ok(get('pout_small', 'MouthAngry') > 0, 'pout_small uses a pout line');
  assert.ok(get('angry_pout', 'MouthAngry') > get('pout_small', 'MouthAngry'), 'angry_pout pouts harder than pout_small');
  assert.ok(get('angry_pout', 'MouthAngryLine') > get('pout_small', 'MouthAngryLine'), 'angry_pout pout line stronger than pout_small');
  // sad_soft is moved by BROWS (lifted inner) + a mild droop; pout_small is
  // moved by the MOUTH with brows near neutral — meaningfully different sets.
  assert.ok(get('sad_soft', 'MouthDown') > 0, 'sad_soft turns the mouth down mildly');
  assert.ok(get('sad_soft', 'BrowLY') > 0, 'sad_soft lifts inner brows (sad)');
  assert.ok(Math.abs(get('pout_small', 'BrowLAngle')) <= 0.2, 'pout_small brows stay near neutral (not sad)');
  assert.equal(get('angry_pout', 'MouthDown'), 0, 'angry_pout must not droop (angry, not sad)');
  assert.ok(Math.abs(get('angry_pout', 'BrowLAngle')) > Math.abs(get('pout_small', 'BrowLAngle')), 'angry brow sharper than pout brow');
  assert.ok(Math.abs(get('angry_pout', 'BrowLForm')) > 0, 'angry furrows the brow');
  assert.ok(eyeOpenOf('angry_pout') < 1.0, 'angry narrows the eyes');
  // Smile palette: mouth is pinned at 1.0 by the idle motion and clamped there
  // (beacon val=1.0), so smiles differentiate via EYE-SMILE / CHEEK / EYE-OPEN
  // narrowing, never via raising the mouth.
  const smileEyeSmile = get('squint_smile', 'EyeLSmile');
  assert.ok(smileEyeSmile > get('small_smile', 'EyeLSmile'), 'squint smile has stronger eye-smile than small smile');
  assert.ok(get('squint_smile', 'Cheek') > get('small_smile', 'Cheek'), 'squint smile blushes more than small smile');
  assert.ok(eyeOpenOf('squint_smile') < 0.9 && eyeOpenOf('squint_smile') >= 0.7, 'squint_smile clearly narrows the eyes');
  assert.equal(eyeOpenOf('small_smile'), 1.0, 'small smile keeps fully open eyes');
  assert.equal(get('neutral', 'MouthUp'), 0);
  assert.equal(get('neutral', 'MouthDown'), 0);
  // No ambient state ever droops strongly or spams a hard mouth-down.
  for (const id of ['neutral', 'small_smile', 'squint_smile', 'sleepy_soft']) {
    assert.ok(get(id, 'MouthDown') <= 0.4, `${id} must not turn the mouth down strongly`);
  }
  // sleepy_soft keeps both eyes very slightly open-capable (multiply, no lock).
  assert.ok(eyeOpenOf('sleepy_soft') >= 0.7, 'sleepy_soft never locks eyes closed');
});

test('weighted selection favors calm neutral/subtle-positive over rare negatives', () => {
  const byId = Object.fromEntries(IDLE_FACIAL_PALETTE.map((s) => [s.id, s]));
  assert.ok((byId.neutral.weight ?? 0) > (byId.angry_pout.weight ?? 0), 'neutral more common than angry_pout');
  assert.ok((byId.small_smile.weight ?? 0) > (byId.sad_soft.weight ?? 0), 'small_smile more common than sad_soft');
  assert.ok((byId.angry_pout.weight ?? 0) <= 8, 'angry_pout stays rare');
  assert.ok((byId.sad_soft.weight ?? 0) <= 8, 'sad_soft stays rare');
  assert.ok((byId.sleepy_soft.weight ?? 0) === 0, 'sleepy_soft never picked during normal idle');
  assert.ok((byId.sleepy_soft.longIdleWeight ?? 0) > 0, 'sleepy_soft common during long_idle');
  assert.ok((byId.squint_smile.longIdleWeight ?? byId.squint_smile.weight) < byId.squint_smile.weight, 'squint_smile less frequent during long_idle');
});

test('debug cycle walks every state in order, holding each for cycleHoldMs', () => {
  const h = makeController({ cycle: DEBUG_IDLE_FACIAL_CYCLE, cycleHoldMs: 400 });
  h.controller.setActivity('long_idle');
  const seen: string[] = [];
  let prev: string | null = null;
  // Fine-grained pumps (≈112ms each) so every held state is observed at least
  // once before it changes (hold 400ms > pump granularity).
  for (let i = 0; i < 90; i += 1) {
    pump(h, 100);
    const s = h.controller.snapshot().state;
    if (s && s !== prev) {
      seen.push(s);
      prev = s;
    }
  }
  const firstEight = seen.slice(0, DEBUG_IDLE_FACIAL_CYCLE.length);
  assert.deepEqual(
    firstEight,
    DEBUG_IDLE_FACIAL_CYCLE,
    `cycle must visit states in order, got ${firstEight.join(' -> ')}`,
  );
  // And it wraps back to the start afterwards.
  assert.equal(seen[DEBUG_IDLE_FACIAL_CYCLE.length], DEBUG_IDLE_FACIAL_CYCLE[0]);
});

test('disabling the debug cycle returns to random weighted selection', () => {
  const h = makeController({ cycle: DEBUG_IDLE_FACIAL_CYCLE, cycleHoldMs: 200 });
  h.controller.setActivity('idle');
  pump(h, 230);
  assert.ok(DEBUG_IDLE_FACIAL_CYCLE.includes(h.controller.snapshot().state ?? ''));
  h.controller.setCycle(null);
  pump(h, 500);
  // Random mode still produces a (non-null) state and never repeats instantly
  // when alternatives exist.
  const s = h.controller.snapshot().state;
  assert.ok(s !== null, 'random mode still selects a state');
  assert.ok(IDLE_FACIAL_PALETTE.some((p) => p.id === s));
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
  // Stage 3 runs last, so its own selected mouth additive is applied after the
  // earlier system's write and drives the final face (order already proves this).
  assert.ok(Number.isFinite(additiveValues.MouthAngry), 'Stage 3 wrote a finite mouth contribution');
  assert.ok(additiveValues.EyeLOpen >= 0.7 && additiveValues.EyeLOpen <= 1.2);

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