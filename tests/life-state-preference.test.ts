import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_STATE_PREF_KEY,
  DEFAULT_LIFE_STATE_PREFS,
  LIFE_STATE_MIN_WIDTH,
  LIFE_STATE_MAX_WIDTH,
  clampLifeStatePosition,
  clampLifeStateSize,
  loadLifeStatePreferences,
  pinchDistance,
  pinchResizedSize,
  saveLifeStatePreferences,
} from "@/utils/life-state-preference";

// Minimal localStorage stub so the pure module works without a browser.
const storage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
  innerWidth: 1280,
  innerHeight: 800,
};

test("default is ON with no position/size when nothing saved", () => {
  storage.clear();
  assert.deepEqual(loadLifeStatePreferences(), DEFAULT_LIFE_STATE_PREFS);
  assert.equal(loadLifeStatePreferences().enabled, true);
});

test("ON/OFF roundtrips without touching other fields", () => {
  storage.clear();
  saveLifeStatePreferences({ enabled: false, position: null, size: null });
  assert.equal(loadLifeStatePreferences().enabled, false);
  saveLifeStatePreferences({
    enabled: true,
    position: { x: 10, y: 20 },
    size: null,
  });
  const loaded = loadLifeStatePreferences();
  assert.equal(loaded.enabled, true);
  assert.deepEqual(loaded.position, { x: 10, y: 20 });
});

test("corrupt data falls back to safe default", () => {
  storage.set(LIFE_STATE_PREF_KEY, "{broken");
  assert.deepEqual(loadLifeStatePreferences(), DEFAULT_LIFE_STATE_PREFS);
});

test("size is clamped to readable bounds", () => {
  const tiny = clampLifeStateSize({ width: 10, height: 10 });
  assert.ok(tiny.width >= LIFE_STATE_MIN_WIDTH && tiny.height >= 150);
  const huge = clampLifeStateSize({ width: 5000, height: 5000 });
  assert.ok(huge.width <= LIFE_STATE_MAX_WIDTH && huge.height <= 520);
});

test("position clamp keeps a visible strip inside the viewport", () => {
  const clamped = clampLifeStatePosition({ x: 5000, y: 5000 }, 1280, 800);
  assert.ok(clamped.x <= 1280 - 80 && clamped.y <= 800 - 80);
  const kept = clampLifeStatePosition({ x: 100, y: 100 }, 1280, 800);
  assert.deepEqual(kept, { x: 100, y: 100 });
});

test("pinch distance is symmetric and zero for identical points", () => {
  assert.equal(pinchDistance({ id: 1, x: 0, y: 0 }, { id: 2, x: 3, y: 4 }), 5);
  assert.equal(
    pinchDistance({ id: 1, x: 10, y: 10 }, { id: 2, x: 10, y: 10 }),
    0,
  );
});

test("pinch out grows, pinch in shrinks", () => {
  const start = { width: 232, height: 200 };
  const grown = pinchResizedSize(100, 150, start);
  assert.ok(grown.width > start.width && grown.height > start.height);
  const shrunk = pinchResizedSize(150, 100, start);
  assert.ok(shrunk.width < start.width && shrunk.height < start.height);
});

test("pinch respects min/max bounds", () => {
  const tiny = pinchResizedSize(100, 5, { width: 232, height: 200 });
  assert.ok(tiny.width >= LIFE_STATE_MIN_WIDTH);
  const huge = pinchResizedSize(10, 1000, { width: 232, height: 200 });
  assert.ok(huge.width <= LIFE_STATE_MAX_WIDTH);
});

test("degenerate pinch distance keeps current size", () => {
  const start = { width: 232, height: 200 };
  assert.deepEqual(pinchResizedSize(0, 50, start), start);
});
