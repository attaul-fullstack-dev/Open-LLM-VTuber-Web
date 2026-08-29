/* eslint-disable no-underscore-dangle */
import {
  useCallback, useEffect, useRef,
} from 'react';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { CubismFramework } from '../../../WebSDK/Framework/src/live2dcubismframework';
import { setLive2DIdleFacialHook } from '../../../WebSDK/src/lapplive2dfacialhook';
import {
  DEBUG_IDLE_FACIAL_CYCLE,
  IDLE_FACIAL_PALETTE,
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
// ---------------------------------------------------------------------------
// TEMPORARY Stage 3 mouth-tuning debug pass — deterministic visual cycle + rich
// runtime beacon. Both are DEBUG ONLY and must be removed before final release
// (production keeps the random anti-repeat palette and no beacon traffic).
// ---------------------------------------------------------------------------
const DEBUG_FACIAL_CYCLE = true;
const DEBUG_FACIAL_CYCLE_HOLD_MS = 5_000;
const DEBUG_BEACON_DELAY_MS = 1_200; // converged read (interpolation done)
const DEBUG_BEACON_LATE_DELAY_MS = 2_600; // overwrite check read
// ---------------------------------------------------------------------------

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

  // Enable the deterministic debug cycle (mouth-tuning pass).
  useEffect(() => {
    controller.setCycle(
      DEBUG_FACIAL_CYCLE ? DEBUG_IDLE_FACIAL_CYCLE : null,
      DEBUG_FACIAL_CYCLE_HOLD_MS,
    );
  }, [controller]);

  // DEV beacon: for every selected facial state, prove the mouth writes land
  // on the real mao_pro parameters. Reports the semantic state, mouth param
  // IDs, requested targets, actual runtime values, the param min/max (real
  // clamp bounds from the model API), a clamped flag, and a delayed read that
  // detects whether any later system overwrites the value. Reported via a URL
  // 404 that lands in the server access log. DEBUG ONLY — removed before
  // final release.
  const beaconStateRef = useRef<string | null>(null);
  const beaconTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = beaconTimersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      beaconStateRef.current = null;
    };
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
        // Debug beacon: on every state CHANGE, schedule a converged read plus a
        // delayed read (overwrite check).
        const state = active.snapshot().state;
        if (state && state !== beaconStateRef.current
          && typeof cubismModel.getParameterValueById === 'function') {
          beaconStateRef.current = state;
          const capturedState = state;
          const fire = (suffix: string) => {
            if (beaconStateRef.current !== capturedState) return; // moved on
            try {
              const target =
                IDLE_FACIAL_PALETTE.find((s) => s.id === capturedState)?.additive ?? {};
              const entries: string[] = [`s=${capturedState}`];
              // Mouth baselines from the idle motion (mtn_01..mtn_04):
              // MouthUp=1.0 constant, all other mouth params 0.
              const MOUTH_BASE: Record<string, number> = {
                MouthUp: 1.0,
                MouthDown: 0.0,
                MouthAngry: 0.0,
                MouthAngryLine: 0.0,
              };
              const MOUTH_KEY: Array<[string, keyof IdleFacialAdditive]> = [
                ['up', 'MouthUp'],
                ['dn', 'MouthDown'],
                ['an', 'MouthAngry'],
                ['ln', 'MouthAngryLine'],
              ];
              for (const [tag, paramKey] of MOUTH_KEY) {
                const handle = handles[paramKey];
                const idx = cubismModel.getParameterIndex(handle);
                const min = typeof cubismModel.getParameterMinimumValue === 'function'
                  ? cubismModel.getParameterMinimumValue(idx)
                  : NaN;
                const max = typeof cubismModel.getParameterMaximumValue === 'function'
                  ? cubismModel.getParameterMaximumValue(idx)
                  : NaN;
                const val = cubismModel.getParameterValueById(handle) ?? NaN;
                const tgt = (target[paramKey] as number | undefined) ?? 0;
                const base = MOUTH_BASE[paramKey];
                const desired = base + tgt;
                const clamped = Number.isFinite(desired) && Number.isFinite(val)
                  && Math.abs(val - desired) > 0.01;
                entries.push(
                  `${tag}_tgt=${tgt.toFixed(2)}`,
                  `${tag}_base=${base.toFixed(2)}`,
                  `${tag}_min=${Number.isFinite(min) ? min.toFixed(2) : 'na'}`,
                  `${tag}_max=${Number.isFinite(max) ? max.toFixed(2) : 'na'}`,
                  `${tag}_val=${Number.isFinite(val) ? val.toFixed(2) : 'na'}`,
                  `${tag}_clp=${clamped ? 1 : 0}`,
                );
              }
              const eyeFactor = Number.isFinite(active.snapshot().eyeOpen)
                ? active.snapshot().eyeOpen
                : 1.0;
              entries.push(`eo=${eyeFactor.toFixed(2)}`);
              const q = entries.join('&');
              fetch(`/__facial_beacon${suffix}?${q}`).catch(() => undefined);
            } catch {
              // beacon is best-effort only
            }
          };
          beaconTimersRef.current.push(
            setTimeout(() => fire(''), DEBUG_BEACON_DELAY_MS),
            setTimeout(() => fire('_late'), DEBUG_BEACON_LATE_DELAY_MS),
          );
        }
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