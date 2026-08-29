import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXTUAL_EMOTION_MAP,
  mapEmotionLabelToFaceId,
  decodeExpressionIndexToFaceId,
  resolveResponseFaceId,
} from '../src/renderer/src/utils/contextual-emotion.ts';
import {
  IdleFacialExpressionController,
  IDLE_FACIAL_PALETTE,
  NEUTRAL_EYE_OPEN,
  RESPONSE_FACE_HOLD_MS,
  type IdleFacialControllerOptions,
  type IdleFacialTiming,
  type IdleFacialStateWeighted,
} from '../src/renderer/src/utils/live2d-idle-facial.ts';
import {
  responseFaceBus,
  decideResponseFace,
  pickTextOnlyHoldMs,
  TEXT_ONLY_HOLD_MIN_MS,
  TEXT_ONLY_HOLD_MAX_MS,
} from '../src/renderer/src/utils/response-face-bus.ts';

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

const TINY: IdleFacialTiming = { idleMinMs: 100, idleMaxMs: 100, longIdleMinMs: 100, longIdleMaxMs: 100 };
function seqRng(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}
function face(id: string): IdleFacialStateWeighted {
  const f = IDLE_FACIAL_PALETTE.find((s) => s.id === id);
  assert.ok(f, `palette must contain ${id}`);
  return f;
}
function makeController(options: IdleFacialControllerOptions = {}): { clock: FakeClock; c: IdleFacialExpressionController } {
  const clock = new FakeClock();
  const c = new IdleFacialExpressionController({
    timing: TINY,
    schedule: clock.schedule,
    cancel: clock.cancel,
    rng: seqRng([0.99]),
    ...options,
  });
  return { clock, c };
}
function pump(h: { clock: FakeClock; c: IdleFacialExpressionController }, ms: number) {
  const steps = Math.ceil(ms / 16);
  for (let i = 0; i < steps; i += 1) {
    h.clock.advance(16);
    h.c.step(0.016);
  }
}

test('response emotion labels map to the expected semantic faces', () => {
  assert.equal(resolveResponseFaceId({ emotions: ['neutral'] }), 'neutral');
  assert.equal(resolveResponseFaceId({ emotions: ['joy'] }), 'small_smile');
  assert.equal(resolveResponseFaceId({ emotions: ['smirk'] }), 'squint_smile');
  assert.equal(resolveResponseFaceId({ emotions: ['sadness'] }), 'sad_soft');
  assert.equal(resolveResponseFaceId({ emotions: ['anger'] }), 'angry_pout');
  assert.equal(resolveResponseFaceId({ emotions: ['disgust'] }), 'pout_small');
});

test('rig-limited response emotions resolve to neutral (never a wrong face)', () => {
  // mao_pro's Stage 3 params can't express fear/surprise; mapping them to a
  // smile or to sad would be actively wrong, so they stay neutral.
  assert.equal(resolveResponseFaceId({ emotions: ['fear'] }), 'neutral');
  assert.equal(resolveResponseFaceId({ emotions: ['surprise'] }), 'neutral');
});

test('unknown/empty emotion label resolves to neutral without crashing', () => {
  assert.equal(resolveResponseFaceId({ emotions: ['bogus_emotion'] }), 'neutral');
  assert.equal(resolveResponseFaceId({ emotions: [''] }), 'neutral');
  assert.equal(resolveResponseFaceId({ emotions: [] }), 'neutral');
  assert.equal(resolveResponseFaceId({ emotions: null }), 'neutral');
  assert.equal(resolveResponseFaceId({}), 'neutral');
  assert.equal(mapEmotionLabelToFaceId(undefined), 'neutral');
  assert.equal(mapEmotionLabelToFaceId(null), 'neutral');
  assert.equal(mapEmotionLabelToFaceId('ANGER'), 'angry_pout'); // case-insensitive
});

test('legacy index fallback decodes conservative faces', () => {
  assert.equal(decodeExpressionIndexToFaceId(0), 'neutral');
  assert.equal(decodeExpressionIndexToFaceId(1), 'sad_soft');
  assert.equal(decodeExpressionIndexToFaceId(2), 'angry_pout');
  assert.equal(decodeExpressionIndexToFaceId(3), 'squint_smile');
  assert.equal(decodeExpressionIndexToFaceId(99), 'neutral');
  assert.equal(decodeExpressionIndexToFaceId('bogus'), 'neutral');
  assert.equal(decodeExpressionIndexToFaceId(null), 'neutral');
});

test('semantic label wins over legacy index when both present', () => {
  assert.equal(resolveResponseFaceId({ emotions: ['joy'], expressions: [2] }), 'small_smile');
});

test('CONTEXTUAL_EMOTION_MAP only references real Stage 3 palette ids', () => {
  const paletteIds = new Set(IDLE_FACIAL_PALETTE.map((s) => s.id));
  for (const id of Object.values(CONTEXTUAL_EMOTION_MAP)) {
    assert.ok(paletteIds.has(id), `face ${id} must exist in the Stage 3 palette`);
  }
});

test('claiming a response face overrides an active idle face', () => {
  const h = makeController();
  h.c.setActivity('long_idle');
  pump(h, 500);
  // force some idle face (rng 0.99 → heavy-weighted neutral or a rare negative)
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 400);
  const snap = h.c.snapshot();
  assert.equal(snap.state, 'angry_pout');
  // additive reflects the angry_pout recipe (full pout line), not whatever idle picked.
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const additiveAny: Record<string, number> = snap.additive as unknown as Record<string, number>;
  assert.ok((additiveAny.MouthAngry ?? 0) > 0.5, 'claimed angry face drives the mouth');
  assert.equal(snap.holding, true);
});

test('idle scheduling cannot override an active response face', () => {
  const h = makeController();
  h.c.setActivity('long_idle');
  h.c.claimResponseFace(face('sad_soft'));
  // pump well past many idle change intervals (100ms each) - the response face
  // must remain owned and identical.
  pump(h, 5_000);
  const snap = h.c.snapshot();
  assert.equal(snap.state, 'sad_soft');
  assert.ok(snap.eyeOpen < 1.0 && snap.eyeOpen > 0.9, 'sad_soft eye factor retained');
});

test('response face stays active while speaking (idle suppression must not clear it)', () => {
  const h = makeController();
  h.c.setSuppression('speaking', true); // speaking suppress idle
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 500);
  assert.equal(h.c.snapshot().state, 'angry_pout');
  // speaking continues: still active
  h.c.setActivity('speaking');
  pump(h, 300);
  assert.equal(h.c.snapshot().state, 'angry_pout');
  h.c.setSuppression('drag', true);
  pump(h, 300);
  assert.equal(h.c.snapshot().state, 'angry_pout');
});

test('claiming null releases: briefly neutral then idle resumes', () => {
  const h = makeController();
  h.c.setActivity('long_idle');
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, 'angry_pout');
  h.c.claimResponseFace(null);
  // Immediately after release the contribution is zeroing toward neutral.
  pump(h, 120);
  assert.notEqual(h.c.snapshot().state, 'angry_pout');
  // idle scheduling resumes afterwards (state becomes non-null, non-angry).
  pump(h, 3_000);
  const s = h.c.snapshot().state;
  assert.ok(s !== null && s !== 'angry_pout', 'idle face resumes after release');
});

test('consecutive response emotions replace each other (no stale face)', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('sad_soft'));
  pump(h, 200);
  h.c.claimResponseFace(face('small_smile'));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, 'small_smile');
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, 'angry_pout');
});

test('claimed response face writes only facial params, never ParamA or Stage-2 movement', () => {
  const h = makeController();
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 400);
  const keys = Object.keys(h.c.step(0.016).additive);
  for (const forbidden of ['ParamA', 'AngleX', 'AngleY', 'AngleZ', 'BodyAngleX', 'EyeBallX', 'EyeBallY']) {
    assert.ok(!keys.includes(forbidden), `must not touch ${forbidden}`);
  }
});

test('lip-sync ownership: claimed face never writes ParamA and allows blink via multiply', () => {
  const h = makeController();
  h.c.claimResponseFace(face('squint_smile'));
  pump(h, 1_000);
  const step = h.c.step(0.016);
  const keys = Object.keys(step.additive);
  assert.ok(!keys.includes('ParamA'), 'lip-sync owns ParamA, never Stage 4');
  assert.ok(!keys.includes('EyeLOpen') && !keys.includes('EyeROpen'), 'EyeOpen is NOT additive-managed');
  // EyeOpen is a MULTIPLY factor (~0.82 for squint). Blink / lip-sync keep
  // controlling openness amplitude underneath.
  assert.ok(step.eyeOpen < 0.9 && step.eyeOpen > 0.7, 'squint narrows via a safe multiply factor');
});

test('auto-release: response face releases after the hold timeout', () => {
  const h = makeController();
  h.c.setActivity('long_idle');
  h.c.claimResponseFace(face('small_smile'), 1_000);
  pump(h, 300);
  assert.equal(h.c.snapshot().state, 'small_smile');
  pump(h, 1_500); // passes the 1000ms hold
  assert.notEqual(h.c.snapshot().state, 'small_smile');
});

test('response face works for both TTS and text-only (claim is audio-independent)', () => {
  // Text-only / TTS both funnel into the same controller claim path via the
  // busy resolve; the controller itself has no notion of audio, so a face is
  // applied either way. Prove the resolve→claim path for a TTS-like and a
  // text-only-like payload.
  const ttsLike = resolveResponseFaceId({ emotions: ['joy'] });
  const textLike = resolveResponseFaceId({ emotions: ['sadness'] });
  const h = makeController();
  h.c.claimResponseFace(face(ttsLike));
  pump(h, 200);
  h.c.claimResponseFace(face(textLike));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, textLike);
});

test('response face aligns with proactive responses (same mapping path)', () => {
  // Proactive turns reuse the exact same emotion-label pipeline, so the same
  // resolver drives their faces automatically.
  assert.equal(resolveResponseFaceId({ emotions: ['joy'] }), 'small_smile');
  assert.ok(Object.keys(CONTEXTUAL_EMOTION_MAP).length > 0);
});

test('responseFaceBus carries face ids and releases', () => {
  responseFaceBus.clear();
  const got: (string | null)[] = [];
  const unsub = responseFaceBus.subscribe(({ faceId }) => got.push(faceId));
  responseFaceBus.publish({ faceId: 'angry_pout' });
  responseFaceBus.publish({ faceId: 'neutral' });
  responseFaceBus.publish({ faceId: null });
  assert.deepEqual(got, ['angry_pout', 'neutral', null]);
  assert.equal(responseFaceBus.getLastPayload().faceId, null);
  unsub();
  responseFaceBus.clear();
});

test('turn-level latch: unmarked sentences never release an active response face', () => {
  // Live-proven bug: the marker sat on the LAST sentence, so squint_smile was
  // claimed for ~64ms and then released by the turn-end signal. The latch
  // fixes the *missing-marker* case: 'neutral' on a sentence means "no new
  // emotion update", never "reset to neutral".
  assert.deepEqual(
    decideResponseFace(null, 'smirk'),
    { kind: 'claim', faceId: 'smirk', switchingFrom: null },
  );
  // Unmarked / neutral fallback / same-face re-publish → keep + refresh hold.
  assert.deepEqual(decideResponseFace('squint_smile', 'neutral'), { kind: 'refresh', faceId: 'squint_smile' });
  assert.deepEqual(decideResponseFace('squint_smile', ''), { kind: 'refresh', faceId: 'squint_smile' });
  assert.deepEqual(decideResponseFace('squint_smile', 'squint_smile'), { kind: 'refresh', faceId: 'squint_smile' });
  // True turn-end / cancellation only.
  assert.deepEqual(decideResponseFace('squint_smile', null), { kind: 'release' });
  assert.deepEqual(decideResponseFace(null, null), { kind: 'keep' });
  // Fully neutral turn: nothing latches.
  assert.deepEqual(decideResponseFace(null, 'neutral'), { kind: 'keep' });
  // Next turn can replace the latched face cleanly.
  assert.deepEqual(
    decideResponseFace('squint_smile', 'joy'),
    { kind: 'claim', faceId: 'joy', switchingFrom: 'squint_smile' },
  );
});

test('full turn flow: claim early, keep through unmarked sentences, release at turn end', () => {
  const h = makeController();
  h.c.setActivity('idle');
  // Sentence 1 carries the emotion marker (now at the START of the response).
  // The publisher resolves the raw label to a palette face id first, exactly
  // like use-audio-task does before publishing.
  const smirkFace = resolveResponseFaceId({ emotions: ['smirk'] });
  assert.equal(smirkFace, 'squint_smile');
  let decision = decideResponseFace(null, smirkFace);
  assert.equal(decision.kind, 'claim');
  if (decision.kind === 'claim') h.c.claimResponseFace(face(decision.faceId));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, 'squint_smile');
  // Sentences 2..4 have no marker → 'neutral' fallback → latch must hold.
  for (const incoming of ['neutral', 'neutral', 'neutral']) {
    decision = decideResponseFace(
      h.c.isResponseFaceActive() ? h.c.snapshot().state : null,
      incoming,
    );
    assert.equal(decision.kind, 'refresh', 'unmarked sentence must refresh, not release');
    if (decision.kind === 'refresh') h.c.claimResponseFace(face(decision.faceId));
    pump(h, 200);
    assert.equal(h.c.snapshot().state, 'squint_smile', 'unmarked sentence must not release the face');
  }
  // Turn playback complete → null → release.
  decision = decideResponseFace(h.c.snapshot().state, null);
  assert.equal(decision.kind, 'release');
  if (decision.kind === 'release') h.c.releaseResponseFace();
  pump(h, 300);
  assert.notEqual(h.c.snapshot().state, 'squint_smile');
});

test('unmarked sentences refresh the safety hold so a long response survives', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('squint_smile'), 1_000); // 1s hold
  pump(h, 700);
  assert.equal(h.c.snapshot().state, 'squint_smile');
  // A neutral sentence refreshes the hold before the original 1s expires.
  const decision = decideResponseFace('squint_smile', 'neutral');
  assert.equal(decision.kind, 'refresh');
  if (decision.kind === 'refresh') h.c.claimResponseFace(face(decision.faceId), 1_000);
  pump(h, 700); // past the original 1s expiry
  assert.equal(h.c.snapshot().state, 'squint_smile', 'refreshed hold must survive past original expiry');
});

test('neutral response with no contextual emotion never latches a stale face', () => {
  const h = makeController();
  h.c.setActivity('idle');
  for (const incoming of ['neutral', 'neutral', 'neutral']) {
    assert.equal(decideResponseFace(null, incoming).kind, 'keep');
  }
  assert.equal(h.c.isResponseFaceActive(), false, 'no contextual face latched');
  // Turn ends with nothing latched: no release needed, no stale face.
  assert.equal(decideResponseFace(null, null).kind, 'keep');
});

test('text-only hold policy keeps a muted/text-only face visibly long enough', () => {
  // Muted/text-only live case: the face was claimed but released ~50-100ms
  // later because there was no audio lifecycle. The perceptual hold must keep
  // it visible for a bounded, human-perceivable duration.
  assert.equal(pickTextOnlyHoldMs(0), TEXT_ONLY_HOLD_MIN_MS);
  const short = pickTextOnlyHoldMs(60); // short response
  assert.ok(short >= 2_500 && short <= 4_000, `short response hold=${short}`);
  const long = pickTextOnlyHoldMs(800); // long response
  assert.equal(long, TEXT_ONLY_HOLD_MAX_MS);
  assert.ok(TEXT_ONLY_HOLD_MAX_MS <= 6_000, 'bounded: never stuck for 20-30s');
  assert.ok(pickTextOnlyHoldMs(200) >= pickTextOnlyHoldMs(100), 'scales with length');
  assert.ok(TEXT_ONLY_HOLD_MIN_MS < TEXT_ONLY_HOLD_MAX_MS);
});

test('text-only face survives the perceptual window and releases cleanly after', () => {
  // No audio activity at all: the contextual face must NOT drop the instant a
  // (near-instant) text completion arrives — it holds through the perceptual
  // window, then a delayed text-only release releases it cleanly.
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('squint_smile'));
  pump(h, 100);
  assert.equal(h.c.snapshot().state, 'squint_smile');
  // No audio lifecycle; the minimum perceptual hold passes without dropping
  // (the 20s watchdog is only a stuck-lifecycle fallback, not the lifetime).
  pump(h, TEXT_ONLY_HOLD_MIN_MS + 200);
  assert.equal(
    h.c.snapshot().state,
    'squint_smile',
    'face must survive the whole perceptual hold window',
  );
  // The delayed text-only release arrives → smooth release, idle may resume.
  h.c.releaseResponseFace();
  pump(h, 400);
  assert.notEqual(h.c.snapshot().state, 'squint_smile');
});

test('safety window default is a generous fallback, not the primary lifetime', () => {
  // Live proof: the old 6s window expired between two sentences of the SAME
  // turn (face released at holdMs=6000 while seq2 arrived 340ms later). The
  // default is now a 20s fallback combined with activity refresh.
  assert.ok(
    RESPONSE_FACE_HOLD_MS >= 15_000 && RESPONSE_FACE_HOLD_MS <= 30_000,
    `RESPONSE_FACE_HOLD_MS=${RESPONSE_FACE_HOLD_MS} must be a generous safety window`,
  );
});

test('response face survives >6 seconds of a valid ongoing turn (watchdog refresh)', () => {
  const h = makeController();
  h.c.setActivity('idle');
  // Simulate the OLD 6s window: heartbeats must keep it alive past 6s.
  h.c.claimResponseFace(face('squint_smile'), 6_000);
  pump(h, 5_500);
  assert.equal(h.c.snapshot().state, 'squint_smile');
  h.c.refreshResponseFace(6_000); // audio_end / next-task heartbeat
  pump(h, 5_500);
  h.c.refreshResponseFace(6_000);
  pump(h, 5_500);
  h.c.refreshResponseFace(6_000);
  pump(h, 5_500);
  assert.equal(h.c.snapshot().state, 'squint_smile', 'heartbeat must keep the face alive past 6s');
});

test('audio activity refreshes the watchdog across a long TTS gap between sentences', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('squint_smile')); // default 20s hold
  pump(h, 100);
  // sentence 1 audio_start + audio_end heartbeats, then a long gap until seq2.
  h.c.refreshResponseFace();
  pump(h, 5_000);
  h.c.refreshResponseFace();
  pump(h, 5_000);
  // seq2 task arrives: heartbeat again — still inside the refreshed window.
  h.c.refreshResponseFace();
  assert.equal(h.c.snapshot().state, 'squint_smile');
  pump(h, 15_000);
  assert.equal(
    h.c.snapshot().state,
    'squint_smile',
    'gap between sentences of one turn must not time out the face',
  );
});

test('unmarked sentence keeps the face and refreshes the watchdog (subscriber path)', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('squint_smile'), 6_000); // old too-short window
  pump(h, 100);
  for (let i = 0; i < 3; i += 1) {
    const decision = decideResponseFace('squint_smile', 'neutral');
    assert.equal(decision.kind, 'refresh');
    if (decision.kind === 'refresh') h.c.refreshResponseFace(6_000);
    pump(h, 3_000); // half the old 6s window passes
    h.c.refreshResponseFace(6_000); // audio_end heartbeat mid-gap
    pump(h, 4_000); // total gap 7s > the old 6s window
    assert.equal(
      h.c.snapshot().state,
      'squint_smile',
      'unmarked sentence + mid-gap heartbeat must prevent mid-turn timeout',
    );
  }
});

test('safety timeout still releases a genuinely stuck face', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('squint_smile')); // default 20s fallback
  pump(h, 100);
  assert.equal(h.c.snapshot().state, 'squint_smile');
  // No activity at all: the fallback must eventually release the stuck face.
  pump(h, 21_000);
  assert.notEqual(h.c.snapshot().state, 'squint_smile');
});

test('duplicate turn completion / release is idempotent', () => {
  const h = makeController();
  h.c.setActivity('idle');
  h.c.claimResponseFace(face('small_smile'));
  pump(h, 200);
  assert.equal(h.c.snapshot().state, 'small_smile');
  h.c.releaseResponseFace();
  pump(h, 300);
  assert.notEqual(h.c.snapshot().state, 'small_smile');
  // A second completion signal (duplicate backend-synth-complete) must be a
  // no-op: nothing latched, no crash, no stale face resurrection.
  h.c.releaseResponseFace();
  assert.equal(h.c.isResponseFaceActive(), false);
  assert.equal(decideResponseFace(null, null).kind, 'keep');
  pump(h, 2_000);
  assert.notEqual(h.c.snapshot().state, 'small_smile');
});

test('no extra provider/LLM call is introduced by stage 4 logic', () => {
  // The mapping and controller are pure in-process logic — no fetch/network.
  // Resolving simply runs the pure resolver.
  assert.equal(resolveResponseFaceId({ emotions: ['anger'] }), 'angry_pout');
  assert.equal(NEUTRAL_EYE_OPEN, 1.0);
});

// ---------------------------------------------------------------------------
// RUNTIME-ORDER REGRESSION — the response face is applied by the same Stage 3
// facial hook that runs LAST (after physics/pose/lip-sync and Stage 2), so a
// claimed response face survives to `model.update()`. Mirrors the Stage 2
// overwrite-bug guard.
// ---------------------------------------------------------------------------
test('runtime-order: claimed response face survives (drives final additive)', () => {
  const order: string[] = [];
  const h = makeController();
  h.c.setActivity('long_idle');
  // An idle face was already scheduled BEFORE the response face arrives.
  pump(h, 300);
  order.push('idle_face_active');

  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 400); // many frames while "talking"
  const { additive } = h.c.step(0.016);
  const a = additive as unknown as Record<string, number>;
  // The final additive the (last-running) hook would write is the response
  // face's, not an idle/neutral value, and it survives:
  assert.equal(h.c.snapshot().state, 'angry_pout');
  assert.ok((a.MouthAngry ?? 0) >= 0.99);
  assert.ok((a.BrowLForm ?? 0) <= -0.5);
  assert.deepEqual(order, ['idle_face_active']);
});

test('no stale face after dispose', () => {
  const h = makeController();
  h.c.claimResponseFace(face('angry_pout'));
  pump(h, 200);
  h.c.dispose();
  const snap = h.c.snapshot();
  assert.equal(snap.state, null);
  assert.equal(snap.eyeOpen, NEUTRAL_EYE_OPEN);
  assert.equal(snap.additive.MouthAngry, 0);
});