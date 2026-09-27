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
  LIFE_STATE_BASE_WIDTH,
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
      // No viewport clamp here on purpose: the drag gesture already clamps
      // with the live zoom-aware geometry, and re-clamping with stale width
      // constants would snap the persisted position (e.g. 327 -> 310) and
      // teleport the panel on the next render. Keep finite values only.
      const clean = {
        x:
          Number.isFinite(position.x) && Math.abs(position.x) < 10000
            ? Math.round(position.x)
            : 0,
        y:
          Number.isFinite(position.y) && Math.abs(position.y) < 10000
            ? Math.round(position.y)
            : 0,
      };
      persist({
        enabled: stored.enabled,
        position: clean,
        size: stored.size,
      });
    },
    [persist, stored.enabled, stored.size],
  );

  const setSize = useCallback(
    (size: LifeStateSize) => {
      // No px-clamp here on purpose: the resize gesture already enforces
      // the MIN/MAX scale locks, and clamping here would snap sub-280px
      // persists back up (undoing a shrink). Load-time sanitize still
      // migrates legacy records.
      const clean = {
        width:
          Number.isFinite(size.width) && size.width > 0
            ? Math.round(size.width)
            : LIFE_STATE_BASE_WIDTH,
        height:
          Number.isFinite(size.height) && size.height > 0
            ? Math.round(size.height)
            : LIFE_STATE_BASE_WIDTH,
      };
      persist({
        enabled: stored.enabled,
        position: stored.position,
        size: clean,
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
