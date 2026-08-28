import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agent = read('../src/renderer/src/components/sidebar/setting/agent.tsx');
const dialog = read('../src/renderer/src/components/sidebar/setting/character-memory-dialog.tsx');
const audioTask = read('../src/renderer/src/hooks/utils/use-audio-task.ts');
const interrupt = read('../src/renderer/src/hooks/utils/use-interrupt.ts');

test('agent settings render one launcher instead of inline memory cards', () => {
  assert.match(agent, /CharacterMemoryLauncher/);
  assert.doesNotMatch(agent, /memories\.map/);
});

test('dedicated memory view keeps existing delete websocket actions', () => {
  assert.match(agent, /delete-character-memory/);
  assert.match(agent, /reset-character-memory/);
  assert.match(dialog, /memories\.map/);
});

test('memory view is mobile full-screen, independently scrollable, and wraps text', () => {
  assert.match(dialog, /'100dvh'/);
  assert.match(dialog, /overflowY="auto"/);
  assert.match(dialog, /overflowWrap="anywhere"/);
  assert.match(dialog, /minWidth="44px"/);
});

test('memory UI uses i18n keys instead of hard-coded labels', () => {
  assert.match(dialog, /settings\.agent\.memoryDescription/);
  assert.match(dialog, /settings\.agent\.deleteAllMemory/);
  assert.match(dialog, /settings\.agent\.noCharacterMemory/);
});

test('subtitle changes are anchored to actual playback and cancellation', () => {
  assert.match(audioTask, /addEventListener\('playing'/);
  assert.match(audioTask, /activateForPlayback/);
  assert.match(interrupt, /subtitlePlaybackCoordinator\.cancelResponse\(\)/);
  assert.match(interrupt, /setSubtitleText\(''\)/);
});
