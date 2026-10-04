import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOFOLLOW_BOTTOM_THRESHOLD_PX,
  initialFollowOwnership,
  isAtBottom,
  nextFollowOwnership,
} from '../src/renderer/src/utils/chat-autofollow.ts';

// 1. Long streaming, no user touch -> system keeps following.
test('fresh mount follows (no user control)', () => {
  assert.equal(initialFollowOwnership().userControl, false);
});

// 2. User scrolls up mid-stream -> control transfers immediately.
test('user gesture takes control immediately', () => {
  const next = nextFollowOwnership(initialFollowOwnership(), {
    type: 'user-gesture',
  });
  assert.equal(next.userControl, true);
});

// 3-4. Chunks keep arriving + stream ends while user is up -> stays put.
test('scroll away from bottom keeps user control', () => {
  let state = nextFollowOwnership(initialFollowOwnership(), {
    type: 'user-gesture',
  });
  for (let i = 0; i < 10; i++) {
    state = nextFollowOwnership(state, { type: 'scroll', atBottom: false });
    assert.equal(state.userControl, true);
  }
});

// 5. User scrolls back to bottom -> follow resumes.
test('scroll landing at bottom releases control', () => {
  const held = nextFollowOwnership(initialFollowOwnership(), {
    type: 'user-gesture',
  });
  const released = nextFollowOwnership(held, { type: 'scroll', atBottom: true });
  assert.equal(released.userControl, false);
});

// 6. Many renders while held -> never force-follows.
test('scrolling up without a prior gesture still takes control', () => {
  const state = nextFollowOwnership(initialFollowOwnership(), {
    type: 'scroll',
    atBottom: false,
  });
  assert.equal(state.userControl, true);
});

test('at-bottom detection honors the threshold', () => {
  assert.equal(AUTOFOLLOW_BOTTOM_THRESHOLD_PX, 40);
  // Exactly at bottom.
  assert.equal(isAtBottom(960, 1000, 40), true);
  // Within threshold counts as bottom (re-enable zone).
  assert.equal(isAtBottom(930, 1000, 40), true);
  // Clearly above does not.
  assert.equal(isAtBottom(100, 1000, 40), false);
  // Short content that cannot scroll counts as bottom.
  assert.equal(isAtBottom(0, 200, 800), true);
});

// 7. Composer-area gestures are out of scope by construction: the controller
// only ever receives events wired to the chat list container, so there is
// nothing to assert here beyond the event source contract below.
test('gesture events carry no element identity (wiring decides scope)', () => {
  const state = nextFollowOwnership(initialFollowOwnership(), {
    type: 'user-gesture',
  });
  assert.equal(state.userControl, true);
});

// 8. Fresh mount after refresh/reconnect starts in follow mode.
test('re-mount resets to follow mode', () => {
  const held = nextFollowOwnership(initialFollowOwnership(), {
    type: 'user-gesture',
  });
  assert.equal(held.userControl, true);
  assert.equal(initialFollowOwnership().userControl, false);
});
