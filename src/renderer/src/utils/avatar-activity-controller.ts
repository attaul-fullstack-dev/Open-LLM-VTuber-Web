export type AvatarActivityState = 'active' | 'idle' | 'long_idle' | 'speaking';

export interface AvatarActivityThresholds {
  idleAfterMs: number
  longIdleAfterMs: number
}

export const AVATAR_ACTIVITY_THRESHOLDS: AvatarActivityThresholds = {
  idleAfterMs: 30_000,
  longIdleAfterMs: 120_000,
};

type TimerHandle = ReturnType<typeof setTimeout>;
type StateListener = (state: AvatarActivityState) => void;

interface AvatarActivityControllerOptions {
  thresholds?: AvatarActivityThresholds
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => TimerHandle
  cancel?: (handle: TimerHandle) => void
}

/**
 * Event-driven conversational-idle state. It deliberately knows nothing
 * about sockets, LLM requests, or Live2D parameters; later avatar behavior
 * can consume this state without coupling itself to those systems.
 */
export class AvatarActivityController {
  private readonly thresholds: AvatarActivityThresholds;

  private readonly now: () => number;

  private readonly schedule: (callback: () => void, delayMs: number) => TimerHandle;

  private readonly cancel: (handle: TimerHandle) => void;

  private readonly listeners = new Set<StateListener>();

  private readonly speakingTokens = new Set<symbol>();

  private transitionTimer: TimerHandle | null = null;

  private state: AvatarActivityState = 'active';

  private lastUserActivityAt: number;

  private running = false;

  constructor(options: AvatarActivityControllerOptions = {}) {
    this.thresholds = options.thresholds ?? AVATAR_ACTIVITY_THRESHOLDS;
    if (this.thresholds.idleAfterMs < 0
      || this.thresholds.longIdleAfterMs <= this.thresholds.idleAfterMs) {
      throw new Error('Avatar activity thresholds must satisfy 0 <= idle < long idle');
    }
    this.now = options.now ?? (() => (
      typeof performance === 'undefined' ? Date.now() : performance.now()
    ));
    this.schedule = options.schedule ?? ((callback, delayMs) => (
      setTimeout(callback, delayMs)
    ));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
    this.lastUserActivityAt = this.now();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.refreshFromElapsedTime();
  }

  stop(): void {
    this.running = false;
    this.clearTransitionTimer();
    this.speakingTokens.clear();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): AvatarActivityState {
    return this.state;
  }

  getLastUserActivityAt(): number {
    return this.lastUserActivityAt;
  }

  markUserActivity(): void {
    this.lastUserActivityAt = this.now();
    this.setState(this.speakingTokens.size > 0 ? 'speaking' : 'active');
    this.scheduleNextTransition();
  }

  beginSpeaking(): symbol {
    const token = Symbol('avatar-speaking');
    this.speakingTokens.add(token);
    this.setState('speaking');
    return token;
  }

  endSpeaking(token: symbol): void {
    if (!this.speakingTokens.delete(token) || this.speakingTokens.size > 0) return;
    this.refreshFromElapsedTime();
  }

  endAllSpeaking(): void {
    if (this.speakingTokens.size === 0) return;
    this.speakingTokens.clear();
    this.refreshFromElapsedTime();
  }

  private derivedIdleState(): Exclude<AvatarActivityState, 'speaking'> {
    const elapsed = Math.max(0, this.now() - this.lastUserActivityAt);
    if (elapsed >= this.thresholds.longIdleAfterMs) return 'long_idle';
    if (elapsed >= this.thresholds.idleAfterMs) return 'idle';
    return 'active';
  }

  private refreshFromElapsedTime(): void {
    this.setState(this.speakingTokens.size > 0 ? 'speaking' : this.derivedIdleState());
    this.scheduleNextTransition();
  }

  private scheduleNextTransition(): void {
    this.clearTransitionTimer();
    if (!this.running) return;

    const elapsed = Math.max(0, this.now() - this.lastUserActivityAt);
    let delay: number | null = null;
    if (elapsed < this.thresholds.idleAfterMs) {
      delay = this.thresholds.idleAfterMs - elapsed;
    } else if (elapsed < this.thresholds.longIdleAfterMs) {
      delay = this.thresholds.longIdleAfterMs - elapsed;
    }

    if (delay !== null) {
      this.transitionTimer = this.schedule(() => {
        this.transitionTimer = null;
        this.refreshFromElapsedTime();
      }, delay);
    }
  }

  private clearTransitionTimer(): void {
    if (this.transitionTimer !== null) {
      this.cancel(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  private setState(nextState: AvatarActivityState): void {
    if (nextState === this.state) return;
    this.state = nextState;
    this.listeners.forEach((listener) => listener(nextState));
  }
}
