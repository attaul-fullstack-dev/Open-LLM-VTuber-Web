import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildContinuation,
  continuationForSnapshot,
  parseContinuationEvent,
  type ContinuationEvent,
} from '../src/renderer/src/utils/history-continuation.ts';
import {
  reconcileHistoryData,
  toChatRow,
  type ChatRow,
} from '../src/renderer/src/utils/history-reconcile.ts';
import { decideHistoryResume } from '../src/renderer/src/utils/history-storage.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** A `history-data` frame exactly as the backend builds it (snake_case). */
const backendFrame = (overrides: Record<string, unknown> = {}) => ({
  type: 'history-data',
  history_uid: 'new-history',
  messages: [],
  continued_from: 'old-history',
  continued_at: '2026-10-28T10:00:00+00:00',
  context_messages: [
    {
      role: 'human',
      content: 'halo Mili',
      timestamp: '2026-10-27T09:00:00+00:00',
      msg_id: 'src-0',
    },
    {
      role: 'ai',
      content: 'Halo! Ada yang bisa dibantu?',
      timestamp: '2026-10-27T09:00:05+00:00',
      name: 'Mili',
      msg_id: 'src-1',
    },
  ],
  context_total: 2,
  ...overrides,
});

const row = (id: string, content: string, role: 'ai' | 'human' = 'human'): ChatRow => ({
  id, role, content,
});

const messagesSnapshot = (rows: ChatRow[]) => JSON.parse(JSON.stringify(rows));

// -- parsing ------------------------------------------------------------

test('parses the backend continuation frame', () => {
  const event = parseContinuationEvent(backendFrame());
  assert.ok(event);
  assert.equal(event?.from, 'old-history');
  assert.equal(event?.at, '2026-10-28T10:00:00+00:00');
  assert.equal(event?.total, 2);
  assert.equal(event?.context?.length, 2);
});

test('an ordinary session frame carries no continuation', () => {
  assert.equal(parseContinuationEvent({ type: 'history-data', history_uid: 'x' }), null);
  assert.equal(parseContinuationEvent({ continued_from: '   ' }), null);
  assert.equal(parseContinuationEvent(null), null);
  assert.equal(parseContinuationEvent(undefined), null);
});

test('malformed continuation fields are ignored, never invented', () => {
  const event = parseContinuationEvent({
    continued_from: 'old-history',
    context_messages: 'not-an-array',
    context_total: -3,
  });
  assert.deepEqual(event, { from: 'old-history' });
});

// -- hand-off on the live tab -------------------------------------------

test('the live tab adopts its own bubbles as context, unchanged', () => {
  const live: ChatRow[] = [
    row('msg:src-0', 'halo Mili'),
    row('msg:src-1', 'Halo! Ada yang bisa dibantu?', 'ai'),
  ];
  const before = messagesSnapshot(live);
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;

  const view = buildContinuation({
    event,
    displayedHistoryUid: 'old-history',
    displayedMessages: live,
  });

  assert.equal(view.adopted, true);
  assert.equal(view.from, 'old-history');
  // Same objects in the same order: no identity, timestamp or text rewrite.
  assert.deepEqual(view.messages, before);
  assert.equal(view.messages[0], live[0]);
  // Nothing lost, nothing duplicated.
  assert.equal(view.messages.length, live.length);
  assert.equal(view.total, 2);
});

test('a single hand-off event leaves the session rows list empty', () => {
  // The continuation view never becomes part of `messages`: it is context.
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const view = buildContinuation({
    event,
    displayedHistoryUid: 'old-history',
    displayedMessages: [row('msg:src-0', 'halo Mili')],
  });
  assert.equal(view.messages.length, 1);
  // `applyHistoryData([], ...)` reconciles to zero rows; the helper itself
  // only owns the context, so this stays a statement about the contract.
  assert.ok(!('sessionMessages' in view));
});

test('a tab showing another conversation does not adopt its own bubbles', () => {
  const otherTab: ChatRow[] = [row('msg:x1', 'percakapan lain')];
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const view = buildContinuation({
    event,
    displayedHistoryUid: 'unrelated-history',
    displayedMessages: otherTab,
  });
  assert.equal(view.adopted, false);
  assert.equal(view.messages.length, 2);
  assert.deepEqual(
    view.messages.map((item) => item.msgId),
    ['src-0', 'src-1'],
  );
  assert.ok(!view.messages.some((item) => item.content === 'percakapan lain'));
});

// -- resumed / reconnected tab ------------------------------------------

test('a resumed tab renders the server preview with every identity kept', () => {
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const view = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });

  assert.equal(view.adopted, false);
  assert.equal(view.total, 2);
  assert.deepEqual(
    view.messages.map((item) => item.msgId),
    ['src-0', 'src-1'],
  );
  assert.deepEqual(
    view.messages.map((item) => item.timestamp),
    ['2026-10-27T09:00:00+00:00', '2026-10-27T09:00:05+00:00'],
  );
  assert.deepEqual(
    view.messages.map((item) => item.content),
    ['halo Mili', 'Halo! Ada yang bisa dibantu?'],
  );
  assert.equal(view.messages[1].name, 'Mili');
});

test('re-applying the same snapshot replaces the preview instead of appending', () => {
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const first = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  const second = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
    previous: first,
  });
  assert.deepEqual(second, first);
  assert.equal(second.messages.length, 2);
});

test('a frame without a preview keeps the view this tab already holds', () => {
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const first = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  const stripped = { from: 'old-history', total: 2 } as ContinuationEvent;
  const second = buildContinuation({
    event: stripped,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
    previous: first,
  });
  assert.deepEqual(second.messages, first.messages);
  // The stamp the tab already knows is kept; a bare frame cannot erase it.
  assert.equal(second.at, first.at);
  assert.equal(second.from, 'old-history');
});

test('a different source replaces the view, it never merges two conversations', () => {
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const first = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  const other = buildContinuation({
    event: { from: 'another-source', total: 0 },
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
    previous: first,
  });
  assert.equal(other.from, 'another-source');
  assert.deepEqual(other.messages, []);
});

test('ordinary sessions clear a stale continuation banner', () => {
  assert.equal(
    continuationForSnapshot({
      event: null,
      displayedHistoryUid: 'new-history',
      displayedMessages: [],
    }),
    null,
  );
});

test('the preview stays bounded and keeps positional ids stable for legacy rows', () => {
  const rows = Array.from({ length: 30 }, (_, index) => ({
    // No msg_id on the oldest half: those rows get positional identity.
    ...(index >= 15 ? { msg_id: `src-${index}` } : {}),
    role: index % 2 === 0 ? 'human' : 'ai',
    content: `pesan ${index}`,
    timestamp: `2026-10-27T09:${String(index).padStart(2, '0')}:00+00:00`,
  }));
  const event = parseContinuationEvent(
    backendFrame({ context_messages: rows, context_total: rows.length }),
  ) as ContinuationEvent;

  const view = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  assert.equal(view.total, 30);
  assert.equal(view.messages.length, 24);
  assert.equal(view.messages[0].content, 'pesan 6');
  // The same row must have the same id seen through a full fetch or this slice.
  const full = rows.map((item, index) => toChatRow(item, index));
  assert.deepEqual(
    view.messages.map((item) => item.id),
    full.slice(-24).map((item) => item.id),
  );
});

test('a retried row collapses by identity, identical text with different ids does not', () => {
  const event = parseContinuationEvent(backendFrame({
    context_messages: [
      { role: 'human', content: 'halo', timestamp: 't1', msg_id: 'same' },
      { role: 'human', content: 'halo (retry)', timestamp: 't2', msg_id: 'same' },
      { role: 'ai', content: 'hai', timestamp: 't3', msg_id: 'other' },
      { role: 'ai', content: 'hai', timestamp: 't4', msg_id: 'third' },
    ],
    context_total: 4,
  })) as ContinuationEvent;
  const view = buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  assert.equal(view.messages.length, 3);
  assert.deepEqual(
    view.messages.map((item) => item.msgId),
    ['same', 'other', 'third'],
  );
  // The surviving retry row keeps its latest content, not a rewrite.
  assert.equal(view.messages[0].content, 'halo (retry)');
});

test('context rows are never mutated by building the view', () => {
  const frame = backendFrame();
  const before = JSON.parse(JSON.stringify(frame));
  const event = parseContinuationEvent(frame) as ContinuationEvent;
  buildContinuation({
    event,
    displayedHistoryUid: 'new-history',
    displayedMessages: [],
  });
  assert.deepEqual(frame, before);
});

/**
 * Production order for one `history-data` frame, as ChatHistoryProvider runs
 * it: resolve the continuation against the DISPLAYED history, then reconcile
 * the session's own rows. The session list never absorbs context rows.
 */
function applySnapshot(input: {
  rows: Parameters<typeof toChatRow>[0][];
  uid: string;
  displayedUid: string | null;
  displayed: ChatRow[];
  event?: ContinuationEvent | null;
  previous?: ReturnType<typeof buildContinuation> | null;
}) {
  const continuation = continuationForSnapshot({
    event: input.event ?? null,
    displayedHistoryUid: input.displayedUid,
    displayedMessages: input.displayed,
    previous: input.previous,
  });
  const { messages } = reconcileHistoryData(
    input.rows.map((row, index) => toChatRow(row, index)),
    [],
  );
  return { continuation, messages };
}

test('after a hand-off the first new row lands alone, context stays context', () => {
  const live: ChatRow[] = [
    row('msg:src-0', 'halo Mili'),
    row('msg:src-1', 'Halo! Ada yang bisa dibantu?', 'ai'),
  ];
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;

  const snapshot = applySnapshot({
    // The new session's own snapshot: one persisted row.
    rows: [{
      role: 'human',
      content: 'lanjut ya',
      timestamp: '2026-10-28T10:01:00+00:00',
      msg_id: 'new-0',
    }],
    uid: 'new-history',
    displayedUid: 'old-history',
    displayed: live,
    event,
  });

  assert.ok(snapshot.continuation);
  assert.equal(snapshot.continuation?.from, 'old-history');
  assert.equal(snapshot.continuation?.adopted, true);
  assert.deepEqual(
    snapshot.continuation?.messages.map((item) => item.content),
    ['halo Mili', 'Halo! Ada yang bisa dibantu?'],
  );
  // The session list holds only this session's rows: the old conversation is
  // shown as context, never as rows this transcript silently gained.
  assert.deepEqual(snapshot.messages.map((item) => item.content), ['lanjut ya']);
});

test('reapplying the new session snapshot never duplicates either side', () => {
  const event = parseContinuationEvent(backendFrame()) as ContinuationEvent;
  const rows = [
    { role: 'human', content: 'halo Mili', timestamp: '2026-10-27T09:00:00+00:00', msg_id: 'src-0' },
    { role: 'ai', content: 'Halo! Ada yang bisa dibantu?', timestamp: '2026-10-27T09:00:05+00:00', msg_id: 'src-1' },
  ];
  const first = applySnapshot({
    rows,
    uid: 'new-history',
    displayedUid: 'new-history',
    displayed: [],
    event,
  });
  const second = applySnapshot({
    rows,
    uid: 'new-history',
    displayedUid: 'new-history',
    displayed: [],
    event,
    previous: first.continuation,
  });
  assert.deepEqual(second, first);
  assert.equal(second.continuation?.messages.length, 2);
});

// -- resume fallback ----------------------------------------------------

test('resumes the remembered conversation when it still exists', () => {
  assert.deepEqual(decideHistoryResume(['a', 'b'], 'b'), {
    type: 'resume',
    uid: 'b',
    source: 'remembered',
  });
});

test('a remembered empty hand-off target is resumed as a continuation', () => {
  // Stage 4.10: the target has no rows yet, so it is not in the conversation
  // list -- but the tab remembers it and the backend vouches for its lineage.
  // Resuming the source instead silently dropped the continuation.
  assert.deepEqual(
    decideHistoryResume(['source', 'older'], 'continuation', ['continuation']),
    { type: 'resume', uid: 'continuation', source: 'continued' },
  );
});

test('a resumable uid is only adopted by a tab that remembers it', () => {
  // Nothing remembered: never adopt an unreferenced empty session.
  assert.deepEqual(decideHistoryResume(['source'], null, ['continuation']), {
    type: 'resume', uid: 'source', source: 'newest',
  });
  assert.deepEqual(decideHistoryResume([], null, ['continuation']), {
    type: 'create',
  });
  // Remembered uid that is neither listed nor vouched for keeps falling back.
  assert.deepEqual(decideHistoryResume(['source'], 'deleted', ['continuation']), {
    type: 'resume', uid: 'source', source: 'newest',
  });
});

test('a listed conversation wins over the resumable list', () => {
  assert.deepEqual(
    decideHistoryResume(['b', 'a'], 'b', ['b', 'continuation']),
    { type: 'resume', uid: 'b', source: 'remembered' },
  );
});

test('blank entries in the resumable list are ignored', () => {
  assert.deepEqual(decideHistoryResume(['real'], '', ['', '   ']), {
    type: 'resume', uid: 'real', source: 'newest',
  });
  assert.deepEqual(decideHistoryResume(['real'], 'gone', ['', 'other']), {
    type: 'resume', uid: 'real', source: 'newest',
  });
});

test('a remembered uid that vanished falls back to the available list', () => {
  assert.deepEqual(decideHistoryResume(['newest', 'older'], 'deleted'), {
    type: 'resume',
    uid: 'newest',
    source: 'newest',
  });
  assert.deepEqual(decideHistoryResume(['only'], null), {
    type: 'resume',
    uid: 'only',
    source: 'newest',
  });
});

test('an empty list still means a new conversation', () => {
  assert.deepEqual(decideHistoryResume([], 'gone'), { type: 'create' });
  assert.deepEqual(decideHistoryResume([], null), { type: 'create' });
});

test('blank entries in the list are not resumable', () => {
  assert.deepEqual(decideHistoryResume(['', 'real'], null), {
    type: 'resume',
    uid: 'real',
    source: 'newest',
  });
});

// -- wiring (contract against drift) ------------------------------------

const handler = read('../src/renderer/src/services/websocket-handler.tsx');
const context = read('../src/renderer/src/context/chat-history-context.tsx');
const panel = read('../src/renderer/src/components/sidebar/chat-history-panel.tsx');

test('history-data forwards the continuation event to the chat state', () => {
  const start = handler.indexOf("case 'history-data'");
  assert.ok(start >= 0);
  const window = handler.slice(start, start + 1600);
  assert.ok(window.includes('parseContinuationEvent('), 'continuation not parsed');
  assert.ok(window.includes('applyHistoryData('), 'snapshot not applied');
});

test('a hand-off never calls applyHistoryData without its continuation', () => {
  const start = handler.indexOf("case 'new-history-created'");
  assert.ok(start >= 0);
  const window = handler.slice(start, start + 2200);
  assert.ok(window.includes('parseContinuationEvent('), 'hand-off event not parsed');
  assert.ok(
    !window.includes('applyHistoryData([], message.history_uid)'),
    'hand-off would render as an empty session',
  );
  assert.ok(window.includes('continued_from'), 'list entry loses its link');
});

test('history-list hands the resumable list to the resume decision', () => {
  const start = handler.indexOf("case 'history-list'");
  assert.ok(start >= 0);
  const window = handler.slice(start, start + 2600);
  assert.ok(window.includes('resumable_sessions'), 'resumable list not read');
  assert.ok(
    window.includes('decideHistoryResume('),
    'resume decision not taken',
  );
  assert.ok(
    window.includes("decision.source === 'continued'"),
    'an adopted empty continuation is not reflected in the sidebar',
  );
});

test('the chat context exposes the continuation as read-only state', () => {
  assert.ok(context.includes('continuation: ContinuationView | null'));
  assert.ok(context.includes('continuationForSnapshot('));
  assert.ok(context.includes('continuation,'));
});

test('the panel renders a banner and keeps context out of the live list', () => {
  assert.ok(panel.includes('continuation-banner'));
  assert.ok(panel.includes('history.continuedFrom'));
  assert.ok(panel.includes('visibleContinuation'));
  // The context block must be driven by `continuation.messages`, never mixed
  // into `messages` (which only ever holds this session's own rows).
  assert.ok(panel.includes('continuation?.messages'));
});
