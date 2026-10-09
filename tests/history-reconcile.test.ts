import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capPending,
  clonePendingEntry,
  reconcileHistoryData,
  retireSupersededPending,
} from '../src/renderer/src/utils/history-reconcile.ts';

const human = (id: string, content: string) => ({ id, role: 'human' as const, content });
const ai = (id: string, content: string) => ({ id, role: 'ai' as const, content });
const pend = (id: string, role: 'ai' | 'human', content: string, uid: string | null = 'h1') => ({
  uid, id, role, content,
});

/**
 * Mirror of ChatHistoryProvider's wiring so the pure helpers are exercised in
 * exactly the production order: scope -> clone(preserve identity) -> reconcile
 * -> cap. Pre-fix, `clone` was an inline `{uid,id,role,content}` literal that
 * dropped requestId; anything regression-shaped must go through here.
 */
function applySnapshot(
  server: ReturnType<typeof human>[],
  pending: { uid: string | null; id: string; role: 'ai' | 'human'; content: string; requestId?: string }[],
  target: string | null = 'h1',
) {
  const scoped = pending.filter((e) => e.uid === target || e.uid == null);
  const others = pending.filter((e) => !(e.uid === target || e.uid == null));
  const { messages, remaining } = reconcileHistoryData(
    server as Parameters<typeof reconcileHistoryData>[0],
    scoped.map(clonePendingEntry),
  );
  return { messages, pending: capPending([...others, ...remaining]) };
}

const contents = (rows: { content: string }[]) => rows.map((r) => r.content);
const roles = (rows: { role: string }[]) => rows.map((r) => r.role);

test('1. normal resync without pending behaves exactly like replacement', () => {
  const server = [human('s1', 'halo'), ai('s2', 'hai juga')];
  const { messages, remaining } = reconcileHistoryData(server, []);
  assert.deepEqual(messages, server);
  assert.deepEqual(remaining, []);
});

test('2. accepted message survives a racing resync (the core invariant)', () => {
  const server = [human('s1', 'halo')];
  const { messages, remaining } = reconcileHistoryData(server, [pend('p1', 'human', 'pesan baru')]);
  assert.deepEqual(messages.map((m) => m.content), ['halo', 'pesan baru']);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'p1');
});

test('3. reconnect resync with persisted message clears pending, no duplicate', () => {
  const server = [human('s1', 'halo'), human('s2', 'pesan baru')];
  const { messages, remaining } = reconcileHistoryData(server, [pend('p1', 'human', 'pesan baru')]);
  assert.deepEqual(messages.map((m) => m.content), ['halo', 'pesan baru']);
  assert.deepEqual(remaining, []);
});

test('4. stale snapshot cannot erase newer local state', () => {
  const server = [human('s1', 'lama')];
  const pending = [pend('p1', 'human', 'baru1'), pend('p2', 'human', 'baru2')];
  const { messages, remaining } = reconcileHistoryData(server, pending);
  assert.deepEqual(messages.map((m) => m.content), ['lama', 'baru1', 'baru2']);
  assert.equal(remaining.length, 2);
});

test('5. duplicate identical sends match oldest-first, no duplication', () => {
  const server = [human('s1', 'ok')];
  const pending = [pend('p1', 'human', 'ok'), pend('p2', 'human', 'ok')];
  const { messages, remaining } = reconcileHistoryData(server, pending);
  // One snapshot "ok" confirms the oldest pending; the newer stays pending.
  assert.deepEqual(messages.map((m) => m.content), ['ok', 'ok']);
  assert.deepEqual(remaining.map((r) => r.id), ['p2']);
});

test('6. rapid resend cancelled pre-persist keeps true order (older first)', () => {
  // M1 was cancelled before persist; only M2 reached the snapshot.
  const server = [human('s0', 'awal'), human('s2', 'kedua')];
  const pending = [pend('p1', 'human', 'pertama'), pend('p2', 'human', 'kedua')];
  const { messages, remaining } = reconcileHistoryData(server, pending);
  assert.deepEqual(messages.map((m) => m.content), ['awal', 'pertama', 'kedua']);
  assert.deepEqual(remaining.map((r) => r.id), ['p1']);
});

test('7. in-flight AI partial is re-applied, completed response is not duplicated', () => {
  const partial = [human('s1', 'tanya'), ai('s9', 'jawab')];
  const first = reconcileHistoryData([human('s1', 'tanya')], [pend('a1', 'ai', 'jawab')]);
  assert.deepEqual(first.messages.map((m) => m.content), ['tanya', 'jawab']);
  assert.equal(first.remaining.length, 1);
  const second = reconcileHistoryData(partial, first.remaining);
  assert.deepEqual(second.messages.map((m) => m.content), ['tanya', 'jawab']);
  assert.deepEqual(second.remaining, []);
});

test('8. dead stream partial is a prefix of nothing: kept once, never crashes', () => {
  const server = [human('s1', 'tanya'), human('s2', 'lanjut')];
  const { messages, remaining } = reconcileHistoryData(server, [pend('a1', 'ai', 'sebagian')]);
  assert.deepEqual(messages.map((m) => m.content), ['tanya', 'lanjut', 'sebagian']);
  assert.equal(remaining.length, 1);
});

test('9. empty/corrupt snapshots are tolerated', () => {
  const r1 = reconcileHistoryData([], [pend('p1', 'human', 'x')]);
  assert.deepEqual(r1.messages.map((m) => m.content), ['x']);
  const r2 = reconcileHistoryData(null as never, []);
  assert.deepEqual(r2.messages, []);
});

test('10. pending list is bounded', () => {
  const many = Array.from({ length: 150 }, (_, i) => pend(`p${i}`, 'human', `m${i}`));
  assert.equal(capPending(many).length, 100);
  assert.equal(capPending(many)[0].id, 'p50');
});

// ---------------------------------------------------------------------------
// Pending-entry turn identity (phantom-message regression)
// ---------------------------------------------------------------------------

test('11. clonePendingEntry preserves turn identity (the defect)', () => {
  const entry = { uid: 'h1', id: 'p1', role: 'human' as const, content: 'x', requestId: 'req-1' };
  const cloned = clonePendingEntry(entry);
  assert.equal(cloned.requestId, 'req-1', 'requestId must survive re-serialization');
  assert.deepEqual({ ...cloned }, { ...entry });

  // Legacy entries without identity keep the previous shape (no phantom key).
  const legacy = clonePendingEntry({ uid: null, id: 'p2', role: 'human', content: 'y' });
  assert.deepEqual(legacy, { uid: null, id: 'p2', role: 'human', content: 'y' });
  assert.ok(!('requestId' in legacy));
});

test('12. retireSupersededPending only retires entries it can identify', () => {
  const entries = [
    { uid: 'h1', id: 'a', role: 'ai' as const, content: 'partial', requestId: 'old' },
    { uid: 'h1', id: 'b', role: 'human' as const, content: 'superseded', requestId: 'old' },
    { uid: 'h1', id: 'c', role: 'human' as const, content: 'latest', requestId: 'new' },
    { uid: 'other', id: 'd', role: 'human' as const, content: 'other-history', requestId: 'old' },
    { uid: 'h1', id: 'e', role: 'human' as const, content: 'legacy' },
  ];
  const kept = retireSupersededPending(entries, 'new', 'h1').map((e) => e.id);
  // 'a' is an AI leftover (always dropped), 'b' belongs to the superseded turn,
  // 'c' is the just-accepted send, 'd' belongs to another history, 'e' is
  // legacy (no identity -> original never-retire behaviour).
  assert.deepEqual(kept, ['c', 'd', 'e']);
  assert.deepEqual(retireSupersededPending(entries, undefined, 'h1').map((e) => e.id),
    ['b', 'c', 'd', 'e'], 'no known latest keeps every identified entry');
});

// The exact production sequence from the E2E audit that reproduced the phantom.
test('13. PHANTOM REGRESSION: stale snapshot -> superseding turn -> resync', () => {
  const R1 = 'req-1';
  const R2 = 'req-2';
  const R3 = 'req-3';
  const server1 = [human('s1', 'Pesan pertama'), ai('s2', 'A1')];

  // Turn 1 completed and persisted: both of its rows exist pending-side too.
  let pending = [
    { uid: 'h1', id: 'p1', role: 'human' as const, content: 'Pesan pertama', requestId: R1 },
    { uid: 'h1', id: 'a1', role: 'ai' as const, content: 'A1', requestId: R1 },
  ];

  // (1) optimistic accept of turn 2, then (2) a rapid follow-up for turn 3.
  pending = [
    ...pending,
    { uid: 'h1', id: 'p2', role: 'human' as const, content: 'Pesan kedua', requestId: R2 },
    { uid: 'h1', id: 'p3', role: 'human' as const, content: 'Pesan ketiga', requestId: R3 },
  ];
  // Turn 2 was cancelled: the server never persisted it.

  // (3) A stale history-data lands in the interrupt window.
  let step = applySnapshot(server1, pending);
  // ...and the accepted-but-unpersisted sends must NOT be lost by it.
  assert.deepEqual(contents(step.messages),
    ['Pesan pertama', 'A1', 'Pesan kedua', 'Pesan ketiga']);
  assert.equal(step.pending.length, 2);

  // (4) Turn 3's chain-start supersedes turn 2's leftovers.
  const latest = R3;
  step = { ...step, pending: retireSupersededPending(step.pending, latest, 'h1') };
  assert.deepEqual(step.pending.map((e) => e.id), ['p3']);

  // (5) Reconnect/resync: the canonical transcript has turn 1 + turn 3 only.
  const server3 = [...server1, human('s3', 'Pesan ketiga'), ai('s4', 'A3')];
  step = applySnapshot(server3, step.pending);
  assert.deepEqual(roles(step.messages), ['human', 'ai', 'human', 'ai']);
  assert.deepEqual(contents(step.messages),
    ['Pesan pertama', 'A1', 'Pesan ketiga', 'A3']);
  assert.deepEqual(step.pending, [], 'nothing unconfirmed is left');

  // (6) A SECOND resync must not resurrect the phantom.
  step = applySnapshot(server3, step.pending);
  assert.deepEqual(contents(step.messages),
    ['Pesan pertama', 'A1', 'Pesan ketiga', 'A3']);
  assert.ok(!contents(step.messages).includes('Pesan kedua'), 'no phantom row');
});

test('14. identity survives any number of resyncs (idempotent, no phantom)', () => {
  const R1 = 'req-1';
  const R2 = 'req-2';
  let pending = [
    { uid: 'h1', id: 'p1', role: 'human' as const, content: 'm1', requestId: R1 },
    { uid: 'h1', id: 'p2', role: 'human' as const, content: 'm2', requestId: R2 },
  ];
  const stale = [human('s1', 'm1')];

  for (let i = 0; i < 5; i += 1) {
    pending = applySnapshot(stale, pending).pending;
  }
  assert.deepEqual(pending.map((e) => e.id), ['p2']);
  assert.equal(pending[0].requestId, R2, 'requestId must survive every resync');

  // A resync can retire nothing once the identity is intact.
  pending = retireSupersededPending(pending, R2, 'h1');
  assert.deepEqual(pending.map((e) => e.id), ['p2']);
});

test('15. legacy pending entries keep their never-retire behaviour', () => {
  // (a) content already persisted: confirmed once, never duplicated.
  let step = applySnapshot([human('s1', 'lama')], [pend('p1', 'human', 'lama')]);
  assert.deepEqual(contents(step.messages), ['lama']);
  assert.deepEqual(step.pending, []);

  // (b) content NOT persisted: re-applied by every resync, and it is never
  // retired by noteChainStart because there is no turn identity to compare.
  let legacy = [pend('p1', 'human', 'lama')];
  for (let i = 0; i < 3; i += 1) {
    step = applySnapshot([human('s0', 'lain')], legacy);
    assert.deepEqual(contents(step.messages), ['lain', 'lama']);
    legacy = step.pending;
  }
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].content, 'lama');
  assert.ok(!('requestId' in legacy[0]));
  assert.deepEqual(retireSupersededPending(legacy, 'req-x', 'h1').length, 1);
});
