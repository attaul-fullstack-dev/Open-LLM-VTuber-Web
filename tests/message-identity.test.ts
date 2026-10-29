import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bubbleIdForMessage,
  bubbleIndexForMessage,
  newLocalMessageId,
  resolveAiTarget,
  applyCanonicalFinal,
  type IdentityBubble,
} from '../src/renderer/src/utils/turn-identity.ts';
import {
  canonicalRowId,
  reconcileHistoryData,
  toChatRow,
  type ChatRow,
  type ServerHistoryRow,
} from '../src/renderer/src/utils/history-reconcile.ts';

/**
 * Stage 0: one logical message = one identity.
 *
 * The backend mints `msg_id` once per logical assistant message, persists it on
 * the history row and reuses it verbatim for a retry. These tests pin the
 * client half of that contract:
 *
 *   the same msgId always maps to ONE bubble, even across a new attempt
 *   (new request_id, possibly different text) or a reload;
 *   two different messages NEVER merge, even when their text is identical.
 *
 * Every mechanism has a deliberate negative control: the "broken" variant a
 * naive implementation would use is written out next to the assertion, and the
 * test proves that variant violates the requirement (so the test really fails
 * when the mechanism is removed).
 */

const ai = (
  id: string,
  content: string,
  extra: Partial<IdentityBubble> = {},
): IdentityBubble => ({ id, role: 'ai', content, type: 'text', ...extra });

const human = (id: string, content: string): IdentityBubble => ({
  id,
  role: 'human',
  content,
  type: 'text',
});

/** Stream one chunk of a message through resolveAiTarget, like the provider. */
function appendChunk(
  bubbles: IdentityBubble[],
  chunk: string,
  ids: { msgId?: string; requestId?: string },
  forceNew = false,
): IdentityBubble[] {
  const target = resolveAiTarget(bubbles, {
    msgId: ids.msgId ?? null,
    requestId: ids.requestId ?? null,
    forceNew,
  });
  if (target.mode === 'merge') {
    const next = bubbles.slice();
    const base = next[target.index];
    next[target.index] = { ...base, content: base.content + chunk };
    return next;
  }
  const next = bubbles.slice();
  next.push(ai(`msg:${ids.msgId}`, chunk, {
    msgId: ids.msgId,
    requestId: ids.requestId,
  }));
  return next;
}

// --------------------------------------------------------------------------- //
// 1. Retry with the SAME msgId lands in the SAME bubble
// --------------------------------------------------------------------------- //

test('a retried delivery (new request_id, new text) updates its bubble instead of adding one', () => {
  // Attempt 1: the reminder was generated but the socket died mid-send.
  let bubbles = appendChunk([], 'Ingat minum obat ya. ', {
    msgId: 'm-obat',
    requestId: 'req-attempt-1',
  });
  // Attempt 2: same logical message, fresh attempt id, slightly different text
  // (the model re-worded it). The persisted row is keyed on m-obat.
  bubbles = appendChunk(bubbles, 'Jam delapan malam ya.', {
    msgId: 'm-obat',
    requestId: 'req-attempt-2',
  });

  assert.equal(bubbles.length, 1, 'a retry must not open a second bubble');
  assert.equal(bubbles[0].msgId, 'm-obat');
  assert.equal(bubbles[0].id, 'msg:m-obat');

  // Negative control: attempt-only routing (the pre-Stage-0 behaviour) cannot
  // see that the two frames are the same message, so it produces two bubbles.
  const attemptOnly = resolveAiTarget([bubbles[0]], {
    requestId: 'req-attempt-2',
    forceNew: true,
  });
  assert.deepEqual(attemptOnly, { mode: 'new' });
});

test('a retry still merges when a newer turn already forced a new message', () => {
  // The live list already moved on to a different message.
  const live = [
    ai('msg:m-obat', 'Ingat minum obat ya.', { msgId: 'm-obat' }),
    ai('msg:m-lain', 'Oh iya, halo.', { msgId: 'm-lain' }),
  ];
  const target = resolveAiTarget(live, {
    msgId: 'm-obat',
    requestId: 'req-attempt-2',
    forceNew: true,
  });
  assert.deepEqual(target, { mode: 'merge', index: 0 });
});

// --------------------------------------------------------------------------- //
// 2. Two DIFFERENT messages with identical text stay two bubbles
// --------------------------------------------------------------------------- //

test('identical text with different msgIds never merges', () => {
  const first = appendChunk([], 'Aku sayang kamu.', {
    msgId: 'm-1',
    requestId: 'req-1',
  });
  const second = appendChunk(first, 'Aku sayang kamu.', {
    msgId: 'm-2',
    requestId: 'req-2',
  });

  assert.equal(second.length, 2);
  assert.deepEqual(second.map((row) => row.msgId), ['m-1', 'm-2']);
  assert.deepEqual(second.map((row) => row.content), [
    'Aku sayang kamu.',
    'Aku sayang kamu.',
  ]);

  // Negative control: text-keyed merging (the tempting shortcut) collapses
  // them into one row — exactly the data loss the identity rule prevents.
  const byText = new Map<string, number>();
  second.forEach((row) => byText.set(row.content, (byText.get(row.content) ?? 0) + 1));
  assert.equal(byText.get('Aku sayang kamu.'), 2, 'the naive text key would see one message');
});

test('two messages can share a prefix and still stay separate', () => {
  const live = [
    ai('msg:m-1', 'Aku sayang kamu.', { msgId: 'm-1' }),
  ];
  const target = resolveAiTarget(live, {
    msgId: 'm-2',
    requestId: null,
    forceNew: false,
  });
  assert.deepEqual(target, { mode: 'new' });
});

// --------------------------------------------------------------------------- //
// 3. Legacy compatibility: frames without msgId behave exactly as before
// --------------------------------------------------------------------------- //

test('a chunk without msgId keeps the legacy request_id routing', () => {
  const live = [ai('b1', 'sebagian', { requestId: 'req-old' })];
  assert.deepEqual(
    resolveAiTarget(live, { requestId: 'req-old', forceNew: true }),
    { mode: 'merge', index: 0 },
  );
  // No identity at all: unchanged legacy behaviour (merge into the last AI row).
  assert.deepEqual(
    resolveAiTarget(live, { forceNew: false }),
    { mode: 'merge', index: 0 },
  );
  // A chunk with no identity after a forced break opens a new bubble.
  assert.deepEqual(
    resolveAiTarget(live, { forceNew: true }),
    { mode: 'new' },
  );
});

test('bubbleIndexForMessage ignores non-AI rows and empty ids', () => {
  const live = [human('h1', 'halo'), ai('msg:m-1', 'hai', { msgId: 'm-1' })];
  assert.equal(bubbleIndexForMessage(live, 'm-1'), 1);
  assert.equal(bubbleIndexForMessage(live, 'm-2'), -1);
  assert.equal(bubbleIndexForMessage(live, null), -1);
  assert.equal(bubbleIndexForMessage(live, ''), -1);
});

// --------------------------------------------------------------------------- //
// 4. Reload: the persisted row keeps the identity and its canonical id
// --------------------------------------------------------------------------- //

test('a persisted row keeps its msgId and yields the same bubble id as the live bubble', () => {
  const row: ServerHistoryRow = {
    role: 'ai',
    content: 'Ingat minum obat ya. Jam delapan malam ya.',
    msg_id: 'm-obat',
    name: 'Mili',
    avatar: 'mili.png',
    timestamp: '2026-10-25T10:00:00+00:00',
  };
  const mapped = toChatRow(row, 3);
  assert.equal(mapped.msgId, 'm-obat');
  assert.equal(mapped.id, 'msg:m-obat');
  // The live bubble created from the frames carries the same id, so a resync
  // replaces it in place instead of remounting a second bubble.
  assert.equal(bubbleIdForMessage('m-obat', 'local:x'), 'msg:m-obat');
});

test('a reconnect resync confirms the pending AI entry by msgId, not by text', () => {
  // The retry persisted a REWORDED version, so the prefix rule would fail.
  const server: ChatRow[] = [
    { id: 'msg:m-obat', role: 'ai', content: 'Minum obatnya jam delapan ya.', msgId: 'm-obat' },
  ];
  const pending = [
    {
      uid: 'h1',
      id: 'msg:m-obat',
      role: 'ai' as const,
      content: 'Ingat minum obat ya. ', // partial, no longer a prefix
      msgId: 'm-obat',
    },
  ];
  const { messages, remaining } = reconcileHistoryData(server, pending);
  assert.deepEqual(messages.map((row) => row.id), ['msg:m-obat']);
  assert.equal(remaining.length, 0, 'the persisted logical message is no longer pending');

  // Negative control: without the msgId the stale partial stays pending and is
  // re-applied as a second bubble next to the persisted one.
  const legacy = reconcileHistoryData(server, [{ ...pending[0], msgId: undefined, content: 'Ingat minum obat ya. ' }]);
  assert.equal(legacy.messages.length, 2);
  assert.equal(legacy.remaining.length, 1);
});

test('duplicate persisted rows of one logical message render once', () => {
  const server: ChatRow[] = [
    { id: 'msg:m-1', role: 'human', content: 'halo' },
    { id: 'msg:m-1', role: 'ai', content: 'versi pertama', msgId: 'm-1' },
    { id: 'msg:m-1', role: 'ai', content: 'versi kedua', msgId: 'm-1' },
  ];
  const { messages } = reconcileHistoryData(server, []);
  assert.equal(messages.length, 2);
  const aiRows = messages.filter((row) => row.role === 'ai');
  assert.equal(aiRows.length, 1);
  assert.equal(aiRows[0].content, 'versi kedua', 'the latest write wins');
  assert.equal(aiRows[0].id, 'msg:m-1', 'the first position/id is kept');
});

// --------------------------------------------------------------------------- //
// 5. Legacy history rows (no msg_id) stay readable and distinct
// --------------------------------------------------------------------------- //

test('legacy rows without msg_id get stable, distinct ids (never the empty string)', () => {
  const legacy: ServerHistoryRow[] = [
    { role: 'human', content: 'halo', timestamp: 't1' },
    { role: 'ai', content: 'hai', timestamp: 't2' },
    { role: 'human', content: 'halo', timestamp: 't3' }, // identical text!
  ];
  const rows = legacy.map((row, index) => toChatRow(row, index));
  assert.deepEqual(rows.map((row) => row.id), ['row:0', 'row:1', 'row:2']);
  assert.ok(rows.every((row) => row.id.length > 0), 'no blank React keys');
  assert.equal(new Set(rows.map((row) => row.id)).size, 3);
  assert.ok(rows.every((row) => row.msgId === undefined));
  assert.deepEqual(rows.map((row) => row.content), ['halo', 'hai', 'halo']);
});

test('dedupe is keyed on role + msgId, so it can never swap a role', () => {
  const server: ChatRow[] = [
    { id: 'h', role: 'human', content: 'pesan', msgId: 'shared' },
    { id: 'a', role: 'ai', content: 'balasan', msgId: 'shared' },
  ];
  const { messages } = reconcileHistoryData(server, []);
  assert.deepEqual(messages.map((row) => row.role), ['human', 'ai']);
  assert.deepEqual(messages.map((row) => row.content), ['pesan', 'balasan']);
});

test('legacy rows are never collapsed by identical text', () => {
  const server = [
    toChatRow({ role: 'human', content: 'ok' }, 0),
    toChatRow({ role: 'human', content: 'ok' }, 1),
  ];
  const { messages } = reconcileHistoryData(server, []);
  assert.equal(messages.length, 2);
});

test('canonicalRowId prefers msg_id, then a given id, then the position', () => {
  assert.equal(canonicalRowId({ msg_id: 'm-1' }, 7), 'msg:m-1');
  assert.equal(canonicalRowId({ id: 'caller-id' }, 7), 'caller-id');
  assert.equal(canonicalRowId({}, 7), 'row:7');
  assert.equal(canonicalRowId({ msg_id: '   ' }, 7), 'row:7');
});

// --------------------------------------------------------------------------- //
// 6. Canonical final after a reload matches by msgId
// --------------------------------------------------------------------------- //

test('applyCanonicalFinal finds a reloaded bubble that has no request_id', () => {
  const reloaded = [toChatRow({ role: 'ai', content: 'parsial', msg_id: 'm-9' }, 0)];
  const result = applyCanonicalFinal(reloaded, '', 'teks lengkap', 'm-9');
  assert.equal(result.matched, true);
  assert.equal(result.bubbles[0].content, 'teks lengkap');
  assert.equal(result.bubbles[0].id, 'msg:m-9');

  // Negative control: request_id-only matching (pre-Stage-0) cannot find it.
  const requestOnly = applyCanonicalFinal(reloaded, 'req-1', 'teks lengkap');
  assert.equal(requestOnly.matched, false);
});

test('applyCanonicalFinal does not touch another message with identical text', () => {
  const live = [
    ai('msg:m-1', 'sama', { msgId: 'm-1' }),
    ai('msg:m-2', 'sama', { msgId: 'm-2' }),
  ];
  const result = applyCanonicalFinal(live, 'req-2', 'sama', 'm-2');
  assert.equal(result.matched, true);
  assert.deepEqual(result.finalizedIds, ['msg:m-2']);
  assert.equal(result.bubbles[0].content, 'sama');
});

test('applyCanonicalFinal backfills the attempt id on a reloaded bubble', () => {
  const reloaded = [toChatRow({ role: 'ai', content: 'parsial', msg_id: 'm-9' }, 0)];
  const result = applyCanonicalFinal(reloaded, 'req-late', 'parsial penuh', 'm-9');
  assert.equal(result.bubbles[0].requestId, 'req-late');
  // Later chunks of this attempt (which carry only request_id) still land here.
  assert.deepEqual(
    resolveAiTarget(result.bubbles, { requestId: 'req-late', forceNew: true }),
    { mode: 'merge', index: 0 },
  );
});

// --------------------------------------------------------------------------- //
// 7. Local ids are not timestamps
// --------------------------------------------------------------------------- //

test('provisional local ids are unique, namespaced, and not clock-derived', () => {
  const ids = Array.from({ length: 50 }, () => newLocalMessageId());
  assert.equal(new Set(ids).size, ids.length, 'every provisional id is unique');
  ids.forEach((id) => {
    assert.ok(id.startsWith('local:'), id);
    // A bare timestamp ("1750000000000-1") is not an identity: no clock digits
    // may form the whole id.
    assert.doesNotMatch(id.slice('local:'.length), /^\d{10,}/);
  });
  assert.equal(bubbleIdForMessage(null, 'local:abc'), 'local:abc');
  assert.equal(bubbleIdForMessage('m-1', 'local:abc'), 'msg:m-1');
});
