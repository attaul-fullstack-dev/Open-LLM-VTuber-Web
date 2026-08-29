import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { useAvatarActivityState } from '@/context/avatar-activity-context';
import { useAiState } from '@/context/ai-state-context';
import { useChatHistory } from '@/context/chat-history-context';
import { responseFaceBus } from '@/utils/response-face-bus';
import { resolveBehaviorOwnership } from '@/utils/behavior-orchestrator';
import type { BehaviorOwnershipSnapshot } from '@/utils/behavior-orchestrator';

/**
 * Mili Hidup Stage 5 — behavior ownership adapter (React).
 *
 * Turns live inputs (Stage 1 activity, ai-state, the Stage 4 response-face bus,
 * drag/motion toggles, interruption, session switch) into the pure
 * `BehaviorOwnershipSnapshot` that Stage 2/3 query for "may I act?". This is a
 * thin mapper — all resolution logic lives in the pure orchestrator.
 */

export interface UseBehaviorOwnershipOptions {
  isDragging: boolean;
  isMotionPlaying: boolean;
}

/**
 * Release the contextual response face through the Stage 4 release path. Safe to
 * call from any owner (idempotent via the shared turn lifecycle) — used on
 * session switches and interruption cleanup.
 */
export function clearTransientOwnership(): void {
  responseFaceBus.publish({ faceId: null, releaseReason: 'interruption' });
}

export function useBehaviorOwnership({
  isDragging,
  isMotionPlaying,
}: UseBehaviorOwnershipOptions): BehaviorOwnershipSnapshot {
  const { activityState } = useAvatarActivityState();
  const { isInterrupted, isThinkingSpeaking } = useAiState();
  const { currentHistoryUid } = useChatHistory();

  // The Stage 4 response face is visible to the whole window via the shared
  // module-scoped bus (several components feed/release it). Mirror the latest
  // latched state so the orchestrator sees "a contextual face is owned".
  const [responseFaceActive, setResponseFaceActive] = useState(
    responseFaceBus.getLastPayload().faceId !== null,
  );

  useEffect(() => responseFaceBus.subscribe(({ faceId }) => {
    setResponseFaceActive(faceId !== null);
  }), []);

  // Session switch (chat change / new chat / character switch): clear transient
  // response ownership and briefly disable autonomous behavior so nothing snaps
  // or resumes mid-switch. Only transient avatar state is touched — never
  // memory/relationship/character-global state.
  const [sessionActive, setSessionActive] = useState(true);
  const lastUidRef = useRef(currentHistoryUid);
  useEffect(() => {
    const previous = lastUidRef.current;
    lastUidRef.current = currentHistoryUid;
    if (previous !== null && previous !== currentHistoryUid) {
      clearTransientOwnership();
      setSessionActive(false);
      const settle = window.setTimeout(() => setSessionActive(true), 200);
      return () => window.clearTimeout(settle);
    }
    return undefined;
  }, [currentHistoryUid]);

  // An assistant turn is in progress (generation/playback) whenever the AI is
  // thinking/speaking — this includes proactive responses, which begin while the
  // avatar is still in long_idle.
  const responseInProgress = isThinkingSpeaking;

  return useMemo(
    () => resolveBehaviorOwnership({
      activityState,
      responseFaceActive,
      responseInProgress,
      isDragging,
      isMotionPlaying,
      interrupted: isInterrupted,
      sessionActive,
    }),
    [
      activityState,
      responseFaceActive,
      responseInProgress,
      isDragging,
      isMotionPlaying,
      isInterrupted,
      sessionActive,
    ],
  );
}

export type { BehaviorOwnershipSnapshot };