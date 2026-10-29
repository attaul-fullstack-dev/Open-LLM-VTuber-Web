// Client receipts for the backend delivery protocol (Stage 2).
//
// An ACK answers exactly ONE question: did this frame make it into the
// client's message buffer? `received` is therefore NOT proof that the text is
// rendered, that the audio finished playing, or that the user read anything —
// the buffer is filled before playback, sometimes long before. `dropped` is
// the honest answer when the client deliberately discards a frame, and it is
// what lets the backend retry with the SAME msg_id instead of inventing a
// second message.
//
// Identity rules:
// - `msg_id` names the logical message and `turn_id` names the attempt's turn;
//   the backend only settles an attempt when both match, so both are required.
// - `attempt` must be a positive integer. A frame from a server that predates
//   the protocol carries neither field, so no ACK is produced at all and such
//   a server keeps its legacy behaviour.
// - `seq`/`final` are echoed when present, so the backend can tell a partial
//   receipt from the closing one.
//
// Pure and dependency-free: building a receipt never throws and never touches
// the socket.

export type AckStatus = 'received' | 'dropped';

export interface AckFrameIdentity {
  msg_id?: unknown;
  id?: unknown;
  turn?: unknown;
  turn_id?: unknown;
  request_id?: unknown;
  attempt?: unknown;
  seq?: unknown;
  final?: unknown;
}

export interface AckDecision {
  status: AckStatus;
  reason?: string;
}

export interface MessageAck {
  type: 'message-ack';
  msg_id: string;
  turn_id: string;
  attempt: number;
  status: AckStatus;
  seq?: number;
  final?: boolean;
  reason?: string;
}

const identityString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const wholeNumber = (value: unknown, minimum: number): number | null => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum
    ? value
    : null
);

/** Logical-message id of a frame (`msg_id`, or its protocol alias `id`). */
export function frameMsgId(frame: AckFrameIdentity | null | undefined): string {
  if (!frame) return '';
  return identityString(frame.msg_id) || identityString(frame.id);
}

/** Turn id of a frame (`turn`, `turn_id`, or the legacy `request_id`). */
export function frameTurnId(frame: AckFrameIdentity | null | undefined): string {
  if (!frame) return '';
  return (
    identityString(frame.turn)
    || identityString(frame.turn_id)
    || identityString(frame.request_id)
  );
}

/**
 * Receipt for one AUDIO/content frame, from the two facts the transport
 * actually knows: was the frame buffered, and if not, why was it discarded.
 *
 * A buffered frame is `received` (parsed and enqueued — never "played" or
 * "rendered"). A discarded frame is ALWAYS `dropped`: reporting `received`
 * for a frame the client threw away would tell the backend a message arrived
 * that this client will never show.
 */
export function audioFrameAck(
  buffered: boolean,
  discardReason?: string | null,
): AckDecision {
  if (buffered) return { status: 'received' };
  const reason = identityString(discardReason);
  return { status: 'dropped', ...(reason ? { reason } : {}) };
}

/**
 * Build the receipt for one frame, or null when the frame cannot be
 * acknowledged (no protocol identity) or the status is not one this stage
 * may send. Never invents an attempt, never acknowledges on a guess.
 */
export function buildMessageAck(
  frame: AckFrameIdentity | null | undefined,
  status: AckStatus,
  reason?: string | null,
): MessageAck | null {
  if (status !== 'received' && status !== 'dropped') return null;
  const msgId = frameMsgId(frame);
  const turnId = frameTurnId(frame);
  const attempt = wholeNumber(frame?.attempt, 1);
  if (!msgId || !turnId || attempt === null) return null;

  const ack: MessageAck = {
    type: 'message-ack',
    msg_id: msgId,
    turn_id: turnId,
    attempt,
    status,
  };
  const seq = wholeNumber(frame?.seq, 0);
  if (seq !== null) ack.seq = seq;
  if (typeof frame?.final === 'boolean') ack.final = frame.final;
  if (status === 'dropped') {
    const text = identityString(reason);
    if (text) ack.reason = text;
  }
  return ack;
}
