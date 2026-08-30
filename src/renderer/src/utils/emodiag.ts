/**
 * TEMPORARY Stage-5/4 emotion diagnostic — metadata ONLY.
 *
 * Forwards tiny emotion metadata (labels, mapped face id, claim/release
 * decision) to the backend `/debug/emodiag` bridge, which logs it into the same
 * server-side log the user greps during a live test. Nothing sensitive is ever
 * sent: no chat text, persona, memory, relationship, cue text.
 *
 * Fire-and-forget; failures are swallowed so diagnostics can never break the
 * app. REMOVE in production cleanup.
 */

export interface EmoDiagPayload {
  faceId?: string | null
  claim?: boolean
  release?: boolean
  reason?: string
  /** Raw resolved face id on the way IN to the subscriber (pre-latch). */
  incoming?: string | null
  /** Where the signal came from (e.g. 'task'). */
  on?: string
  emotions?: (string | null)[] | null
  expressions?: (string | number | null)[] | null
  hasAudio?: boolean
  seq?: number
}

let seq = 0;

function trim(payload: EmoDiagPayload): EmoDiagPayload {
  const out: EmoDiagPayload = {};
  if (payload.faceId !== undefined) out.faceId = payload.faceId;
  if (payload.claim !== undefined) out.claim = payload.claim;
  if (payload.release !== undefined) out.release = payload.release;
  if (payload.reason !== undefined) out.reason = payload.reason;
  if (payload.emotions !== undefined) out.emotions = payload.emotions
    ?.filter((e): e is string => typeof e === 'string' && !!e.trim()) ?? [];
  if (payload.expressions !== undefined) out.expressions = payload.expressions
    ?.filter((e): e is string | number => e !== null && e !== undefined) ?? [];
  if (payload.hasAudio !== undefined) out.hasAudio = payload.hasAudio;
  if (payload.incoming !== undefined) out.incoming = payload.incoming;
  if (payload.on !== undefined) out.on = payload.on;
  if (payload.seq !== undefined) out.seq = payload.seq;
  return out;
}

export function emoDiag(payload: EmoDiagPayload): void {
  try {
    seq += 1;
    void fetch('/debug/emodiag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...trim(payload), seq }),
    }).catch(() => {});
  } catch {
    // never break the app
  }
}

export function resetEmoDiagSeq(): void {
  seq = 0;
}