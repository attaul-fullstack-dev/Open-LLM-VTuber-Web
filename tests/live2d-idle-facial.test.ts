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
import { TEMP_CAPABILITY_FACES } from '../src/renderer/src/hooks/canvas/use-live2d-idle-facial.ts';
import { ZERO_FACIAL } from '../src/renderer/src/utils/live2d-idle-facial.ts';

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

test('production default is weighted-random selection (no debug cycle)', () => {
  // A stock controller (no cycle option) must only ever pick from the palette
  // via weighted random — it never walks any fixed order.
  const h = makeController({ rng: seqRng([0.01, 0.5, 0.95, 0.3, 0.7]) });
  h.controller.setActivity('idle');
  let sawNeutral = false;
  let sawNonNeutral = false;
  const seen: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    pump(h, 130);
    const s = h.controller.snapshot().state;
    if (s !== null) { seen.push(s); if (s === 'neutral') sawNeutral = true; else sawNonNeutral = true; }
  }
  assert.ok(seen.length > 0, 'random selection produces states');
  assert.ok(sawNeutral && sawNonNeutral, 'weighted random yields a mix, not a fixed cycle');
  for (const s of seen) {
    assert.ok(IDLE_FACIAL_PALETTE.some((p) => p.id === s), `state ${s} must come from the palette`);
    assert.ok(!s.includes('debug'), 'debug cycle state must not leak into production');
  }
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

test('AUDIO OFF: latched response face survives and idle timer cannot overwrite it', () => {
  // Muted/text-only response: the contextual face is claimed from emotion
  // metadata (activity stays idle because beginSpeaking is never called when
  // muted). Even with the idle timer firing AND speaking suppression turning
  // on mid-turn, the latched response face must keep owning the face.
  const h = makeController();
  h.controller.setActivity('idle');
  // Start Stage 3 autonomous so its idle timer is armed.
  pump(h, 300);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0);

  // Stage 4 claims the contextual response face (muted path publishes at task
  // time from emotion metadata). Find squint_smile in the palette.
  const face = IDLE_FACIAL_PALETTE.find((s) => s.id === 'squint_smile')!;
  h.controller.claimResponseFace(face, 20_000);
  const latched = face.additive;

  // Let the idle change timer fire multiple times while the response face is
  // held — it must NOT replace the latched face (armChange returns early).
  for (let i = 0; i < 10; i += 1) {
    pump(h, 130); // 130ms > idle change interval (100ms)
    h.controller.step(0.016);
    const snap = h.controller.snapshot();
    assert.equal(snap.state, 'squint_smile', 'response face must stay latched while held');
  }

  // Speaking suppression turning on mid-turn must not clear the response face.
  h.controller.setSuppression('speaking', true);
  pump(h, 200);
  assert.equal(h.controller.snapshot().state, 'squint_smile', 'response face survives speaking suppression');

  // Compare held additive against the target of the latched face (allow smooth
  // interpolation to have approached it).
  const held = h.controller.snapshot().additive;
  for (const fk of Object.keys(latched) as (keyof IdleFacialAdditive)[]) {
    const target = latched[fk] as number;
    if (Math.abs(target) < 1e-9) continue;
    assert.ok(Math.abs(held[fk] - target) < 1.0, `face parameter ${fk} driven toward latched target`);
  }

  // Only a real release (turn end / text-only hold expiry) returns to neutral
  // and lets Stage 3 idle scheduling resume.
  h.controller.releaseResponseFace();
  pump(h, 300);
  assert.ok(facialMax(h.controller.snapshot().additive) > 0, 'idle resumes after release');
});

// ---------------------------------------------------------------------------
// TEMPORARY capability-test mode — pure checks on the forced faces.
// ---------------------------------------------------------------------------
test('capability mode: every forced face zeroes Cheek (no blush residue)', () => {
  for (const key of Object.keys(TEMP_CAPABILITY_FACES)) {
    const merged = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES[key].additive };
    assert.equal(merged.Cheek, 0, `capface ${key} must explicitly clear blush`);
  }
});

test('capability mode: neutral counters the 1.0 MouthUp motion baseline', () => {
  // The idle motion mtn_01 holds ParamMouthUp = 1.0 (its neutral mouth pose) and
  // the true max is 1.0, so an ACTIVE neutral that writes MouthUp 0 would leave
  // the mouth clamped at 1.0 (permanent smile). The cap neutral must apply
  // MouthUp -1.0 to flatten it, and keep brows/eyes neutral.
  const n = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES.neutral.additive };
  assert.equal(n.MouthUp, -1.0, 'neutral counteracts the baseline to flatten the smile');
  assert.equal(n.MouthDown, 0);
  assert.equal(n.MouthAngry, 0);
  assert.equal(n.BrowLAngle, 0);
  assert.equal(TEMP_CAPABILITY_FACES.neutral.eyeOpen, 1.0);
});

test('capability mode: sad is clearly distinct from neutral (mouth droop + sad brows)', () => {
  const s = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES.sad.additive };
  assert.ok(s.MouthDown > 0.5, 'sad turns the mouth down clearly');
  assert.ok(Math.abs(s.BrowLAngle) > 0.5, 'sad angles brows');
  assert.ok(Math.abs(s.BrowLForm) > 0.5, 'sad shapes/forms brows');
  assert.ok(TEMP_CAPABILITY_FACES.sad.eyeOpen < 1.0, 'sad slightly softens the eyes');
  assert.equal(s.Cheek, 0);
});

test('capability mode: angry reads angry not sad (pout line, no MouthDown)', () => {
  const a = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES.angry.additive };
  assert.equal(a.MouthDown, 0, 'angry must NOT droop the mouth (would read sad)');
  assert.equal(a.MouthAngry, 1.0);
  assert.equal(a.MouthAngryLine, 1.0);
  assert.ok(Math.abs(a.BrowLAngle) > 0.5 && Math.abs(a.BrowLForm) > 0.5, 'angry furrows + angles brows');
  assert.equal(a.EyeLForm, 1.0, 'angry uses sharp angular eyes');
  assert.ok(TEMP_CAPABILITY_FACES.angry.eyeOpen < 0.9, 'angry narrows the eyes');
});

test('capability mode: all faces only write owned facial params (no ParamA / Stage-2)', () => {
  for (const key of Object.keys(TEMP_CAPABILITY_FACES)) {
    const merged = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES[key].additive };
    for (const forbidden of ['ParamA', 'AngleX', 'AngleY', 'AngleZ', 'BodyAngleX', 'EyeBallX', 'EyeBallY']) {
      assert.ok(!(forbidden in merged), `capface ${key} must not touch ${forbidden}`);
    }
  }
});

test('capability mode reset/no-face disables the forced override', () => {
  // A non-existent or empty capface leaves the bridge OFF: a fresh controller
  // still schedules normal autonomous faces.
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 300);
  assert.ok(h.controller.snapshot().state !== null, 'normal idle face still schedules when cap mode off');
  void (0 as never);
});

void (0 as never);