import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIFE_STATE_PREF_KEY,
  DEFAULT_LIFE_STATE_PREFS,
  LIFE_STATE_MIN_WIDTH,
  LIFE_STATE_MIN_HEIGHT,
  LIFE_STATE_MAX_WIDTH,
  LIFE_STATE_MAX_HEIGHT,
  LIFE_STATE_BASE_WIDTH,
  LIFE_STATE_MIN_SCALE,
  LIFE_STATE_MAX_SCALE,
  applyDragDelta,
  clampLifeStatePosition,
  clampLifeStateScale,
  clampLifeStateSize,
  loadLifeStatePreferences,
  resolveRenderPosition,
  resolveRenderScale,
  saveLifeStatePreferences,
  scaleForHandleDelta,
  scaleForWidth,
  widthForScale,
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
  // Way past the minimum: locked at 0.35x of the 280px base.
  assert.equal(scaleForHandleDelta(1, -1000), LIFE_STATE_MIN_SCALE);
  assert.equal(widthForScale(LIFE_STATE_MIN_SCALE), 98);
});

test("resize up stops at MAX lock", () => {
  assert.equal(scaleForHandleDelta(1, 1000), LIFE_STATE_MAX_SCALE);
  assert.equal(widthForScale(LIFE_STATE_MAX_SCALE), 560);
});

test("normal resize produces the exact scale", () => {
  // +28px drag on a 280px base = +0.1 scale.
  assert.equal(scaleForHandleDelta(1, 28), 1.1);
  assert.equal(scaleForHandleDelta(1, -28), 0.9);
  assert.equal(widthForScale(1.1), 308);
  // Non-finite deltas are ignored safely.
  assert.equal(scaleForHandleDelta(1, Number.NaN), 1);
});

test("aspect ratio is preserved across scales", () => {
  // One zoom factor drives both dimensions: any content height scales
  // with the same factor as the base width.
  for (const scale of [0.35, 1, 2]) {
    const width = widthForScale(scale);
    const contentHeight = 200;
    assert.equal(width / (contentHeight * scale), LIFE_STATE_BASE_WIDTH / contentHeight);
  }
});

test("viewport bound keeps the widget on small screens", () => {
  // 360px-wide phone: scale capped so 280px base still fits.
  const capped = scaleForHandleDelta(2, 0, 360);
  assert.ok(capped * LIFE_STATE_BASE_WIDTH <= 360 - 16);
});

test("drag delta moves the panel point from any grab origin", () => {
  // Press in the middle of the panel (not the header) and slide.
  assert.deepEqual(
    applyDragDelta({ x: 100, y: 100 }, { x: 250, y: 300 }, { x: 270, y: 280 }),
    { x: 120, y: 80 },
  );
});

test("pointer +100 grows scale, -100 shrinks it (A/B)", () => {
  assert.ok(scaleForHandleDelta(1, 100) > 1);
  assert.ok(scaleForHandleDelta(1, -100) < 1);
});

test("live gesture value wins for render, persisted otherwise (C/D/K)", () => {
  assert.equal(resolveRenderScale(1, 1.5), 1.5);
  assert.equal(resolveRenderScale(1, null), 1);
  assert.deepEqual(
    resolveRenderPosition({ x: 10, y: 20 }, { x: 30, y: 40 }),
    { x: 30, y: 40 },
  );
  assert.deepEqual(resolveRenderPosition({ x: 10, y: 20 }, null), {
    x: 10,
    y: 20,
  });
  assert.equal(resolveRenderPosition(null, null), null);
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

test("persist happens once per gesture end, never per move (J)", () => {
  const srcDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "renderer",
    "src",
  );
  const widget = fs.readFileSync(
    path.join(srcDir, "components/canvas/life-state-widget.tsx"),
    "utf8",
  );
  const setPositionCalls = widget.match(/[^a-zA-Z]setPosition\(/g) ?? [];
  const setSizeCalls = widget.match(/[^a-zA-Z]setSize\(/g) ?? [];
  // Exactly one persist site each (finishDrag / finishResize); moves only
  // touch live refs + DOM style, never storage.
  assert.equal(setPositionCalls.length, 1);
  assert.equal(setSizeCalls.length, 1);
});

test("resize handle is isolated from panel drag (H)", () => {
  const srcDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "renderer",
    "src",
  );
  const widget = fs.readFileSync(
    path.join(srcDir, "components/canvas/life-state-widget.tsx"),
    "utf8",
  );
  const handleBlock = widget.slice(widget.indexOf("onHandlePointerDown"));
  assert.ok(
    handleBlock.slice(0, 400).includes("stopPropagation"),
    "handle press must not reach the panel drag handler",
  );
  assert.ok(widget.includes('data-testid="life-state-resize-handle"'));
});
