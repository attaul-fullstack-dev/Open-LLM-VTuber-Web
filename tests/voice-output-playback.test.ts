import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioManager } from '@/utils/audio-manager';
import {
  loadVoiceOutputEnabled,
  saveVoiceOutputEnabled,
} from '@/utils/voice-output-preference';

// Minimal localStorage stub for the singleton's initial muted read.
const storage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => storage.set(key, value),
  },
};

function fakeAudio(): any {
  return {
    paused: true,
    src: '',
    pause() { this.paused = true; },
    load() {},
  };
}

function fakeModel(releaseSpy: () => void): any {
  return { _wavFileHandler: { releasePcmData: releaseSpy } };
}

test('default: playback not skipped when voice output is ON and not muted', () => {
  audioManager.setVoiceOutputEnabled(true);
  audioManager.setMuted(false);
  assert.equal(audioManager.isVoiceOutputEnabled(), true);
  assert.equal(audioManager.shouldSkipPlayback(), false);
});

test('voice output OFF makes playback skipped (even when quick mute is off)', () => {
  audioManager.setMuted(false);
  audioManager.setVoiceOutputEnabled(false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.shouldSkipPlayback(), true);
});

test('voice output back ON restores playback (quick mute still off)', () => {
  audioManager.setMuted(false);
  audioManager.setVoiceOutputEnabled(true);
  assert.equal(audioManager.shouldSkipPlayback(), false);
});

test('voice output flag is independent from the quick speaker mute flag', () => {
  // quick mute ON must not turn voice output OFF
  audioManager.setVoiceOutputEnabled(true);
  audioManager.setMuted(true);
  assert.equal(audioManager.isVoiceOutputEnabled(), true);
  // and quick mute OFF must not auto-enable voice output
  audioManager.setVoiceOutputEnabled(false);
  audioManager.setMuted(false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.shouldSkipPlayback(), true);
});

test('turning voice output OFF stops the currently playing audio and lip sync', () => {
  audioManager.setMuted(false);
  const audio = fakeAudio();
  const model = fakeModel(() => {});
  audioManager.setCurrentAudio(audio, model);

  audioManager.setVoiceOutputEnabled(false);

  assert.equal(audio.paused, true, 'current audio should be paused');
  assert.equal(audio.src, '', 'current audio src should be cleared');
  assert.equal(audioManager.hasCurrentAudio(), false, 'manager should drop the audio reference');
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
});

test('turning voice output OFF releases PCM lip-sync data on the model', () => {
  audioManager.setMuted(false);
  let released = false;
  const audio = fakeAudio();
  const model = fakeModel(() => { released = true; });
  audioManager.setCurrentAudio(audio, model);

  audioManager.setVoiceOutputEnabled(false);

  assert.equal(released, true, 'releasePcmData should be called when stopping');
});

test('reload persistence: saved OFF re-inits the runtime gate OFF, then toggle ON restores audio', () => {
  // The pure persistence helpers mirror what the reconnect-sync in
  // WebSocketHandler sends to the backend on WS OPEN.
  storage.clear();
  saveVoiceOutputEnabled(false);

  // Simulate page-reload mount: the hook now re-initializes the shared
  // audioManager gate from the persisted value (matching the saved OFF).
  audioManager.setVoiceOutputEnabled(loadVoiceOutputEnabled());
  assert.equal(audioManager.isVoiceOutputEnabled(), false, 'runtime gate OFF after reload/init');
  assert.equal(audioManager.shouldSkipPlayback(), true, 'received audio is skipped after reload while saved OFF');

  // The backend sync value sent on reconnect equals the persisted value.
  assert.equal(loadVoiceOutputEnabled(), false, 'websocket sync (backend) value is OFF');

  // User toggles Voice Output back to ON.
  saveVoiceOutputEnabled(true);
  audioManager.setVoiceOutputEnabled(loadVoiceOutputEnabled());
  assert.equal(audioManager.isVoiceOutputEnabled(), true, 'runtime gate ON after toggle');
  assert.equal(loadVoiceOutputEnabled(), true, 'websocket sync (backend) value is ON after toggle');
  assert.equal(audioManager.shouldSkipPlayback(), false, 'subsequent audio is NOT skipped after reload->ON');
});

test('ordinary ON->OFF->ON without reload still restores playback', () => {
  audioManager.setMuted(false);
  audioManager.setVoiceOutputEnabled(true);

  // OFF
  audioManager.setVoiceOutputEnabled(false);
  assert.equal(audioManager.isVoiceOutputEnabled(), false);
  assert.equal(audioManager.shouldSkipPlayback(), true);

  // back to ON
  audioManager.setVoiceOutputEnabled(true);
  assert.equal(audioManager.isVoiceOutputEnabled(), true);
  assert.equal(audioManager.shouldSkipPlayback(), false);
});
