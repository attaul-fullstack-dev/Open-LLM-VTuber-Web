/**
 * Persistent composer draft store (BUG 2 safety net).
 *
 * The unsent user input must survive reconnect / history reload /
 * component remount. Only the *unsent* input is stored here — never
 * transcripts or history. Cleared only after a message is successfully
 * handed to the send lifecycle.
 */

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

import { getActiveConnectionId, logDraftSave, logWsDiag } from './ws-diagnostics.ts';

const DRAFT_KEY_PREFIX = 'mili-composer-draft:';

/** Scope the draft to one conversation so drafts never leak across chats. */
export function draftKey(historyUid: string | null | undefined): string {
  const scope = (historyUid || '').trim() || 'default';
  return `${DRAFT_KEY_PREFIX}${scope}`;
}

export function saveDraft(
  storage: DraftStorage | null | undefined,
  key: string,
  text: string,
): void {
  if (!storage || !key) return;
  try {
    if (text) storage.setItem(key, text);
    else storage.removeItem(key);
    // Diagnostic-only: scope key only, never draft text.
    logDraftSave(key);
  } catch {
    // Storage quota/private-mode failures must never break typing.
  }
}

export function loadDraft(
  storage: DraftStorage | null | undefined,
  key: string,
): string {
  if (!storage || !key) return '';
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function clearDraft(
  storage: DraftStorage | null | undefined,
  key: string,
): void {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
    // Diagnostic-only: scope key only, never draft text.
    logWsDiag('DRAFT_CLEAR', getActiveConnectionId(), `scope=${key}`);
  } catch {
    // ignore
  }
}

/**
 * Decide what the composer should show after a successful send.
 *
 * The send text is snapshotted before an (up to 1200ms) media-capture
 * await. Keystrokes typed during that window were never sent and must
 * not be wiped: if the live field no longer equals what was sent, keep
 * the live value (caller re-persists it as the draft).
 */
export function resolvePostSendDraft(
  sentText: string,
  liveValue: string | null | undefined,
): { action: 'clear' | 'keep'; text: string } {
  const live = (liveValue || '').trim();
  if (live && live !== sentText.trim()) {
    return { action: 'keep', text: liveValue as string };
  }
  return { action: 'clear', text: '' };
}
