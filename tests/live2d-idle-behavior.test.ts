import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Live2DIdleOffsetController,
  type IdleOffsetAdditive,
  type IdleTiming,
  type Live2DIdleOffsetControllerOptions,
} from '../src/renderer/src/utils/live2d-idle-offsets.ts';
import type { AvatarActivityState } from '../src/renderer/src/utils/avatar-activity-controller.ts';

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

const TINY_TIMING: Record<'idle' | 'long_idle', IdleTiming> = {
  idle: {
    quietMinMs: 10,
    quietMaxMs: 10,
    transitionMinMs: 100,
    transitionMaxMs: 100,
    holdMinMs: 50,
    holdMaxMs: 50,
    releaseMinMs: 100,
    releaseMaxMs: 100,
  },
  long_idle: {
    quietMinMs: 10,
    quietMaxMs: 10,
    transitionMinMs: 100,
    transitionMaxMs: 100,
    holdMinMs: 50,
    holdMaxMs: 50,
    releaseMinMs: 100,
    releaseMaxMs: 100,
  },
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
  controller: Live2DIdleOffsetController;
  activity: AvatarActivityState;
}

function makeController(options: Live2DIdleOffsetControllerOptions = {}): Harness {
  const clock = new FakeClock();
  const controller = new Live2DIdleOffsetController({
    timing: TINY_TIMING,
    schedule: clock.schedule,
    cancel: clock.cancel,
    rng: seqRng([0.5]),
    ...options,
  });
  const harness: Harness = { clock, controller, activity: 'active' };
  return harness;
}

function pump(
  h: Harness,
  ms: number,
  recorder?: (offset: IdleOffsetAdditive) => void,
): void {
  const steps = Math.ceil(ms / 16);
  for (let i = 0; i < steps; i += 1) {
    h.clock.advance(16);
    const offset = h.controller.step(0.016);
    recorder?.(offset);
  }
}

function maxMagnitude(offset: IdleOffsetAdditive): number {
  return Math.max(
    Math.abs(offset.AngleX),
    Math.abs(offset.AngleY),
    Math.abs(offset.AngleZ),
    Math.abs(offset.BodyAngleX),
    Math.abs(offset.EyeBallX),
    Math.abs(offset.EyeBallY),
  );
}

function isZero(offset: IdleOffsetAdditive): boolean {
  return maxMagnitude(offset) < 1e-6;
}

function keysOf(offset: IdleOffsetAdditive): string[] {
  return Object.keys(offset).sort();
}

test('active state schedules no autonomous movement', () => {
  const h = makeController();
  h.controller.setActivity('active');
  let max = 0;
  let lastSeen: string | null = null;
  pump(h, 2_000, (offset) => {
    max = Math.max(max, maxMagnitude(offset));
    lastSeen = h.controller.snapshot().lastAction ?? lastSeen;
  });
  assert.equal(max, 0);
  assert.equal(lastSeen, null);
  assert.equal(h.controller.snapshot().phase, 'disabled');
});

test('idle state schedules movement', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  let max = 0;
  let lastSeen: string | null = null;
  pump(h, 1_200, (offset) => {
    max = Math.max(max, maxMagnitude(offset));
    lastSeen = h.controller.snapshot().lastAction ?? lastSeen;
  });
  assert.notEqual(lastSeen, null);
  assert.ok(max > 0);
});

test('long_idle state schedules movement', () => {
  const h = makeController();
  h.controller.setActivity('long_idle');
  let max = 0;
  let lastSeen: string | null = null;
  pump(h, 1_200, (offset) => {
    max = Math.max(max, maxMagnitude(offset));
    lastSeen = h.controller.snapshot().lastAction ?? lastSeen;
  });
  assert.notEqual(lastSeen, null);
  assert.ok(max > 0);
});

test('speaking suppresses autonomous movement', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  let max = 0;
  pump(h, 600, (offset) => {
    max = Math.max(max, maxMagnitude(offset));
  });
  assert.ok(max > 0);
  h.controller.setSuppression('speaking', true);
  let after = Infinity;
  pump(h, 600, (offset) => {
    after = Math.min(after, maxMagnitude(offset));
  });
  assert.equal(after, 0);
  assert.equal(isZero(h.controller.snapshot().current), true);
});

test('speaking begun during movement eases the offset out, not a snap', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  let mid1: number[] = [];
  pump(h, 150, (offset) => { mid1.push(Math.abs(offset.AngleX)); });
  // We are inside a transition at this point; record a non-zero baseline.
  const before = maxMagnitude(h.controller.snapshot().current);
  h.controller.setSuppression('speaking', true);
  // First details: value must not jump to a larger magnitude.
  const firstAfter = maxMagnitude(h.controller.step(0.016));
  assert.ok(firstAfter <= before + 1e-6);
  void mid1;
  // And it reaches zero through interpolation.
  pump(h, 400);
  assert.ok(isZero(h.controller.snapshot().current));
});

test('speaking end honours a cooldown before movement resumes', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  const before = h.controller.snapshot().lastAction;
  h.controller.setSuppression('speaking', true);
  pump(h, 200); // eases out
  h.controller.setSuppression('speaking', false);
  // Immediately after unsuppress, no action yet and offset should be zero.
  let firstMax = -1;
  pump(h, 90, (offset) => { firstMax = Math.max(firstMax, maxMagnitude(offset)); });
  // speechEnd cooldown is 2500ms (> the 90ms pumped), so nothing yet.
  assert.equal(isZero(h.controller.snapshot().current), true);
  assert.equal(h.controller.snapshot().lastAction, before);
  void firstMax;
  // After cooldown + quiet + transition, movement can occur again.
  h.clock.advance(2_500);
  pump(h, 500);
  assert.notEqual(h.controller.snapshot().lastAction, before);
  assert.ok(maxMagnitude(h.controller.snapshot().current) >= 0);
});

test('manual drag suppresses idle motion', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 600);
  assert.ok(!isZero(h.controller.snapshot().current));
  h.controller.setSuppression('drag', true);
  pump(h, 400);
  assert.ok(isZero(h.controller.snapshot().current));
});

test('manual drag end allows resume after cooldown', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  const before = h.controller.snapshot().lastAction;
  h.controller.setSuppression('drag', true);
  pump(h, 200);
  h.controller.setSuppression('drag', false);
  pump(h, 100); // well under 1500ms drag cooldown
  assert.equal(isZero(h.controller.snapshot().current), true);
  h.clock.advance(1_500);
  pump(h, 500);
  assert.notEqual(h.controller.snapshot().lastAction, before);
});

test('live2d motion suppression eases out and honours cooldown', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 600);
  h.controller.setSuppression('motion', true);
  pump(h, 400);
  assert.ok(isZero(h.controller.snapshot().current));
  const before = h.controller.snapshot().lastAction;
  h.controller.setSuppression('motion', false);
  pump(h, 100);
  assert.equal(isZero(h.controller.snapshot().current), true);
  h.clock.advance(1_500);
  pump(h, 500);
  assert.notEqual(h.controller.snapshot().lastAction, before);
});

test('same action is not immediately repeated when alternatives exist', () => {
  const h = makeController({
    actions: [
      { id: 'A', target: { AngleX: 1 } },
      { id: 'B', target: { AngleX: -1 } },
    ],
    antiRepeatCount: 1,
  });
  h.controller.setActivity('idle');
  // Record each distinct action globally. With 2 options + anti-repeat(1), each
  // new pick must strictly alternate because the previous pick is excluded.
  const seen: string[] = [];
  let lastSeen: string | null = null;
  for (let i = 0; i < 6000; i += 1) {
    h.clock.advance(1);
    h.controller.step(0.001);
    const current = h.controller.snapshot().lastAction;
    if (current !== lastSeen) {
      lastSeen = current;
      if (current !== null) seen.push(current);
    }
  }
  assert.ok(seen.length >= 4, `expected several picks, got ${seen.length}`);
  for (let i = 1; i < seen.length; i += 1) {
    assert.notEqual(seen[i], seen[i - 1], 'consecutive picks must not repeat');
  }
});

test('movement intensity stays inside configured safe bounds', () => {
  const h = makeController();
  h.controller.setActivity('long_idle');
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  let maxB = 0;
  let maxEX = 0;
  let maxEY = 0;
  pump(h, 3_000, (o) => {
    maxX = Math.max(maxX, Math.abs(o.AngleX));
    maxY = Math.max(maxY, Math.abs(o.AngleY));
    maxZ = Math.max(maxZ, Math.abs(o.AngleZ));
    maxB = Math.max(maxB, Math.abs(o.BodyAngleX));
    maxEX = Math.max(maxEX, Math.abs(o.EyeBallX));
    maxEY = Math.max(maxEY, Math.abs(o.EyeBallY));
  });
  // Default ranges: AngleX 9, AngleY 5.4, AngleZ 6, Body 1.2, Eye 0.25.
  // Intensity is capped at 75% of range, so these must hold tightly.
  assert.ok(maxX <= 9 + 1e-6);
  assert.ok(maxY <= 5.4 + 1e-6);
  assert.ok(maxZ <= 6 + 1e-6);
  assert.ok(maxB <= 1.2 + 1e-6);
  assert.ok(maxEX <= 0.25 + 1e-6);
  assert.ok(maxEY <= 0.25 + 1e-6);
});

test('parameter result stays within model min/max (additive clamps)', () => {
  const h = makeController({
    ranges: { AngleX: 5, AngleY: 3, AngleZ: 4, BodyAngleX: 1, EyeBallX: 0.2, EyeBallY: 0.2 },
  });
  h.controller.setActivity('idle');
  pump(h, 2_000, (o) => {
    assert.ok(Math.abs(o.AngleX) <= 5 + 1e-6);
    assert.ok(Math.abs(o.AngleY) <= 3 + 1e-6);
    assert.ok(Math.abs(o.AngleZ) <= 4 + 1e-6);
    assert.ok(Math.abs(o.BodyAngleX) <= 1 + 1e-6);
    assert.ok(Math.abs(o.EyeBallX) <= 0.2 + 1e-6);
    assert.ok(Math.abs(o.EyeBallY) <= 0.2 + 1e-6);
  });
});

test('no lip-sync (ParamA) or eye-open ownership in produced offsets', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 600);
  const allowed = ['AngleX', 'AngleY', 'AngleZ', 'BodyAngleX', 'EyeBallX', 'EyeBallY'].sort();
  const seen = new Set<string>();
  pump(h, 1_200, (o) => {
    keysOf(o).forEach((k) => seen.add(k));
  });
  seen.forEach((k) => assert.ok(allowed.includes(k)));
  assert.ok(!seen.has('ParamA'));
  assert.ok(!seen.has('EyeLOpen'));
  assert.ok(!seen.has('ParamEyeLOpen'));
});

test('cleanup cancels pending timers and prevents phantom movement', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 200);
  h.controller.dispose();
  assert.equal(h.clock.timers.size, 0);
  pump(h, 5_000);
  assert.ok(isZero(h.controller.snapshot().current));
});

test('timer backlog stays bounded (no busy polling loop)', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  for (let i = 0; i < 500; i += 1) {
    h.clock.advance(16);
    h.controller.step(0.016);
    assert.ok(h.clock.timers.size <= 2);
  }
});

test('snapshot exposes a compact non-sensitive decision structure', () => {
  const h = makeController();
  h.controller.setActivity('idle');
  pump(h, 200);
  const snap = h.controller.snapshot();
  assert.ok(['disabled', 'quiet', 'moving', 'holding', 'releasing'].includes(snap.phase));
  assert.equal(snap.activity, 'idle');
  assert.equal(typeof snap.quietScheduled, 'boolean');
  assert.deepEqual(Object.keys(snap.suppressed).sort(), ['drag', 'motion', 'speaking']);
});