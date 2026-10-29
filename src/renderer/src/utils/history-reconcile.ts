// History resync reconciliation (pure, dependency-free).
//
// Invariant: once the user presses Send and the socket accepts the payload,
// the optimistic message MUST NOT disappear merely because a history resync
// (`history-data`) arrives before the server snapshot contains it.
//
// The server transcript is append-only, so a resync snapshot is always a
// prefix of the true conversation: anything the snapshot lacks but the local
// UI already accepted is re-applied AFTER the snapshot instead of being
// dropped. Entries confirmed by the snapshot stop being pending.
//
// Matching rules (deliberately conservative):
// - human text: exact multiset match on (role, content), oldest-first. A
//   resync can therefore never erase an accepted-but-unpersisted message,
//   and a persisted one is never duplicated.
// - ai text: an untracked-streaming partial is a PREFIX of its eventual
//   persisted response, so a snapshot entry that starts with (or equals) the
//   local content confirms it. AI matches never consume snapshot rows.
// - tool_call_status rows are server-authoritative and never pending.
//
// Ordering: an unmatched human entry is inserted immediately BEFORE the
// earliest snapshot row consumed by a LATER pending entry (its true position
// when a rapid resend was cancelled pre-persist); otherwise it appends at
// the end, preserving pending order. Unmatched AI partials always append.

export interface ChatRow {
  id: string;
  role: 'ai' | 'human';
  content: string;
  type?: string;
  /**
   * Backend turn request_id (AI rows). Turn identity is what lets a late
   * canonical final find its bubble after a resync; it must survive the
   * server -> UI round trip unchanged.
   */
  requestId?: string;
  /**
   * Stable logical-message id persisted by the backend. This is the row's
   * identity across reload/reconnect/retry: a row with the same msgId is
   * the SAME message, whatever its text says, and rows with different
   * msgIds are different messages even when their text is identical.
   */
  msgId?: string;
  /** Display metadata persisted by the backend (speaker + sent time). */
  name?: string;
  avatar?: string;
  timestamp?: string;
}

/** Raw row shape of a `history-data` snapshot (backend JSON, snake_case). */
export interface ServerHistoryRow {
  id?: unknown;
  role?: 'ai' | 'human';
  content?: unknown;
  type?: string;
  msg_id?: unknown;
  /** Optional per-attempt turn id (not persisted today; tolerated if present). */
  request_id?: unknown;
  name?: unknown;
  avatar?: unknown;
  timestamp?: unknown;
}

function textField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
}

/** Identity-shaped string: trimmed, and absent when blank. */
function idField(value: unknown): string | undefined {
  const raw = textField(value);
  return raw === undefined ? undefined : raw.trim();
}

/**
 * Identity of one persisted row.
 *
 * `msg:<msg_id>` is the canonical name shared with the live bubble, so a
 * resync lands on the bubble it already has instead of remounting it. Rows
 * written before msg_id existed (and optimistic rows) have no canonical id;
 * they get a positional one instead — the transcript is append-only, so the
 * index is stable across resyncs. Never derived from content: two different
 * messages with the same text must stay two rows.
 */
export function canonicalRowId(row: ServerHistoryRow, index: number): string {
  const msgId = idField(row?.msg_id);
  if (msgId) return `msg:${msgId}`;
  const given = typeof row?.id === 'string' ? row.id.trim() : '';
  if (given) return given;
  return `row:${index}`;
}

/** Map one backend transcript row to a UI row, keeping every identity. */
export function toChatRow(row: ServerHistoryRow, index: number): ChatRow {
  const mapped: ChatRow = {
    id: canonicalRowId(row, index),
    role: row?.role as 'ai' | 'human',
    content: typeof row?.content === 'string' ? row.content : '',
  };
  if (row?.type !== undefined) mapped.type = row.type;
  const msgId = idField(row?.msg_id);
  if (msgId) mapped.msgId = msgId;
  const requestId = idField(row?.request_id);
  if (requestId) mapped.requestId = requestId;
  const name = textField(row?.name);
  if (name) mapped.name = name;
  const avatar = textField(row?.avatar);
  if (avatar) mapped.avatar = avatar;
  const timestamp = textField(row?.timestamp);
  if (timestamp) mapped.timestamp = timestamp;
  return mapped;
}

/**
 * Collapse rows that are the SAME logical message (same non-empty msgId and
 * role). The first occurrence keeps its position (the transcript order of a
 * retry is the order of its first attempt) and the last one supplies the
 * content (the most recent attempt). Rows without a msgId are never
 * collapsed: there is no identity to compare, and text is not an identity.
 * The role is part of the key so a (pathological) id shared by a human and an
 * assistant row can never turn one into the other.
 */
export function collapseDuplicateMessages(rows: ChatRow[]): ChatRow[] {
  const firstIndex = new Map<string, number>();
  const out: ChatRow[] = [];
  rows.forEach((row) => {
    const msgId = row.msgId;
    if (!msgId) {
      out.push(row);
      return;
    }
    const key = `${row.role}:${msgId}`;
    const existing = firstIndex.get(key);
    if (existing === undefined) {
      firstIndex.set(key, out.length);
      out.push(row);
      return;
    }
    out[existing] = { ...out[existing], ...row, id: out[existing].id };
  });
  return out;
}

export interface PendingEntry {
  /** History the message was accepted on. */
  uid: string | null;
  /** Local message id (unique per append). */
  id: string;
  role: 'ai' | 'human';
  /** Latest known content (streaming AI entries grow by merging). */
  content: string;
  /** Backend request_id of the accepted send (human text sends only). */
  requestId?: string;
  /** Stable logical-message id, when the chunk carried one. */
  msgId?: string;
}

export interface ReconcileResult {
  /** Snapshot with unconfirmed local entries re-applied. */
  messages: ChatRow[];
  /** Pending entries still unconfirmed (matched ones are dropped). */
  remaining: PendingEntry[];
}

const MAX_PENDING = 100;

function textOf(row: ChatRow | undefined): string {
  return typeof row?.content === 'string' ? row.content : '';
}

export function capPending(entries: PendingEntry[]): PendingEntry[] {
  if (entries.length <= MAX_PENDING) return entries;
  return entries.slice(entries.length - MAX_PENDING);
}

/**
 * Lossless re-serialization of one pending entry.
 *
 * `applyHistoryData` hands pending entries to `reconcileHistoryData`, which
 * only reads `role`/`content`. That used to be done with an explicit
 * `{ uid, id, role, content }` literal, which silently dropped `requestId`.
 * Once lost, `retireSupersededPending` can no longer tell that the entry
 * belongs to a superseded turn, so a cancelled/unpersisted send is re-applied
 * by every later resync forever (a permanent phantom row the canonical
 * transcript does not contain). Cloning through here keeps the entry's turn
 * identity across any number of resyncs.
 */
export function clonePendingEntry(entry: PendingEntry): PendingEntry {
  const cloned: PendingEntry = {
    uid: entry.uid,
    id: entry.id,
    role: entry.role,
    content: entry.content,
  };
  if (entry.requestId !== undefined) cloned.requestId = entry.requestId;
  if (entry.msgId !== undefined) cloned.msgId = entry.msgId;
  return cloned;
}

/**
 * Retire pending leftovers of turns that a newer turn on the same history has
 * superseded.
 *
 * A turn on one history actually started: older turns there are done or
 * cancelled by construction, so their leftovers stop being pending — but the
 * just-accepted send (latest request_id) is kept until the snapshot confirms
 * it. Entries for other histories are kept for their own resync, and legacy
 * entries without a request_id keep their original "never retire" behaviour,
 * because there is no turn identity to compare against.
 */
export function retireSupersededPending(
  entries: PendingEntry[],
  latestRequestId: string | undefined,
  target: string | null | undefined,
): PendingEntry[] {
  return entries.filter((entry) => {
    if (!(entry.uid === target || entry.uid == null)) return true;
    if (entry.role !== 'human') return false;
    if (!entry.requestId || !latestRequestId) return true;
    return entry.requestId === latestRequestId;
  });
}

export function reconcileHistoryData(
  server: ChatRow[],
  pending: PendingEntry[],
): ReconcileResult {
  // A snapshot containing the same msgId twice is one logical message
  // delivered twice; render it once. Identity-only: identical text with
  // different ids stays two rows.
  const snapshot = collapseDuplicateMessages(
    Array.isArray(server) ? server.slice() : [],
  );
  const queue = Array.isArray(pending) ? pending.slice() : [];
  if (queue.length === 0) {
    return { messages: snapshot, remaining: [] };
  }

  const consumed = new Array(snapshot.length).fill(false);
  // pending index -> snapshot index (human exact matches only).
  const position = new Map<number, number>();

  const isHumanText = (row: ChatRow | undefined): boolean =>
    !!row && row.role === 'human' && (row.type === undefined || row.type === 'text');

  // Pass 1: human entries, oldest-first exact multiset match.
  queue.forEach((entry, pi) => {
    if (entry.role !== 'human') return;
    for (let si = 0; si < snapshot.length; si += 1) {
      if (!consumed[si] && isHumanText(snapshot[si]) && textOf(snapshot[si]) === (entry.content || '')) {
        consumed[si] = true;
        position.set(pi, si);
        return;
      }
    }
  });

  // Pass 2: AI entries. Identity first: if the snapshot holds the same
  // logical message (msgId), the entry is confirmed no matter how its text
  // was rewritten by the retry that persisted it. Otherwise fall back to the
  // legacy prefix-or-equal text match.
  // Clear-only: never consumes, so rapid duplicate partials cannot collide.
  const clearedAi = new Set<number>();
  queue.forEach((entry, pi) => {
    if (entry.role !== 'ai' || position.has(pi)) return;
    const local = entry.content || '';
    if (entry.msgId) {
      const persisted = snapshot.some(
        (row) => !!row && row.role === 'ai' && row.msgId === entry.msgId,
      );
      if (persisted) {
        clearedAi.add(pi);
        return;
      }
    }
    if (!local) return;
    for (let si = 0; si < snapshot.length; si += 1) {
      const row = snapshot[si];
      if (!row || row.role !== 'ai') continue;
      const full = textOf(row);
      if (full && (full === local || full.startsWith(local))) {
        clearedAi.add(pi);
        return;
      }
    }
  });

  // Pass 3: build output. Unmatched entries keep pending order; a human
  // entry anchors before the earliest snapshot row consumed by a later
  // pending entry, otherwise it appends. Unmatched AI partials append.
  const out = snapshot.slice();
  const remaining: PendingEntry[] = [];
  // Later-matched anchor per pending index (suffix minimum of positions).
  const anchorAfter: (number | null)[] = new Array(queue.length).fill(null);
  let best: number | null = null;
  for (let pi = queue.length - 1; pi >= 0; pi -= 1) {
    anchorAfter[pi] = best;
    const pos = position.get(pi);
    if (pos !== undefined && (best === null || pos < best)) {
      best = pos;
    }
  }
  // Track insertions so earlier inserts shift later anchor indices.
  let inserted = 0;
  queue.forEach((entry, pi) => {
    if (position.has(pi) || clearedAi.has(pi)) return; // confirmed
    remaining.push(entry);
    // Carry the full entry, not just id/role/content. Re-inserting a
    // human row used to drop `requestId`, which meant the AI answer that
    // this human turn just triggered could no longer be matched to its
    // turn identity: `applyCanonicalFinalToBubble` turned into a no-op and
    // the stale partial bubble stayed on screen.
    const restored: ChatRow = {
      id: entry.id,
      role: entry.role,
      content: entry.content,
      requestId: entry.requestId,
      msgId: entry.msgId,
    };
    const anchor = anchorAfter[pi];
    if (entry.role === 'human' && anchor !== null && anchor !== undefined) {
      out.splice(anchor + inserted, 0, restored);
      inserted += 1;
    } else {
      out.push(restored);
    }
  });

  return { messages: out, remaining: capPending(remaining) };
}
