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
 * mao_pro ambient idle palette — FINAL production set.
 *
 * Live beacon findings that shaped this palette:
 *   - ParamMouthUp is already pinned at 1.0 by idle motion mtn_01 AND its real
 *     max is 1.0, so ANY positive mouth-corner offset is CLAMPED (val=1.0
 *     for small_smile / squint_smile / big_smile). The mouth literally cannot
 *     open wider than neutral → smiles must be sold by EYES + CHEEK, never by
 *     raising the mouth. big_smile therefore looks identical to small_smile on
 *     the mouth axis and was REMOVED from production.
 *   - MouthDown / MouthAngry / MouthAngryLine are NOT clamped and reach the rig
 *     intact, so the negative side has full power.
 *   - On mao_pro the ONE thing that separates ANGRY from SAD is the mouth:
 *       angry = ParamMouthAngry + ParamMouthAngryLine (pout line), corners do
 *               NOT droop (no MouthDown, or it reads sad).
 *       sad   = ParamMouthDown (corners pulled down).
 *
 * Emotion construction per state (mouth + brows + eyes stay in sync):
 *   - sad_soft   : moved by BROWS (lifted inner) + EYES + mild mouth droop.
 *   - pout_small : moved by the MOUTH only (pout line), brows/eyes near neutral.
 *   - angry_pout : full pout line + furrowed lowered sharp brows + narrowed eyes.
 *   - smiles     : EyeSmile + Cheek (+ narrow eyes for squint); the mouth sits
 *                  at its pinned 1.0 baseline and adds nothing.
 *
 * `weight` = relative selection probability; `longIdleWeight` (if set) overrides
 * `weight` while the avatar is in long_idle. Weights intentionally favor calm,
 * subtly-positive faces: negative states are rare so Mili is not constantly
 * emotional.
 */
export interface IdleFacialStateWeighted extends IdleFacialState {
  /** Relative selection probability while idle (higher = more common). */
  weight: number;
  /** Optional probability override while in long_idle. */
  longIdleWeight?: number;
}

export const IDLE_FACIAL_PALETTE: IdleFacialStateWeighted[] = [
  // ---------- reset ----------
  // TRUE NEUTRAL (live verified). The idle motion mtn_01 holds ParamMouthUp =
  // 1.0 (its neutral mouth pose) and the true max is 1.0, so an additive 0
  // leaves the mouth clamped at 1.0 = permanent smile (this caused the old
  // "neutral still smiles" bug). Actively counter the baseline with MouthUp
  // -1.0 to flatten it. Brows/eyes stay neutral and Cheek is 0 (no dynamic
  // blush; the residual pink is base model ART, not a runtime residue).
  // Never reads as sad because MouthDown/Angry stay 0.
  {
    id: 'neutral',
    weight: 30,
    additive: {
      MouthUp: -1.0,
      MouthDown: 0,
      MouthAngry: 0,
      MouthAngryLine: 0,
      Cheek: 0,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  // ---------- subtle positive ----------
  {
    id: 'small_smile',
    weight: 22,
    additive: {
      EyeLSmile: 0.45,
      EyeRSmile: 0.45,
      Cheek: 0.45,
      BrowLY: 0.12,
      BrowRY: 0.12,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    // Squinted pleased/mischievous smile: narrowed happy eyes + eye-smile +
    // blush. The mouth stays at its pinned 1.0 baseline; the distinct look is
    // carried by the eyes (EyeOpen multiply ×0.82) — cute, not threatening.
    id: 'squint_smile',
    weight: 13,
    longIdleWeight: 9,
    additive: {
      EyeLSmile: 0.85,
      EyeRSmile: 0.85,
      EyeLForm: 0.2,
      EyeRForm: 0.2,
      BrowLY: 0.08,
      BrowRY: 0.08,
      Cheek: 0.5,
    },
    eyeOpen: 0.82,
  },
  // ---------- negative ladder (sad -> pout -> angry) ----------
  {
    // Murung / soft sad — live capability-tested. Emotion driven by BROWS
    // (angled/form) + softened eyes + a clear mouth downturn, AND counter the
    // mtn_01 MouthUp smile baseline (MouthUp -1.0) plus MouthDown 0.8 so it
    // reads unmistakably sad, not neutral. No dynamic blush. Immediately
    // distinguishable from neutral on a phone screen.
    id: 'sad_soft',
    weight: 7,
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
  {
    // Cemberut kecil / ngambek. Primarily MOUTH-driven: a clear downward curve
    // (MouthUp -0.6) + a distinct pout line (MouthAngry/Line 0.7). MouthDown
    // stays 0 so it reads ngambek, NOT sad. Brows/eyes near neutral so the
    // emotion clearly comes from the pouting mouth.
    id: 'pout_small',
    weight: 13,
    longIdleWeight: 10,
    additive: {
      MouthAngry: 0.7,
      MouthAngryLine: 0.7,
      MouthUp: -0.6,
      MouthDown: 0,
      BrowLAngle: -0.05,
      BrowRAngle: -0.05,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  {
    // Clearly more annoyed / marah kecil than pout_small; definitely NOT sad.
    // Follows the rig's own angry recipe (exp_08): full frown line (MouthUp
    // -1), MouthAngry + MouthAngryLine full, and SHARP angular eyes (EyeForm
    // 1.0 — the rig's prime anger cue we previously set far too low). On top:
    // furrowed lowered inward brows + narrowed eyes (×0.85). MouthDown = 0 so
    // it reads 😡/kesal, never 😔.
    id: 'angry_pout',
    weight: 7,
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
  // ---------- high-intensity contextual only (weight 0 = never random idle) ----------
  {
    // MUCH stronger than angry_pout: full serious anger 😡. Stacks every proven
    // anger cue toward its safe extreme WITHOUT MouthDown (so it never reads as
    // sad). Sharper/narrower eyes than angry_pout (eyeOpen ×0.78 vs ×0.85) plus
    // maximally furrowed, lowered-inward brows (brow angle/form -1.0). The mouth
    // is already at its capped extreme (MouthAngry/AngryLine 1.0, MouthUp -1),
    // so the extra intensity comes from eyes + brows. Cheek stays 0 (flushed
    // cheeks with these brows reads as shy, not furious). Not in autonomous idle.
    id: 'angry_strong',
    weight: 0,
    additive: {
      MouthUp: -1.0,
      MouthAngry: 1.0,
      MouthAngryLine: 1.0,
      MouthDown: 0,
      BrowLAngle: -1.0,
      BrowRAngle: -1.0,
      BrowLForm: -1.0,
      BrowRForm: -1.0,
      EyeLForm: 1.0,
      EyeRForm: 1.0,
      Cheek: 0,
    },
    eyeOpen: 0.78,
  },
  {
    // Visibly flustered / embarrassed 😳. The rig's own shy recipe (exp_06)
    // drives Cheek to its true max (1.0) — far stronger than the subtle blush
    // on small_smile (0.45) / squint_smile (0.5). Keeps a small uneasy smile
    // (EyeSmile + slight MouthUp counter so it is shy, not yelling), slightly
    // lifted brows, and normally-open eyes. MouthDown/Angry stay 0 so it never
    // veers into sad or angry. Not in autonomous idle.
    id: 'strong_blush',
    weight: 0,
    additive: {
      Cheek: 1.0,
      MouthUp: -0.5,
      MouthDown: 0,
      MouthAngry: 0,
      MouthAngryLine: 0,
      EyeLSmile: 0.35,
      EyeRSmile: 0.35,
      BrowLY: 0.2,
      BrowRY: 0.2,
    },
    eyeOpen: NEUTRAL_EYE_OPEN,
  },
  // ---------- long_idle only ----------
  {
    // Calm sleepy-soft. Mainly a gentle EyeOpen ×0.78 with relaxed brows and a
    // barely-there mouth; never a closed-eye lock.
    id: 'sleepy_soft',
    weight: 0,
    longIdleWeight: 22,
    additive: {
      BrowLY: -0.2,
      BrowRY: -0.2,
      EyeLSmile: 0.18,
      EyeRSmile: 0.18,
    },
    eyeOpen: 0.78,
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

/**
 * Stage 4 — safety-net fallback window for a contextual response face.
 *
 * This is NOT the primary lifetime: normal release authority is real turn
 * completion (`playback_complete` / interruption / cancellation → `null`), and
 * the watchdog is REFRESHED on every response activity (audio start/end, text
 * segments, subsequent sentence publishes), so a healthy turn never times out.
 *
 * 6s was proven too short live (a long TTS gap between two sentences of the
 * SAME turn exceeded it and released the face mid-response). 20s only fires
 * for a genuinely stuck lifecycle (no activity at all for 20s).
 */
export const RESPONSE_FACE_HOLD_MS = 20_000;

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
  palette?: IdleFacialStateWeighted[];
  smoothing?: number;
}

export class IdleFacialExpressionController {
  private readonly rng: () => number;

  private readonly schedule: (callback: () => void, delayMs: number) => unknown;

  private readonly cancel: (handle: unknown) => void;

  private readonly timing: IdleFacialTiming;

  private readonly palette: IdleFacialStateWeighted[];

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

  /** Stage 4 — contextual response face currently owning the face (nullable). */
  private responseFace: IdleFacialStateWeighted | null = null;

  private responseFaceTimer: unknown | null = null;

  /** Semantic id exposed while a response face is active (snapshot). */
  private responseFaceId: string | null = null;

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

  /**
   * Stage 4 — claim the face for a contextual response emotion. The given face
   * owns the facial contribution until released, INCLUDING while 'speaking'
   * (where autonomous idle faces are legitimately suppressed). Calling with
   * `null` releases back to neutral + normal idle scheduling.
   */
  claimResponseFace(
    state: IdleFacialStateWeighted | null,
    holdMs: number = RESPONSE_FACE_HOLD_MS,
  ): void {
    this.clearChangeTimer();
    this.clearCooldownTimer();
    this.clearResponseTimer();
    this.responseFace = state;
    this.responseFaceId = state ? state.id : null;
    this.activeStateId = state ? state.id : null;
    if (state) {
      this.target = { ...ZERO_FACIAL, ...state.additive };
      this.targetEyeOpen = state.eyeOpen;
      this.armResponseTimer(state.id, holdMs);
    } else {
      this.releaseResponseFace();
    }
  }

  /**
   * Stage 4 — watchdog heartbeat. Refreshes the safety hold WITHOUT touching
   * the latched face or its targets, so continued response activity (audio
   * start/end, text segments, unmarked sentence publishes) proves the turn is
   * alive and the face survives long TTS gaps between sentences. No-op when no
   * response face is currently latched.
   */
  refreshResponseFace(holdMs: number = RESPONSE_FACE_HOLD_MS): void {
    if (this.responseFace === null) return;
    this.armResponseTimer(this.responseFaceId ?? 'unknown', holdMs);
  }

  private armResponseTimer(_stateId: string, holdMs: number): void {
    this.clearResponseTimer();
    this.responseFaceTimer = this.schedule(() => {
      this.responseFaceTimer = null;
      this.releaseResponseFace();
    }, holdMs);
  }

  /**
   * Stage 4 — release the contextual response face. Returns the facial
   * contribution smoothly to neutral, then lets Stage 3 idle scheduling resume.
   */
  releaseResponseFace(graceMs: number = IDLE_FACIAL_COOLDOWN_MS.speaking): void {
    this.clearResponseTimer();
    this.responseFace = null;
    this.responseFaceId = null;
    this.target = { ...ZERO_FACIAL };
    this.targetEyeOpen = NEUTRAL_EYE_OPEN;
    this.activeStateId = null;
    this.wasInactive = true;
    this.reconcileSchedule();
  }

  /** True while a Stage 4 contextual response face owns the contribution. */
  isResponseFaceActive(): boolean {
    return this.responseFace !== null;
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
    this.clearResponseTimer();
    this.current = { ...ZERO_FACIAL };
    this.target = { ...ZERO_FACIAL };
    this.currentEyeOpen = NEUTRAL_EYE_OPEN;
    this.targetEyeOpen = NEUTRAL_EYE_OPEN;
    this.activeStateId = null;
    this.responseFace = null;
    this.responseFaceId = null;
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
    // A Stage 4 response face owns the facial target until released; activity
    // and suppression changes (e.g. speaking starting) must not clear it.
    if (this.responseFace) return;
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
    const delayMs = this.randBetween(min, max);
    this.changeTimer = this.schedule(() => {
      this.changeTimer = null;
      if (this.isSuppressed() || !this.shouldBeActive()) return;
      if (this.responseFace) return; // Stage 4 response owns the face
      this.applyNextState();
    }, delayMs);
  }

  private applyNextState(): void {
    const state = this.pickState();
    this.activeStateId = state.id;
    this.target = { ...ZERO_FACIAL, ...state.additive };
    this.targetEyeOpen = state.eyeOpen;
    // Schedule the next change (micro-expressions come and go).
    this.armChange();
  }

  private pickState(): IdleFacialStateWeighted {
    const longIdle = this.activity === 'long_idle';
    const eligible = this.palette.filter((s) => (!s.longIdleOnly || longIdle));
    const notRecent = eligible.filter((s) => !this.recentStates.includes(s.id));
    const pool = notRecent.length > 0 ? notRecent : eligible;
    const choice = this.pickWeighted(pool, longIdle);
    this.rememberLast(choice.id);
    return choice;
  }

  private pickWeighted(pool: IdleFacialStateWeighted[], longIdle: boolean): IdleFacialStateWeighted {
    let total = 0;
    for (const s of pool) {
      const w = longIdle ? (s.longIdleWeight ?? s.weight) : s.weight;
      if (w > 0) total += w;
    }
    if (total <= 0) return pool[0];
    let r = this.rng() * total;
    for (const s of pool) {
      const w = longIdle ? (s.longIdleWeight ?? s.weight) : s.weight;
      if (w > 0) {
        r -= w;
        if (r < 0) return s;
      }
    }
    return pool[pool.length - 1];
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

  private clearResponseTimer(): void {
    if (this.responseFaceTimer !== null) {
      this.cancel(this.responseFaceTimer);
      this.responseFaceTimer = null;
    }
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}