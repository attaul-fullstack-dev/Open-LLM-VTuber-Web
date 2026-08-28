/**
 * Mili Hidup Stage 3 — Autonomous idle facial micro-expressions (WebSDK hook).
 *
 * Mirrors the Stage 2 idle registry (`lapplive2didlehook.ts`): a tiny mutable
 * registry that lets the (React) facial adapter publish a per-frame apply
 * function which `LAppModel._update` consumes. Kept in the WebSDK layer so the
 * Cubism render loop never imports React code, while a freshly loaded model
 * (character switch / reconnect) can still auto-link to the currently active
 * autonomous-idle facial source. When no handler is set, behavior is a no-op
 * and identical to before this feature.
 */

export type Live2DIdleFacialHook = (
  cubismModel: any,
  deltaTimeSeconds: number,
) => void;

let currentHook: Live2DIdleFacialHook | null = null;

/** Publish the active per-frame facial hook (assigned on mount/unmount). */
export function setLive2DIdleFacialHook(hook: Live2DIdleFacialHook | null): void {
  currentHook = hook;
}

/** Read the active per-frame facial hook (called by lappmodel each frame). */
export function getLive2DIdleFacialHook(): Live2DIdleFacialHook | null {
  return currentHook;
}