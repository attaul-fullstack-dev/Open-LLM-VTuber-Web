import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capPending,
  reconcileHistoryData,
} from '../src/renderer/src/utils/history-reconcile.ts';

const human = (id: string, content: string) => ({ id, role: 'human' as const, content });
const ai = (id: string, content: string) => ({ id, role: 'ai' as const, content });
const pend = (id: string, role: 'ai' | 'human', content: string, uid: string | null = 'h1') => ({
  uid, id, role, content,
});

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
