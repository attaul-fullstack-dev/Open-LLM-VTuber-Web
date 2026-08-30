/* eslint-disable no-underscore-dangle */
import {
  useCallback, useEffect, useRef,
} from 'react';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { CubismFramework } from '../../../WebSDK/Framework/src/live2dcubismframework';
import { setLive2DIdleFacialHook } from '../../../WebSDK/src/lapplive2dfacialhook';
import {
  IDLE_FACIAL_PALETTE,
  IdleFacialExpressionController,
  ZERO_FACIAL,
  type IdleFacialAdditive,
  type IdleFacialStateWeighted,
} from '@/utils/live2d-idle-facial';
import { responseFaceBus, decideResponseFace } from '@/utils/response-face-bus';
import { emoDiag } from '@/utils/emodiag';

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
 * Selection is pure weighted-random inside the controller (neutral/subtle-positive
 * dominate; negatives are rare). No new render loop / interval / network / LLM
 * call is created; event cadence is setTimeout-driven and interpolation rides the
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

// ---------------------------------------------------------------------------
// ------ TEMPORARY micro capability-test mode (mao_pro) — remove after test ---
//
// Drives ONE forced face at a time via the URL query param `?capface=`:
//   ?capface=  or absent  → normal Stage 3/4 behavior
//   ?capface=neutral      → force TRUE NEUTRAL 😐
//   ?capface=sad          → force CLEAR SAD 🙁
//   ?capface=angry        → force CLEAR ANGRY/cemberut 😡
//
// Values are ADDITIVE on top of the motion baseline. CRITICAL finding: the
// idle motion mtn_01 holds ParamMouthUp = 1.0 (its neutral mouth pose) AND
// the true max is 1.0, so a neutral face MUST counter that baseline with
// MouthUp = -1.0 or the mouth sits clamped at 1.0 and the face reads as a
// permanent smile. Each set below explicitly zeroes Cheek so switching off a
// blush face leaves no red-cheek residue.
//
// While a cap face is active the controller's autonomous idle face AND the
// Stage 4 contextual response face are fully bypassed (we never call
// controller.step()); the Stage 2 head/body/eye movement hook keeps running
// (separate hook). No network, no LLM, no polling — this is developer-only and
// deleted before final Stage 6.
// ---------------------------------------------------------------------------
export const TEMP_CAPABILITY_FACES: Record<
  string,
  { additive: Partial<IdleFacialAdditive>; eyeOpen: number }
> = {
  // TRUE NEUTRAL 😐 — counter the 1.0 MouthUp baseline to flatten the smile,
  // keep brows/eyes at neutral, explicitly clear blush residue.
  neutral: {
    additive: {
      MouthUp: -1.0,
      BrowLAngle: 0,
      BrowRAngle: 0,
      MouthDown: 0,
      MouthAngry: 0,
      MouthAngryLine: 0,
      Cheek: 0,
    },
    eyeOpen: 1.0,
  },
  // CLEAR SAD 🙁 — mouth downturn + sad brows (lifted inner via form/angle +
  // soft tired eyes). Mirror the rig's own exp_05 recipe (MouthUp -1, MouthDown
  // +1, brows angled/form -1) but kept within safe bounds.
  sad: {
    additive: {
      MouthUp: -1.0,
      MouthDown: 0.8,
      BrowLAngle: -0.8,
      BrowRAngle: -0.8,
      BrowLForm: -0.8,
      BrowRForm: -0.8,
      Cheek: 0,
    },
    eyeOpen: 0.92,
  },
  // CLEAR ANGRY/cemberut 😡 — follow the rig's own angry recipe (exp_08):
  // pout line full (MouthAngry + AngryLine), NO MouthDown (or it reads sad),
  // sharp angular eyes (EyeForm), furrowed lowered angry brows + narrowed eyes.
  angry: {
    additive: {
      MouthUp: -1.0,
      MouthAngry: 1.0,
      MouthAngryLine: 1.0,
      MouthDown: 0,
      BrowLAngle: -0.9,
      BrowRAngle: -0.9,
      BrowLForm: -0.9,
      BrowRForm: -0.9,
      EyeLForm: 1.0,
      EyeRForm: 1.0,
      Cheek: 0,
    },
    eyeOpen: 0.85,
  },
};

function readCapabilityFace(): keyof typeof TEMP_CAPABILITY_FACES | null {
  try {
    const param = new URLSearchParams(window.location.search).get('capface');
    if (param && Object.prototype.hasOwnProperty.call(TEMP_CAPABILITY_FACES, param)) {
      return param as keyof typeof TEMP_CAPABILITY_FACES;
    }
  } catch {
    // never break app startup
  }
  return null;
}

export function useLive2DIdleFacial({
  isDragging,
  isMotionPlaying,
}: UseLive2DIdleFacialOptions): Live2DIdleFacialApi {
  const { activityState } = useAvatarActivityState();

  // TEMPORARY capability-test: read `?capface=` once on reflect.
  const capFaceRef = useRef<keyof typeof TEMP_CAPABILITY_FACES | null>(readCapabilityFace());

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

  // Stage 4 — contextual response emotion → Stage 3 face, applied as a
  // TURN-LEVEL LATCH. A valid non-neutral emotion claims the face and KEEPS it
  // for the whole response turn; later sentences without emotion metadata
  // ('neutral' fallback) must NOT release it — they only refresh the safety
  // hold. Audio/text activity from the same response ALSO refreshes the
  // watchdog, so long TTS gaps between sentences of one turn never time it
  // out. Only `null` (real turn end / interruption / cancellation) releases
  // back to neutral + idle scheduling.
  useEffect(() => {
    return responseFaceBus.subscribe(({ faceId }) => {
      const active = controllerRef.current;
      if (!active) return;
      const snap = active.snapshot();
      const wasActive = active.isResponseFaceActive();
      const currentFace = wasActive ? (snap.state ?? null) : null;
      const decision = decideResponseFace(currentFace, faceId);
      emoDiag({ faceId, reason: `decision:${decision.kind}` });
      switch (decision.kind) {
        case 'keep':
          // Nothing latched and nothing to claim (e.g. fully neutral response).
          return;
        case 'release':
          // Real turn end / interruption / cancellation: release back to
          // neutral, letting Stage 3 idle scheduling resume normally.
          active.releaseResponseFace();
          emoDiag({ release: true, reason: 'release:turn_end' });
          return;
        case 'refresh':
          // No new emotion on this signal: keep the latch and refresh the
          // safety watchdog (heartbeat) so the face survives the response.
          active.refreshResponseFace();
          return;
        default: {
          const state = IDLE_FACIAL_PALETTE.find((s: IdleFacialStateWeighted) => s.id === decision.faceId);
          active.claimResponseFace(state ?? null);
          emoDiag({ claim: true, faceId: state ? state.id : null });
        }
      }
    });
  }, []);

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

      // TEMPORARY capability-test: when active, override the controller
      // entirely with ONE forced face (bypasses Stage 3 idle random AND the
      // Stage 4 contextual face). ZERO_FACIAL base + cap offsets guarantees
      // every owned param is written (Cheek=0 clears blush residue).
      const capFace = capFaceRef.current;
      let additive: IdleFacialAdditive;
      let eyeOpen: number;
      if (capFace && TEMP_CAPABILITY_FACES[capFace]) {
        additive = { ...ZERO_FACIAL, ...TEMP_CAPABILITY_FACES[capFace].additive };
        eyeOpen = TEMP_CAPABILITY_FACES[capFace].eyeOpen;
      } else {
        const stepped = active.step(deltaSeconds);
        additive = stepped.additive;
        eyeOpen = stepped.eyeOpen;
      }
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