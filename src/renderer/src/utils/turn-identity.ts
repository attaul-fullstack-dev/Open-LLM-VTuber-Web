// Turn-identity helpers for live-bubble synchronization (pure, no I/O).
//
// A live AI bubble is identified by the backend turn request_id carried on
// every audio payload of that turn — never by arrival timing. The persisted
// history row is authoritative; these helpers decide, deterministically:
// - which bubble a streaming chunk belongs to (resolveAiTarget),
// - how a canonical-final event reconciles bubbles of one turn
//   (applyCanonicalFinal).
//
// Rules mirror the pre-existing append behavior exactly when no request id
// is present, so ordinary turns are byte-identical to before.

export interface IdentityBubble {
  id: string;
  role: "ai" | "human";
  content: string;
  type?: string;
  requestId?: string | null;
}

export type AiTarget = { mode: "merge"; index: number } | { mode: "new" };

const isAiText = (row: IdentityBubble | undefined): boolean =>
  !!row && row.role === "ai" && (row.type === undefined || row.type === "text");

/** Last bubble index whose requestId matches (AI text rows only). */
export function bubbleIndexForTurn(
  bubbles: IdentityBubble[],
  requestId: string | null | undefined,
): number {
  if (!requestId) return -1;
  for (let i = bubbles.length - 1; i >= 0; i -= 1) {
    const row = bubbles[i];
    if (isAiText(row) && row.requestId === requestId) return i;
  }
  return -1;
}

export function resolveAiTarget(
  bubbles: IdentityBubble[],
  opts: { requestId?: string | null; forceNew: boolean },
): AiTarget {
  const list = Array.isArray(bubbles) ? bubbles : [];
  // A chunk that carries its turn identity always joins its own turn's
  // bubble — even when a newer turn already forced a new message. This is
  // what keeps a trailing payload from opening a stray bubble.
  if (opts.requestId) {
    const owned = bubbleIndexForTurn(list, opts.requestId);
    if (owned >= 0) return { mode: "merge", index: owned };
    return { mode: "new" };
  }
  // No identity: legacy behavior, unchanged.
  const last = list[list.length - 1];
  if (opts.forceNew || !isAiText(last)) return { mode: "new" };
  return { mode: "merge", index: list.length - 1 };
}

export interface SegmentText {
  text: string;
  name?: string;
  avatar?: string;
  requestId?: string | null;
}

/**
 * FIFO of received-but-unplayed segment texts. The audio queue owns
 * playback; this buffer owns TEXT preservation: if the queue is cleared
 * (interrupt / next turn) before a task executes, flush() reaps the
 * unplayed texts into the live bubble first. shiftForText() runs at task
 * execution start in the same FIFO order, so a flushed entry's task
 * (cleared right after) can never double-append. No audio is ever replayed.
 */
export function createSegmentTextBuffer() {
  const pending: SegmentText[] = [];
  return {
    push(entry: SegmentText): void {
      if (entry && typeof entry.text === "string" && entry.text) {
        pending.push(entry);
      }
    },
    shiftForText(text: string): void {
      if (!text) return;
      if (pending.length > 0 && pending[0].text === text) {
        pending.shift();
        return;
      }
      // Defensive: FIFO broken (should not happen) — drop the matching
      // entry if present so a flush cannot duplicate it.
      const at = pending.findIndex((e) => e.text === text);
      if (at >= 0) pending.splice(at, 1);
    },
    flush(): SegmentText[] {
      if (pending.length === 0) return [];
      const drained = pending.slice();
      pending.length = 0;
      return drained;
    },
    size(): number {
      return pending.length;
    },
  };
}

export type SegmentTextBuffer = ReturnType<typeof createSegmentTextBuffer>;

/**
 * Decide which drained unplayed segments may still join the live UI.
 *
 * A segment is healable only when its turn already finalized (ai-final
 * received): the owning bubble then holds the canonical text and the
 * finalized guard turns the append into a verified no-op. Anything else
 * — interrupted/cancelled turns (no ai-final will ever come), unknown
 * turns, or turns whose bubble is gone — is dropped: appending it would
 * invent live text the canonical history does not contain.
 *
 * Segments without turn identity predate identity routing; they keep the
 * legacy append-everything behavior so old payload shapes are unchanged.
 * Pure and deterministic: same inputs, same partition, no text heuristics.
 */
export function selectFlushSegments(
  segments: SegmentText[],
  finalizedTurnIds: Set<string> | string[] | null | undefined,
  bubbles: IdentityBubble[],
): { heal: SegmentText[]; drop: SegmentText[] } {
  const finalized = new Set(finalizedTurnIds ?? []);
  const heal: SegmentText[] = [];
  const drop: SegmentText[] = [];
  for (const seg of Array.isArray(segments) ? segments : []) {
    if (!seg || typeof seg.text !== "string" || !seg.text) continue;
    const turnId = seg.requestId ?? null;
    if (!turnId) {
      heal.push(seg);
      continue;
    }
    if (!finalized.has(turnId)) {
      drop.push(seg);
      continue;
    }
    if (bubbleIndexForTurn(bubbles, turnId) < 0) {
      drop.push(seg);
      continue;
    }
    heal.push(seg);
  }
  return { heal, drop };
}

export interface CanonicalResult {
  bubbles: IdentityBubble[];
  /** Bubble ids whose content was set/kept to the canonical text. */
  finalizedIds: string[];
  /** True when at least one bubble of the turn was found. */
  matched: boolean;
  /** True when the visible text actually changed. */
  changed: boolean;
}

/**
 * Reconcile every live bubble of one turn to its canonical persisted text.
 * Pure and idempotent: running twice changes nothing the second time.
 * Split bubbles of the same turn collapse into the first (identity merge,
 * never another stray bubble); bubbles of other turns are untouched.
 */
export function applyCanonicalFinal(
  bubbles: IdentityBubble[],
  requestId: string,
  text: string,
): CanonicalResult {
  const list = Array.isArray(bubbles) ? bubbles.slice() : [];
  // Empty canonical text can never be authoritative (the backend never
  // emits it); reconciling to '' would wipe the bubble, so refuse.
  if (!requestId || typeof text !== "string" || text.length === 0) {
    return { bubbles: list, finalizedIds: [], matched: false, changed: false };
  }
  const owned: number[] = [];
  list.forEach((row, i) => {
    if (isAiText(row) && row.requestId === requestId) owned.push(i);
  });
  if (owned.length === 0) {
    return { bubbles: list, finalizedIds: [], matched: false, changed: false };
  }
  let changed = false;
  const kept = list[owned[0]];
  if (kept.content !== text) {
    list[owned[0]] = { ...kept, content: text };
    changed = true;
  }
  const finalizedIds = [list[owned[0]].id];
  // Collapse split parts: same turn identity means same logical message.
  // Remove from the end so indices stay valid.
  for (let k = owned.length - 1; k >= 1; k -= 1) {
    list.splice(owned[k], 1);
    changed = true;
  }
  return { bubbles: list, finalizedIds, matched: true, changed };
}
