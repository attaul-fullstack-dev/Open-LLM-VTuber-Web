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
 * Max additive magnitudes — safe ceilings, NOT the micro-expression defaults.
 *
 * The idle motion (mtn_01..mtn_04) holds ParamMouthUp at 1.0 (its neutral
 * mouth pose), so smile offsets must stack far enough above that baseline to
 * be visible; the model's own expression presets (exp_05/exp_08) use full
 * ±1.0 mouth swings. CubismModel clamps the final value to the param's real
 * min/max anyway, so pushing toward the design range is safe.
 */
export const FACIAL_RANGES: Required<IdleFacialAdditive> = {
  BrowLY: 0.5,
  BrowRY: 0.5,
  BrowLAngle: 0.6,
  BrowRAngle: 0.6,
  BrowLForm: 0.4,
  BrowRForm: 0.4,
  MouthUp: 1.0,
  MouthDown: 0.5,
  MouthAngry: 1.0,
  MouthAngryLine: 1.0,
  EyeLSmile: 1.0,
  EyeRSmile: 1.0,
  EyeLForm: 0.4,
  EyeRForm: 0.4,
  Cheek: 0.7,
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
 * mao_pro ambient idle palette. Rich enough to sell emotion on a phone screen.
 *
 * Design rule (drawn from the rig's own presets): on mao_pro the ONE thing that
 * separates ANGRY from SAD is the mouth:
 *   - angry  = ParamMouthAngry + ParamMouthAngryLine (pout/frown line), corners
 *              do NOT droop.
 *   - sad    = ParamMouthDown (corners pulled DOWN) + mouth corners down.
 * So angry states must NOT use MouthDown (that instantly reads sad), and sad
 * states must NOT use MouthAngry. Brows sharpen (lower + furrow) for anger and
 * relax upward for sadness.
 *
 * Idle motion mtn_01..mtn_04 holds ParamMouthUp at 1.0 (neutral mouth pose), so
 * mouth offsets must be comfortably above that baseline to be visible; the rig
 * clamps final values to real min/max anyway.
 */
export const IDLE_FACIAL_PALETTE: IdleFacialState[] = [
  // ---------- reset / calm ----------
  { id: 'neutral', additive: {}, eyeOpen: NEUTRAL_EYE_OPEN },
  {
    id: 'relaxed',
    additive: {
      MouthUp: 0.25,
      BrowLY: -0.1,
      BrowRY: -0.1,
      EyeLSmile: 0.2,
      EyeRSmile: 0.2,
    },
    eyeOpen: 0.94,
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
  // ---------- smile ladder ----------
  {
    id: 'small_smile',
    additive: {
      MouthUp: 0.5,
      EyeLSmile: 0.45,
      EyeRSmile: 0.45,
      BrowLY: 0.15,
      BrowRY: 0.15,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    // NEW: squinted pleased/mischievous smile — narrowed happy eyes + wide
    // smile + blush. Cute, not threatening (brows stay soft, mouth is a smile).
    id: 'squint_smile',
    additive: {
      MouthUp: 0.8,
      EyeLSmile: 0.85,
      EyeRSmile: 0.85,
      EyeLForm: 0.2,
      EyeRForm: 0.2,
      BrowLY: 0.1,
      BrowRY: 0.1,
      Cheek: 0.5,
    },
    eyeOpen: 0.82,
  },
  {
    // Widest smile the rig allows: full corner-up (stacking on mtn_01 MouthUp
    // baseline), full eye-smile like exp_02/exp_04, sparkle-eye open (×1.15).
    id: 'big_smile',
    additive: {
      MouthUp: 1.0,
      EyeLSmile: 0.9,
      EyeRSmile: 0.9,
      EyeLForm: 0.25,
      EyeRForm: 0.25,
      BrowLY: 0.3,
      BrowRY: 0.3,
      Cheek: 0.6,
    },
    eyeOpen: 1.15,
  },
  // ---------- negative ladder (sad -> pout -> angry) ----------
  {
    // NEW: light murmur / soft sad. The negative-states' tail (MouthDown droop)
    // previously read as this; made deliberate, subtle, clearly not exhausted.
    id: 'sad_soft',
    additive: {
      MouthDown: 0.5,
      MouthUp: -0.4,
      BrowLY: -0.15,
      BrowRY: -0.15,
      BrowLAngle: -0.2,
      BrowRAngle: -0.2,
      EyeLForm: 0.12,
      EyeRForm: 0.12,
    },
    eyeOpen: 0.96,
  },
  {
    // Light pout: soft MouthAngry line, brows neutral. Clearly distinct from
    // sad_soft (no MouthDown droop) and from angry_pout (lighter mouth + no
    // furrow).
    id: 'pout_small',
    additive: {
      MouthAngry: 0.5,
      MouthAngryLine: 0.5,
      MouthUp: -0.2,
      BrowLAngle: -0.3,
      BrowRAngle: -0.3,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    // Angry pout (stronger than pout_small, definitely NOT sad). No MouthDown
    // (that would read sad). Instead: full pout line + furrowed, lowered sharp
    // brows + slightly narrowed eyes = unmistakable annoyed/ngambek.
    id: 'angry_pout',
    additive: {
      MouthAngry: 1.0,
      MouthAngryLine: 1.0,
      MouthUp: -0.4,
      BrowLAngle: -0.6,
      BrowRAngle: -0.6,
      BrowLForm: -0.5,
      BrowRForm: -0.5,
      BrowLY: -0.1,
      BrowRY: -0.1,
      EyeLForm: 0.15,
      EyeRForm: 0.15,
    },
    eyeOpen: 0.97,
  },
  {
    id: 'sleepy_soft',
    additive: {
      BrowLY: -0.25,
      BrowRY: -0.25,
      MouthUp: 0.15,
      MouthDown: 0.15,
      EyeLSmile: 0.15,
      EyeRSmile: 0.15,
    },
    eyeOpen: 0.8,
    longIdleOnly: true,
  },
];

/**
 * Temporary debug visual cycle (revision pass): walks the emotion arc from
 * murung -> netral -> senyum lebar so each state is natural to inspect on
 * Android. Debug-only — REMOVE before final release; production uses the
 * random anti-repeat palette.
 */
export const DEBUG_IDLE_FACIAL_CYCLE: string[] = [
  'sad_soft',
  'pout_small',
  'angry_pout',
  'neutral',
  'relaxed',
  'small_smile',
  'squint_smile',
  'big_smile',
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
  /** Debug: when non-empty, walk these state ids in order instead of random. */
  cycle?: string[] | null;
  /** Debug: how long each cycle state is held (ms). */
  cycleHoldMs?: number;
}

export class IdleFacialExpressionController {
  private readonly rng: () => number;

  private readonly schedule: (callback: () => void, delayMs: number) => unknown;

  private readonly cancel: (handle: unknown) => void;

  private readonly timing: IdleFacialTiming;

  private readonly palette: IdleFacialState[];

  private readonly smoothing: number;

  private cycle: string[] | null;

  private cycleHoldMs: number;

  private cycleIndex = 0;

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
    this.cycle = options.cycle ?? null;
    this.cycleHoldMs = options.cycleHoldMs ?? 5_000;
  }

  /**
   * Toggle debug cycle mode. When a non-empty list is given the controller
   * stops random selection and walks the listed state ids in order, holding
   * each `holdMs`. Pass `null` to return to weighted random behavior.
   */
  setCycle(cycle: string[] | null, holdMs?: number): void {
    this.cycle = cycle;
    if (holdMs !== undefined) this.cycleHoldMs = holdMs;
    this.cycleIndex = 0;
    if (cycle && cycle.length > 0) {
      // Start cycling immediately if eligible (debug: bypasses longIdleOnly).
      this.clearChangeTimer();
      if (this.shouldBeActive() && !this.isSuppressed()) {
        this.applyNextState();
      } else {
        this.target = { ...ZERO_FACIAL };
        this.targetEyeOpen = NEUTRAL_EYE_OPEN;
        this.activeStateId = null;
      }
    } else {
      this.reconcileSchedule();
    }
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
    const delayMs = this.cycle && this.cycle.length > 0
      ? this.cycleHoldMs
      : (() => {
        const { min, max } = this.activity === 'long_idle'
          ? { min: this.timing.longIdleMinMs, max: this.timing.longIdleMaxMs }
          : { min: this.timing.idleMinMs, max: this.timing.idleMaxMs };
        return this.randBetween(min, max);
      })();
    this.changeTimer = this.schedule(() => {
      this.changeTimer = null;
      if (this.isSuppressed() || !this.shouldBeActive()) return;
      this.applyNextState();
    }, delayMs);
  }

  private applyNextState(): void {
    const state = this.cycle && this.cycle.length > 0
      ? this.pickCycleState()
      : this.pickState();
    this.activeStateId = state.id;
    this.target = { ...ZERO_FACIAL, ...state.additive };
    this.targetEyeOpen = state.eyeOpen;
    // Schedule the next change (micro-expressions come and go).
    this.armChange();
  }

  private pickCycleState(): IdleFacialState {
    const ids = this.cycle!;
    const id = ids[this.cycleIndex % ids.length];
    this.cycleIndex += 1;
    const state = this.palette.find((s) => s.id === id) ?? this.palette[0];
    this.rememberLast(state.id);
    return state;
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