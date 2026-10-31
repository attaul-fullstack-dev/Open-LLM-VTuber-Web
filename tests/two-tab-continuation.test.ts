import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContinuation,
  continuationForSnapshot,
  parseContinuationEvent,
  type ContinuationEvent,
} from '../src/renderer/src/utils/history-continuation.ts';
import {
  clearLastHistoryUid,
  decideHistoryResume,
  getLastHistoryUid,
  setLastHistoryUid,
} from '../src/renderer/src/utils/history-storage.ts';
import type { ChatRow } from '../src/renderer/src/utils/history-reconcile.ts';

const SOURCE = 'source-history';
const CONTINUATION = 'continuation-history';

const row = (id: string, content: string, role: 'ai' | 'human' = 'human'): ChatRow => ({
  id, role, content,
});

/** A hand-off frame exactly as the backend sends it. */
const handoffFrame = (overrides: Record<string, unknown> = {}) => ({
  type: 'new-history-created',
  history_uid: CONTINUATION,
  continued_from: SOURCE,
  ...overrides,
});

/** localStorage as the browser shares it: one store for every tab. */
const makeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

// -- each tab owns its own screen ---------------------------------------

test('only the tab showing the source adopts the hand-off; the other tab is untouched', () => {
  const event = parseContinuationEvent(handoffFrame()) as ContinuationEvent;
  const tabA: ChatRow[] = [row('msg:src-0', 'halo Mili'), row('msg:src-1', 'Halo!', 'ai')];
  const tabB: ChatRow[] = [row('msg:other-0', 'percakapan lain')];
  const tabBBefore = JSON.parse(JSON.stringify(tabB));

  const viewA = continuationForSnapshot({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: tabA,
  });
  const viewB = continuationForSnapshot({
    event: null,
    displayedHistoryUid: 'another-history',
    displayedMessages: tabB,
  });

  assert.ok(viewA);
  assert.equal(viewA?.adopted, true);
  assert.equal(viewB, null, 'a tab with no hand-off frame shows no banner');
  // The second tab's own conversation is never rewritten by another tab's
  // hand-off: its rows are exactly what it already had.
  assert.deepEqual(tabB, tabBBefore);
  assert.equal(tabB[0].id, 'msg:other-0');
});

test('a duplicate hand-off frame replaces the context instead of appending it', () => {
  const event = parseContinuationEvent(handoffFrame()) as ContinuationEvent;
  const live: ChatRow[] = [
    row('msg:src-0', 'halo Mili'),
    row('msg:src-1', 'Halo!', 'ai'),
  ];

  const first = buildContinuation({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: live,
  });
  const second = buildContinuation({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: live,
    previous: first,
  });

  assert.deepEqual(second, first);
  assert.equal(second.messages.length, live.length);
  assert.equal(
    new Set(second.messages.map((message) => message.id)).size,
    second.messages.length,
    'no bubble may share a React key after a repeated frame',
  );
});

// -- the remembered uid is one browser-wide value -----------------------

test('the remembered uid is shared by every tab, so a reloaded tab can adopt the continuation', () => {
  const storage = makeStorage();
  // Tab A was handed off and stored the target...
  setLastHistoryUid('mili', CONTINUATION, storage);
  // ...so tab B, reloaded later, reads the SAME value even though it never
  // saw the frame itself. This is the documented coupling, not per-tab state.
  assert.equal(getLastHistoryUid('mili', storage), CONTINUATION);

  const decision = decideHistoryResume([SOURCE], CONTINUATION, [CONTINUATION]);
  assert.deepEqual(decision, {
    type: 'resume',
    uid: CONTINUATION,
    source: 'continued',
  });

  clearLastHistoryUid('mili', storage);
  assert.equal(getLastHistoryUid('mili', storage), null);
});

test('a tab that never saw the frame keeps the source and shows no phantom banner', () => {
  const storage = makeStorage();
  setLastHistoryUid('mili', SOURCE, storage);
  const remembered = getLastHistoryUid('mili', storage);

  // The empty continuation exists server-side but this tab does not remember
  // it: the source is resumed, no new session is created, and the source
  // snapshot carries no continuation event (so no banner is invented).
  const decision = decideHistoryResume([SOURCE], remembered, [CONTINUATION]);
  assert.deepEqual(decision, { type: 'resume', uid: SOURCE, source: 'remembered' });

  const plainSnapshot = parseContinuationEvent({
    type: 'history-data',
    history_uid: SOURCE,
    messages: [],
  });
  assert.equal(plainSnapshot, null);
  assert.equal(
    continuationForSnapshot({
      event: plainSnapshot,
      displayedHistoryUid: SOURCE,
      displayedMessages: [],
    }),
    null,
  );
});

// -- two tabs on the SAME source converge on one continuation -----------

test('two tabs handed off from the same source render the same context once', () => {
  const event = parseContinuationEvent(handoffFrame()) as ContinuationEvent;
  const live: ChatRow[] = [
    row('msg:src-0', 'halo Mili'),
    row('msg:src-1', 'Halo!', 'ai'),
    row('msg:src-2', 'lanjut cerita kemarin yuk'),
  ];

  // Both tabs were showing the source, so both adopt their own live bubbles
  // as the context of the SAME target. The frame names one target only.
  const tabA = buildContinuation({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: live,
  });
  const tabB = buildContinuation({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: live,
  });

  assert.deepEqual(tabB, tabA);
  assert.equal(tabA.from, SOURCE);
  assert.equal(tabA.adopted, true);
  assert.equal(tabA.total, live.length);
  assert.deepEqual(
    tabB.messages.map((message) => message.id),
    live.map((message) => message.id),
    'both tabs keep the source rows identities: no re-keying, no new session',
  );

  // A repeated frame (server retry, or the other tab's copy) replaces the
  // context instead of appending a second copy of it.
  const repeated = buildContinuation({
    event,
    displayedHistoryUid: SOURCE,
    displayedMessages: live,
    previous: tabA,
  });
  assert.deepEqual(repeated, tabA);
  assert.equal(
    new Set(repeated.messages.map((message) => message.id)).size,
    repeated.messages.length,
  );
});

test('a reconnect during the cut rebuilds one continuation tail, not a duplicate', () => {
  const contextRows = Array.from({ length: 30 }, (_, index) => ({
    role: index % 2 === 0 ? 'human' : 'ai',
    content: `row ${index}`,
    msg_id: `src-${index}`,
  }));
  const snapshot = {
    type: 'history-data',
    history_uid: CONTINUATION,
    continued_from: SOURCE,
    continued_at: '2026-10-30T00:00:00+00:00',
    context_total: 30,
    context_messages: contextRows,
    messages: [],
  };
  const event = parseContinuationEvent(snapshot) as ContinuationEvent;

  const first = continuationForSnapshot({
    event,
    displayedHistoryUid: CONTINUATION,
    displayedMessages: [],
  });
  const afterSecondTab = continuationForSnapshot({
    event,
    displayedHistoryUid: CONTINUATION,
    displayedMessages: [],
  });
  const afterDuplicateSnapshot = continuationForSnapshot({
    event,
    displayedHistoryUid: CONTINUATION,
    displayedMessages: [],
    previous: first,
  });

  assert.ok(first);
  assert.equal(first?.from, SOURCE);
  assert.equal(first?.adopted, false, 'a reconnected tab uses the server tail');
  assert.equal(first?.total, 30);
  assert.equal(first?.messages.length, 24, 'the preview stays bounded');
  assert.deepEqual(afterSecondTab, first);
  assert.deepEqual(afterDuplicateSnapshot, first);
  assert.equal(
    new Set(first?.messages.map((message) => message.id)).size,
    first?.messages.length,
    'a second tab or a repeated snapshot adds no bubble',
  );
  // The preview is the tail, with ids that do not depend on which tab read it.
  assert.equal(first?.messages[0].id, 'msg:src-6');
  assert.equal(first?.messages.at(-1)?.id, 'msg:src-29');
});

