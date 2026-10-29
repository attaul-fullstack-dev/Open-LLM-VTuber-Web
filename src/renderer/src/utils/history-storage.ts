const LAST_HISTORY_KEY_PREFIX = 'olv:last-history:';

const storageKey = (confUid: string) => `${LAST_HISTORY_KEY_PREFIX}${confUid}`;

/**
 * One empty-but-valid continuation session the backend reports apart from the
 * conversation list (a hand-off target this tab never reached). Only a tab
 * that already remembers this exact uid may adopt it.
 */
export interface ResumableSession {
  uid: string;
  continued_from?: string | null;
  continued_at?: string | null;
  timestamp?: string | null;
}

export type HistoryResumeDecision =
  | {
    type: 'resume';
    uid: string;
    /**
     * Why this uid: `remembered` is the conversation this tab was last on;
     * `continued` is a remembered hand-off target that has no messages of its
     * own yet (so it is not in the conversation list, but it is the session
     * that must be continued rather than the source it continues); `newest` is
     * the fallback used when that uid is gone (deleted, cleaned up, created by
     * another server process) but the conversation list is not empty.
     * Resuming the newest session keeps the user's conversation reachable
     * instead of silently minting another empty one.
     */
    source: 'remembered' | 'newest' | 'continued';
  }
  | { type: 'create' };

export const decideHistoryResume = (
  historyUids: string[],
  rememberedUid: string | null,
  resumableUids: string[] = [],
): HistoryResumeDecision => {
  const available = Array.isArray(historyUids)
    ? historyUids.filter((uid) => typeof uid === 'string' && uid.length > 0)
    : [];
  const resumable = Array.isArray(resumableUids)
    ? resumableUids.filter((uid) => typeof uid === 'string' && uid.length > 0)
    : [];

  if (rememberedUid && available.includes(rememberedUid)) {
    return { type: 'resume', uid: rememberedUid, source: 'remembered' };
  }

  // A hand-off target that is still empty is not in `available` (it is not a
  // conversation yet), but the tab that was handed off to it remembers the
  // uid and the backend vouches for its lineage. Never chosen for a uid this
  // tab does not remember: an unreferenced empty session stays unreachable.
  if (rememberedUid && resumable.includes(rememberedUid)) {
    return { type: 'resume', uid: rememberedUid, source: 'continued' };
  }

  // Empty or vanished uid: fall back to the list the server actually has
  // (newest first) rather than creating a session that hides the previous
  // conversation. An empty list still means "create": there is nothing to
  // resume.
  if (available.length > 0) {
    return { type: 'resume', uid: available[0], source: 'newest' };
  }

  return { type: 'create' };
};

export const getLastHistoryUid = (
  confUid: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): string | null => {
  if (!confUid) return null;
  return storage.getItem(storageKey(confUid));
};

export const setLastHistoryUid = (
  confUid: string,
  historyUid: string,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): void => {
  if (!confUid || !historyUid) return;
  storage.setItem(storageKey(confUid), historyUid);
};

export const clearLastHistoryUid = (
  confUid: string,
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void => {
  if (!confUid) return;
  storage.removeItem(storageKey(confUid));
};
