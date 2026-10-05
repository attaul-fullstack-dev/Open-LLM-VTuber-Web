/**
 * Chat auto-follow ownership — pure logic, no DOM, no React.
 *
 * Ownership rule: SYSTEM follows the bottom while the user never touches
 * the list. The moment the user starts a scroll gesture on the chat list,
 * ownership transfers to the USER until they scroll back to the bottom.
 *
 * A second, subtler rule keeps the viewport *stable* while the user is in
 * control: only scroll events backed by a real user gesture may move the
 * pinned position. The chat list library re-anchors its scroll offset on
 * every streaming update (and the browser's own scroll anchoring can move
 * it too). Those programmatic moves carry no gesture, so they must never
 * be adopted as the user's position — otherwise each chunk ratchets the
 * pin a little further down and the viewport drifts while reading.
 *
 * Gesture lifetime is tracked with `gestureArmed`: set by wheel /
 * touchstart+touchmove / pointerdown / scroll-key presses on the list, and
 * cleared by scrollend (which fires after momentum settles) or pointer
 * release. Touch release alone must NOT disarm: finger momentum keeps
 * producing scrolls after touchend, and those still belong to the user.
 * While armed, scroll events are adopted as the new pin; while unarmed,
 * scroll events are echo of a programmatic move and the caller must
 * re-pin instead of adopting.
 */

export const AUTOFOLLOW_BOTTOM_THRESHOLD_PX = 40;

export interface FollowOwnership {
  /** True once a user gesture took control; cleared when back at bottom. */
  userControl: boolean;
  /** True while a user gesture is still driving scroll events. */
  gestureArmed: boolean;
}

export const initialFollowOwnership = (): FollowOwnership => ({
  userControl: false,
  gestureArmed: false,
});

export function isAtBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx: number = AUTOFOLLOW_BOTTOM_THRESHOLD_PX,
): boolean {
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
}

export type FollowEvent =
  | { type: 'user-gesture' }
  | { type: 'gesture-end' }
  | { type: 'scroll'; atBottom: boolean };

/**
 * Pure ownership transition.
 *
 * - `user-gesture` (wheel / touchstart+touchmove / pointerdown / scroll
 *   keys, wired to the chat list only) always takes control immediately
 *   and arms adoption for the scroll events that gesture produces.
 * - `gesture-end` (scrollend / pointer release) disarms adoption but
 *   never changes who owns the viewport. Touch release alone is NOT a
 *   gesture-end: momentum scrolls after touchend still belong to the user.
 * - A `scroll` landing at the bottom hands control back to the system.
 * - A `scroll` away from the bottom is adopted as the new pin only while
 *   armed; unarmed scrolls are programmatic moves (library re-anchoring,
 *   browser scroll anchoring, our own enforcement echo) and leave the pin
 *   untouched so the caller can re-pin instead of ratcheting downward.
 */
export function nextFollowOwnership(
  prev: FollowOwnership,
  event: FollowEvent,
): FollowOwnership {
  if (event.type === 'user-gesture') {
    return { userControl: true, gestureArmed: true };
  }
  if (event.type === 'gesture-end') {
    return prev.gestureArmed
      ? { userControl: prev.userControl, gestureArmed: false }
      : prev;
  }
  if (event.atBottom) {
    return prev.userControl || prev.gestureArmed
      ? { userControl: false, gestureArmed: false }
      : prev;
  }
  if (!prev.userControl) {
    return { userControl: true, gestureArmed: prev.gestureArmed };
  }
  return prev;
}

/**
 * Should the caller adopt this scroll position as the new pin?
 * Only scrolls backed by an armed user gesture (or the follow-mode path)
 * may move the pin. Returns false for programmatic moves.
 */
export function shouldAdoptScrollPosition(state: FollowOwnership): boolean {
  return !state.userControl || state.gestureArmed;
}
