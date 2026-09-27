import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIFE_STATE_PREF_KEY,
  DEFAULT_LIFE_STATE_PREFS,
  LIFE_STATE_MIN_WIDTH,
  LIFE_STATE_MIN_HEIGHT,
  LIFE_STATE_MAX_WIDTH,
  LIFE_STATE_MAX_HEIGHT,
  applyDragDelta,
  applyResizeDelta,
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

test("saved size and position restore on initialization", () => {
  storage.clear();
  saveLifeStatePreferences({
    enabled: true,
    position: { x: 300, y: 150 },
    size: { width: 320, height: 260 },
  });
  const loaded = loadLifeStatePreferences();
  assert.deepEqual(loaded.position, { x: 300, y: 150 });
  assert.deepEqual(loaded.size, { width: 320, height: 260 });
});

test("corrupt data falls back to safe default", () => {
  storage.set(LIFE_STATE_PREF_KEY, "{broken");
  assert.deepEqual(loadLifeStatePreferences(), DEFAULT_LIFE_STATE_PREFS);
});

test("size is clamped to readable bounds", () => {
  assert.equal(LIFE_STATE_MIN_WIDTH, 280);
  assert.equal(LIFE_STATE_MIN_HEIGHT, 200);
  assert.equal(LIFE_STATE_MAX_WIDTH, 520);
  assert.equal(LIFE_STATE_MAX_HEIGHT, 700);
  const tiny = clampLifeStateSize({ width: 10, height: 10 });
  assert.deepEqual(tiny, { width: 280, height: 200 });
  const huge = clampLifeStateSize({ width: 5000, height: 5000 });
  assert.deepEqual(huge, { width: 520, height: 700 });
});

test("position clamp keeps a visible strip inside the viewport", () => {
  const clamped = clampLifeStatePosition({ x: 5000, y: 5000 }, 1280, 800);
  assert.ok(clamped.x <= 1280 - 80 && clamped.y <= 800 - 80);
  const kept = clampLifeStatePosition({ x: 100, y: 100 }, 1280, 800);
  assert.deepEqual(kept, { x: 100, y: 100 });
});

test("resize down stops at MIN lock", () => {
  const start = { width: 320, height: 260 };
  const shrunk = applyResizeDelta(start, -1000, -1000);
  assert.deepEqual(shrunk, { width: 280, height: 200 });
});

test("resize up stops at MAX lock", () => {
  const start = { width: 320, height: 260 };
  const grown = applyResizeDelta(start, 1000, 1000);
  assert.deepEqual(grown, { width: 520, height: 700 });
});

test("normal resize produces the exact size", () => {
  assert.deepEqual(applyResizeDelta({ width: 300, height: 240 }, 40, -20), {
    width: 340,
    height: 220,
  });
  // Non-finite deltas are ignored safely.
  assert.deepEqual(
    applyResizeDelta({ width: 300, height: 240 }, Number.NaN, 10),
    { width: 300, height: 250 },
  );
});

test("drag delta moves the panel point from any grab origin", () => {
  // Press in the middle of the panel (not the header) and slide.
  assert.deepEqual(
    applyDragDelta({ x: 100, y: 100 }, { x: 250, y: 300 }, { x: 270, y: 280 }),
    { x: 120, y: 80 },
  );
});

test("no pinch helpers remain exported", async () => {
  const mod = (await import("@/utils/life-state-preference")) as Record<
    string,
    unknown
  >;
  for (const key of Object.keys(mod)) {
    assert.ok(
      !key.toLowerCase().includes("pinch"),
      `pinch API must be gone: ${key}`,
    );
  }
});
