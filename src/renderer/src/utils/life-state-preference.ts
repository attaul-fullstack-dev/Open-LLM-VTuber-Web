/**
 * Pure persistence helpers for the "Mili Life State" observability widget.
 *
 * Kept free of React so it can be unit-tested directly. Three independent
 * preferences share one localStorage record:
 * - enabled: whether the floating widget is visible (default ON for
 *   development/verification).
 * - position: last drag position {x, y} in CSS pixels, or null for default.
 * - size: last resize {width, height} in CSS pixels, or null for default.
 *
 * OFF only hides the observability display. It never touches World State,
 * chat, avatar, emotion, or voice, and it never stops Stage 7.
 */

export const LIFE_STATE_PREF_KEY = "miliLifeStateWidget";

export interface LifeStatePosition {
  x: number;
  y: number;
}

export interface LifeStateSize {
  width: number;
  height: number;
}

export interface LifeStatePreferences {
  enabled: boolean;
  position: LifeStatePosition | null;
  size: LifeStateSize | null;
}

// Reasonable bounds so the widget stays readable but can never swallow the app.
export const LIFE_STATE_MIN_WIDTH = 280;
export const LIFE_STATE_MIN_HEIGHT = 200;
export const LIFE_STATE_MAX_WIDTH = 520;
export const LIFE_STATE_MAX_HEIGHT = 700;
// Minimum visible strip (px) kept inside the viewport (boundary protection).
export const LIFE_STATE_VISIBLE_STRIP = 80;

// ---------------------------------------------------------------------------
// Proportional whole-widget scaling (single source of size truth).
//
// The panel renders at a fixed base width; a single `zoom` factor scales
// width, height, fonts, padding, gaps, icons and radius together, so the
// aspect ratio and internal layout can never drift apart. The resize handle
// only changes this scale; persisted size records are interpreted through
// it (width authoritative, height informational).
// ---------------------------------------------------------------------------

/** Base layout width (px) the widget is designed at; zoom scales from here. */
export const LIFE_STATE_BASE_WIDTH = 280;
/** Minimum scale (~0.35x): compact but still readable. */
export const LIFE_STATE_MIN_SCALE = 0.35;
/** Maximum scale (~2x): large but never fullscreen. */
export const LIFE_STATE_MAX_SCALE = 2.0;

export function clampLifeStateScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const clamped = Math.min(
    LIFE_STATE_MAX_SCALE,
    Math.max(LIFE_STATE_MIN_SCALE, value),
  );
  return Math.round(clamped * 100) / 100;
}

/** Scale that renders the given persisted width (width authoritative). */
export function scaleForWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return clampLifeStateScale(width / LIFE_STATE_BASE_WIDTH);
}

/** Visual width (px) at a scale step. */
export function widthForScale(scale: number): number {
  return Math.round(LIFE_STATE_BASE_WIDTH * clampLifeStateScale(scale));
}

/**
 * New scale after dragging the bottom-right resize handle (pure,
 * unit-testable). Horizontal pointer travel drives the scale so width and
 * height stay proportional; the result is hard-clamped to MIN/MAX and
 * additionally to the current viewport width when provided.
 */
export function scaleForHandleDelta(
  startScale: number,
  deltaX: number,
  viewportWidth?: number,
): number {
  const dx = Number.isFinite(deltaX) ? deltaX : 0;
  let scale = clampLifeStateScale(startScale + dx / LIFE_STATE_BASE_WIDTH);
  if (viewportWidth !== undefined && Number.isFinite(viewportWidth)) {
    const fit = (viewportWidth - 16) / LIFE_STATE_BASE_WIDTH;
    if (fit < scale) {
      // Floor (not round) so the fitted width never exceeds the viewport.
      scale = Math.max(
        LIFE_STATE_MIN_SCALE,
        Math.floor(Math.min(scale, fit) * 100) / 100,
      );
    }
  }
  return scale;
}

/**
 * Resolve the scale to render: a live gesture value wins over the persisted
 * one while a gesture is in flight, so unrelated re-renders (clock ticks,
 * snapshot updates) can never snap the visuals back mid-gesture. This is
 * the single source of truth that prevents resize/drag feedback loops.
 */
export function resolveRenderScale(
  persistedScale: number,
  liveScale: number | null,
): number {
  return liveScale ?? persistedScale;
}

/**
 * Resolve the position to render: same live-wins contract as scale, so a
 * drag never jumps when something else re-renders the widget.
 */
export function resolveRenderPosition(
  persisted: LifeStatePosition | null,
  live: LifeStatePosition | null,
): LifeStatePosition | null {
  return live ?? persisted;
}

/**
 * Single live geometry for an in-flight gesture, ALL IN UNSCALED units.
 *
 * CSS `zoom` scales positioned offsets too (a `top:64px` renders at
 * 64*zoom), so mixing getBoundingClientRect readings (scaled/visual) with
 * style values (unscaled) makes panels jump, drift and resist the finger.
 * Exactly one of drag/resize owns this object at a time; each writes only
 * its own fields (drag: x/y, resize: scale), so gestures can never fight.
 * Null fields mean "keep whatever the persisted/rendered value is".
 */
export interface LifeStateLiveGeometry {
  x: number | null;
  y: number | null;
  scale: number | null;
}

export function resolveRenderGeometry(
  persisted: LifeStateLiveGeometry,
  live: LifeStateLiveGeometry | null,
): LifeStateLiveGeometry {
  return live ?? persisted;
}

/**
 * Drag step in unscaled units: finger travel converts through the scale
 * that was active when the gesture STARTED (constant for the whole drag),
 * so the panel follows the finger 1:1 visually at any zoom.
 */
export function dragGeometryStep(
  base: LifeStatePosition,
  from: LifeStatePosition,
  to: LifeStatePosition,
  scale: number,
): LifeStatePosition {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: base.x + (to.x - from.x) / s,
    y: base.y + (to.y - from.y) / s,
  };
}

/**
 * Clamp an unscaled position so the SCALED panel stays in the viewport.
 * Bounds convert explicitly (visual_bound / scale); the caller passes the
 * live visual height measured ONCE at gesture start, never re-measured
 * per move (no measurement feedback).
 */
export function clampUnscaledPosition(
  pos: LifeStatePosition,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  visualHeight: number,
): LifeStatePosition {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const vw =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1024;
  const vh =
    Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 768;
  const vhPx =
    Number.isFinite(visualHeight) && visualHeight > 0
      ? visualHeight
      : 200 * s;
  const visualWidth = LIFE_STATE_BASE_WIDTH * s;
  return {
    x: Math.round(
      clampNumber(
        pos.x,
        (LIFE_STATE_VISIBLE_STRIP - visualWidth) / s,
        (vw - LIFE_STATE_VISIBLE_STRIP) / s,
      ),
    ),
    y: Math.round(
      clampNumber(pos.y, -(vhPx - LIFE_STATE_VISIBLE_STRIP) / s, (vh - LIFE_STATE_VISIBLE_STRIP) / s),
    ),
  };
}

/**
 * New panel position after a drag (pure, unit-testable). Adds the pointer
 * delta to the gesture-start position; viewport clamping is applied by the
 * caller via clampLifeStatePosition.
 */
export function applyDragDelta(
  base: LifeStatePosition,
  from: LifeStatePosition,
  to: LifeStatePosition,
): LifeStatePosition {
  return {
    x: base.x + (to.x - from.x),
    y: base.y + (to.y - from.y),
  };
}

export const DEFAULT_LIFE_STATE_PREFS: LifeStatePreferences = {
  enabled: true,
  position: null,
  size: null,
};

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clampLifeStateSize(size: LifeStateSize): LifeStateSize {
  return {
    width: Math.round(
      clampNumber(size.width, LIFE_STATE_MIN_WIDTH, LIFE_STATE_MAX_WIDTH),
    ),
    height: Math.round(
      clampNumber(size.height, LIFE_STATE_MIN_HEIGHT, LIFE_STATE_MAX_HEIGHT),
    ),
  };
}

export function clampLifeStatePosition(
  pos: LifeStatePosition,
  viewportWidth: number,
  viewportHeight: number,
  boxWidth?: number,
): LifeStatePosition {
  const vw =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1024;
  const vh =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : 768;
  // Clamp against the LIVE visual width when known (zoom-scaled panel),
  // otherwise the conservative maximum constant.
  const visualWidth =
    Number.isFinite(boxWidth) && (boxWidth as number) > 0
      ? (boxWidth as number)
      : LIFE_STATE_MAX_WIDTH;
  return {
    x: Math.round(
      clampNumber(
        pos.x,
        LIFE_STATE_VISIBLE_STRIP - visualWidth,
        vw - LIFE_STATE_VISIBLE_STRIP,
      ),
    ),
    y: Math.round(clampNumber(pos.y, 0, vh - LIFE_STATE_VISIBLE_STRIP)),
  };
}

function sanitizePreferences(raw: unknown): LifeStatePreferences {
  if (typeof raw !== "object" || raw === null)
    return { ...DEFAULT_LIFE_STATE_PREFS };
  const record = raw as Record<string, unknown>;
  const enabled =
    typeof record.enabled === "boolean"
      ? record.enabled
      : DEFAULT_LIFE_STATE_PREFS.enabled;
  let position: LifeStatePosition | null = null;
  const rawPos = record.position as { x?: unknown; y?: unknown } | null;
  if (rawPos && typeof rawPos.x === "number" && typeof rawPos.y === "number") {
    position = {
      x: clampNumber(rawPos.x, -4096, 4096),
      y: clampNumber(rawPos.y, -4096, 4096),
    };
  }
  let size: LifeStateSize | null = null;
  const rawSize = record.size as { width?: unknown; height?: unknown } | null;
  if (
    rawSize &&
    typeof rawSize.width === "number" &&
    typeof rawSize.height === "number"
  ) {
    // Scale roundtrip (no px floor): preserves sub-280px shrinks exactly
    // while still bounding outliers to MIN/MAX scale. Legacy records
    // migrate losslessly (232px -> 0.83x -> 232px).
    const scale = clampLifeStateScale(rawSize.width / LIFE_STATE_BASE_WIDTH);
    size = {
      width: Math.round(LIFE_STATE_BASE_WIDTH * scale),
      height:
        Number.isFinite(rawSize.height) && rawSize.height > 0
          ? Math.round(rawSize.height)
          : LIFE_STATE_BASE_WIDTH,
    };
    // Scale-aware viewport clamp so a reload never strands the panel
    // off-screen, without remapping valid positions.
    if (position && typeof window !== "undefined") {
      const visualWidth = LIFE_STATE_BASE_WIDTH * scale;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      position = {
        x: Math.round(
          clampNumber(
            position.x,
            (LIFE_STATE_VISIBLE_STRIP - visualWidth) / scale,
            (vw - LIFE_STATE_VISIBLE_STRIP) / scale,
          ),
        ),
        y: Math.round(
          clampNumber(position.y, 0, (vh - LIFE_STATE_VISIBLE_STRIP) / scale),
        ),
      };
    }
  }
  return { enabled, position, size };
}

export function loadLifeStatePreferences(): LifeStatePreferences {
  try {
    const item = window.localStorage.getItem(LIFE_STATE_PREF_KEY);
    if (item === null) return { ...DEFAULT_LIFE_STATE_PREFS };
    return sanitizePreferences(JSON.parse(item));
  } catch (error) {
    console.error("Error reading life state preferences:", error);
    return { ...DEFAULT_LIFE_STATE_PREFS };
  }
}

export function saveLifeStatePreferences(prefs: LifeStatePreferences): void {
  // Save WITHOUT viewport clamping: gestures already clamp with live
  // geometry, and re-clamping here (e.g. with a stale or rounded scale)
  // silently rewrites valid positions on every write (327 -> 279) and
  // teleports the panel. Load-time sanitize stays responsible for
  // migrating legacy/corrupt records.
  try {
    const clean: LifeStatePreferences = {
      enabled: prefs.enabled === true,
      position:
        prefs.position &&
        Number.isFinite(prefs.position.x) &&
        Number.isFinite(prefs.position.y)
          ? {
            x: Math.round(prefs.position.x),
            y: Math.round(prefs.position.y),
          }
          : null,
      size:
        prefs.size &&
        Number.isFinite(prefs.size.width) &&
        Number.isFinite(prefs.size.height)
          ? {
            width: Math.round(prefs.size.width),
            height: Math.round(prefs.size.height),
          }
          : null,
    };
    window.localStorage.setItem(LIFE_STATE_PREF_KEY, JSON.stringify(clean));
  } catch (error) {
    console.error("Error saving life state preferences:", error);
  }
}

/**
 * Guard for Life State fetches: only send while the shared socket is OPEN.
 * sendMessage itself toasts error.websocketNotOpen on failure, so callers
 * must skip (not send) while connecting/reconnecting. The reconnect
 * lifecycle (ws OPEN effect) owns the first fetch after (re)connect.
 */
export function canFetchLifeState(wsState: string | null | undefined): boolean {
  return wsState === "OPEN";
}
