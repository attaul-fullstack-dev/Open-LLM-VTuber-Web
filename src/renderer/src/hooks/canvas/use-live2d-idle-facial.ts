/* eslint-disable no-underscore-dangle */
import {
  useCallback, useEffect, useRef,
} from 'react';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { CubismFramework } from '../../../WebSDK/Framework/src/live2dcubismframework';
import { setLive2DIdleFacialHook } from '../../../WebSDK/src/lapplive2dfacialhook';
import {
  IdleFacialExpressionController,
  type IdleFacialAdditive,
} from '@/utils/live2d-idle-facial';

/**
 * Mili Hidup Stage 3 — Autonomous idle facial micro-expressions.
 *
 * Consumes Stage 1's `useAvatarActivityState()` and publishes a per-frame apply
 * function into the Cubism render loop (via the facial-hook registry that
 * `LAppModel._update` auto-links AFTER the Stage 2 movement hook). It owns facial
 * parameters only and NEVER writes:
 *   - ParamA / ParamI/U/E/O (lip-sync owns the mouth vowels)
 *   - Stage 2 movement params (AngleX/Y/Z, BodyAngleX, EyeBallX/Y)
 * Eye-open parameters are always MULTIPLIED (neutral 1.0), so blink keeps running.
 *
 * No new render loop / interval / network / LLM call is created; event cadence
 * is setTimeout-driven inside the pure controller, and interpolation rides the
 * existing Cubism render loop.
 */
interface UseLive2DIdleFacialOptions {
  isDragging: boolean;
  isMotionPlaying: boolean;
}

interface Live2DIdleFacialApi {
  snapshot: () => {
    state: string | null;
    activity: string;
    additive: IdleFacialAdditive;
    eyeOpen: number;
    suppressed: { speaking: boolean; drag: boolean; motion: boolean };
  };
}

export function useLive2DIdleFacial({
  isDragging,
  isMotionPlaying,
}: UseLive2DIdleFacialOptions): Live2DIdleFacialApi {
  const { activityState } = useAvatarActivityState();

  const controllerRef = useRef<IdleFacialExpressionController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new IdleFacialExpressionController();
  }
  const controller = controllerRef.current;

  useEffect(() => {
    controller.setActivity(activityState);
  }, [controller, activityState]);

  useEffect(() => {
    controller.setSuppression('speaking', activityState === 'speaking');
  }, [controller, activityState]);

  useEffect(() => {
    controller.setSuppression('drag', isDragging);
  }, [controller, isDragging]);

  useEffect(() => {
    controller.setSuppression('motion', isMotionPlaying);
  }, [controller, isMotionPlaying]);

  // Cubism id handles, resolved lazily and retried per frame until available
  // (keeps working even if this mounts before CubismFramework has started up).
  const idsRef = useRef<Record<string, unknown> | null>(null);
  const ensureIds = useCallback((): Record<string, unknown> | null => {
    if (idsRef.current) return idsRef.current;
    try {
      const idManager = CubismFramework.getIdManager();
      if (!idManager || typeof idManager.getId !== 'function') return null;
      const facesInstance: Record<string, unknown> = {
        BrowLY: idManager.getId('ParamBrowLY'),
        BrowRY: idManager.getId('ParamBrowRY'),
        BrowLAngle: idManager.getId('ParamBrowLAngle'),
        BrowRAngle: idManager.getId('ParamBrowRAngle'),
        BrowLForm: idManager.getId('ParamBrowLForm'),
        BrowRForm: idManager.getId('ParamBrowRForm'),
        MouthUp: idManager.getId('ParamMouthUp'),
        MouthDown: idManager.getId('ParamMouthDown'),
        MouthAngry: idManager.getId('ParamMouthAngry'),
        MouthAngryLine: idManager.getId('ParamMouthAngryLine'),
        EyeLSmile: idManager.getId('ParamEyeLSmile'),
        EyeRSmile: idManager.getId('ParamEyeRSmile'),
        EyeLForm: idManager.getId('ParamEyeLForm'),
        EyeRForm: idManager.getId('ParamEyeRForm'),
        Cheek: idManager.getId('ParamCheek'),
        EyeLOpen: idManager.getId('ParamEyeLOpen'),
        EyeROpen: idManager.getId('ParamEyeROpen'),
      };
      idsRef.current = facesInstance;
      return facesInstance;
    } catch {
      return null;
    }
  }, []);

  // Publish the per-frame apply function for the render loop, tear down on
  // unmount so no stale controller affects a different/next model or character.
  useEffect(() => {
    setLive2DIdleFacialHook((cubismModel: any, deltaSeconds: number) => {
      const active = controllerRef.current;
      if (!active || !cubismModel || typeof cubismModel.addParameterValueById !== 'function') {
        return;
      }
      const handles = ensureIds();
      if (!handles) return;
      const { additive, eyeOpen } = active.step(deltaSeconds);
      try {
        // Additive facial micro-expression parameters.
        cubismModel.addParameterValueById(handles.BrowLY, additive.BrowLY);
        cubismModel.addParameterValueById(handles.BrowRY, additive.BrowRY);
        cubismModel.addParameterValueById(handles.BrowLAngle, additive.BrowLAngle);
        cubismModel.addParameterValueById(handles.BrowRAngle, additive.BrowRAngle);
        cubismModel.addParameterValueById(handles.BrowLForm, additive.BrowLForm);
        cubismModel.addParameterValueById(handles.BrowRForm, additive.BrowRForm);
        cubismModel.addParameterValueById(handles.MouthUp, additive.MouthUp);
        cubismModel.addParameterValueById(handles.MouthDown, additive.MouthDown);
        cubismModel.addParameterValueById(handles.MouthAngry, additive.MouthAngry);
        cubismModel.addParameterValueById(handles.MouthAngryLine, additive.MouthAngryLine);
        cubismModel.addParameterValueById(handles.EyeLSmile, additive.EyeLSmile);
        cubismModel.addParameterValueById(handles.EyeRSmile, additive.EyeRSmile);
        cubismModel.addParameterValueById(handles.EyeLForm, additive.EyeLForm);
        cubismModel.addParameterValueById(handles.EyeRForm, additive.EyeRForm);
        cubismModel.addParameterValueById(handles.Cheek, additive.Cheek);

        // Eye open is ALWAYS multiply (neutral 1.0) so blink / runtime eye
        // animation keeps working under it.
        if (typeof cubismModel.multiplyParameterValueById === 'function') {
          cubismModel.multiplyParameterValueById(handles.EyeLOpen, eyeOpen);
          cubismModel.multiplyParameterValueById(handles.EyeROpen, eyeOpen);
        }
      } catch {
        // Parameter absent on a non-mao_pro model: safely no-op, keep rendering.
      }
    });
    return () => {
      setLive2DIdleFacialHook(null);
      controllerRef.current?.dispose();
    };
  }, [ensureIds]);

  const snapshot = useCallback(() => {
    const snap = controller.snapshot();
    return {
      state: snap.state,
      activity: snap.activity,
      additive: snap.additive,
      eyeOpen: snap.eyeOpen,
      suppressed: snap.suppressed,
    };
  }, [controller]);

  return { snapshot };
}