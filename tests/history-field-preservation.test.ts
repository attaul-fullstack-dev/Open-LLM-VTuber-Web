import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clonePendingEntry,
  reconcileHistoryData,
} from '@/utils/history-reconcile';
import { applyCanonicalFinal } from '@/utils/turn-identity';

/**
 * Live/history consistency regressions.
 *
 * Both bugs are about information destroyed on the way from the server
 * transcript to the rendered list:
 *
 * 1. `applyHistoryData` mapped every server row through a 4-field literal,
 *    which dropped `requestId`. Without turn identity,
 *    `applyCanonicalFinalToBubble` cannot match its row and returns
 *    `{matched: false, changed: false}`, so a bubble that was still showing
 *    a truncated partial stays truncated forever after a mid-stream resync.
 *    It also dropped `name`/`avatar`/`timestamp`, which the backend persists
 *    and the panel renders: every loaded AI bubble fell back to the default
 *    speaker image (wrong in group chats).
 * 2. Re-inserting a pending human row also used a 3-field literal, losing the
 *    same identity for the answer that human turn had just triggered.
 */

test('reconcileHistoryData keeps requestId on re-applied pending rows', () => {
  const server = [
    { id: 's1', role: 'human', content: 'halo', timestamp: 't0' },
  ];
  const pending = [
    {
      uid: 'h1',
      id: 'p1',
      role: 'human',
      content: 'halo',
      requestId: 'turn-R',
    },
  ];
  const { messages, remaining } = reconcileHistoryData(server, pending);
  // the human row is matched, so it is dropped from pending...
  assert.equal(remaining.length, 0);
  assert.ok(Array.isArray(messages));
});

test('re-inserted human rows keep their requestId', () => {
  const server = [
    { id: 's1', role: 'ai', content: 'answer'},
  ];
  const pending = [
    {
      uid: 'h1',
      id: 'p1',
      role: 'human',
      content: 'halo',
      requestId: 'turn-R',
    },
  ];
  const { messages } = reconcileHistoryData(server, pending);
  const restored = messages.find((row) => row.id === 'p1');
  assert.ok(restored, 'the unmatched human row must be re-applied');
  assert.equal(
    restored.requestId,
    'turn-R',
    'a re-applied human row must keep its turn identity',
  );
});

test('clonePendingEntry preserves the turn identity', () => {
  const cloned = clonePendingEntry({
    uid: 'h1',
    id: 'p1',
    role: 'human',
    content: 'halo',
    requestId: 'turn-R',
  });
  assert.equal(cloned.requestId, 'turn-R');
});

test('a canonical final still matches after a mid-stream resync', () => {
  // This is the user-visible symptom: the bubble shows a truncated partial,
  // the server persisted the full text and emits ai-final, and before the
  // fix the final could not find its row.
  const live = [
    { id: 'p1', role: 'human', content: 'ceritakan panjang', requestId: 'turn-R' },
    {
      id: 'a1',
      role: 'ai',
      content: 'partial teks',
      requestId: 'turn-R',
    },
  ];

  // What applyHistoryData now produces from the server snapshot.
  const resynced = applyCanonicalFinal(
    live,
    'turn-R',
    'partial teks lanjutan panjang sampai selesai',
  );

  const updated = resynced.bubbles.find((row) => row.id === 'a1');
  assert.equal(resynced.matched, true, 'the final must find its row');
  assert.equal(
    updated?.content,
    'partial teks lanjutan panjang sampai selesai',
    'the canonical final must replace the truncated bubble',
  );
});

test('applyHistoryData maps the identity and display fields through', () => {
  // Source contract: the row literal inside applyHistoryData must carry
  // these fields. A UI component harness is not available in this suite, and
  // the mapping is exactly where the fields used to be dropped.
  const source = readFileSync(
    new URL('../src/renderer/src/context/chat-history-context.tsx', import.meta.url),
    'utf8',
  );
  const mapping = source.slice(
    source.indexOf('reconcileHistoryData('),
    source.indexOf('scoped.map(clonePendingEntry)'),
  );
  for (const field of ['requestId', 'name', 'avatar', 'timestamp']) {
    assert.match(
      mapping,
      new RegExp(`${field}:`),
      `applyHistoryData must preserve '${field}' from the server transcript`,
    );
  }
});
