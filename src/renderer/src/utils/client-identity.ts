// Stable client-instance identity (Stage 3).
//
// The backend keys every WebSocket connection on a fresh `client_uid`, so a
// reconnect looks like a brand-new client. That is correct for isolation but
// useless for recovery: the receipts and the in-flight message of the previous
// connection would then belong to "someone else".
//
// `client_ref` is the smallest thing that fixes it: a random id minted once per
// browser profile and persisted. It is NOT an authentication credential — the
// backend still refuses a receipt while the previous owner is connected, and
// the id only ever lets a reconnect reclaim its OWN unsettled messages. When it
// cannot be read or written (storage disabled), the id is empty and the client
// simply behaves like a legacy one: no reclaim, no protocol loss.

export const CLIENT_REF_KEY = 'mili.client-ref.v1';

export interface RefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_REF_LENGTH = 64;

/** Random, non-clock-based id (a timestamp is not an identity). */
export function newClientRef(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID().replace(/-/g, '');
  }
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  }
  return out;
}

/**
 * The persisted ref for this browser profile, minted on first use. Returns ''
 * when storage is unavailable — callers must then omit the field rather than
 * invent an identity.
 */
export function stableClientRef(storage?: RefStorage | null): string {
  let store = storage;
  if (store === undefined) {
    try {
      store = typeof window === 'undefined' ? null : window.localStorage;
    } catch {
      store = null;
    }
  }
  if (!store) return '';
  try {
    const existing = store.getItem(CLIENT_REF_KEY);
    if (typeof existing === 'string') {
      const trimmed = existing.trim();
      if (trimmed) return trimmed.slice(0, MAX_REF_LENGTH);
    }
    const minted = newClientRef().slice(0, MAX_REF_LENGTH);
    store.setItem(CLIENT_REF_KEY, minted);
    return minted;
  } catch {
    return '';
  }
}
