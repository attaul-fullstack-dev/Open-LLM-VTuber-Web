import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source contracts for the character-memory ("Lihat ingatan Mili") list.
//
// Bug: facts stored in the backend never appeared in the dialog although
// Mili already recalled them. Two compounding staleness vectors:
//
//  1. The backend served the agent's in-memory snapshot (loaded once per
//     history resume) instead of the authoritative file.
//  2. Opening the dialog never refetched, so the rendered list stayed
//     frozen at history-resume time -- unlike the attachment dialog, which
//     refetches on open.
//
// The dialog itself renders `memories` verbatim (no filter), so these
// contracts pin the fetch side. The backend half is covered behaviourally
// in `test_character_memory_commands.py::ListFreshnessTest`.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agent = read('../src/renderer/src/components/sidebar/setting/agent.tsx');
const dialog = read(
  '../src/renderer/src/components/sidebar/setting/character-memory-dialog.tsx',
);

test('opening the character memory dialog refetches the unified list', () => {
  const block = agent.slice(
    agent.indexOf('<CharacterMemoryDialog'),
    agent.indexOf('<AttachmentMemoryLauncher'),
  );
  assert.match(block, /onOpenChange=\{\(open\) => \{/);
  assert.match(block, /setMemoryDialogOpen\(open\)/);
  assert.match(block, /fetch-memory-overview/);
  assert.match(
    block,
    /if \(open && wsState === 'OPEN'\)/,
    'refetch on open, gated on a live socket',
  );
});

test('the dialog renders the served list verbatim (no filter)', () => {
  assert.match(dialog, /memories\.map\(\(memory, index\)/);
  // the only .filter in the dialog joins label parts, never memories
  assert.doesNotMatch(dialog, /memories\.filter/);
});

test('the list refreshes after delete, reset, and state-reset events', () => {
  assert.match(agent, /character-memory-deleted/);
  assert.match(agent, /character-memory-reset/);
  assert.match(agent, /character-state-reset/);
});

test('each row shows its stored source and date, never invented metadata', () => {
  assert.match(dialog, /memorySourceLabel/);
  assert.match(dialog, /memoryDateLabel/);
  assert.match(dialog, /memorySourceManual/);
  assert.match(dialog, /memorySourceAuto/);
  for (const locale of ['en', 'id', 'zh']) {
    const strings = JSON.parse(
      read(`../src/renderer/src/locales/${locale}/translation.json`),
    );
    assert.equal(typeof strings.settings.agent.memorySourceManual, 'string');
    assert.equal(typeof strings.settings.agent.memorySourceAuto, 'string');
  }
});

test('the panel consumes the unified overview, not the facts-only fetch', () => {
  assert.match(agent, /memory-overview/);
  assert.match(agent, /fetch-memory-overview/);
  assert.match(agent, /setMemoryOverview/);
});

test('each category has its own delete message type', () => {
  assert.match(agent, /delete-character-memory/);
  assert.match(agent, /delete-episodic-event/);
  assert.match(agent, /delete-interaction-preference/);
  assert.match(agent, /cancel-future-intention/);
});

test('episodic delete sends the row id, never an array index', () => {
  const block = dialog.slice(
    dialog.indexOf('episodicView.events.map((event)'),
    dialog.indexOf(': world && ('),
  );
  assert.match(block, /onDeleteEpisodic\(event\.id\)/);
  assert.doesNotMatch(block, /onDeleteEpisodic\((index|i)\)/);
});

test('the dialog renders one section per store plus a read-only world card', () => {
  assert.match(dialog, /memorySectionPreferences/);
  assert.match(dialog, /memorySectionIntentions/);
  assert.match(dialog, /memorySectionEpisodic/);
  assert.match(dialog, /memorySectionWorld/);
  assert.match(dialog, /memoryWorldReadOnly/);
  // the world card must not offer any delete operation (the facts
  // delete-all footer lives outside the dialog body and is out of scope)
  const worldBlock = dialog.slice(
    dialog.indexOf(': world && ('),
    dialog.indexOf('</DialogBody>'),
  );
  assert.doesNotMatch(worldBlock, /onDelete|onCancel|FiTrash2/);
});

test('a failed category renders a load error, not an empty state', () => {
  // status signal drives the UI: an unreadable store must say "couldn't
  // load" instead of "no data", for and only for the failed category
  assert.match(dialog, /status\?\.\[category\] === 'error'/);
  assert.match(dialog, /MemoryCategoryError/);
  for (const category of ['facts', 'preferences', 'intentions', 'world']) {
    assert.match(
      dialog,
      new RegExp(`failed\\('${category}'\\)`),
      `the ${category} section must gate on its read status`,
    );
  }
  // episodic has its own search view, gated on the same error status
  assert.match(
    dialog,
    /episodicView\.status === 'error'/,
    'the episodic section must gate on its read status',
  );
});

test('section rows carry only stored metadata in three locales', () => {
  for (const key of [
    'memorySectionPreferences',
    'memorySectionIntentions',
    'memorySectionEpisodic',
    'memorySectionWorld',
    'memorySectionEpisodicTitle',
    'memorySearchEpisodicPlaceholder',
    'memorySearchLoading',
    'memorySearchNoResults',
    'noEpisodicMemory',
    'memoryLoadMore',
    'memoryWorldReadOnly',
    'memoryCategoryLoadFailed',
    'forgetPreference',
    'deletePreferenceConfirm',
    'cancelIntention',
    'cancelIntentionConfirm',
    'forgetEvent',
    'deleteEventConfirm',
  ]) {
    for (const locale of ['en', 'id', 'zh']) {
      const strings = JSON.parse(
        read(`../src/renderer/src/locales/${locale}/translation.json`),
      );
      assert.equal(
        typeof strings.settings.agent[key],
        'string',
        `${locale} must define settings.agent.${key}`,
      );
    }
  }
});
