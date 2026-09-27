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

/**
 * New size after dragging the bottom-right resize handle (pure,
 * unit-testable). Adds the pointer delta to the gesture-start size, then
 * hard-clamps to MIN/MAX: shrinking past MIN stops at MIN, growing past
 * MAX stops at MAX. Drag right/down grows, left/up shrinks.
 */
export function applyResizeDelta(
  startSize: LifeStateSize,
  deltaX: number,
  deltaY: number,
): LifeStateSize {
  const dx = Number.isFinite(deltaX) ? deltaX : 0;
  const dy = Number.isFinite(deltaY) ? deltaY : 0;
  return clampLifeStateSize({
    width: startSize.width + dx,
    height: startSize.height + dy,
  });
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
): LifeStatePosition {
  const vw =
    Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 1024;
  const vh =
    Number.isFinite(viewportHeight) && viewportHeight > 0
      ? viewportHeight
      : 768;
  return {
    x: Math.round(
      clampNumber(
        pos.x,
        LIFE_STATE_VISIBLE_STRIP - LIFE_STATE_MAX_WIDTH,
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
      x: clampNumber(rawPos.x, -LIFE_STATE_MAX_WIDTH, 4096),
      y: clampNumber(rawPos.y, -LIFE_STATE_MAX_HEIGHT, 4096),
    };
  }
  let size: LifeStateSize | null = null;
  const rawSize = record.size as { width?: unknown; height?: unknown } | null;
  if (
    rawSize &&
    typeof rawSize.width === "number" &&
    typeof rawSize.height === "number"
  ) {
    size = clampLifeStateSize({
      width: rawSize.width,
      height: rawSize.height,
    });
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
  try {
    window.localStorage.setItem(
      LIFE_STATE_PREF_KEY,
      JSON.stringify(sanitizePreferences(prefs)),
    );
  } catch (error) {
    console.error("Error saving life state preferences:", error);
  }
}
