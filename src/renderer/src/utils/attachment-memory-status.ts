/**
 * Attachment Memory deletion-status mapping (pure, no React/Chakra).
 *
 * Backend contract (`attachment-memory-deleted`):
 *   { type, success, record_id, purge: {
 *       found, record_id, filename, attachment_removed,
 *       episodic_removed[], episodic_failed[],
 *       character_memories_remaining[], transcripts_remaining[],
 *       summaries_remaining[], world_state_match, complete } }
 *
 * Mapping rules (never claim more than the backend proves):
 * - purge.complete === true (with attachment_removed) -> 'complete'.
 * - record gone but complete !== true                  -> 'partial'.
 * - record NOT gone (attachment_removed !== true)       -> 'failed'.
 * - legacy response without a purge object              -> 'legacy-success'
 *   (record deleted under the old contract; purge scope unverified and
 *   therefore never claimed) or 'failed' when success is falsy.
 * - missing/malformed message or malformed purge        -> 'unknown'
 *   (renders as failure, never as success).
 */

export interface AttachmentPurgeStatus {
  found?: boolean;
  record_id?: string;
  filename?: string;
  attachment_removed?: boolean;
  episodic_removed?: string[];
  episodic_failed?: string[];
  character_memories_remaining?: string[];
  transcripts_remaining?: string[];
  summaries_remaining?: string[];
  world_state_match?: boolean;
  complete?: boolean;
}

export interface AttachmentMemoryRecord {
  id: string;
  filename?: string;
  mime_type?: string;
  source?: string;
  received_at?: string;
  session_uid?: string;
  status?: string;
  summary?: string;
  created_at?: string;
}

export type AttachmentDeleteOutcome =
  | 'complete'
  | 'partial'
  | 'failed'
  | 'unknown'
  | 'legacy-success';

export type AttachmentRemainingKind =
  | 'episodic'
  | 'transcripts'
  | 'summaries'
  | 'character'
  | 'world';

export interface AttachmentRemainingSource {
  kind: AttachmentRemainingKind;
  count: number;
}

export interface AttachmentDeleteResult {
  outcome: AttachmentDeleteOutcome;
  remaining: AttachmentRemainingSource[];
}

export interface AttachmentDeleteMessage {
  success?: boolean;
  record_id?: string;
  purge?: AttachmentPurgeStatus | null;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Collect the remaining-copy sources a purge object reports.
 * Only sources with at least one remaining copy are listed.
 */
export function collectRemainingSources(
  purge: AttachmentPurgeStatus,
): AttachmentRemainingSource[] {
  const remaining: AttachmentRemainingSource[] = [];
  const push = (kind: AttachmentRemainingKind, count: number): void => {
    if (count > 0) {
      remaining.push({ kind, count });
    }
  };
  push('episodic', countOf(purge.episodic_failed));
  push('transcripts', countOf(purge.transcripts_remaining));
  push('summaries', countOf(purge.summaries_remaining));
  push('character', countOf(purge.character_memories_remaining));
  if (purge.world_state_match === true) {
    remaining.push({ kind: 'world', count: 1 });
  }
  return remaining;
}

/**
 * Map a raw `attachment-memory-deleted` message to a UI outcome.
 * Malformed input degrades to 'unknown', never to success.
 */
export function resolveAttachmentDeleteOutcome(
  message: AttachmentDeleteMessage | null | undefined,
): AttachmentDeleteResult {
  if (!isRecordObject(message)) {
    return { outcome: 'unknown', remaining: [] };
  }
  if ('purge' in message) {
    const purge = (message as { purge?: unknown }).purge;
    if (!isRecordObject(purge)) {
      return { outcome: 'unknown', remaining: [] };
    }
    const status = purge as AttachmentPurgeStatus;
    if (status.attachment_removed === true) {
      if (status.complete === true) {
        return { outcome: 'complete', remaining: [] };
      }
      return { outcome: 'partial', remaining: collectRemainingSources(status) };
    }
    return { outcome: 'failed', remaining: [] };
  }
  if ((message as { success?: unknown }).success === true) {
    return { outcome: 'legacy-success', remaining: [] };
  }
  return { outcome: 'failed', remaining: [] };
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Coerce an untrusted `attachment-memories` payload into renderable
 * records. Entries without a usable string id are dropped (they can
 * neither display stably nor be deleted); every other field degrades to
 * undefined instead of crashing the list.
 */
export function normalizeAttachmentRecords(input: unknown): AttachmentMemoryRecord[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const records: AttachmentMemoryRecord[] = [];
  for (const entry of input) {
    if (!isRecordObject(entry)) {
      continue;
    }
    const id = cleanString(entry.id);
    if (id === undefined) {
      continue;
    }
    const record: AttachmentMemoryRecord = { id };
    const filename = cleanString(entry.filename);
    if (filename !== undefined) {
      record.filename = filename;
    }
    const mimeType = cleanString(entry.mime_type);
    if (mimeType !== undefined) {
      record.mime_type = mimeType;
    }
    const source = cleanString(entry.source);
    if (source !== undefined) {
      record.source = source;
    }
    const receivedAt = cleanString(entry.received_at);
    if (receivedAt !== undefined) {
      record.received_at = receivedAt;
    }
    const sessionUid = cleanString(entry.session_uid);
    if (sessionUid !== undefined) {
      record.session_uid = sessionUid;
    }
    const status = cleanString(entry.status);
    if (status !== undefined) {
      record.status = status;
    }
    const summary = cleanString(entry.summary);
    if (summary !== undefined) {
      record.summary = summary;
    }
    const createdAt = cleanString(entry.created_at);
    if (createdAt !== undefined) {
      record.created_at = createdAt;
    }
    records.push(record);
  }
  return records;
}

/**
 * Display label for a record: uploader filename when known, otherwise a
 * caller-supplied fallback (e.g. "<source> capture").
 */
export function attachmentDisplayName(
  record: Pick<AttachmentMemoryRecord, 'filename'> | null | undefined,
  fallback: string,
): string {
  const filename = cleanString(record?.filename);
  return filename ?? fallback;
}
