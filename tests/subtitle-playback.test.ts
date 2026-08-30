import assert from 'node:assert/strict';
import test from 'node:test';
import { SubtitlePlaybackCoordinator } from '../src/renderer/src/utils/subtitle-playback.ts';

test('queued future segments do not replace the current subtitle', () => {
  const coordinator = new SubtitlePlaybackCoordinator();
  coordinator.startResponse();
  const first = coordinator.createSegment('Segmen pertama');
  const second = coordinator.createSegment('Segmen kedua');

  assert.equal(coordinator.getCurrentSubtitle(), '');
  assert.equal(coordinator.activateForPlayback(first), 'Segmen pertama');
  assert.equal(coordinator.getCurrentSubtitle(), 'Segmen pertama');

  // Merely synthesizing/queueing the second segment changes nothing.
  assert.equal(coordinator.getCurrentSubtitle(), 'Segmen pertama');
  assert.equal(coordinator.activateForPlayback(second), 'Segmen kedua');
  assert.equal(coordinator.getCurrentSubtitle(), 'Segmen kedua');
});

test('a short segment remains visible until the next playback starts', () => {
  const coordinator = new SubtitlePlaybackCoordinator();
  coordinator.startResponse();
  const short = coordinator.createSegment('Ih.');
  const next = coordinator.createSegment('Jangan gitu dong.');

  coordinator.activateForPlayback(short);
  assert.equal(coordinator.getCurrentSubtitle(), 'Ih.');
  // There is deliberately no timer-based replacement.
  assert.equal(coordinator.getCurrentSubtitle(), 'Ih.');
  coordinator.activateForPlayback(next);
  assert.equal(coordinator.getCurrentSubtitle(), 'Jangan gitu dong.');
});

test('cancelled response tickets cannot leak stale subtitles', () => {
  const coordinator = new SubtitlePlaybackCoordinator();
  coordinator.startResponse();
  const cancelled = coordinator.createSegment('Jangan tampilkan aku');
  coordinator.cancelResponse();

  assert.equal(coordinator.activateForPlayback(cancelled), null);
  assert.equal(coordinator.getCurrentSubtitle(), '');
});

test('duplicate playback events do not duplicate a subtitle', () => {
  const coordinator = new SubtitlePlaybackCoordinator();
  coordinator.startResponse();
  const segment = coordinator.createSegment('Sekali saja');

  assert.equal(coordinator.activateForPlayback(segment), 'Sekali saja');
  assert.equal(coordinator.activateForPlayback(segment), null);
  assert.equal(coordinator.getCurrentSubtitle(), 'Sekali saja');
});

test('silent or muted responses accumulate without losing text', () => {
  const coordinator = new SubtitlePlaybackCoordinator();
  coordinator.startResponse();
  const first = coordinator.createSegment('Bagian satu.');
  const second = coordinator.createSegment('Bagian dua.');

  assert.equal(coordinator.activateWithoutPlayback(first), 'Bagian satu.');
  assert.equal(
    coordinator.activateWithoutPlayback(second),
    'Bagian satu. Bagian dua.',
  );
});
