import {
  createContext,
  useState,
  useMemo,
  useContext,
  useCallback,
} from "react";
import {
  loadLifeStatePreferences,
  saveLifeStatePreferences,
  clampLifeStatePosition,
  clampLifeStateSize,
  type LifeStatePosition,
  type LifeStateSize,
} from "@/utils/life-state-preference";

/** Authoritative backend snapshot (read-only mirror, never edited locally). */
export type { LifeStateSnapshot } from "@/utils/life-state-sync";
import type { LifeStateSnapshot } from "@/utils/life-state-sync";

interface LifeStateState {
  /** Widget visibility (persisted). OFF hides display only. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Last backend snapshot, or null before the first fetch. */
  snapshot: LifeStateSnapshot | null;
  setSnapshot: (snapshot: LifeStateSnapshot) => void;
  /** Last drag position (persisted), null = default dock. */
  position: LifeStatePosition | null;
  setPosition: (position: LifeStatePosition) => void;
  /** Last resize size (persisted), null = default size. */
  size: LifeStateSize | null;
  setSize: (size: LifeStateSize) => void;
}

export const LifeStateContext = createContext<LifeStateState | null>(null);

export function useLifeState(): LifeStateState {
  const context = useContext(LifeStateContext);
  if (!context) {
    throw new Error("useLifeState must be used within a LifeStateProvider");
  }
  return context;
}

/**
 * Pure display state + preference persistence. Sends nothing by itself;
 * refresh requests go through the existing WebSocket (widget mount,
 * toggle-ON, manual refresh, conversation-chain-end).
 */
export function LifeStateProvider({ children }: { children: React.ReactNode }) {
  const [stored, setStored] = useState(loadLifeStatePreferences);
  const [snapshot, setSnapshotState] = useState<LifeStateSnapshot | null>(null);

  const persist = useCallback(
    (next: {
      enabled: boolean;
      position: LifeStatePosition | null;
      size: LifeStateSize | null;
    }) => {
      setStored(next);
      saveLifeStatePreferences(next);
    },
    [],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      persist({ enabled, position: stored.position, size: stored.size });
    },
    [persist, stored.position, stored.size],
  );

  const setPosition = useCallback(
    (position: LifeStatePosition) => {
      const clamped = clampLifeStatePosition(
        position,
        window.innerWidth,
        window.innerHeight,
      );
      persist({
        enabled: stored.enabled,
        position: clamped,
        size: stored.size,
      });
    },
    [persist, stored.enabled, stored.size],
  );

  const setSize = useCallback(
    (size: LifeStateSize) => {
      persist({
        enabled: stored.enabled,
        position: stored.position,
        size: clampLifeStateSize(size),
      });
    },
    [persist, stored.enabled, stored.position],
  );

  const setSnapshot = useCallback((next: LifeStateSnapshot) => {
    setSnapshotState(next);
  }, []);

  const value = useMemo(
    () => ({
      enabled: stored.enabled,
      setEnabled,
      snapshot,
      setSnapshot,
      position: stored.position,
      setPosition,
      size: stored.size,
      setSize,
    }),
    [stored, setEnabled, snapshot, setSnapshot, setPosition, setSize],
  );

  return (
    <LifeStateContext.Provider value={value}>
      {children}
    </LifeStateContext.Provider>
  );
}
