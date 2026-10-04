/**
 * Chat auto-follow ownership — pure logic, no DOM, no React.
 *
 * Ownership rule: SYSTEM follows the bottom while the user never touches
 * the list. The moment the user starts a scroll gesture on the chat list,
 * ownership transfers to the USER until they scroll back to the bottom.
 *
 * This exists because the message list keeps the viewport glued to the
 * bottom while streaming (growth of the last message shifts scrollTop),
 * which would otherwise fight the user reading earlier content.
 */

export const AUTOFOLLOW_BOTTOM_THRESHOLD_PX = 40;

export interface FollowOwnership {
  /** True once a user gesture took control; cleared when back at bottom. */
  userControl: boolean;
}

export const initialFollowOwnership = (): FollowOwnership => ({
  userControl: false,
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
  | { type: 'scroll'; atBottom: boolean };

/**
 * Pure ownership transition. `user-gesture` (touchstart/pointerdown/wheel
 * on the chat list only) always takes control immediately. A scroll event
 * releases control back to the system only when it lands at the bottom.
 */
export function nextFollowOwnership(
  prev: FollowOwnership,
  event: FollowEvent,
): FollowOwnership {
  if (event.type === 'user-gesture') {
    return { userControl: true };
  }
  if (event.atBottom) {
    return prev.userControl ? { userControl: false } : prev;
  }
  if (!prev.userControl) {
    return { userControl: true };
  }
  return prev;
}
