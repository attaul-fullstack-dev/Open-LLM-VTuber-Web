import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TaskQueue } from '@/utils/task-queue';

// ---------------------------------------------------------------------------
// Behavioural: the wedge mechanism
//
// A queued audio task whose promise never settles (its only resolution paths
// are audio events, and a stopped element with an empty src fires neither
// `error` nor `ended`) stays in `activeTasks` forever. `hasTask()` then never
// goes false, `waitForCompletion()` never resolves, and the turn lifecycle
// never emits `frontend-playback-complete`. `clearQueue()` is the primitive
// every recovery path uses to break out of that.
// ---------------------------------------------------------------------------

test('a task that never settles keeps the queue busy', async () => {
  const queue = new TaskQueue(1);
  let settled = false;
  queue.addTask(
    () =>
      new Promise(() => {
        // never resolves: mirrors an abandoned playback promise
        settled = true;
      }),
  );

  // give the queue a tick to pick the task up
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(queue.hasTask(), true, 'the stuck task keeps the queue busy');

  const completion = queue.waitForCompletion();
  let done = false;
  completion.then(() => {
    done = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(done, false, 'waitForCompletion stays pending while a task is stuck');

  queue.clearQueue();
  await completion;
  assert.equal(done, true, 'clearQueue settles waitForCompletion');
  assert.equal(queue.hasTask(), false, 'queue reports idle after clearQueue');
  assert.equal(settled, true, 'the task itself had started');
});

test('clearQueue is idempotent and safe to call with nothing queued', async () => {
  const queue = new TaskQueue(1);
  queue.clearQueue();
  queue.clearQueue();
  assert.equal(queue.hasTask(), false);
  await queue.waitForCompletion();
});

test('clearQueue drops pending tasks but lets a started task settle', async () => {
  const queue = new TaskQueue(1);
  const ran = [];
  queue.addTask(async () => {
    ran.push('first');
  });
  // A second task is queued but cannot start until the first finishes.
  queue.addTask(async () => {
    ran.push('second');
  });

  queue.clearQueue();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(
    ran,
    ['first'],
    'clearQueue drops only the not-yet-started tasks',
  );
});

// ---------------------------------------------------------------------------
// Contract: every path that stops playback must also clear the queue.
//
// The quick-mute path used to stop only the current element. Because the
// per-segment gate (`shouldSkipPlayback`) still hid the remaining segments,
// nothing was audible, but the queued tasks kept the lifecycle wedged. These
// are source contracts because the footer component needs a DOM harness this
// suite does not have; the behavioural half above proves the primitive.
// ---------------------------------------------------------------------------

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('quick mute clears the pending audio queue', () => {
  const footer = read('src/renderer/src/components/footer/footer.tsx');
  const toggle = footer.slice(
    footer.indexOf('const handleSoundToggle'),
    footer.indexOf('return (', footer.indexOf('const handleSoundToggle')),
  );
  assert.match(
    toggle,
    /audioTaskQueue\.clearQueue\(\)/,
    'muting must clear queued audio so waitForCompletion can settle',
  );
  assert.match(
    toggle,
    /if \(!nextSoundOn\)/,
    'the clear must be scoped to the mute transition, not unmute',
  );
});

test('voice output OFF clears the pending audio queue', () => {
  const hook = read('src/renderer/src/hooks/utils/use-voice-output.ts');
  const setter = hook.slice(
    hook.indexOf('const setVoiceOutputEnabled'),
    hook.indexOf('const syncVoiceOutputToBackend'),
  );
  assert.match(
    setter,
    /if \(!enabled\)[\s\S]*audioTaskQueue\.clearQueue\(\)/,
    'turning voice output OFF must clear queued audio',
  );
});
