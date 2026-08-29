/**
 * Mili Hidup Stage 5 — Behavior ownership orchestrator (pure).
 *
 * This is the SINGLE source of truth for "who is allowed to act on Mili's
 * avatar, and when". Stages 1–4 already work independently and own their own
 * parameters:
 *   - Stage 1 = conversational activity state (active / idle / long_idle / speaking)
 *   - Stage 2 = autonomous idle MOVEMENT (AngleX/Y/Z, BodyAngleX, EyeBallX/Y)
 *   - Stage 3 = autonomous idle FACIAL micro-expressions
 *   - Stage 4 = contextual response FACIAL ownership (claims a Stage 3 face)
 *   - Lip sync (ParamA) owns the mouth voxels; Stage 5 never writes params.
 *
 * Stage 5 does NOT animate. It only RESOLVES ownership and answers queries like
 * "may autonomous idle movement run now?", "may idle facial selection run now?",
 * "is a response owning the face?", using deterministic priority + channels.
 * Stages 2/3/4 (and the React adapter) consult these queries instead of each
 * re-deriving the same "if speaking / if dragging / if idle" logic in isolation.
 *
 * Ownership channels:
 *   - face     : contextual response face > idle face > neutral
 *   - movement : drag / explicit motion > safe idle movement
 *   - lip      : lip-sync only (never touched here)
 *   - lifecycle: response / interruption / idle / session_switch
 */

export type AvatarBehaviorOwner =
  | 'session_switch'
  | 'interruption'
  | 'response'
  | 'speaking'
  | 'user_active'
  | 'drag'
  | 'intentional_motion'
  | 'idle_face'
  | 'idle_movement'
  | 'long_idle'
  | 'neutral';

/**
 * Deterministic priority (higher wins). Follows the Stage 5 conflict matrix:
 *   1. interruption / user control
 *   2. contextual response
 *   3. speaking
 *   4. intentional motion / drag
 *   5. autonomous idle face
 *   6. autonomous idle movement
 *   7. neutral
 */
export const BEHAVIOR_PRIORITY: Record<AvatarBehaviorOwner, number> = {
  session_switch: 110,
  interruption: 100,
  response: 90,
  speaking: 80,
  user_active: 70,
  drag: 60,
  intentional_motion: 55,
  idle_face: 40,
  idle_movement: 30,
  long_idle: 20,
  neutral: 0,
};

export interface BehaviorOwnershipInput {
  /** Stage 1 conversational activity state. */
  activityState: 'active' | 'idle' | 'long_idle' | 'speaking';
  /** A Stage 4 contextual response face is latched (owns the face). */
  responseFaceActive: boolean;
  /** An assistant turn is being generated/played (aiState != idle, incl. proactive). */
  responseInProgress: boolean;
  /** User disabling the model with drag / an explicit Live2D motion playing. */
  isDragging: boolean;
  isMotionPlaying: boolean;
  /** A user interruption just cleared the current response. */
  interrupted: boolean;
  /** False right after a chat/session switch until transient state resets. */
  sessionActive: boolean;
}

export type BehaviorLifecycle =
  | 'session_switch'
  | 'interruption'
  | 'response'
  | 'idle';

export interface BehaviorOwnershipSnapshot {
  /** Highest-priority owner in the whole system (diagnostics/labels). */
  owner: AvatarBehaviorOwner;
  priority: number;
  /** Owner of the FACE channel (facial contribution). */
  faceOwner: AvatarBehaviorOwner;
  /** Owner of the MOVEMENT channel (head/body/eye movement). */
  movementOwner: AvatarBehaviorOwner;
  /** Owner of the LIP channel (always lip-sync; never written by Stage 5). */
  lipOwner: 'lip_sync';
  /** High-level lifecycle. */
  lifecycle: BehaviorLifecycle;
  /** May autonomous idle FACE run/select right now? */
  canRunIdleFace(): boolean;
  /** May autonomous idle MOVEMENT run/start now? */
  canRunIdleMovement(): boolean;
  /** Is a contextual response currently owning the avatar (face/generation)? */
  isResponseOwned(): boolean;
  /** Is the user actively interacting (Stage 1 = active)? */
  isUserActive(): boolean;
  /** Is ownership in an interruption state? */
  isInterrupted(): boolean;
  /** Shortcut: should autonomous idle contributions be suppressed right now? */
  shouldSuppressAutonomous(): { face: boolean; movement: boolean };
}

/**
 * Resolve behavior ownership from the live Stage 1/3/4 + input signals into a
 * deterministic snapshot. Pure and side-effect free (an input mapper turns the
 * live React/context state into a `BehaviorOwnershipInput`).
 */
export function resolveBehaviorOwnership(
  input: BehaviorOwnershipInput,
): BehaviorOwnershipSnapshot {
  const sessionBroken = !input.sessionActive;
  const interrupted = input.interrupted || sessionBroken;

  const responseOwned = input.responseFaceActive || input.responseInProgress;
  const idleEligible = input.activityState === 'idle'
    || input.activityState === 'long_idle';
  const speaking = input.activityState === 'speaking';

  // --- face channel ---
  const faceOwner: AvatarBehaviorOwner = sessionBroken
    ? 'session_switch'
    : interrupted
      ? 'interruption'
      : input.responseFaceActive || input.responseInProgress
        ? 'response'
        : speaking
          ? 'speaking'
          : input.isDragging
            ? 'drag'
            : input.isMotionPlaying
              ? 'intentional_motion'
              : input.activityState === 'active'
                ? 'user_active'
                : input.activityState === 'long_idle'
                  ? 'long_idle'
                  : idleEligible
                    ? 'idle_face'
                    : 'neutral';

  // --- movement channel ---
  // Safe idle movement may continue during a contextual response FACE (the face
  // channel is independent), but it must yield while a response is being
  // generated/played, interrupted, speaking, dragged, or an explicit motion runs.
  const movementBlocked = sessionBroken
    || interrupted
    || speaking
    || input.isDragging
    || input.isMotionPlaying
    || input.responseInProgress;
  const movementAllowed = idleEligible && !movementBlocked;

  // --- lifecycle ---
  const lifecycle: BehaviorLifecycle = sessionBroken
    ? 'session_switch'
    : interrupted
      ? 'interruption'
      : responseOwned
        ? 'response'
        : 'idle';

  const movementOwner: AvatarBehaviorOwner = movementAllowed
    ? (input.activityState === 'long_idle' ? 'long_idle' : 'idle_movement')
    : sessionBroken
      ? 'session_switch'
      : interrupted
        ? 'interruption'
        : speaking
          ? 'speaking'
          : input.isDragging
            ? 'drag'
            : input.isMotionPlaying
              ? 'intentional_motion'
              : input.responseInProgress || input.responseFaceActive
                ? 'response'
                : input.activityState === 'active'
                  ? 'user_active'
                  : 'neutral';

  // --- global owner: highest priority among the applicable owners ---
  // Face and movement may differ; expose the highest-priority one as `owner`
  // for diagnostics. Face (40) > movement (30) when both idle-run.
  const faceP = BEHAVIOR_PRIORITY[faceOwner];
  const moveP = BEHAVIOR_PRIORITY[movementOwner];
  const owner = faceP >= moveP ? faceOwner : movementOwner;

  const canRunIdleFace = (): boolean => (
    idleEligible
    && !speaking
    && !input.isDragging
    && !input.isMotionPlaying
    && !interrupted
    && !responseOwned
  );

  const canRunIdleMovement = (): boolean => movementAllowed;

  const isResponseOwned = (): boolean => responseOwned;
  const isUserActive = (): boolean => input.activityState === 'active';
  const isInterrupted = (): boolean => interrupted;

  return {
    owner,
    priority: Math.max(faceP, moveP),
    faceOwner,
    movementOwner,
    lipOwner: 'lip_sync',
    lifecycle,
    canRunIdleFace,
    canRunIdleMovement,
    isResponseOwned,
    isUserActive,
    isInterrupted,
    shouldSuppressAutonomous: () => ({
      face: !canRunIdleFace(),
      movement: !canRunIdleMovement(),
    }),
  };
}