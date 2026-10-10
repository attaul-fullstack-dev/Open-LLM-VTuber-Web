/**
 * Multi-file attachment helpers for the chat composer.
 *
 * Pure functions only (no React, no DOM, no FileReader by default) so the
 * whole selection/merge/remove/validate lifecycle is unit-testable in node.
 * The hook (`use-text-input.tsx`) owns the FileReader side effect and keeps
 * a synchronous ref mirror so rapid overlapping selections compose instead
 * of overwriting each other.
 *
 * Wire limits mirror the backend (`sanitize_images` in conversation_utils.py):
 * keep both sides in sync when changing these.
 */

/** Hard cap: attachments carried by a single chat message. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
/** Hard cap: decoded bytes of one attachment. */
export const MAX_ATTACHMENT_FILE_BYTES = 5 * 1024 * 1024;
/** Hard cap: decoded bytes of all attachments in one message combined. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 10 * 1024 * 1024;

/** Validation failure codes; the hook maps these to localized toasts. */
export type AttachmentRejectCode =
  | 'not-image'
  | 'too-large'
  | 'too-many'
  | 'total-too-large'
  | 'read-failed';

/** One selected file, ready to preview and submit. */
export interface AttachmentEntry {
  /** Stable identity, independent of filename/content. Never reused. */
  id: string;
  /** Original filename for display and error messages. */
  name: string;
  /** Raw byte size (File.size), for display and limit checks. */
  size: number;
  /** MIME type for display; always image/* after validation. */
  mimeType: string;
  source: 'upload';
  /** Data-URL payload sent to the backend. */
  data: string;
  /** Decoded payload bytes, for the aggregate limit. */
  dataBytes: number;
}

let attachmentSeq = 0;

/** Mint a unique id. Counter-scoped so same-ms selections never collide. */
export function createAttachmentId(): string {
  attachmentSeq += 1;
  return `att-${Date.now().toString(36)}-${attachmentSeq.toString(36)}-${Math.floor(
    Math.random() * 0xffff,
  ).toString(36)}`;
}

/** Reset the id counter (tests only). */
export function __resetAttachmentSeqForTests(): void {
  attachmentSeq = 0;
}

/** Human-readable size, e.g. 512 B, 1.5 KB, 3.0 MB. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** Quick pre-read gate on a raw File: type + per-file size. */
export function validateAttachmentFile(file: {
  type: string;
  size: number;
}): { ok: true } | { ok: false; code: 'not-image' | 'too-large' } {
  if (!file.type || !file.type.startsWith('image/')) {
    return { ok: false, code: 'not-image' };
  }
  if (file.size > MAX_ATTACHMENT_FILE_BYTES) {
    return { ok: false, code: 'too-large' };
  }
  return { ok: true };
}

/** Decoded byte length of a data-URL (or raw base64) payload. */
export function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const len = b64.length;
  if (len === 0) return 0;
  let padding = 0;
  if (b64.endsWith('==')) padding = 2;
  else if (b64.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export interface MergeResult {
  merged: AttachmentEntry[];
  /** Entries refused by the count cap, in selection order. */
  droppedByCount: AttachmentEntry[];
  /** Entries refused by the aggregate-bytes cap, in selection order. */
  droppedByTotal: AttachmentEntry[];
}

/**
 * Append newly loaded entries to the current list.
 *
 * Identity is by `id` only: same filename or identical content never
 * overwrites an unrelated entry. Enforces the count cap (first-N win, rest
 * reported) and the aggregate-bytes cap (in-order fill, overflow reported).
 * Pure: safe to call from overlapping async selections.
 */
export function mergeAttachments(
  prev: AttachmentEntry[],
  added: AttachmentEntry[],
): MergeResult {
  const seen = new Set(prev.map((e) => e.id));
  const fresh = added.filter((e) => !seen.has(e.id));
  fresh.forEach((e) => seen.add(e.id));
  const room = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - prev.length);
  const withinCount = fresh.slice(0, room);
  const droppedByCount = fresh.slice(room);
  const merged: AttachmentEntry[] = [...prev];
  const droppedByTotal: AttachmentEntry[] = [];
  let total = prev.reduce((sum, e) => sum + e.dataBytes, 0);
  for (const entry of withinCount) {
    if (total + entry.dataBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
      droppedByTotal.push(entry);
      continue;
    }
    total += entry.dataBytes;
    merged.push(entry);
  }
  return { merged, droppedByCount, droppedByTotal };
}

/** Remove one entry by id; everything else (including same-name twins) stays. */
export function removeAttachment(
  prev: AttachmentEntry[],
  id: string,
): AttachmentEntry[] {
  return prev.filter((e) => e.id !== id);
}

export type ReadableFile = {
  name: string;
  type: string;
  size: number;
} & Blob;

export type ReadAsDataUrl = (file: ReadableFile) => Promise<string>;

function defaultReadAsDataUrl(file: ReadableFile): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

export interface LoadOutcome {
  loaded: AttachmentEntry[];
  /** Files that failed to read (name + error); caller toasts each. */
  failed: Array<{ name: string; error: unknown }>;
}

/**
 * Read one batch of Files into entries. Per-file isolation: one unreadable
 * file never discards its siblings. `read` is injectable for node tests.
 */
export async function loadAttachmentEntries(
  files: ReadableFile[],
  read: ReadAsDataUrl = defaultReadAsDataUrl,
): Promise<LoadOutcome> {
  const loaded: AttachmentEntry[] = [];
  const failed: Array<{ name: string; error: unknown }> = [];
  for (const file of files) {
    try {
      const data = await read(file);
      loaded.push({
        id: createAttachmentId(),
        name: file.name || 'image',
        size: file.size,
        mimeType: file.type || 'image/jpeg',
        source: 'upload',
        data,
        dataBytes: estimateDataUrlBytes(data),
      });
    } catch (error) {
      failed.push({ name: file.name || 'image', error });
    }
  }
  return { loaded, failed };
}
