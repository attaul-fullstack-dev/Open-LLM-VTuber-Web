import type { AvatarActivityState } from '@/utils/avatar-activity-controller';

/**
 * Stage 2 — Safe autonomous Live2D idle movement.
 *
 * This module is deliberately framework-free and pure so it can be tested with
 * injected randomness, a fake clock and fake timers. It only decides *what*
 * small additive offset Mili should hold on her head/body/eyes while she is
 * conversationally idle. The actual per-frame parameter write lives in the
 * React adapter (`use-live2d-idle-behavior.ts`) which rides the existing Cubism
 * render loop; this controller never touches a browser timer or a parameter.
 */

export interface IdleOffsetAdditive {
  /** ParamAngleX additive (degrees). */
  AngleX: number;
  /** ParamAngleY additive (degrees). */
  AngleY: number;
  /** ParamAngleZ additive (degrees). */
  AngleZ: number;
  /** ParamBodyAngleX additive (degrees). */
  BodyAngleX: number;
  /** ParamEyeBallX additive (unit -1..1). */
  EyeBallX: number;
  /** ParamEyeBallY additive (unit -1..1). */
  EyeBallY: number;
}

export const ZERO_OFFSET: IdleOffsetAdditive = Object.freeze({
  AngleX: 0,
  AngleY: 0,
  AngleZ: 0,
  BodyAngleX: 0,
  EyeBallX: 0,
  EyeBallY: 0,
});

/**
 * Additive magnitudes the model can withstand without looking like a joystick.
 * For mao_pro these are well inside the parameter's min/max: Angle ±30 deg,
 * BodyAngle ±10 deg, EyeBall ±1. Kept additive so breathing / drag / motion /
 * expression all continue under them. The CubismModel clamps the final value
 * anyway, so even a hard drag cannot push the parameter past its range.
 */
export const IDLE_OFFSET_RANGES: Required<IdleOffsetAdditive> = {
  // Deliberately lively: big enough to be clearly visible on a phone, still
  // well inside mao_pro's parameter ranges (Angle ±30, BodyAngle ±10, Eye ±1).
  AngleX: 16,
  AngleY: 10,
  AngleZ: 14,
  BodyAngleX: 3.5,
  EyeBallX: 0.5,
  EyeBallY: 0.5,
};

export type IdleSuppressionKind = 'speaking' | 'drag' | 'motion';

/** Timing ranges (ms) that are randomized per idle event and start points only. */
export interface IdleTiming {
  quietMinMs: number;
  quietMaxMs: number;
  transitionMinMs: number;
  transitionMaxMs: number;
  holdMinMs: number;
  holdMaxMs: number;
  releaseMinMs: number;
  releaseMaxMs: number;
}

export const IDLE_TIMING: Record<'idle' | 'long_idle', IdleTiming> = {
  idle: {
    quietMinMs: 4_000,
    quietMaxMs: 10_000,
    transitionMinMs: 400,
    transitionMaxMs: 1_200,
    holdMinMs: 500,
    holdMaxMs: 2_000,
    releaseMinMs: 800,
    releaseMaxMs: 1_400,
  },
  long_idle: {
    quietMinMs: 7_000,
    quietMaxMs: 16_000,
    transitionMinMs: 700,
    transitionMaxMs: 1_500,
    holdMinMs: 1_000,
    holdMaxMs: 3_000,
    releaseMinMs: 1_000,
    releaseMaxMs: 1_600,
  },
};

/** Cooldown after a suppression ends before autonomous movement resumes (ms). */
export const IDLE_SUPPRESSION_COOLDOWN_MS = {
  speechEnd: 2_500,
  dragEnd: 1_500,
  motionEnd: 1_500,
};

type IdlePhase = 'disabled' | 'quiet' | 'moving' | 'holding' | 'releasing';

/** A discrete, bounded movement primitive for Mili's face/head/body. */
export interface IdleAction {
  id: string;
  /** Unit-direction target per affected parameter (multiplied by intensity). */
  target: Partial<IdleOffsetAdditive>;
}

/**
 * Small palette of safe, low-energy movements. Every entry is additive and tiny.
 * `id` doubles as the anti-repetition key so `head_left, head_left` is unlikely.
 */
export const IDLE_ACTIONS: IdleAction[] = [
  // Whole-silhouette turns (head + body + eyes together) so the movement reads
  // clearly; anti-repetition still prevents mechanical left-right-left cycles.
  { id: 'look_left', target: { AngleX: 1, BodyAngleX: 1, EyeBallX: 1 } },
  { id: 'look_right', target: { AngleX: -1, BodyAngleX: -1, EyeBallX: -1 } },
  { id: 'tilt_left', target: { AngleZ: 1, AngleY: 0.3, EyeBallY: 0.4 } },
  { id: 'tilt_right', target: { AngleZ: -1, AngleY: 0.3, EyeBallY: 0.4 } },
  { id: 'look_up', target: { AngleY: 1, EyeBallY: 1, BodyAngleX: 0.5 } },
  { id: 'look_down', target: { AngleY: -1, EyeBallY: -1 } },
  { id: 'glance_left', target: { EyeBallX: 1, AngleX: 0.6 } },
  { id: 'glance_right', target: { EyeBallX: -1, AngleX: -0.6 } },
  { id: 'glance_up', target: { EyeBallY: 1, AngleY: 0.4 } },
  { id: 'glance_down', target: { EyeBallY: -1, AngleY: -0.4 } },
  { id: 'body_lean_left', target: { BodyAngleX: 1, AngleX: 0.5, AngleZ: 0.25 } },
  { id: 'body_lean_right', target: { BodyAngleX: -1, AngleX: -0.5, AngleZ: -0.25 } },
];

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export interface Live2DIdleOffsetControllerOptions {
  rng?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  timing?: Record<'idle' | 'long_idle', IdleTiming>;
  actions?: IdleAction[];
  ranges?: IdleOffsetAdditive;
  antiRepeatCount?: number;
}

export interface IdleOffsetSnapshot {
  phase: IdlePhase;
  activity: AvatarActivityState;
  suppressed: { [K in IdleSuppressionKind]: boolean };
  current: IdleOffsetAdditive;
  target: IdleOffsetAdditive;
  quietScheduled: boolean;
  lastAction: string | null;
}

interface PendingEvent {
  kind: 'moving' | 'releasing';
  originalTarget: IdleOffsetAdditive;
  /** Hold duration (ms) chosen when the action was picked (moving only). */
  holdMs?: number;
}

export class Live2DIdleOffsetController {
  private readonly rng: () => number;

  private readonly schedule: (callback: () => void, delayMs: number) => unknown;

  private readonly cancel: (handle: unknown) => void;

  private readonly timing: Record<'idle' | 'long_idle', IdleTiming>;

  private readonly actions: IdleAction[];

  private readonly ranges: IdleOffsetAdditive;

  private readonly antiRepeatCount: number;

  private phase: IdlePhase = 'disabled';

  private activity: AvatarActivityState = 'active';

  private readonly suppressed: { [K in IdleSuppressionKind]: boolean } = {
    speaking: false,
    drag: false,
    motion: false,
  };

  private current: IdleOffsetAdditive = { ...ZERO_OFFSET };

  private target: IdleOffsetAdditive = { ...ZERO_OFFSET };

  private phaseElapsedMs = 0;

  private phaseDurationMs = 0;

  private pending: PendingEvent | null = null;

  private quietTimer: unknown | null = null;

  private cooldownTimer: unknown | null = null;

  private readonly recentActions: string[] = [];

  private lastAction: string | null = null;

  /** Whether the last reconcile produced an active (moving-eligible) state. */
  private wasInactive = false;

  /** Which suppression was most recently armed (used to pick resume cooldown). */
  private lastSuppressionKind: IdleSuppressionKind | null = null;

  constructor(options: Live2DIdleOffsetControllerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.timing = options.timing ?? IDLE_TIMING;
    this.actions = options.actions ?? IDLE_ACTIONS;
    this.ranges = { ...ZERO_OFFSET, ...(options.ranges ?? IDLE_OFFSET_RANGES) };
    this.antiRepeatCount = options.antiRepeatCount ?? 2;
  }

  setActivity(state: AvatarActivityState): void {
    if (state === this.activity) return;
    this.activity = state;
    this.reconcileSchedule();
  }

  setSuppression(kind: IdleSuppressionKind, suppressed: boolean): void {
    if (this.suppressed[kind] === suppressed) return;
    this.suppressed[kind] = suppressed;
    if (suppressed) {
      this.lastSuppressionKind = kind;
    }
    this.reconcileSchedule();
  }

  /**
   * Advance one frame and return the current additive offset. Call from the
   * render loop only; interpolation is deterministic per `deltaSeconds`.
   */
  step(deltaSeconds: number): IdleOffsetAdditive {
    const deltaMs = Math.max(0, deltaSeconds * 1000);
    this.advancePhase(deltaMs);
    return this.current;
  }

  /** Read-only for tests / debug logging. */
  snapshot(): IdleOffsetSnapshot {
    return {
      phase: this.phase,
      activity: this.activity,
      suppressed: { ...this.suppressed },
      current: { ...this.current },
      target: { ...this.target },
      quietScheduled: this.quietTimer !== null,
      lastAction: this.lastAction,
    };
  }

  /** Tie off the current autonomous behavior; cancel timers and reset to neutral. */
  dispose(): void {
    this.clearQuietTimer();
    this.clearCooldownTimer();
    // Hard, safe reset: no more autonomous offset may be applied after teardown
    // or a model switch to a different character/model.
    this.phase = 'disabled';
    this.pending = null;
    this.current = { ...ZERO_OFFSET };
    this.target = { ...ZERO_OFFSET };
    this.quietTimer = null;
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
      this.clearQuietTimer();
      if (this.phase === 'moving' || this.phase === 'holding') {
        // Smoothly return to neutral instead of snapping.
        this.startRelease(true);
      } else if (this.phase !== 'releasing') {
        this.phase = 'disabled';
        this.current = { ...ZERO_OFFSET };
        this.target = { ...ZERO_OFFSET };
      }
      return;
    }

    // Autonomous movement just became eligible again: reset cleanly and wait a
    // calm cooldown so nothing snaps (e.g. the instant speech ends).
    if (this.wasInactive) {
      this.wasInactive = false;
      this.phase = 'disabled';
      this.pending = null;
      this.current = { ...ZERO_OFFSET };
      this.target = { ...ZERO_OFFSET };
      this.armResumeCooldown();
      return;
    }

    if (this.phase === 'disabled') {
      this.enterQuiet();
    } else if (this.phase === 'releasing' && this.pending === null) {
      // Finished a defensive release; wait quietly rather than resuming mid-touch.
      this.enterQuiet();
    }
  }

  private armResumeCooldown(): void {
    this.clearCooldownTimer();
    const base = this.pickResumeCooldownMs();
    this.cooldownTimer = this.schedule(() => {
      this.cooldownTimer = null;
      this.enterQuiet();
    }, base);
  }

  private enterQuiet(): void {
    this.phase = 'quiet';
    this.pending = null;
    this.current = { ...ZERO_OFFSET };
    this.target = { ...ZERO_OFFSET };
    this.clearQuietTimer();
    const timing = this.timing[this.activity === 'long_idle' ? 'long_idle' : 'idle'];
    const delay = this.randBetween(timing.quietMinMs, timing.quietMaxMs);
    this.quietTimer = this.schedule(() => {
      this.quietTimer = null;
      if (this.phase !== 'quiet' || this.isSuppressed() || !this.shouldBeActive()) return;
      this.pickAndStartAction();
    }, delay);
  }

  private pickAndStartAction(): void {
    const action = this.pickAction();
    this.lastAction = action.id;
    const timing = this.timing[this.activity === 'long_idle' ? 'long_idle' : 'idle'];
    const transitionMs = this.randBetween(timing.transitionMinMs, timing.transitionMaxMs);
    const holdMs = this.randBetween(timing.holdMinMs, timing.holdMaxMs);

    // Intensity per parameter, each within a configured safe fraction of range.
    const target = this.buildTarget(action);

    this.target = target;
    this.phaseElapsedMs = 0;
    this.phaseDurationMs = transitionMs;
    this.pending = {
      kind: 'moving',
      originalTarget: { ...target },
    };
    this.phase = 'moving';

    // Remember when the hold should end so `advancePhase` can release smoothly.
    this.pending.holdMs = holdMs;
  }

  private pickAction(): IdleAction {
    const candidates = this.actions.filter((action) => (
      !this.recentActions.includes(action.id)
    ));
    const pool = candidates.length > 0 ? candidates : this.actions;
    const index = Math.floor(this.rng() * pool.length) % pool.length;
    const action = pool[index];
    this.rememberLast(action.id);
    return action;
  }

  private rememberLast(id: string): void {
    this.recentActions.push(id);
    if (this.recentActions.length > this.antiRepeatCount) {
      this.recentActions.shift();
    }
  }

  private buildTarget(action: IdleAction): IdleOffsetAdditive {
    const target: IdleOffsetAdditive = { ...ZERO_OFFSET };
    for (const key of Object.keys(action.target) as (keyof IdleOffsetAdditive)[]) {
      const direction = action.target[key];
      if (!direction) continue;
      // Lively by design: primary param mostly 40–90% of the configured range
      // so the movement is clearly visible without hitting parameter extremes.
      const mag = this.randBetween(0.4, 0.9) * this.ranges[key];
      target[key] = clamp(direction * mag, -this.ranges[key], this.ranges[key]);
    }
    return target;
  }

  private advancePhase(deltaMs: number): void {
    if (this.phase !== 'moving' && this.phase !== 'holding' && this.phase !== 'releasing') {
      return;
    }
    this.phaseElapsedMs += deltaMs;

    if (this.phase === 'moving' && this.pending) {
      const t = easeOut(clamp(this.phaseElapsedMs / this.phaseDurationMs, 0, 1));
      this.current = this.blend(ZERO_OFFSET, this.pending.originalTarget, t);
      if (t >= 1) {
        this.current = { ...this.pending.originalTarget };
        this.phase = 'holding';
        this.phaseElapsedMs = 0;
        this.phaseDurationMs = this.pending.holdMs ?? 0;
      }
      return;
    }

    if (this.phase === 'holding') {
      if (this.phaseElapsedMs >= this.phaseDurationMs) {
        this.startRelease(false);
      }
      return;
    }

    if (this.phase === 'releasing') {
      const from = this.releaseFrom;
      const t = easeOut(clamp(this.phaseElapsedMs / this.phaseDurationMs, 0, 1));
      this.current = this.blend(from ?? ZERO_OFFSET, ZERO_OFFSET, t);
      if (t >= 1) {
        this.current = { ...ZERO_OFFSET };
        this.pending = null;
        this.enterQuiet();
      }
    }
  }

  private releaseFrom: IdleOffsetAdditive | null = null;

  private startRelease(_immediate: boolean): void {
    this.releaseFrom = { ...this.current };
    this.phase = 'releasing';
    this.phaseElapsedMs = 0;
    const timing = this.timing[this.activity === 'long_idle' ? 'long_idle' : 'idle'];
    this.phaseDurationMs = this.randBetween(timing.releaseMinMs, timing.releaseMaxMs);
    this.pending = {
      kind: 'releasing',
      originalTarget: { ...ZERO_OFFSET },
    };
    this.clearCooldownTimer();
    void _immediate;
  }

  private blend(from: IdleOffsetAdditive, to: IdleOffsetAdditive, t: number): IdleOffsetAdditive {
    return {
      AngleX: lerp(from.AngleX, to.AngleX, t),
      AngleY: lerp(from.AngleY, to.AngleY, t),
      AngleZ: lerp(from.AngleZ, to.AngleZ, t),
      BodyAngleX: lerp(from.BodyAngleX, to.BodyAngleX, t),
      EyeBallX: lerp(from.EyeBallX, to.EyeBallX, t),
      EyeBallY: lerp(from.EyeBallY, to.EyeBallY, t),
    };
  }

  private randBetween(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.rng() * (max - min);
  }

  private pickResumeCooldownMs(): number {
    if (this.lastSuppressionKind === 'speaking') return IDLE_SUPPRESSION_COOLDOWN_MS.speechEnd;
    if (this.lastSuppressionKind === 'drag') return IDLE_SUPPRESSION_COOLDOWN_MS.dragEnd;
    return IDLE_SUPPRESSION_COOLDOWN_MS.motionEnd;
  }

  private clearQuietTimer(): void {
    if (this.quietTimer !== null) {
      this.cancel(this.quietTimer);
      this.quietTimer = null;
    }
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer !== null) {
      this.cancel(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}