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

test('opening the character memory dialog refetches the list', () => {
  const block = agent.slice(
    agent.indexOf('<CharacterMemoryDialog'),
    agent.indexOf('<AttachmentMemoryLauncher'),
  );
  assert.match(block, /onOpenChange=\{\(open\) => \{/);
  assert.match(block, /setMemoryDialogOpen\(open\)/);
  assert.match(block, /fetch-character-memory/);
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
