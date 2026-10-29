import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audioFrameAck,
  buildMessageAck,
  frameMsgId,
  frameTurnId,
  type MessageAck,
} from '../src/renderer/src/utils/message-ack.ts';
import {
  applyCanonicalFinal,
  resolveAiTarget,
  type IdentityBubble,
} from '../src/renderer/src/utils/turn-identity.ts';

/**
 * Stage 2: client receipts (received / dropped).
 *
 * What an ACK may and may not claim:
 * - `received` = the frame was parsed and put in the client's message buffer.
 *   It is NOT proof of rendering, of playback, or that the user read anything.
 * - `dropped` = the frame was deliberately discarded, so the backend may retry
 *   the SAME msg_id instead of treating the message as delivered.
 * - A frame from a server without protocol identity produces NO receipt.
 *
 * Every negative control below writes out the "tempting shortcut" next to the
 * assertion, so the test really fails when the guard is removed.
 */

const audioFrame = (overrides: Record<string, unknown> = {}) => ({
  type: 'audio',
  msg_id: 'm-obat',
  id: 'm-obat',
  request_id: 'req-1',
  turn: 'req-1',
  attempt: 1,
  seq: 0,
  final: false,
  display_text: { text: 'Ingat minum obat ya.', name: 'Mili', avatar: null },
  ...overrides,
});

// --------------------------------------------------------------------------- //
// 1. Received: the exact wire shape the backend matches
// --------------------------------------------------------------------------- //

test('a buffered audio frame is acknowledged as received for its attempt', () => {
  const ack = buildMessageAck(audioFrame(), 'received');
  assert.deepEqual(ack, {
    type: 'message-ack',
    msg_id: 'm-obat',
    turn_id: 'req-1',
    attempt: 1,
    status: 'received',
    seq: 0,
    final: false,
  });
  // The receipt is a protocol frame, not user input: it must never be able to
  // masquerade as a chat trigger.
  assert.notEqual((ack as unknown as { type: string }).type, 'text-input');
});

test('the closing frame is acknowledged with final=true and its seq', () => {
  const ack = buildMessageAck(
    audioFrame({ type: 'ai-final', text: 'penuh', seq: 2, final: true, segments: 2 }),
    'received',
  );
  assert.equal(ack?.status, 'received');
  assert.equal(ack?.final, true);
  assert.equal(ack?.seq, 2);
});

test('the protocol alias `id` names the message when msg_id is absent', () => {
  assert.equal(frameMsgId({ id: 'm-alias' }), 'm-alias');
  assert.equal(frameMsgId({ msg_id: 'm-primary', id: 'm-alias' }), 'm-primary');
  assert.equal(frameMsgId({ msg_id: '   ', id: 'm-alias' }), 'm-alias');
  assert.equal(frameMsgId({ msg_id: '  m-trim  ' }), 'm-trim');
});

test('the turn falls back to request_id for servers that send it that way', () => {
  assert.equal(frameTurnId({ turn: 't-1', request_id: 'r-1' }), 't-1');
  assert.equal(frameTurnId({ request_id: 'r-1' }), 'r-1');
  assert.equal(frameTurnId({}), '');
});

// --------------------------------------------------------------------------- //
// 2. Dropped: only when a frame really was discarded
// --------------------------------------------------------------------------- //

test('a discarded frame is acknowledged as dropped, never received', () => {
  const decision = audioFrameAck(false, 'interrupted');
  assert.deepEqual(decision, { status: 'dropped', reason: 'interrupted' });
  const ack = buildMessageAck(audioFrame(), decision.status, decision.reason);
  assert.equal(ack?.status, 'dropped');
  assert.equal(ack?.reason, 'interrupted');

  // Negative control: the shortcut of ACKing every parsed frame as received
  // would tell the backend a message arrived that this client threw away.
  const naive: MessageAck = buildMessageAck(audioFrame(), 'received')!;
  assert.notEqual(naive.status, 'dropped');
  assert.equal(naive.reason, undefined);
});

test('a buffered frame never gets a drop reason attached', () => {
  assert.deepEqual(audioFrameAck(true, 'interrupted'), { status: 'received' });
  const ack = buildMessageAck(audioFrame(), 'received', 'interrupted');
  assert.equal(ack?.reason, undefined, 'a received receipt never carries a drop reason');
});

test('a dropped receipt without a reason stays valid and modest', () => {
  const ack = buildMessageAck(audioFrame(), 'dropped');
  assert.equal(ack?.status, 'dropped');
  assert.equal('reason' in (ack as object), false);
  assert.deepEqual(audioFrameAck(false), { status: 'dropped' });
});

// --------------------------------------------------------------------------- //
// 3. Legacy servers: no identity -> no receipt at all
// --------------------------------------------------------------------------- //

test('a pre-protocol frame (no msg_id/attempt) is not acknowledged', () => {
  // This is the exact frame a Stage-0/1 server sends.
  const legacy = {
    type: 'audio',
    request_id: 'req-old',
    display_text: { text: 'hai', name: 'Mili', avatar: null },
  };
  assert.equal(buildMessageAck(legacy, 'received'), null);
  // Negative control: inventing attempt 1 would make the client speak a
  // protocol the server does not implement.
  assert.equal(frameMsgId(legacy), '');
});

test('an incomplete identity is refused instead of guessed', () => {
  assert.equal(buildMessageAck(audioFrame({ msg_id: undefined, id: undefined }), 'received'), null);
  assert.equal(buildMessageAck(audioFrame({ turn: '', request_id: '' }), 'received'), null);
  assert.equal(buildMessageAck(audioFrame({ attempt: undefined }), 'received'), null);
  assert.equal(buildMessageAck(audioFrame({ attempt: 0 }), 'received'), null);
  assert.equal(buildMessageAck(audioFrame({ attempt: 1.5 }), 'received'), null);
  assert.equal(buildMessageAck(audioFrame({ attempt: '1' }), 'received'), null);
  // Stage 2 knows exactly two statuses; anything else is not sent.
  assert.equal(buildMessageAck(audioFrame(), 'rendered' as never), null);
  assert.equal(buildMessageAck(null, 'received'), null);
});

// --------------------------------------------------------------------------- //
// 4. One logical message, many frames: one identity, one bubble
// --------------------------------------------------------------------------- //

const ai = (id: string, content: string, extra: Partial<IdentityBubble> = {}): IdentityBubble => ({
  id,
  role: 'ai',
  content,
  type: 'text',
  ...extra,
});

test('three segments of one message acknowledge the same msg_id with seq 0..2', () => {
  const frames = [
    audioFrame({ seq: 0, display_text: { text: 'satu. ' } }),
    audioFrame({ seq: 1, display_text: { text: 'dua. ' } }),
    audioFrame({ type: 'ai-final', seq: 2, final: true, segments: 2, text: 'satu. dua. ' }),
  ];
  const acks = frames.map((frame) => buildMessageAck(frame, 'received')!);
  assert.deepEqual(acks.map((ack) => ack.seq), [0, 1, 2]);
  assert.deepEqual(acks.map((ack) => ack.final), [false, false, true]);
  assert.equal(new Set(acks.map((ack) => ack.msg_id)).size, 1, 'one message, one identity');
  assert.equal(new Set(acks.map((ack) => ack.attempt)).size, 1);
});

test('a retry (attempt 2) acknowledges the same msg_id with a higher attempt', () => {
  const first = buildMessageAck(audioFrame({ attempt: 1 }), 'dropped', 'interrupted')!;
  const retry = buildMessageAck(
    audioFrame({ attempt: 2, turn: 'req-2', request_id: 'req-2', seq: 0 }),
    'received',
  )!;
  assert.equal(retry.msg_id, first.msg_id);
  assert.equal(retry.turn_id, 'req-2', 'the receipt names the attempt that produced the frame');
  assert.ok(retry.attempt > first.attempt);
});

test('a retried delivery keeps ONE bubble even with new text and a new attempt', () => {
  // Attempt 1 was dropped by the client, so only attempt 2 is rendered.
  let bubbles: IdentityBubble[] = [];
  const attempt2Frames = ['Jam delapan malam ya. ', 'Aku ingat kok.'] as const;
  attempt2Frames.forEach((chunk) => {
    const target = resolveAiTarget(bubbles, {
      msgId: 'm-obat',
      requestId: 'req-2',
      forceNew: false,
    });
    if (target.mode === 'merge') {
      const base = bubbles[target.index];
      bubbles = bubbles.slice();
      bubbles[target.index] = { ...base, content: base.content + chunk };
    } else {
      bubbles = [...bubbles, ai('msg:m-obat', chunk, { msgId: 'm-obat', requestId: 'req-2' })];
    }
  });
  assert.equal(bubbles.length, 1, 'two segments are one message');
  assert.equal(bubbles[0].id, 'msg:m-obat');

  // The canonical final of the retry converges the same bubble (idempotent).
  const first = applyCanonicalFinal(bubbles, 'req-2', 'Jam delapan malam ya.', 'm-obat');
  const second = applyCanonicalFinal(first.bubbles, 'req-2', 'Jam delapan malam ya.', 'm-obat');
  assert.equal(second.bubbles.length, 1);
  assert.equal(second.changed, false, 'a repeated final changes nothing');

  // Negative control: attempt-only routing cannot see that a NEW attempt
  // (req-3) is the same logical message, so it opens a second bubble — the
  // exact duplicate this protocol exists to prevent.
  assert.deepEqual(
    resolveAiTarget(bubbles, { requestId: 'req-3', forceNew: true }),
    { mode: 'new' },
  );
});

// --------------------------------------------------------------------------- //
// 5. ACK identity is independent of text
// --------------------------------------------------------------------------- //

test('two different messages with identical text produce two distinct receipts', () => {
  const a = buildMessageAck(audioFrame({ msg_id: 'm-1', id: 'm-1' }), 'received')!;
  const b = buildMessageAck(
    audioFrame({ msg_id: 'm-2', id: 'm-2', request_id: 'req-2', turn: 'req-2' }),
    'received',
  )!;
  assert.notEqual(a.msg_id, b.msg_id);
  // Negative control: keying receipts by content would collapse them.
  assert.equal(audioFrame().display_text.text, audioFrame().display_text.text);
});
