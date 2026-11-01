import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceOutputStore, type SendMessageFn } from '@/utils/voice-output-store';
import { audioManager } from '@/utils/audio-manager';
import {
  VOICE_OUTPUT_ENABLED_KEY,
  loadVoiceOutputEnabled,
  saveVoiceOutputEnabled,
} from '@/utils/voice-output-preference';

// In-memory localStorage mock for node test runner
const storage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
};

test('1. VoiceOutputStore initializes from localStorage persistence', () => {
  storage.clear();
  storage.set(VOICE_OUTPUT_ENABLED_KEY, 'false');
  const store = new VoiceOutputStore();

  assert.equal(store.getSnapshot(), false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.isMuted(), true);
  assert.equal(audioManager.shouldSkipPlayback(), true);
});

test('2. Turning Voice OFF updates store, localStorage, audioManager, and sends WS toggle', () => {
  storage.clear();
  const store = new VoiceOutputStore();
  const sentMessages: any[] = [];
  const sendMessage: SendMessageFn = (msg) => sentMessages.push(msg);

  store.setVoiceOutputEnabled(false, sendMessage);

  assert.equal(store.getSnapshot(), false);
  assert.equal(window.localStorage.getItem(VOICE_OUTPUT_ENABLED_KEY), 'false');
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.isMuted(), true, 'Mute safeguard set when voice OFF');
  assert.equal(audioManager.shouldSkipPlayback(), true);
  assert.deepEqual(sentMessages, [{ type: 'voice-output-toggle', enabled: false }]);
});

test('3. Turning Voice ON restores audioManager playback and sends WS toggle', () => {
  storage.clear();
  const store = new VoiceOutputStore();
  const sentMessages: any[] = [];
  const sendMessage: SendMessageFn = (msg) => sentMessages.push(msg);

  store.setVoiceOutputEnabled(false, sendMessage);
  store.setVoiceOutputEnabled(true, sendMessage);

  assert.equal(store.getSnapshot(), true);
  assert.equal(window.localStorage.getItem(VOICE_OUTPUT_ENABLED_KEY), 'true');
  assert.equal(audioManager.isVoiceOutputEnabled(), true);
  assert.equal(audioManager.isMuted(), false);
  assert.equal(audioManager.shouldSkipPlayback(), false);
  assert.equal(sentMessages.length, 2);
  assert.deepEqual(sentMessages[1], [{ type: 'voice-output-toggle', enabled: true }][0]);
});

test('4. Footer and Settings listeners remain synchronized with identical state', () => {
  storage.clear();
  const store = new VoiceOutputStore();
  let footerObserved: boolean | null = null;
  let settingsObserved: boolean | null = null;

  const unsubFooter = store.subscribe(() => {
    footerObserved = store.getSnapshot();
  });
  const unsubSettings = store.subscribe(() => {
    settingsObserved = store.getSnapshot();
  });

  store.setVoiceOutputEnabled(false);
  assert.equal(footerObserved, false);
  assert.equal(settingsObserved, false);

  store.setVoiceOutputEnabled(true);
  assert.equal(footerObserved, true);
  assert.equal(settingsObserved, true);

  unsubFooter();
  unsubSettings();
});

test('5. Backend confirmation updates confirmed state and reconciles if needed', () => {
  storage.clear();
  const store = new VoiceOutputStore();
  assert.equal(store.getBackendConfirmedSnapshot(), null);

  // Backend confirms matching state
  store.onBackendConfirmed(true);
  assert.equal(store.getBackendConfirmedSnapshot(), true);
  assert.equal(store.getSnapshot(), true);

  // Backend authoritative state contradicts local state (reconciliation)
  store.onBackendConfirmed(false);
  assert.equal(store.getBackendConfirmedSnapshot(), false);
  assert.equal(store.getSnapshot(), false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.shouldSkipPlayback(), true);
});

test('6. Reconnect syncToBackend dispatches current persisted state', () => {
  storage.clear();
  storage.set(VOICE_OUTPUT_ENABLED_KEY, 'false');
  const store = new VoiceOutputStore();

  const sent: any[] = [];
  store.syncToBackend((msg) => sent.push(msg));

  assert.deepEqual(sent, [{ type: 'voice-output-toggle', enabled: false }]);
});

test('7. Rapid toggle sequence OFF -> ON -> OFF settles cleanly', () => {
  storage.clear();
  const store = new VoiceOutputStore();
  const sent: any[] = [];
  const sender: SendMessageFn = (msg) => sent.push(msg);

  store.setVoiceOutputEnabled(false, sender);
  store.setVoiceOutputEnabled(true, sender);
  store.setVoiceOutputEnabled(false, sender);

  assert.equal(store.getSnapshot(), false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.shouldSkipPlayback(), true);
  assert.equal(sent.length, 3);
  assert.equal(sent[sent.length - 1].enabled, false);
});

test('8. Stale handshake protection: unprompted initial handshake enabled=true does not overwrite persisted OFF', () => {
  storage.clear();
  storage.set(VOICE_OUTPUT_ENABLED_KEY, 'false');
  const store = new VoiceOutputStore();
  const sent: any[] = [];
  const sender: SendMessageFn = (msg) => sent.push(msg);

  // Initial un-synced backend sends stale enabled=true
  store.onBackendConfirmed(true, sender);

  // Must reject stale handshake: store remains false, localStorage remains false, and toggle(false) re-asserted
  assert.equal(store.getSnapshot(), false);
  assert.equal(storage.get(VOICE_OUTPUT_ENABLED_KEY), 'false');
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.isMuted(), true);
  assert.deepEqual(sent, [{ type: 'voice-output-toggle', enabled: false }]);

  // Now backend acknowledges and sends enabled=false
  store.onBackendConfirmed(false, sender);
  assert.equal(store.getSnapshot(), false);
  assert.equal(store.getBackendConfirmedSnapshot(), false);
});
