// Continued-conversation view (pure, dependency-free).
//
// A long conversation is continued in a NEW transcript (backend hand-off).
// That new session is NOT an empty chat: it is where the previous one carries
// on, and the client must show it that way without ever copying rows into the
// new file or rewriting the old ones.
//
// Two sources feed this view, both read-only:
// 1. The `new-history-created` frame the server sends at hand-off time. The
//    tab that was live on the source conversation already holds its bubbles,
//    so those ARE the context (adopted, identities and timestamps untouched).
// 2. The `history-data` snapshot of a continuation session (`continued_from`
//    + `context_messages`), which is what a reload or a reconnect sees. The
//    preview is a bounded tail of the source transcript's own rows.
//
// Rules that keep this honest:
// - context rows are never mutated, re-dated or re-identified: `toChatRow`
//   maps them exactly like a normal resync, keeping `msgId`/`timestamp`;
// - the current session's bubble list stays a list of ITS OWN rows, so a
//   preview can never be mistaken for something this session persisted;
// - re-applying the same continuation replaces the preview instead of
//   appending to it (no duplicate bubbles on a repeated resync).

import {
  collapseDuplicateMessages,
  toChatRow,
  type ChatRow,
  type ServerHistoryRow,
} from '@/utils/history-reconcile';

/** Server-side bound for the preview; kept in step with the backend. */
export const CONTINUATION_CONTEXT_LIMIT = 24;

/** What the server said about the continuation in one frame. */
export interface ContinuationEvent {
  /** Source transcript this session continues from. */
  from: string;
  /** When the hand-off happened (server clock, opaque to the UI). */
  at?: string;
  /** Bounded tail of the source transcript, unchanged backend rows. */
  context?: ServerHistoryRow[];
  /** Row count of the whole source transcript. */
  total?: number;
}

/** The view the chat panel renders above the current session. */
export interface ContinuationView {
  from: string;
  at?: string;
  messages: ChatRow[];
  /** Source rows that exist in total (may be more than `messages`). */
  total: number;
  /** True when the context came from this tab's own live bubbles. */
  adopted: boolean;
}

const nonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().length > 0 ? value : undefined;
};

/**
 * Read a continuation out of a server frame, or null when the frame does not
 * describe one. Never throws on a malformed payload: an unreadable
 * continuation is simply not claimed (the client then shows a plain session).
 */
export function parseContinuationEvent(
  payload: Record<string, unknown> | null | undefined,
): ContinuationEvent | null {
  const from = nonEmptyString(payload?.continued_from);
  if (!from) return null;
  const event: ContinuationEvent = { from };
  const at = nonEmptyString(payload?.continued_at);
  if (at) event.at = at;
  if (Array.isArray(payload?.context_messages)) {
    event.context = payload?.context_messages as ServerHistoryRow[];
  }
  const total = payload?.context_total;
  if (typeof total === 'number' && Number.isFinite(total) && total >= 0) {
    event.total = Math.floor(total);
  }
  return event;
}

/**
 * Build the view for one continuation frame.
 *
 * `displayedHistoryUid` is the history this tab is currently showing (not the
 * one the frame is about): when it is the source conversation, the bubbles
 * already on screen are the truest context available and are adopted as-is.
 * Otherwise the server's bounded preview is used, with positional ids offset
 * by the rows the preview omits so identical rows keep identical ids whether
 * they arrive in the preview or in a full fetch.
 */
export function buildContinuation(input: {
  event: ContinuationEvent;
  displayedHistoryUid: string | null;
  displayedMessages: ChatRow[];
  previous?: ContinuationView | null;
  limit?: number;
}): ContinuationView {
  const {
    event, displayedHistoryUid, displayedMessages, previous,
  } = input;
  const limit = Math.max(
    1,
    Math.floor(input.limit ?? CONTINUATION_CONTEXT_LIMIT),
  );
  const total = Math.max(0, event.total ?? 0);

  if (displayedHistoryUid === event.from && displayedMessages.length > 0) {
    return {
      from: event.from,
      ...(event.at ? { at: event.at } : {}),
      messages: collapseDuplicateMessages(displayedMessages.slice(-limit)),
      total: Math.max(total, displayedMessages.length),
      adopted: true,
    };
  }

  const rows = Array.isArray(event.context) ? event.context : [];
  if (rows.length > 0) {
    const slice = rows.slice(-limit);
    const offset = Math.max(0, rows.length - slice.length);
    return {
      from: event.from,
      ...(event.at ? { at: event.at } : {}),
      // Collapse by logical identity (never by text) so a retried row can
      // never render as two bubbles with the same React key.
      messages: collapseDuplicateMessages(
        slice.map((row, index) => toChatRow(row, offset + index)),
      ),
      total: Math.max(total, rows.length),
      adopted: false,
    };
  }

  // A frame with no preview (older server, or an unreadable source) must not
  // blank a view this tab already holds for the SAME source.
  if (previous && previous.from === event.from && previous.messages.length > 0) {
    return {
      from: event.from,
      ...(event.at ?? previous.at ? { at: event.at ?? previous.at } : {}),
      messages: previous.messages,
      total: Math.max(total, previous.total),
      adopted: previous.adopted,
    };
  }

  return {
    from: event.from,
    ...(event.at ? { at: event.at } : {}),
    messages: [],
    total,
    adopted: false,
  };
}

/**
 * The continuation a session should show after a snapshot for `historyUid`.
 *
 * Returns null for an ordinary session, which is what clears a stale banner
 * when the user opens a different conversation.
 */
export function continuationForSnapshot(input: {
  event: ContinuationEvent | null;
  displayedHistoryUid: string | null;
  displayedMessages: ChatRow[];
  previous?: ContinuationView | null;
  limit?: number;
}): ContinuationView | null {
  if (!input.event) return null;
  return buildContinuation({
    event: input.event,
    displayedHistoryUid: input.displayedHistoryUid,
    displayedMessages: input.displayedMessages,
    previous: input.previous,
    limit: input.limit,
  });
}
