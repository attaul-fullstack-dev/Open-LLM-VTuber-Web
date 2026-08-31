import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_OUTPUT_ENABLED_KEY,
  loadVoiceOutputEnabled,
  saveVoiceOutputEnabled,
} from '@/utils/voice-output-preference';

// Minimal localStorage stub so the pure module works without a browser.
const storage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
};

test('default voice output is ON when nothing saved', () => {
  storage.clear();
  assert.equal(loadVoiceOutputEnabled(), true);
});

test('saving OFF persists and reads back OFF', () => {
  storage.clear();
  saveVoiceOutputEnabled(false);
  assert.equal(window.localStorage.getItem(VOICE_OUTPUT_ENABLED_KEY), 'false');
  assert.equal(loadVoiceOutputEnabled(), false);
});

test('saving ON persists and reads back ON', () => {
  storage.clear();
  saveVoiceOutputEnabled(true);
  assert.equal(window.localStorage.getItem(VOICE_OUTPUT_ENABLED_KEY), 'true');
  assert.equal(loadVoiceOutputEnabled(), true);
});

test('reload purity: saved state survives a fresh module read', () => {
  storage.clear();
  saveVoiceOutputEnabled(false);
  // simulate reload — same storage, new read
  assert.equal(loadVoiceOutputEnabled(), false);
});