/**
 * When to (re)fetch character/attachment memories (pure, no React/Chakra).
 *
 * Both stores are keyed by the active character's conf_uid, and the backend
 * only learns that uid once a history has been resumed
 * (``fetch-and-set-history`` / ``create-new-history`` →
 * ``set_memory_from_history``). A fetch issued before that returns an empty
 * list, and nothing used to refetch it afterwards — so the panel stayed at
 * zero even after records existed.
 *
 * Rules:
 * - Only fetch while the socket is OPEN.
 * - Never fetch without an active history uid (avoids the pre-resume race).
 * - Never fetch the same uid twice in a row (no duplicate requests).
 * - Refetch when the uid changes (history switch, resume, new session).
 */

export type MemoryFetchDecision = 'waiting' | 'fetch' | 'skip';

export function planMemoryFetch(
  wsState: string,
  historyUid: string | null | undefined,
  lastFetchedUid: string | null,
): MemoryFetchDecision {
  if (wsState !== 'OPEN') {
    return 'waiting';
  }
  if (!historyUid) {
    // History not resumed yet: the backend cannot resolve conf_uid, so the
    // response would be empty. Wait for the resume instead of guessing.
    return 'waiting';
  }
  if (lastFetchedUid === historyUid) {
    return 'skip';
  }
  return 'fetch';
}
