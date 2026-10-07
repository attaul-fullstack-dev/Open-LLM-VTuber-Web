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

export function reconcileHistoryData(
  server: ChatRow[],
  pending: PendingEntry[],
): ReconcileResult {
  const snapshot = Array.isArray(server) ? server.slice() : [];
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

  // Pass 2: AI entries, prefix-or-equal match against any AI snapshot row.
  // Clear-only: never consumes, so rapid duplicate partials cannot collide.
  const clearedAi = new Set<number>();
  queue.forEach((entry, pi) => {
    if (entry.role !== 'ai' || position.has(pi)) return;
    const local = entry.content || '';
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
    const anchor = anchorAfter[pi];
    if (entry.role === 'human' && anchor !== null && anchor !== undefined) {
      out.splice(anchor + inserted, 0, {
        id: entry.id,
        role: entry.role,
        content: entry.content,
      });
      inserted += 1;
    } else {
      out.push({ id: entry.id, role: entry.role, content: entry.content });
    }
  });

  return { messages: out, remaining: capPending(remaining) };
}
