import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Source contracts for episodic search + "load more" (audit finding C).
//
// The overview only carries the latest 50 events, so an old event that the
// retrieval layer can still use was invisible in the Memory Manager. The fix
// is a read-only, newest-first search over the authoritative store with a
// stable keyset cursor. These contracts pin the UI side; the pagination,
// ordering, id stability and add/delete behaviour are tested behaviourally in
// the backend (`tests/test_episodic_search.py`).

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agent = read('../src/renderer/src/components/sidebar/setting/agent.tsx');
const dialog = read(
  '../src/renderer/src/components/sidebar/setting/character-memory-dialog.tsx',
);
const service = read('../src/renderer/src/services/websocket-service.tsx');

test('the dialog exposes a search box and a load-more control', () => {
  assert.match(dialog, /memorySearchEpisodicPlaceholder/);
  assert.match(dialog, /onEpisodicSearch/);
  assert.match(dialog, /onEpisodicLoadMore/);
  assert.match(dialog, /memoryLoadMore/);
  // the search input drives the debounced callback
  assert.match(dialog, /setSearchText\(event\.target\.value\)/);
  assert.match(dialog, /searchCallbackRef\.current\(query\)/);
});

test('loading, empty-result and read-failure states are distinct', () => {
  assert.match(dialog, /episodicView\.loading/);
  assert.match(dialog, /memorySearchLoading/);
  assert.match(dialog, /episodicView\.status === 'error'/);
  assert.match(dialog, /MemoryCategoryError/);
  assert.match(dialog, /episodicView\.query/);
  assert.match(dialog, /memorySearchNoResults/);
  assert.match(dialog, /noEpisodicMemory/);
});

test('the count label keeps the shown-of-total bound', () => {
  assert.match(dialog, /memorySectionEpisodic', \{\s*shown: episodicView\.events\.length,\s*total: episodicView\.total,/);
});

test('the agent sends search requests and never reloads the whole store', () => {
  assert.match(agent, /type: 'search-episodic-events'/);
  assert.match(agent, /limit: EPISODIC_PAGE_SIZE/);
  // paging is cursor-based, not offset/index-based
  assert.match(agent, /episodicCursorRef/);
  assert.doesNotMatch(agent, /offset:/);
});

test('append responses are merged and deduped by durable event id', () => {
  assert.match(agent, /message\.append/);
  assert.match(agent, /const seen = new Set\(prev\.events\.map\(\(event\) => event\.id\)\)/);
  assert.match(agent, /if \(!seen\.has\(event\.id\)\)/);
  // events are keyed by id, never by array position
  assert.match(dialog, /episodicView\.events\.map\(\(event\) => \(/);
  assert.match(dialog, /key=\{event\.id\}/);
});

test('stale responses for a replaced query are ignored', () => {
  assert.match(agent, /query !== episodicQueryRef\.current/);
  assert.match(agent, /message\.query/);
});

test('a mutation re-runs the active search so deleted/new events are defined', () => {
  assert.match(agent, /episodic-event-deleted/);
  assert.match(agent, /episodicActiveRef\.current && wsStateRef\.current === 'OPEN'/);
});

test('the websocket message carries the paginated search fields', () => {
  assert.match(service, /episodic-search-results/);
  assert.match(service, /next_cursor\?: string \| null/);
  assert.match(service, /has_more\?: boolean/);
  assert.match(service, /append\?: boolean/);
});

test('the search never mixes categories', () => {
  // the search state carries only episodic events
  assert.match(agent, /MemoryEpisodicItem/);
  const block = agent.slice(
    agent.indexOf("message.type === 'episodic-search-results'"),
    agent.indexOf("attachment-memories"),
  );
  assert.doesNotMatch(block, /preferences|intentions|world/);
});

test('all new strings exist in three locales', () => {
  for (const key of [
    'memorySectionEpisodicTitle',
    'memorySearchEpisodicPlaceholder',
    'memorySearchLoading',
    'memorySearchNoResults',
    'noEpisodicMemory',
    'memoryLoadMore',
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
