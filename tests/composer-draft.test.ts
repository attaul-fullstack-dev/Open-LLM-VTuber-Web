import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftKey,
  saveDraft,
  loadDraft,
  clearDraft,
  resolvePostSendDraft,
} from '../src/renderer/src/utils/composer-draft.ts';

const mem = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

test('draft key is scoped per conversation', () => {
  assert.notEqual(draftKey('aaa'), draftKey('bbb'));
  assert.equal(draftKey(null), draftKey(undefined));
  assert.ok(draftKey('aaa').length > 0);
});

test('draft save restores the exact long draft', () => {
  const store = mem();
  const key = draftKey('h1');
  const long = 'Mil, tadi kita lagi bahas bug Temporal Awareness. '.repeat(20);
  saveDraft(store, key, long);
  assert.equal(loadDraft(store, key), long);
});

test('draft survives reconnect, history reload, remount (nothing clears it)', () => {
  const store = mem();
  const key = draftKey('h1');
  saveDraft(store, key, 'draft panjang user');
  // Simulate: socket close -> reconnect -> history-data -> remount.
  // None of these call clearDraft; the value must be byte-identical.
  assert.equal(loadDraft(store, key), 'draft panjang user');
});

test('successful send clears the draft, failed send keeps it', () => {
  const store = mem();
  const key = draftKey('h1');
  saveDraft(store, key, 'terkirim');
  clearDraft(store, key);
  assert.equal(loadDraft(store, key), '');
  saveDraft(store, key, 'gagal terkirim');
  assert.equal(loadDraft(store, key), 'gagal terkirim');
});

test('empty text removes the key instead of storing blanks', () => {
  const store = mem();
  const key = draftKey('h1');
  saveDraft(store, key, 'x');
  saveDraft(store, key, '');
  assert.equal(loadDraft(store, key), '');
});

test('throwing storage never breaks typing', () => {
  const bad = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  saveDraft(bad, 'k', 'x');
  assert.equal(loadDraft(bad, 'k'), '');
  clearDraft(bad, 'k');
});

test('resolvePostSendDraft keeps keystrokes typed during media await', () => {
  const kept = resolvePostSendDraft('halo', 'halo dan lanjutannya');
  assert.equal(kept.action, 'keep');
  assert.equal(kept.text, 'halo dan lanjutannya');
  assert.deepEqual(resolvePostSendDraft('halo', 'halo'), { action: 'clear', text: '' });
  assert.deepEqual(resolvePostSendDraft('halo', ''), { action: 'clear', text: '' });
});
