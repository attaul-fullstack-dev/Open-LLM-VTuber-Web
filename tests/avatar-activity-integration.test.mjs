import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/renderer/src/App.tsx');
const input = read('../src/renderer/src/hooks/footer/use-text-input.tsx');
const audio = read('../src/renderer/src/hooks/utils/use-audio-task.ts');
const interrupt = read('../src/renderer/src/hooks/utils/use-interrupt.ts');
const proactive = read('../src/renderer/src/context/proactive-speak-context.tsx');
const controller = read('../src/renderer/src/utils/avatar-activity-controller.ts');

test('one runtime provider owns avatar activity independently of WebSocket reconnects', () => {
  assert.equal((app.match(/<AvatarActivityProvider>/g) || []).length, 1);
  assert.match(app, /<AvatarActivityProvider>[\s\S]*<WebSocketHandler>/);
});

test('only a successfully sent user text resets conversational inactivity', () => {
  const sentGuard = input.indexOf('if (!sent) return');
  const activity = input.indexOf('markUserActivity();');
  assert.ok(sentGuard >= 0);
  assert.ok(activity > sentGuard);
});

test('speaking begins from actual audio playback rather than queueing or synthesis', () => {
  const playing = audio.indexOf("audio.addEventListener('playing'");
  const begin = audio.indexOf('beginSpeaking();', playing);
  assert.ok(playing >= 0);
  assert.ok(begin > playing);
});

test('multi-segment speaking remains active until the whole queue completes', () => {
  assert.match(audio, /await audioTaskQueue\.waitForCompletion\(\)/);
  assert.match(audio, /stopCurrentAudioAndLipSync\(\)/);
  assert.match(audio, /audioManager\.stopCurrentAudioAndLipSync\(\);\s*endAllSpeaking\(\)/);
  assert.doesNotMatch(audio, /cleanup[\s\S]{0,180}endSpeaking/);
});

test('proactive assistant runtime cannot mark itself as user activity', () => {
  assert.doesNotMatch(proactive, /markUserActivity|AvatarActivity/);
});

test('only a local interruption counts as direct user activity', () => {
  assert.match(interrupt, /if \(sendSignal\) markUserActivity\(\)/);
});

test('idle controller introduces no provider, socket, network, or polling call', () => {
  assert.doesNotMatch(
    controller,
    /fetch\(|new WebSocket|from ['"].*provider|setInterval|requestAnimationFrame/,
  );
  assert.match(controller, /setTimeout/);
});
