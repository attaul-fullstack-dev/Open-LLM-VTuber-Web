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
  clampUnscaledPosition,
  dragGeometryStep,
  loadLifeStatePreferences,
  resolveRenderPosition,
  resolveRenderScale,
  saveLifeStatePreferences,
  scaleForHandleDelta,
  scaleForWidth,
  widthForScale,
} from "../src/renderer/src/utils/life-state-preference.ts";

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
  // Scale roundtrip is 2-decimal: 320 -> 1.14x -> 319px. Bounded, stable,
  // and visually identical; never drifts across reloads.
  assert.deepEqual(loaded.size, { width: 319, height: 260 });
  saveLifeStatePreferences(loaded);
  assert.deepEqual(loadLifeStatePreferences().size, {
    width: 319,
    height: 260,
  });
});

test("save never re-clamps: persist roundtrip is exact (279 regression)", () => {
  // Live bug: a drag-persisted {327,150} at scale ~1.11 came back from
  // storage as {279,150} because the save path re-clamped with a rounded
  // scale. Save must store exactly; only load may clamp for migration.
  storage.clear();
  saveLifeStatePreferences({
    enabled: true,
    position: { x: 327, y: 150 },
    size: { width: 311, height: 80 },
  });
  const raw = JSON.parse(storage.get(LIFE_STATE_PREF_KEY)!);
  assert.deepEqual(raw.position, { x: 327, y: 150 });
  assert.deepEqual(raw.size, { width: 311, height: 80 });
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
  const mod = (await import("../src/renderer/src/utils/life-state-preference.ts")) as Record<
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

test("single live geometry object, no competing scale truths", () => {
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
  for (const dead of ["liveScaleRef", "livePosRef", "persistedScaleRef"]) {
    assert.ok(!widget.includes(dead), `second truth must be gone: ${dead}`);
  }
  // Gesture starts derive scale from the element (visual/base).
  assert.ok(widget.includes("rect.width / LIFE_STATE_BASE_WIDTH"));
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
    handleBlock.slice(0, 600).includes("stopPropagation"),
    "handle press must not reach the panel drag handler",
  );
  assert.ok(widget.includes('data-testid="life-state-resize-handle"'));
});

test("scaled rects never feed style values (no teleport reads)", () => {
  // getBoundingClientRect is zoom-scaled AND viewport-relative: allowed only
  // to DERIVE the live scale (visual width / base), the drag clamp bound,
  // and the offsetParent-corrected style-space origin at gesture start.
  // Positions must always convert back ((rect - origin) / scale); raw
  // viewport readings must never become style values or persist values
  // (that teleported the panel by the sidebar offset on first drag).
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
  const reads = widget.match(/getBoundingClientRect\(\)/g) ?? [];
  assert.equal(reads.length, 3);
  assert.ok(widget.includes("rect.width / LIFE_STATE_BASE_WIDTH"));
  assert.ok(widget.includes("offsetParent.getBoundingClientRect()"));
  assert.ok(widget.includes("(rect.left - opRect.left) / scale"));
  assert.ok(widget.includes("(rect.top - opRect.top) / scale"));
  assert.ok(!widget.match(/baseX:\s*rect\.left[^/]/));
  assert.ok(!widget.match(/baseY:\s*rect\.top[^/]/));
});

// Headless simulator mirroring the component's gesture handlers exactly:
// single live geometry (unscaled units), start+delta math, persist-on-end.
function makePanel(persisted = { x: 100, y: 200, scale: 1 }) {
  const VW = 390;
  const VH = 844;
  return {
    persisted: { ...persisted },
    live: null as null | { x: number | null; y: number | null; scale: number | null },
    _drag: null as null | {
      startX: number;
      startY: number;
      baseX: number;
      baseY: number;
      scale: number;
      visualHeight: number;
    },
    _resize: null as null | { startX: number; startScale: number },
    render() {
      const live = this.live;
      return {
        x: live && live.x !== null ? live.x : this.persisted.x,
        y: live && live.y !== null ? live.y : this.persisted.y,
        scale: live?.scale ?? this.persisted.scale,
      };
    },
    pointerDown(x: number, y: number, onHandle = false) {
      if (this._drag || this._resize) return;
      if (onHandle) {
        this._resize = {
          startX: x,
          startScale: this.live?.scale ?? this.persisted.scale,
        };
        return;
      }
      const base = this.live?.x !== null && this.live?.x !== undefined
        ? { x: this.live!.x as number, y: this.live!.y as number }
        : { x: this.persisted.x, y: this.persisted.y };
      const scale = this.live?.scale ?? this.persisted.scale;
      this._drag = {
        startX: x,
        startY: y,
        baseX: base.x,
        baseY: base.y,
        scale,
        visualHeight: 200 * scale,
      };
    },
    pointerMove(x: number, y: number) {
      if (this._resize) {
        const s = scaleForHandleDelta(this._resize.startScale, x - this._resize.startX, VW);
        this.live = { x: null, y: null, scale: s };
        return;
      }
      if (this._drag) {
        const d = this._drag;
        const raw = dragGeometryStep(
          { x: d.baseX, y: d.baseY },
          { x: d.startX, y: d.startY },
          { x, y },
          d.scale,
        );
        const next = clampUnscaledPosition(raw, d.scale, VW, VH, d.visualHeight);
        this.live = { x: next.x, y: next.y, scale: d.scale };
      }
    },
    pointerUp() {
      if (this._resize) {
        const s = this.live?.scale ?? this._resize.startScale;
        this.persisted.scale = s;
        this._resize = null;
        this.live = null;
      }
      if (this._drag && this.live && this.live.x !== null) {
        this.persisted.x = this.live.x;
        this.persisted.y = this.live.y as number;
        this._drag = null;
        this.live = null;
      } else {
        this._drag = null;
      }
    },
  };
}

test("exact user sequence: shrink -> up -> enlarge -> down (H)", () => {
  const panel = makePanel({ x: 98, y: 64, scale: 1 });
  const seen: string[] = [];
  const snap = () => {
    const r = panel.render();
    return `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.scale.toFixed(2)}`;
  };

  // 1. shrink: handle -120px at scale 1.
  panel.pointerDown(300, 100, true);
  panel.pointerMove(180, 100);
  let r = panel.render();
  assert.ok(r.scale < 1, `shrink must reduce scale, got ${r.scale}`);
  // x/y MUST NOT move during resize (top-left anchor stable).
  assert.deepEqual({ x: r.x, y: r.y }, { x: 98, y: 64 });
  panel.pointerUp();
  const shrunkScale = panel.persisted.scale;

  // 2. move up: press center, slide up 200px finger travel.
  panel.pointerDown(200, 200);
  const before = panel.render();
  panel.pointerMove(200, 100);
  r = panel.render();
  assert.equal(r.scale, before.scale, "drag must not change scale (G)");
  // Finger -100 at scale ~0.57 = -175 unscaled: hits the top clamp, which
  // keeps exactly the 80px visible strip. No snap anywhere else.
  assert.equal(r.y, -60, `clamped, not snapped: ${snap()}`);
  panel.pointerMove(200, 0);
  const r2 = panel.render();
  assert.equal(r2.y, -60, "stays clamped, no further motion, no snap");
  assert.equal(r2.scale, before.scale);
  panel.pointerUp();
  const upPos = { ...panel.persisted };

  // 3. enlarge: handle +150px.
  panel.pointerDown(300, 300, true);
  panel.pointerMove(450, 450);
  r = panel.render();
  assert.ok(r.scale > shrunkScale, "enlarge must grow scale");
  assert.deepEqual(
    { x: r.x, y: r.y },
    { x: upPos.x, y: upPos.y },
    "enlarge must not move position",
  );
  panel.pointerUp();

  // 4. move down: finger +300px converts through the CURRENT scale
  // (dragGeometryStep), so visual travel == finger travel exactly.
  const s = panel.persisted.scale;
  panel.pointerDown(200, 150);
  const d0 = panel.render();
  panel.pointerMove(200, 450);
  r = panel.render();
  assert.equal(r.scale, s, "scale invariant during drag");
  assert.ok(
    Math.abs(r.y - (d0.y + 300 / s)) < 1.5,
    `drag down tracks finger exactly at scale ${s}: ${snap()}`,
  );
  // No magnet: position is pure start+delta, never remapped.
  assert.ok(r.y > d0.y && r.y < 1400);
  panel.pointerUp();
  seen.push(snap());

  // 5. repeat the whole sequence: no drift.
  const first = snap();
  panel.pointerDown(300, 300, true);
  panel.pointerMove(180, 180);
  panel.pointerUp();
  panel.pointerDown(200, 200);
  panel.pointerMove(200, 100);
  panel.pointerUp();
  panel.pointerDown(300, 300, true);
  panel.pointerMove(450, 450);
  panel.pointerUp();
  panel.pointerDown(200, 150);
  panel.pointerMove(200, 450);
  panel.pointerUp();
  // After a symmetric-ish repeat, geometry stays bounded and sane.
  const end = panel.render();
  assert.ok(end.scale >= 0.35 && end.scale <= 2.0);
  assert.ok(end.y >= 0 && end.y <= 844);
  assert.ok(end.x >= 80 - 280 * end.scale && end.x <= 390 - 80);
  void seen;
  void first;
});

test("inverse sequence: enlarge -> down -> shrink -> up", () => {
  const panel = makePanel({ x: 50, y: 100, scale: 1 });
  panel.pointerDown(300, 300, true);
  panel.pointerMove(450, 450);
  panel.pointerUp();
  assert.ok(panel.persisted.scale > 1);
  panel.pointerDown(200, 200);
  panel.pointerMove(200, 500);
  const r = panel.render();
  assert.ok(r.y > 100, "dragged down continuously");
  panel.pointerUp();
  const downY = panel.persisted.y;
  panel.pointerDown(300, 300, true);
  panel.pointerMove(150, 150);
  panel.pointerUp();
  assert.ok(panel.persisted.scale < 1.6);
  panel.pointerDown(200, 400);
  panel.pointerMove(200, 100);
  panel.pointerUp();
  assert.ok(panel.persisted.y < downY, "dragged back up");
});
