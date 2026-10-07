import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const context = read('../src/renderer/src/context/chat-history-context.tsx');
const handler = read('../src/renderer/src/services/websocket-handler.tsx');
const input = read('../src/renderer/src/hooks/footer/use-text-input.tsx');
const reconcile = read('../src/renderer/src/utils/history-reconcile.ts');

test('history-data never blindly replaces local messages', () => {
  assert.doesNotMatch(handler, /setMessages\(message\.messages\)/);
  assert.match(handler, /applyHistoryData\(message\.messages, message\.history_uid\)/);
});

test('new sessions adopt (not drop) an accepted optimistic message', () => {
  assert.doesNotMatch(handler, /setMessages\(\[\]\)/);
  assert.match(handler, /applyHistoryData\(\[\], message\.history_uid\)/);
});

test('chain-start retires superseded turns and forces a fresh AI bubble', () => {
  assert.match(handler, /noteChainStart\(message\?\.history_uid\)/);
  assert.match(handler, /conversation-turn-queued/);
  assert.match(context, /noteChainStart/);
  assert.match(context, /lastRequestRef/);
});

test('sends carry request ids for exact supersede matching', () => {
  assert.match(input, /appendHumanMessage\(messageText, timing\.requestId\)/);
  assert.match(context, /requestId\?: string/);
});

test('reconcile module stays dependency-free and bounded', () => {
  assert.doesNotMatch(reconcile, /^import /m);
  assert.match(reconcile, /MAX_PENDING/);
  assert.match(reconcile, /reconcileHistoryData/);
});

test('message ids are unique per append (no Date.now collisions)', () => {
  assert.match(context, /idSeqRef/);
});
