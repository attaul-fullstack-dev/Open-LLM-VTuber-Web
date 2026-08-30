const LAST_HISTORY_KEY_PREFIX = 'olv:last-history:';

const storageKey = (confUid: string) => `${LAST_HISTORY_KEY_PREFIX}${confUid}`;

export type HistoryResumeDecision =
  | { type: 'resume'; uid: string }
  | { type: 'create' };

export const decideHistoryResume = (
  historyUids: string[],
  rememberedUid: string | null,
): HistoryResumeDecision => {
  if (rememberedUid) {
    return historyUids.includes(rememberedUid)
      ? { type: 'resume', uid: rememberedUid }
      : { type: 'create' };
  }

  return historyUids.length > 0
    ? { type: 'resume', uid: historyUids[0] }
    : { type: 'create' };
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
