/**
 * Stage 2 — Safe autonomous Live2D idle motion.
 *
 * A tiny mutable registry that lets the (React) idle-behavior adapter publish a
 * per-frame apply function which `LAppModel._update` consumes. Keeping it in the
 * WebSDK layer means the Cubism render loop never imports React code, while a
 * freshly loaded model (character switch / reconnect) can still auto-link to the
 * currently active autonomous-idle source. When no handler is set, behavior is a
 * no-op and identical to before this feature.
 */

export type Live2DIdleApplyHook = (
  cubismModel: any,
  deltaTimeSeconds: number,
) => void;

let currentHook: Live2DIdleApplyHook | null = null;

/** Publish the active per-frame hook (assigned on mount/unmount by the adapter). */
export function setLive2DIdleApplyHook(hook: Live2DIdleApplyHook | null): void {
  currentHook = hook;
}

/** Read the active per-frame hook (called by lappmodel each frame while unlinked). */
export function getLive2DIdleApplyHook(): Live2DIdleApplyHook | null {
  return currentHook;
}