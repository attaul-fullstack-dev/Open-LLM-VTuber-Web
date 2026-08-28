import {
  createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import {
  AvatarActivityController,
} from '@/utils/avatar-activity-controller';
import type { AvatarActivityState } from '@/utils/avatar-activity-controller';

interface AvatarActivityContextValue {
  activityState: AvatarActivityState
  lastUserActivityAt: number
  markUserActivity: () => void
  beginSpeaking: () => symbol
  endSpeaking: (token: symbol) => void
  endAllSpeaking: () => void
}

const AvatarActivityContext = createContext<AvatarActivityContextValue | null>(null);

export function AvatarActivityProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new AvatarActivityController());
  const [activityState, setActivityState] = useState(controller.getState());
  const [lastUserActivityAt, setLastUserActivityAt] = useState(
    controller.getLastUserActivityAt(),
  );

  useEffect(() => {
    const unsubscribe = controller.subscribe((nextState) => {
      setActivityState((previousState) => {
        if (import.meta.env.DEV && previousState !== nextState) {
          console.debug(`[AVATAR ACTIVITY] ${previousState} -> ${nextState}`);
        }
        return nextState;
      });
    });
    controller.start();
    return () => {
      unsubscribe();
      controller.stop();
    };
  }, [controller]);

  const markUserActivity = useCallback(() => {
    controller.markUserActivity();
    setLastUserActivityAt(controller.getLastUserActivityAt());
  }, [controller]);
  const beginSpeaking = useCallback(() => controller.beginSpeaking(), [controller]);
  const endSpeaking = useCallback((token: symbol) => controller.endSpeaking(token), [controller]);
  const endAllSpeaking = useCallback(() => controller.endAllSpeaking(), [controller]);

  const value = useMemo(() => ({
    activityState,
    lastUserActivityAt,
    markUserActivity,
    beginSpeaking,
    endSpeaking,
    endAllSpeaking,
  }), [
    activityState,
    lastUserActivityAt,
    markUserActivity,
    beginSpeaking,
    endSpeaking,
    endAllSpeaking,
  ]);

  return (
    <AvatarActivityContext.Provider value={value}>
      {children}
    </AvatarActivityContext.Provider>
  );
}

export function useAvatarActivityState(): AvatarActivityContextValue {
  const context = useContext(AvatarActivityContext);
  if (!context) {
    throw new Error('useAvatarActivityState must be used within AvatarActivityProvider');
  }
  return context;
}
