import type { AvatarActivityState } from '@/utils/avatar-activity-controller';

/**
 * Mili Hidup Stage 3 — Autonomous idle facial micro-expressions.
 *
 * Framework-free pure controller (same discipline as Stage 2). It only decides
 * *what* very small facial contribution Mili should hold while conversationally
 * idle. The actual per-frame parameter writes live in the React adapter
 * (`use-live2d-idle-facial.ts`) which rides the existing Cubism render loop.
 *
 * Parameter ownership:
 * - Stage 3 owns FACIAL micro-expression parameters (brows, mouth shape,
 *   eye-smile, blush). It NEVER writes ParamA / ParamI/U/E/O (lip-sync),
 *   nor the Stage 2 movement parameters (ParamAngleX/Y/Z, ParamBodyAngleX,
 *   ParamEyeBallX/Y).
 * - EyeOpen is only ever a MULTIPLY (neutral = 1.0) so blink keeps working and
 *   Stage 3 never absolutely overwrites it.
 */

/** Every facial parameter Stage 3 may write additively. */
export type IdleFacialAdditive = {
  /** ParamBrowLY additive. */
  BrowLY: number;
  /** ParamBrowRY additive. */
  BrowRY: number;
  /** ParamBrowLAngle additive. */
  BrowLAngle: number;
  /** ParamBrowRAngle additive. */
  BrowRAngle: number;
  /** ParamBrowLForm additive. */
  BrowLForm: number;
  /** ParamBrowRForm additive. */
  BrowRForm: number;
  /** ParamMouthUp additive (corner up => smile). */
  MouthUp: number;
  /** ParamMouthDown additive (corner down). */
  MouthDown: number;
  /** ParamMouthAngry additive (pout). */
  MouthAngry: number;
  /** ParamMouthAngryLine additive (pout line). */
  MouthAngryLine: number;
  /** ParamEyeLSmile additive. */
  EyeLSmile: number;
  /** ParamEyeRSmile additive. */
  EyeRSmile: number;
  /** ParamEyeLForm additive (subtle). */
  EyeLForm: number;
  /** ParamEyeRForm additive (subtle). */
  EyeRForm: number;
  /** ParamCheek additive (blush). */
  Cheek: number;
};

/** Eye-open MULTIPLY factor (1.0 = neutral). Never an absolute value. */
export const NEUTRAL_EYE_OPEN = 1.0;

export const ZERO_FACIAL: IdleFacialAdditive = Object.freeze({
  BrowLY: 0,
  BrowRY: 0,
  BrowLAngle: 0,
  BrowRAngle: 0,
  BrowLForm: 0,
  BrowRForm: 0,
  MouthUp: 0,
  MouthDown: 0,
  MouthAngry: 0,
  MouthAngryLine: 0,
  EyeLSmile: 0,
  EyeRSmile: 0,
  EyeLForm: 0,
  EyeRForm: 0,
  Cheek: 0,
});

/**
 * Max additive magnitudes. Intentional subtle (micro-expression, not
 * exaggerated anime face). Values are conservative already-scaled offsets well
 * inside mao_pro's parameter range; CubismModel clamps the final value anyway.
 */
export const FACIAL_RANGES: Required<IdleFacialAdditive> = {
  BrowLY: 0.35,
  BrowRY: 0.35,
  BrowLAngle: 0.35,
  BrowRAngle: 0.35,
  BrowLForm: 0.35,
  BrowRForm: 0.35,
  MouthUp: 0.4,
  MouthDown: 0.3,
  MouthAngry: 0.35,
  MouthAngryLine: 0.3,
  EyeLSmile: 0.35,
  EyeRSmile: 0.35,
  EyeLForm: 0.25,
  EyeRForm: 0.25,
  Cheek: 0.35,
};

/** Semantic ambient facial state — a set of small offsets + optional eye factor. */
export interface IdleFacialState {
  id: string;
  /** Additive offsets per owned facial parameter. */
  additive: Partial<IdleFacialAdditive>;
  /** EyeOpen multiply target; 1.0 when not changing eye openness. */
  eyeOpen: number;
  /** Only selectable when activity === 'long_idle'. */
  longIdleOnly?: boolean;
}

/**
 * mao_pro ambient idle palette. Deliberately NO strong anger/sad/surprise/
 * shock — those are response-context emotions. All are subtle micro-expressions.
 */
// Idle motion mtn_01 holds ParamMouthUp at 1.0 (its neutral mouth pose), so
// tiny additive mouth offsets are invisible/clamped. These magnitudes are set
// clearly above that baseline so smile/pout read on-screen while still staying
// persona-appropriate (the rig clamps to its real min/max anyway).
export const IDLE_FACIAL_PALETTE: IdleFacialState[] = [
  { id: 'neutral', additive: {}, eyeOpen: NEUTRAL_EYE_OPEN },
  {
    id: 'small_smile',
    additive: {
      MouthUp: 0.7,
      EyeLSmile: 0.4,
      EyeRSmile: 0.4,
      BrowLY: 0.1,
      BrowRY: 0.1,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    id: 'mild_pout',
    additive: {
      MouthAngry: 0.55,
      MouthAngryLine: 0.5,
      MouthDown: 0.2,
      BrowLAngle: -0.18,
      BrowRAngle: -0.18,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    id: 'mildly_annoyed',
    additive: {
      MouthAngry: 0.7,
      MouthAngryLine: 0.65,
      BrowLAngle: -0.35,
      BrowRAngle: -0.35,
      BrowLY: -0.1,
      BrowRY: -0.1,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    id: 'curious_soft',
    additive: {
      BrowLForm: 0.3,
      BrowRForm: 0.3,
      BrowLY: 0.1,
      BrowRY: 0.1,
      EyeLForm: 0.12,
      EyeRForm: 0.12,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    id: 'relaxed',
    additive: {
      MouthUp: 0.3,
      BrowLY: -0.12,
      BrowRY: -0.12,
      EyeLSmile: 0.15,
      EyeRSmile: 0.15,
    },
    eyeOpen: 0.94,
  },
  {
    id: 'sleepy_soft',
    additive: {
      BrowLY: -0.2,
      BrowRY: -0.2,
      MouthDown: 0.25,
    },
    eyeOpen: 0.82,
    longIdleOnly: true,
  },
];

export type IdleFacialSuppressionKind = 'speaking' | 'drag' | 'motion';

/** Low-frequency event timing (ms), random per facial change. */
export interface IdleFacialTiming {
  idleMinMs: number;
  idleMaxMs: number;
  longIdleMinMs: number;
  longIdleMaxMs: number;
}

export const IDLE_FACIAL_TIMING: IdleFacialTiming = {
  idleMinMs: 4_000,
  idleMaxMs: 8_000,
  longIdleMinMs: 5_000,
  longIdleMaxMs: 10_000,
};

/** Cooldown after a suppression ends before facial idle resumes (ms). */
export const IDLE_FACIAL_COOLDOWN_MS = {
  speaking: 1_800,
  drag: 1_200,
  motion: 1_200,
};

export interface IdleFacialSnapshot {
  state: string | null;
  activity: AvatarActivityState;
  suppressed: { [K in IdleFacialSuppressionKind]: boolean };
  additive: IdleFacialAdditive;
  eyeOpen: number;
  holding: boolean;
}

export interface IdleFacialControllerOptions {
  rng?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  timing?: IdleFacialTiming;
  palette?: IdleFacialState[];
  smoothing?: number;
}

export class IdleFacialExpressionController {
  private readonly rng: () => number;

  private readonly schedule: (callback: () => void, delayMs: number) => unknown;

  private readonly cancel: (handle: unknown) => void;

  private readonly timing: IdleFacialTiming;

  private readonly palette: IdleFacialState[];

  private readonly smoothing: number;

  private activity: AvatarActivityState = 'active';

  private readonly suppressed: { [K in IdleFacialSuppressionKind]: boolean } = {
    speaking: false,
    drag: false,
    motion: false,
  };

  private current: IdleFacialAdditive = { ...ZERO_FACIAL };

  private target: IdleFacialAdditive = { ...ZERO_FACIAL };

  private currentEyeOpen = NEUTRAL_EYE_OPEN;

  private targetEyeOpen = NEUTRAL_EYE_OPEN;

  /** The semantic state id currently selected (null when neutral/suppressed). */
  private activeStateId: string | null = null;

  private changeTimer: unknown | null = null;

  private cooldownTimer: unknown | null = null;

  /** Anti-repeat: last selected semantic state ids. */
  private readonly recentStates: string[] = [];

  private lastSuppressionKind: IdleFacialSuppressionKind | null = null;

  private wasInactive = false;

  constructor(options: IdleFacialControllerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.timing = options.timing ?? IDLE_FACIAL_TIMING;
    this.palette = options.palette ?? IDLE_FACIAL_PALETTE;
    this.smoothing = options.smoothing ?? 0.35;
  }

  setActivity(state: AvatarActivityState): void {
    if (state === this.activity) return;
    this.activity = state;
    this.reconcileSchedule();
  }

  setSuppression(kind: IdleFacialSuppressionKind, suppressed: boolean): void {
    if (this.suppressed[kind] === suppressed) return;
    this.suppressed[kind] = suppressed;
    if (suppressed) this.lastSuppressionKind = kind;
    this.reconcileSchedule();
  }

  /** Advance one frame; returns current additive + eye factor. Call each frame. */
  step(deltaSeconds: number): { additive: IdleFacialAdditive; eyeOpen: number } {
    if (deltaSeconds > 0) {
      // Frame-time-aware smoothing toward the target so the fade rate is stable
      // regardless of refresh rate.
      const lambda = 3 * (deltaSeconds / (1 / 60));
      const t = 1 - Math.exp(-this.smoothing * lambda);
      for (const key of Object.keys(ZERO_FACIAL) as (keyof IdleFacialAdditive)[]) {
        this.current[key] = lerp(this.current[key], this.target[key], t);
      }
      this.currentEyeOpen = lerp(this.currentEyeOpen, this.targetEyeOpen, t);
    }
    return { additive: { ...this.current }, eyeOpen: this.currentEyeOpen };
  }

  snapshot(): IdleFacialSnapshot {
    return {
      state: this.activeStateId,
      activity: this.activity,
      suppressed: { ...this.suppressed },
      additive: { ...this.current },
      eyeOpen: this.currentEyeOpen,
      holding: this.activeStateId !== null,
    };
  }

  dispose(): void {
    this.clearChangeTimer();
    this.clearCooldownTimer();
    this.current = { ...ZERO_FACIAL };
    this.target = { ...ZERO_FACIAL };
    this.currentEyeOpen = NEUTRAL_EYE_OPEN;
    this.targetEyeOpen = NEUTRAL_EYE_OPEN;
    this.activeStateId = null;
    this.changeTimer = null;
    this.cooldownTimer = null;
  }

  private isSuppressed(): boolean {
    return this.suppressed.speaking || this.suppressed.drag || this.suppressed.motion;
  }

  private shouldBeActive(): boolean {
    return this.activity === 'idle' || this.activity === 'long_idle';
  }

  private reconcileSchedule(): void {
    const wantActive = this.shouldBeActive() && !this.isSuppressed();

    if (!wantActive) {
      this.wasInactive = true;
      this.clearChangeTimer();
      this.target = { ...ZERO_FACIAL };
      this.targetEyeOpen = NEUTRAL_EYE_OPEN;
      this.activeStateId = null;
      return;
    }

    if (this.wasInactive) {
      // Just became eligible: wait a calm cooldown before resuming.
      this.wasInactive = false;
      this.target = { ...ZERO_FACIAL };
      this.targetEyeOpen = NEUTRAL_EYE_OPEN;
      this.activeStateId = null;
      this.armResumeCooldown();
      return;
    }

    if (this.activeStateId === null) {
      this.armChange();
    }
  }

  private armResumeCooldown(): void {
    this.clearCooldownTimer();
    const base = this.pickResumeCooldownMs();
    this.cooldownTimer = this.schedule(() => {
      this.cooldownTimer = null;
      this.armChange();
    }, base);
  }

  private armChange(): void {
    this.clearChangeTimer();
    const { min, max } = this.activity === 'long_idle'
      ? { min: this.timing.longIdleMinMs, max: this.timing.longIdleMaxMs }
      : { min: this.timing.idleMinMs, max: this.timing.idleMaxMs };
    this.changeTimer = this.schedule(() => {
      this.changeTimer = null;
      if (this.isSuppressed() || !this.shouldBeActive()) return;
      this.applyRandomState();
    }, this.randBetween(min, max));
  }

  private applyRandomState(): void {
    const state = this.pickState();
    this.activeStateId = state.id;
    this.target = { ...ZERO_FACIAL, ...state.additive };
    this.targetEyeOpen = state.eyeOpen;
    // Schedule the next change (micro-expressions come and go).
    this.armChange();
  }

  private pickState(): IdleFacialState {
    const longIdle = this.activity === 'long_idle';
    const eligible = this.palette.filter((s) => (!s.longIdleOnly || longIdle));
    const notRecent = eligible.filter((s) => !this.recentStates.includes(s.id));
    const pool = notRecent.length > 0 ? notRecent : eligible;
    const index = Math.floor(this.rng() * pool.length) % pool.length;
    const choice = pool[index];
    this.rememberLast(choice.id);
    return choice;
  }

  private rememberLast(id: string): void {
    this.recentStates.push(id);
    if (this.recentStates.length > 3) this.recentStates.shift();
  }

  private randBetween(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.rng() * (max - min);
  }

  private pickResumeCooldownMs(): number {
    if (this.lastSuppressionKind === 'speaking') return IDLE_FACIAL_COOLDOWN_MS.speaking;
    if (this.lastSuppressionKind === 'drag') return IDLE_FACIAL_COOLDOWN_MS.drag;
    return IDLE_FACIAL_COOLDOWN_MS.motion;
  }

  private clearChangeTimer(): void {
    if (this.changeTimer !== null) {
      this.cancel(this.changeTimer);
      this.changeTimer = null;
    }
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer !== null) {
      this.cancel(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}