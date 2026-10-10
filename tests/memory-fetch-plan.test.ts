import assert from 'node:assert/strict';
import test from 'node:test';
import { planMemoryFetch } from '../src/renderer/src/utils/memory-fetch-plan.ts';

test('fetch before history resume is deferred (pre-resume race)', () => {
  assert.equal(planMemoryFetch('OPEN', null, null), 'waiting');
  assert.equal(planMemoryFetch('OPEN', undefined, null), 'waiting');
  assert.equal(planMemoryFetch('OPEN', '', null), 'waiting');
});

test('refetch once the history uid becomes available', () => {
  assert.equal(planMemoryFetch('OPEN', 'hist-a', null), 'fetch');
  assert.equal(planMemoryFetch('OPEN', 'hist-a', ''), 'fetch');
});

test('switching history refetches; repeating the same uid does not', () => {
  assert.equal(planMemoryFetch('OPEN', 'hist-b', 'hist-a'), 'fetch');
  assert.equal(planMemoryFetch('OPEN', 'hist-a', 'hist-a'), 'skip');
});

test('closed socket waits, and never duplicates a pending fetch', () => {
  assert.equal(planMemoryFetch('CONNECTING', 'hist-a', null), 'waiting');
  assert.equal(planMemoryFetch('CLOSED', 'hist-a', 'hist-a'), 'waiting');
});

test('reconnect (cleared guard) refetches the resumed history', () => {
  assert.equal(planMemoryFetch('OPEN', 'hist-a', null), 'fetch');
});

test('decision covers every rendered state combination deterministically', () => {
  const states = ['OPEN', 'CLOSED', 'CONNECTING', 'CLOSING'];
  const uids = [null, undefined, '', 'hist-a', 'hist-a'];
  const last = [null, 'hist-a', 'hist-b'];
  for (const wsState of states) {
    for (const historyUid of uids) {
      for (const lastFetchedUid of last) {
        const decision = planMemoryFetch(wsState, historyUid, lastFetchedUid);
        assert.ok(
          ['waiting', 'fetch', 'skip'].includes(decision),
          `unexpected decision ${decision}`,
        );
        if (wsState !== 'OPEN') {
          assert.equal(decision, 'waiting', `${wsState}/${historyUid}`);
        } else if (!historyUid) {
          assert.equal(decision, 'waiting', `empty uid/${lastFetchedUid}`);
        } else if (historyUid === lastFetchedUid) {
          assert.equal(decision, 'skip', `same uid/${lastFetchedUid}`);
        } else {
          assert.equal(decision, 'fetch', `new uid/${lastFetchedUid}`);
        }
      }
    }
  }
});
