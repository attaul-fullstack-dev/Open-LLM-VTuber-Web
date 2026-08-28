import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanChatDisplayText } from '../src/renderer/src/utils/clean-display-text.ts';

test('paragraph breaks and emoji remain visible', () => {
  assert.equal(
    cleanChatDisplayText('[smirk] Paragraf satu 😏\n\nParagraf dua.'),
    'Paragraf satu 😏\n\nParagraf dua.',
  );
});

test('technical markers are removed without damaging long URLs', () => {
  const url = 'https://example.com/a/very-long-path-without-spaces';
  assert.equal(cleanChatDisplayText(`[happy] Cek ${url}`), `Cek ${url}`);
});
