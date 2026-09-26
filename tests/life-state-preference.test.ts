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
