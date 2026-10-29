import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACK_OUTBOX_CORRUPT_KEY,
  ACK_OUTBOX_KEY,
  ACK_OUTBOX_LIMIT,
  ackKey,
  createAckOutbox,
  mergeAckOutbox,
  normalizeAck,
  queueAndSendAck,
  requeueFailedAck,
  type AckStorage,
} from '../src/renderer/src/utils/ack-outbox.ts';
import { buildMessageAck, type MessageAck } from '../src/renderer/src/utils/message-ack.ts';
import {
  applyCanonicalFinal,
  type IdentityBubble,
} from '../src/renderer/src/utils/turn-identity.ts';
import { reconcileHistoryData, toChatRow } from '../src/renderer/src/utils/history-reconcile.ts';

/**
 * Stage 3: a receipt must survive the disconnect that created it.
 *
 * The outbox holds ONLY receipts that were really produced for this client's
 * frames. It never invents one, it never turns a `dropped` into a `received`,
 * and it never lets a receipt for an old attempt masquerade as the current one.
 * Storage failures and corrupt data are reported, not hidden -- a receipt that
 * was not persisted is not "sent".
 */

const ack = (overrides: Partial<MessageAck> = {}): MessageAck => ({
  type: 'message-ack',
  msg_id: 'm-1',
  turn_id: 'turn-1',
  attempt: 1,
  status: 'received',
  seq: 0,
  final: true,
  ...overrides,
});

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

// --------------------------------------------------------------------------- //
// 4. A receipt queued while the socket was down is delivered after reconnect
// --------------------------------------------------------------------------- //

test('a receipt survives a disconnect and is replayed on the next connection', () => {
  const storage = memoryStorage();
  const beforeDrop = createAckOutbox(storage);
  const persisted = beforeDrop.queue(ack({ msg_id: 'm-1' }));
  assert.equal(persisted, true, 'the receipt must be durable before the reload');

  // "Reconnect" = a new outbox over the same persistent store.
  const afterReconnect = createAckOutbox(storage);
  const sent: MessageAck[] = [];
  const result = afterReconnect.flush((next) => {
    sent.push(next);
    return true;
  });

  assert.deepEqual(sent.map((item) => item.msg_id), ['m-1']);
  assert.equal(result.sent, 1);
  assert.equal(result.remaining, 0);
  assert.equal(afterReconnect.pending().length, 0);
  // Nothing is invented for messages that had no receipt.
  assert.deepEqual(sent[0], ack({ msg_id: 'm-1' }));
});

test('a partially drained outbox keeps the unsent receipts in order', () => {
  const storage = memoryStorage();
  const outbox = createAckOutbox(storage);
  outbox.queue(ack({ msg_id: 'm-1' }));
  outbox.queue(ack({ msg_id: 'm-2' }));
  outbox.queue(ack({ msg_id: 'm-3' }));

  // The socket dies after the first receipt: it accepts one, then refuses.
  let delivered = 0;
  const result = outbox.flush(() => {
    delivered += 1;
    return delivered <= 1;
  });

  assert.equal(result.sent, 1);
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-2', 'm-3']);
  assert.equal(result.persisted, true);

  // The next connection drains the rest, oldest first.
  const second = createAckOutbox(storage).flush(() => true);
  assert.equal(second.sent, 2);
  assert.equal(second.remaining, 0);
});

// --------------------------------------------------------------------------- //
// 1 + 4. Write-ahead: the socket accepting a frame is not proof of delivery
// --------------------------------------------------------------------------- //

test('an accepted send is still persisted until the next reconnect can replay it', () => {
  const storage = memoryStorage();
  const outbox = createAckOutbox(storage);
  const order: string[] = [];
  const receipt = ack({ msg_id: 'm-write-ahead' });

  const delivery = queueAndSendAck(
    receipt,
    {
      queue: (next) => {
        order.push('queue');
        return outbox.queue(next);
      },
    },
    () => {
      order.push('send');
      return true;
    },
  );

  assert.deepEqual(order, ['queue', 'send'], 'persist must happen before send');
  assert.equal(delivery.persisted, true);
  assert.equal(delivery.sent, true);
  // "sent" only means the socket accepted it. The durable copy stays until a
  // reconnect flush gets a successful send, so a lost frame is recoverable.
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-write-ahead']);

  const replayed: MessageAck[] = [];
  const reconnected = createAckOutbox(storage);
  const flushed = reconnected.flush((next) => {
    replayed.push(next);
    return true;
  });
  assert.equal(flushed.sent, 1);
  assert.deepEqual(replayed.map((item) => item.msg_id), ['m-write-ahead']);
  assert.equal(reconnected.pending().length, 0);
});

test('a closed socket queues the receipt and a refused send keeps it', () => {
  const outbox = createAckOutbox(memoryStorage());
  const receipt = ack({ msg_id: 'm-closed' });

  const closed = queueAndSendAck(receipt, outbox, () => false);
  assert.equal(closed.persisted, true);
  assert.equal(closed.sent, false);
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-closed']);

  const throwing = queueAndSendAck(
    ack({ msg_id: 'm-throws' }),
    outbox,
    () => { throw new Error('socket died mid-send'); },
  );
  assert.equal(throwing.sent, false);
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-closed', 'm-throws']);
});

test('a storage failure is reported even when the live send succeeds', () => {
  const failing: AckStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
  };
  const outbox = createAckOutbox(failing);
  const delivery = queueAndSendAck(ack({ msg_id: 'm-nodurable' }), outbox, () => true);

  assert.equal(delivery.sent, true);
  assert.equal(delivery.persisted, false, 'a send must not hide storage failure');
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-nodurable']);
});

test('partial and final receipts of one frame are distinct outbox identities', () => {
  const partial = ack({ seq: 0, final: false });
  const final = ack({ seq: 0, final: true });
  assert.notEqual(ackKey(partial), ackKey(final));
  assert.equal(mergeAckOutbox([partial], [final]).length, 2);
});

test('negative control: without persistence a queued receipt is lost on restart', () => {
  // This is the exact failure mode the durable outbox exists to prevent: a
  // receipt produced while the socket is down must not vanish when the app
  // reloads. A storage stub that accepts writes but stores nothing reproduces
  // the "memory only" implementation; the positive test above uses real
  // memoryStorage and does not lose it.
  const volatile: AckStorage = {
    getItem: () => null,
    setItem: () => undefined,
  };
  const beforeReload = createAckOutbox(volatile);
  assert.equal(beforeReload.queue(ack({ msg_id: 'm-lost' })), true);
  assert.equal(beforeReload.pending().length, 1);

  const afterReload = createAckOutbox(volatile);
  assert.deepEqual(afterReload.pending(), [], 'the naive volatile outbox loses it');
});

// --------------------------------------------------------------------------- //
// 5. Duplicate, late and stale receipts
// --------------------------------------------------------------------------- //

test('the same receipt queued twice is stored once', () => {
  const outbox = createAckOutbox(memoryStorage());
  outbox.queue(ack({ msg_id: 'm-1' }));
  outbox.queue(ack({ msg_id: 'm-1' }));
  assert.equal(outbox.pending().length, 1);
  assert.equal(ackKey(ack({ msg_id: 'm-1' })), ackKey(ack({ msg_id: 'm-1' })));
});

test('a receipt for an old attempt is dropped once a newer attempt exists', () => {
  const merged = mergeAckOutbox([ack({ attempt: 1, seq: 0 })], [ack({ attempt: 2, seq: 0 })]);

  assert.deepEqual(merged.map((item) => item.attempt), [2]);
  // Negative control: keeping the stale entry (the naive append) would ask the
  // backend to settle an attempt it has already superseded.
  const naive = [...[ack({ attempt: 1, seq: 0 })], ...[ack({ attempt: 2, seq: 0 })]];
  assert.equal(naive.length, 2, 'without the supersede rule both survive');
  assert.equal(mergeAckOutbox(naive, []).length, 1);
});

test('receipts of different messages never cancel each other', () => {
  const merged = mergeAckOutbox(
    [ack({ msg_id: 'm-1', attempt: 3 })],
    [ack({ msg_id: 'm-2', attempt: 1 })],
  );
  assert.deepEqual(merged.map((item) => item.msg_id), ['m-1', 'm-2']);
});

test('the queue is bounded, keeping the newest receipts', () => {
  const incoming = Array.from({ length: ACK_OUTBOX_LIMIT + 10 }, (_, index) =>
    ack({ msg_id: `m-${index}` }),
  );
  const merged = mergeAckOutbox([], incoming);
  assert.equal(merged.length, ACK_OUTBOX_LIMIT);
  assert.equal(merged[merged.length - 1].msg_id, `m-${ACK_OUTBOX_LIMIT + 9}`);
});

test('a dropped receipt keeps its reason, so a retry never becomes "received"', () => {
  const storage = memoryStorage();
  createAckOutbox(storage).queue(
    ack({ status: 'dropped', reason: 'interrupted', seq: undefined, final: undefined }),
  );
  const restored = createAckOutbox(storage).pending()[0];
  assert.equal(restored.status, 'dropped');
  assert.equal(restored.reason, 'interrupted');
});

test('two outboxes that loaded before either write do not clobber each other', () => {
  const storage = memoryStorage();
  // Both tabs open (and load) before either receipt is produced.
  const tabA = createAckOutbox(storage);
  const tabB = createAckOutbox(storage);
  assert.deepEqual(tabA.pending(), []);
  assert.deepEqual(tabB.pending(), []);

  assert.equal(tabA.queue(ack({ msg_id: 'm-a' })), true);
  // A blind last-write-wins persist would replace tab A's entry with this one.
  assert.equal(tabB.queue(ack({ msg_id: 'm-b' })), true);

  const reloaded = createAckOutbox(storage);
  assert.deepEqual(
    reloaded.pending().map((item) => item.msg_id),
    ['m-a', 'm-b'],
    'a write must merge with what another tab persisted meanwhile',
  );
});

test('a flush removes only the receipts it sent, preserving a concurrent tab', () => {
  const storage = memoryStorage();
  const draining = createAckOutbox(storage);
  draining.queue(ack({ msg_id: 'm-a' }));
  draining.queue(ack({ msg_id: 'm-b' }));

  // Another tab adds a receipt after the draining tab took its snapshot.
  const other = createAckOutbox(storage);
  assert.equal(other.queue(ack({ msg_id: 'm-c' })), true);

  const sent: string[] = [];
  const result = draining.flush((next) => {
    sent.push(next.msg_id);
    return true;
  });
  assert.deepEqual(sent, ['m-a', 'm-b']);
  assert.equal(result.remaining, 1, 'the other tab receipt remains queued');
  assert.equal(result.persisted, true);

  // The sent keys are gone; the other tab's receipt is not.
  assert.deepEqual(
    createAckOutbox(storage).pending().map((item) => item.msg_id),
    ['m-c'],
  );
});

test('a failed backend write requeues the receipt it echoed', () => {
  const storage = memoryStorage();
  const outbox = createAckOutbox(storage);
  outbox.queue(ack({ msg_id: 'm-fail' }));
  outbox.flush(() => true);
  assert.deepEqual(outbox.pending(), [], 'the flush removed the sent receipt');

  const result = requeueFailedAck(outbox, ack({ msg_id: 'm-fail' }));
  assert.deepEqual(result, { queued: true, persisted: true });
  assert.deepEqual(
    outbox.pending().map((item) => item.msg_id),
    ['m-fail'],
    'the failure frame must put the receipt back',
  );
  assert.deepEqual(
    createAckOutbox(storage).pending().map((item) => item.msg_id),
    ['m-fail'],
    'the requeue must be durable too',
  );
});

test('a failure frame without a valid receipt cannot invent one', () => {
  const outbox = createAckOutbox(memoryStorage());
  const result = requeueFailedAck(outbox, { type: 'message-ack', msg_id: 'm', turn_id: 't', attempt: 0, status: 'received' });
  assert.deepEqual(result, { queued: false, persisted: false });
  assert.deepEqual(outbox.pending(), []);
});

// --------------------------------------------------------------------------- //
// 8. Storage failure and corrupt data
// --------------------------------------------------------------------------- //

test('a storage failure is reported and the receipt is not pretended durable', () => {
  const failing: AckStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };
  const outbox = createAckOutbox(failing);

  assert.equal(outbox.queue(ack({ msg_id: 'm-1' })), false, 'must report the failure');
  // Not silently lost within the session: it still drains if the socket returns.
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-1']);
});

test('corrupt outbox data is moved aside, reported, and never replayed as sent', () => {
  const storage = memoryStorage({ [ACK_OUTBOX_KEY]: '{"nope":' });
  const outbox = createAckOutbox(storage);

  const result = outbox.load();
  assert.equal(result.ok, false);
  assert.equal(result.corrupt, true);
  assert.deepEqual(result.entries, []);
  // The damaged payload is preserved for diagnosis instead of vanishing.
  assert.equal(storage.map.get(ACK_OUTBOX_CORRUPT_KEY), '{"nope":');

  // And the outbox still works afterwards.
  assert.equal(outbox.queue(ack({ msg_id: 'm-9' })), true);
  const replayed: MessageAck[] = [];
  createAckOutbox(storage).flush((next) => {
    replayed.push(next);
    return true;
  });
  assert.deepEqual(replayed.map((item) => item.msg_id), ['m-9']);
});

test('garbage entries inside a valid array are reported, valid ones kept', () => {
  const raw = JSON.stringify([
    ack({ msg_id: 'm-ok' }),
    { type: 'message-ack', msg_id: '', turn_id: 't', attempt: 1, status: 'received' },
    { type: 'message-ack', msg_id: 'm-bad', turn_id: 't', attempt: 0, status: 'received' },
    { type: 'message-ack', msg_id: 'm-bad2', turn_id: 't', attempt: 1, status: 'played' },
    'not-an-ack',
  ]);
  const storage = memoryStorage({ [ACK_OUTBOX_KEY]: raw });
  const outbox = createAckOutbox(storage);
  const result = outbox.load();

  // The usable receipt is not lost, but the damage is not hidden either.
  assert.equal(result.ok, false, 'a partially unusable store is not fully OK');
  assert.equal(result.corrupt, true);
  assert.deepEqual(result.entries.map((item) => item.msg_id), ['m-ok']);
  assert.deepEqual(outbox.pending().map((item) => item.msg_id), ['m-ok']);
  assert.equal(storage.map.get(ACK_OUTBOX_CORRUPT_KEY), raw);
});

test('normalizeAck refuses receipts this stage may not send', () => {
  assert.equal(normalizeAck({ type: 'message-ack', msg_id: 'm', turn_id: 't', attempt: 1, status: 'played' }), null);
  assert.equal(normalizeAck({ type: 'message-ack', msg_id: 'm', turn_id: '', attempt: 1, status: 'received' }), null);
  assert.equal(normalizeAck({ type: 'message-ack', msg_id: 'm', turn_id: 't', attempt: 1.5, status: 'received' }), null);
  assert.equal(normalizeAck(null), null);
  assert.equal(normalizeAck(ack({ msg_id: 'm' }))?.msg_id, 'm');
});

// --------------------------------------------------------------------------- //
// 11. A recovery resend never adds a bubble (client dedupe by msg_id)
// --------------------------------------------------------------------------- //

test('the same msg_id delivered twice stays one bubble, at the newest text', () => {
  const live: IdentityBubble[] = [
    { id: 'msg:m-1', role: 'ai', content: 'parsial', msgId: 'm-1', type: 'text' },
  ];
  // A redelivery of the same logical message (attempt 2) lands in that bubble.
  const first = applyCanonicalFinal(live, 'turn-2', 'teks lengkap', 'm-1');
  const second = applyCanonicalFinal(first.bubbles, 'turn-2', 'teks lengkap', 'm-1');

  assert.equal(first.matched, true);
  assert.equal(first.bubbles.length, 1);
  assert.equal(first.bubbles[0].content, 'teks lengkap');
  assert.equal(second.changed, false, 'a repeated resend is a no-op');
  assert.equal(second.bubbles.length, 1);
});

test('a reload + recovery resend still shows one row, not two', () => {
  const serverRow = toChatRow(
    { role: 'ai', content: 'teks lengkap', msg_id: 'm-1', timestamp: 't' },
    0,
  );
  const { messages } = reconcileHistoryData([serverRow], []);
  assert.equal(messages.length, 1);

  const resent = applyCanonicalFinal(messages, 'turn-2', 'teks lengkap', 'm-1');
  assert.equal(resent.matched, true);
  assert.equal(resent.bubbles.length, 1);
  assert.equal(resent.bubbles[0].id, 'msg:m-1');
});

// --------------------------------------------------------------------------- //
// Nothing is acknowledged on a guess
// --------------------------------------------------------------------------- //

test('a frame without protocol identity produces no receipt to queue', () => {
  // A pre-protocol server frame: no msg_id, no attempt.
  assert.equal(buildMessageAck({ type: 'audio', text: 'halo' }, 'received'), null);
  assert.equal(
    buildMessageAck({ msg_id: 'm-1', turn: 'turn-1' }, 'received'),
    null,
    'no attempt means no receipt',
  );
  // And a receipt built from a real frame survives a persistence round-trip.
  const built = buildMessageAck(
    { msg_id: 'm-1', turn: 'turn-1', attempt: 2, seq: 1, final: true },
    'received',
  );
  assert.deepEqual(normalizeAck(JSON.parse(JSON.stringify(built))), built);
});
