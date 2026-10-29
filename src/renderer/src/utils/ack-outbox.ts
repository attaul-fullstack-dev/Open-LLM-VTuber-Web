// Durable outbox for client receipts (Stage 3).
//
// A receipt is only useful if it eventually reaches the backend: an ACK that
// dies with the socket leaves the server believing the message was never taken,
// which is exactly the situation a retry exists for. This module therefore
// keeps unsent receipts across a disconnect (localStorage — the same store the
// rest of this app already persists preferences in; the payload is a handful of
// short ids, so an IndexedDB database would be more machinery than data).
//
// Rules:
// - Only receipts that were ACTUALLY produced get queued. Nothing here invents
//   an ACK for a frame that was never received or was discarded silently.
// - Identity is (msg_id, turn_id, attempt, status, seq, final): queueing the
//   same receipt twice is a no-op; a receipt of an OLDER attempt of the same
//   message is dropped once a newer attempt exists, because the backend would
//   refuse it anyway and it must never be mistaken for the current attempt.
// - Storage failure is reported, never hidden: `queue` returns false and the
//   in-memory copy still holds the receipt for this session (a reload loses it,
//   and the console says so).
// - Corrupt data is moved aside (not silently erased) and reported, so the
//   outbox can keep working without pretending the old receipts were sent.
// - Writes re-read and merge the stored queue first. This closes the ordinary
//   "two tabs loaded an old copy" lost-update window without IndexedDB, but
//   localStorage has no compare-and-swap: two writes in the same instant can
//   still race. The shipping Electron app creates one BrowserWindow; the web
//   build is the only place multiple tabs are expected.
//
// Nothing here claims a message was rendered, played or read — a receipt only
// says the frame reached the client's buffer.

import type { MessageAck } from './message-ack';

export const ACK_OUTBOX_KEY = 'mili.ack-outbox.v1';
export const ACK_OUTBOX_CORRUPT_KEY = 'mili.ack-outbox.v1.corrupt';
export const ACK_OUTBOX_LIMIT = 50;

/** The slice of localStorage this module needs (injectable for tests). */
export interface AckStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface OutboxLoadResult {
  /** False when the stored value existed but could not be used. */
  ok: boolean;
  /** True when unusable data was found and moved aside. */
  corrupt: boolean;
  entries: MessageAck[];
}

export interface FlushResult {
  sent: number;
  remaining: number;
  /** False when the queue could not be written back after flushing. */
  persisted: boolean;
}

export interface AckOutbox {
  queue(ack: MessageAck): boolean;
  pending(): MessageAck[];
  load(): OutboxLoadResult;
  flush(send: (ack: MessageAck) => boolean): FlushResult;
  clear(): void;
}

const isInt = (value: unknown, minimum: number): boolean => (
  typeof value === 'number' && Number.isInteger(value) && value >= minimum
);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Identity of one receipt. Two receipts with the same key say the same thing
 * about the same frame attempt, so the second is redundant.
 */
export function ackKey(ack: MessageAck): string {
  const seq = isInt(ack.seq, 0) ? String(ack.seq) : '-';
  // `final` is part of the identity, not decoration: a partial receipt and the
  // closing receipt of the same frame attempt must not collapse into one.
  const final = ack.final === true ? '1' : ack.final === false ? '0' : '-';
  return `${ack.msg_id}|${ack.turn_id}|${ack.attempt}|${ack.status}|${seq}|${final}`;
}

/** Narrow one parsed item to a sendable receipt, or null when unusable. */
export function normalizeAck(value: unknown): MessageAck | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== 'message-ack') return null;
  const msgId = text(raw.msg_id);
  const turnId = text(raw.turn_id);
  if (!msgId || !turnId) return null;
  if (!isInt(raw.attempt, 1)) return null;
  if (raw.status !== 'received' && raw.status !== 'dropped') return null;
  const ack: MessageAck = {
    type: 'message-ack',
    msg_id: msgId,
    turn_id: turnId,
    attempt: raw.attempt as number,
    status: raw.status,
  };
  if (isInt(raw.seq, 0)) ack.seq = raw.seq as number;
  if (typeof raw.final === 'boolean') ack.final = raw.final;
  const reason = text(raw.reason);
  if (ack.status === 'dropped' && reason) ack.reason = reason;
  return ack;
}

/**
 * Merge receipts, keeping identity unique and dropping attempts that a newer
 * attempt of the same message has already superseded.
 */
export function mergeAckOutbox(
  existing: readonly MessageAck[],
  incoming: readonly MessageAck[],
  limit: number = ACK_OUTBOX_LIMIT,
): MessageAck[] {
  // Highest attempt seen per message: anything below it is stale on arrival.
  const newestAttempt = new Map<string, number>();
  const consider = (ack: MessageAck) => {
    const current = newestAttempt.get(ack.msg_id) ?? 0;
    if (ack.attempt > current) newestAttempt.set(ack.msg_id, ack.attempt);
  };
  existing.forEach(consider);
  incoming.forEach(consider);

  const seen = new Set<string>();
  const merged: MessageAck[] = [];
  // Newest last: the queue is drained in insertion order, so an older receipt
  // is sent before a newer one for the same message.
  for (const ack of [...existing, ...incoming]) {
    const floor = newestAttempt.get(ack.msg_id) ?? ack.attempt;
    if (ack.attempt < floor) continue;
    const key = ackKey(ack);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ack);
  }
  const cap = Math.max(0, Math.floor(limit));
  return merged.length > cap ? merged.slice(merged.length - cap) : merged;
}

export interface AckSendResult {
  /** False when storage refused the write; the in-memory copy still exists. */
  persisted: boolean;
  /** Whether the live transport accepted the frame right now. */
  sent: boolean;
}

export interface AckRequeueResult {
  /** False when the failure frame did not contain a valid receipt. */
  queued: boolean;
  /** False when the receipt is only in memory because storage refused it. */
  persisted: boolean;
}

/**
 * Put a receipt echoed by a failed ``message-ack-result`` back in the outbox.
 *
 * A reconnect flush removes an entry once the socket accepts it. If the
 * backend then reports that the state write failed, the receipt is no longer
 * in the outbox and would otherwise be lost. The failure frame echoes the
 * validated receipt for exactly this purpose; an old backend that omits it
 * simply cannot be repaired here (the server's own redelivery still applies).
 */
export function requeueFailedAck(
  outbox: Pick<AckOutbox, 'queue'>,
  value: unknown,
): AckRequeueResult {
  const ack = normalizeAck(value);
  if (!ack) return { queued: false, persisted: false };
  return { queued: true, persisted: outbox.queue(ack) };
}

/**
 * Persist a receipt BEFORE handing it to the socket, then try to send it.
 *
 * A socket that reports "accepted" can still die before the backend reads the
 * frame. Queuing first means that receipt remains in the outbox and is replayed
 * on the next reconnect; sending first and queuing only on failure would lose
 * exactly that case. The entry is intentionally left in the outbox after a
 * successful send: without a backend confirmation, "accepted by the socket" is
 * not proof that the receipt was recorded. A later flush replays it (the
 * backend treats a duplicate as a no-op) and clears it on a successful send.
 */
export function queueAndSendAck(
  ack: MessageAck,
  outbox: Pick<AckOutbox, 'queue'>,
  send: () => boolean,
): AckSendResult {
  const persisted = outbox.queue(ack);
  let sent = false;
  try {
    sent = send() === true;
  } catch {
    // A transport throw is the same as a refused send: the durable copy stays.
    sent = false;
  }
  return { persisted, sent };
}

/**
 * The outbox. Memory is authoritative for the session; storage is the durable
 * mirror that survives a reload or an app restart.
 */
export function createAckOutbox(storage: AckStorage | null | undefined): AckOutbox {
  let entries: MessageAck[] = [];
  let loaded = false;

  /**
   * Best-effort read of what is currently stored. Returns null when storage
   * cannot be read or holds data this module cannot safely merge; the caller
   * then writes its own queue instead of guessing.
   *
   * This is not an atomic transaction. Two tabs that write at exactly the same
   * instant can still race (localStorage has no compare-and-swap); re-reading
   * before every write closes the ordinary "both tabs loaded an old copy"
   * lost-update window without moving the whole outbox to IndexedDB.
   */
  const readStored = (): MessageAck[] | null => {
    if (!storage) return null;
    let raw: string | null = null;
    try {
      raw = storage.getItem(ACK_OUTBOX_KEY);
    } catch {
      return null;
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const restored: MessageAck[] = [];
      for (const item of parsed) {
        const ack = normalizeAck(item);
        if (!ack) return null;
        restored.push(ack);
      }
      return restored;
    } catch {
      return null;
    }
  };

  const write = (next: MessageAck[]): boolean => {
    if (!storage) return false;
    // Memory follows the durable queue, including entries another tab wrote.
    // On a failed setItem this is still the best copy this session has.
    entries = next;
    try {
      storage.setItem(ACK_OUTBOX_KEY, JSON.stringify(next));
      return true;
    } catch {
      // Quota, private mode, disabled storage: the receipt is NOT durable.
      return false;
    }
  };

  const persist = (next: MessageAck[], merge = true): boolean => {
    if (!storage) return false;
    let toWrite = next;
    if (merge) {
      const stored = readStored();
      if (stored !== null) toWrite = mergeAckOutbox(stored, next);
    }
    return write(toWrite);
  };

  /**
   * Flush write-back must REMOVE the receipts this drain just sent, while
   * preserving receipts another tab added since our snapshot. A plain
   * merge(stored, keep) would put the sent entries back.
   */
  const persistAfterFlush = (
    keep: MessageAck[],
    sentAcks: MessageAck[],
  ): boolean => {
    if (!storage) return false;
    const stored = readStored();
    if (stored === null) return write(keep);
    const sentKeys = new Set(sentAcks.map(ackKey));
    const preserved = stored.filter((ack) => !sentKeys.has(ackKey(ack)));
    return write(mergeAckOutbox(preserved, keep));
  };

  const load = (): OutboxLoadResult => {
    loaded = true;
    if (!storage) {
      entries = [];
      return { ok: false, corrupt: false, entries: [] };
    }
    let raw: string | null = null;
    try {
      raw = storage.getItem(ACK_OUTBOX_KEY);
    } catch {
      entries = [];
      return { ok: false, corrupt: false, entries: [] };
    }
    if (!raw) {
      entries = [];
      return { ok: true, corrupt: false, entries: [] };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('outbox is not an array');
      const restored: MessageAck[] = [];
      let invalid = 0;
      parsed.forEach((item) => {
        const ack = normalizeAck(item);
        if (ack) restored.push(ack);
        else invalid += 1;
      });
      entries = mergeAckOutbox([], restored);
      if (invalid > 0) {
        // Some entries were usable, some were not. Keep the usable ones but
        // report the damage and preserve the original payload: silently
        // dropping malformed receipts would lose messages without a trace.
        try {
          storage.setItem(ACK_OUTBOX_CORRUPT_KEY, raw);
          storage.setItem(ACK_OUTBOX_KEY, JSON.stringify(entries));
        } catch {
          // The in-memory entries are still usable; `corrupt: true` reports it.
        }
        return { ok: false, corrupt: true, entries: entries.slice() };
      }
      return { ok: true, corrupt: false, entries: entries.slice() };
    } catch {
      // Move the damage aside so the queue can work again, and report it: the
      // receipts it held were NOT sent and must not be presented as such.
      try {
        storage.setItem(ACK_OUTBOX_CORRUPT_KEY, raw);
        if (typeof storage.removeItem === 'function') storage.removeItem(ACK_OUTBOX_KEY);
        else storage.setItem(ACK_OUTBOX_KEY, '[]');
      } catch {
        // Best effort only; `corrupt: true` still tells the caller.
      }
      entries = [];
      return { ok: false, corrupt: true, entries: [] };
    }
  };

  const ensureLoaded = (): void => {
    if (!loaded) load();
  };

  return {
    load,

    queue(ack: MessageAck): boolean {
      ensureLoaded();
      const next = mergeAckOutbox(entries, [ack]);
      entries = next;
      return persist(next);
    },

    pending(): MessageAck[] {
      ensureLoaded();
      return entries.slice();
    },

    flush(send: (ack: MessageAck) => boolean): FlushResult {
      ensureLoaded();
      const queue = entries.slice();
      const keep: MessageAck[] = [];
      const sentAcks: MessageAck[] = [];
      let blocked = false;
      queue.forEach((ack) => {
        if (blocked) {
          keep.push(ack);
          return;
        }
        if (send(ack)) sentAcks.push(ack);
        else {
          // Socket went away mid-drain: keep this receipt AND everything after
          // it, in order, for the next connection.
          blocked = true;
          keep.push(ack);
        }
      });
      entries = keep;
      // Write back even when nothing was sent: a stale entry dropped by the
      // merge rule should not reappear on the next load. When something was
      // sent, remove exactly those keys from the durable queue and keep any
      // receipt another tab added meanwhile.
      const persisted = sentAcks.length === 0
        ? true
        : persistAfterFlush(keep, sentAcks);
      return { sent: sentAcks.length, remaining: entries.length, persisted };
    },

    clear(): void {
      entries = [];
      loaded = true;
      // Clearing is deliberate and must not be undone by merging another
      // tab's queue back in.
      persist([], false);
    },
  };
}
