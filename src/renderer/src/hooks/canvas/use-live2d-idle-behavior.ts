/* eslint-disable no-underscore-dangle */
import {
  useCallback, useEffect, useMemo, useRef,
} from 'react';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { CubismFramework } from '../../../WebSDK/Framework/src/live2dcubismframework';
import { setLive2DIdleApplyHook } from '../../../WebSDK/src/lapplive2didlehook';
import {
  Live2DIdleOffsetController,
  type IdleOffsetAdditive,
} from '@/utils/live2d-idle-offsets';

/**
 * Stage 2 — Safe autonomous Live2D idle movement.
 *
 * Consumes Stage 1's `useAvatarActivityState()` and publishes a per-frame apply
 * function into the Cubism render loop (via the idle-hook registry that
 * `LAppModel._update` auto-links). This adapter only forwards the pure offset
 * controller's decisions as additive parameters; lip-sync (ParamA), blink
 * (EyeLOpen/ROpen), expressions, drag and breathing are left untouched.
 *
 * The apply function rides the existing render loop — no new rAF/interval loop
 * is created. Event cadence (quiet pauses, when to act) is timer-driven by the
 * controller, not per-frame.
 */
interface UseLive2DIdleBehaviorOptions {
  isDragging: boolean;
  /** gapless/generous default; a caller can force a non-idle motion to suspend. */
  isMotionPlaying: boolean;
}

interface Live2DIdleBehaviorApi {
  setMotionSuppressed: (suppressed: boolean) => void;
  setDragSuppressed: (suppressed: boolean) => void;
  /** Dev/console diagnostics only; production logs stay silent. */
  snapshot: () => {
    phase: string;
    activity: string;
    current: IdleOffsetAdditive;
    suppressed: { speaking: boolean; drag: boolean; motion: boolean };
    quietScheduled: boolean;
    lastAction: string | null;
  };
}

export function useLive2DIdleBehavior({
  isDragging,
  isMotionPlaying,
}: UseLive2DIdleBehaviorOptions): Live2DIdleBehaviorApi {
  const { activityState } = useAvatarActivityState();

  const controllerRef = useRef<Live2DIdleOffsetController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new Live2DIdleOffsetController();
  }
  const controller = controllerRef.current;

  // Feed Stage 1 activity state straight into the controller.
  useEffect(() => {
    controller.setActivity(activityState);
  }, [controller, activityState]);

  // Speaking is the strictest, highest-priority suppression.
  useEffect(() => {
    const speaking = activityState === 'speaking';
    controller.setSuppression('speaking', speaking);
  }, [controller, activityState]);

  // Manual drag always wins over autonomous movement.
  useEffect(() => {
    controller.setSuppression('drag', isDragging);
  }, [controller, isDragging]);

  // An externally-flagged non-idle motion also suppresses (best-effort hook).
  useEffect(() => {
    controller.setSuppression('motion', isMotionPlaying);
  }, [controller, isMotionPlaying]);

  const setMotionSuppressed = useCallback((suppressed: boolean) => {
    controller.setSuppression('motion', suppressed);
  }, [controller]);

  const setDragSuppressed = useCallback((suppressed: boolean) => {
    controller.setSuppression('drag', suppressed);
  }, [controller]);

  // Build the Cubism id handles once for the known-safe parameters. Guarded so
  // running before CubismFramework.startUp() degrades to a no-op rather than a
  // crash (the apply hook re-checks handles each frame).
  const idsRef = useRef<Record<string, unknown> | null>(null);
  const ids = useMemo<Record<string, unknown> | null>(() => {
    try {
      const idManager = CubismFramework.getIdManager();
      if (!idManager || typeof idManager.getId !== 'function') return null;
      const idsInstance: Record<string, unknown> = {
        AngleX: idManager.getId('ParamAngleX'),
        AngleY: idManager.getId('ParamAngleY'),
        AngleZ: idManager.getId('ParamAngleZ'),
        BodyAngleX: idManager.getId('ParamBodyAngleX'),
        EyeBallX: idManager.getId('ParamEyeBallX'),
        EyeBallY: idManager.getId('ParamEyeBallY'),
      };
      idsRef.current = idsInstance;
      return idsInstance;
    } catch {
      idsRef.current = null;
      return null;
    }
  }, []);

  // Publish the per-frame apply function for the render loop, and tear it down
  // on unmount so no stale controller affects a different/next model.
  useEffect(() => {
    setLive2DIdleApplyHook((cubismModel: any, deltaSeconds: number) => {
      const active = controllerRef.current;
      if (!active || !cubismModel || typeof cubismModel.addParameterValueById !== 'function') {
        return;
      }
      const offset = active.step(deltaSeconds);
      const handles = idsRef.current;
      if (!handles) return;
      try {
        cubismModel.addParameterValueById(handles.AngleX, offset.AngleX);
        cubismModel.addParameterValueById(handles.AngleY, offset.AngleY);
        cubismModel.addParameterValueById(handles.AngleZ, offset.AngleZ);
        cubismModel.addParameterValueById(handles.BodyAngleX, offset.BodyAngleX);
        cubismModel.addParameterValueById(handles.EyeBallX, offset.EyeBallX);
        cubismModel.addParameterValueById(handles.EyeBallY, offset.EyeBallY);
      } catch {
        // A parameter may be absent on a non-mao_pro model; ignore so idle
        // movement safely no-ops without breaking rendering.
      }
    });
    return () => {
      setLive2DIdleApplyHook(null);
      controllerRef.current?.dispose();
    };
  }, [ids]);

  const snapshot = useCallback(() => {
    const snap = controller.snapshot();
    return {
      phase: snap.phase,
      activity: snap.activity,
      current: snap.current,
      suppressed: snap.suppressed,
      quietScheduled: snap.quietScheduled,
      lastAction: snap.lastAction,
    };
  }, [controller]);

  return {
    setMotionSuppressed,
    setDragSuppressed,
    snapshot,
  };
}