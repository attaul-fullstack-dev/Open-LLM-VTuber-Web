import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const handler = read('../src/renderer/src/services/websocket-handler.tsx');
const input = read('../src/renderer/src/hooks/footer/use-text-input.tsx');
const aiState = read('../src/renderer/src/context/ai-state-context.tsx');

const streamingBranches = [
  "case 'conversation-chain-start'",
  "case 'conversation-chain-end'",
  'first-token',
  "case 'audio'",
  "case 'full-text'",
];

for (const branch of streamingBranches) {
  test(`streaming branch ${branch} never triggers connect/resync`, () => {
    const start = handler.indexOf(branch);
    assert.ok(start >= 0, `branch missing: ${branch}`);
    // Slice until the next case/break boundary (generous window).
    const window = handler.slice(start, start + 2500);
    assert.ok(!window.includes('wsService.connect('), `${branch} calls connect`);
    assert.ok(!window.includes('initializeConnection('), `${branch} re-inits`);
    assert.ok(!window.includes('fetch-and-set-history'), `${branch} refetches history`);
  });
}

test('history-data reconciles (never blindly replaces) and never touches the draft', () => {
  const start = handler.indexOf("case 'history-data'");
  assert.ok(start >= 0);
  const window = handler.slice(start, start + 1400);
  // Accepted-but-unpersisted local messages survive a racing resync.
  assert.ok(window.includes('applyHistoryData('));
  assert.ok(!window.includes('setMessages(message.messages)'));
  for (const token of ['setInputText', 'clearDraft', 'saveDraft', 'inputText']) {
    assert.ok(!window.includes(token), `history-data touches ${token}`);
  }
});

test('draft is cleared only on the successful-send path', () => {
  const clears = [...input.matchAll(/clearDraft\(/g)].length;
  assert.equal(clears, 1);
  const pos = input.indexOf('clearDraft(');
  const postSend = input.indexOf('resolvePostSendDraft(');
  assert.ok(postSend >= 0 && postSend < pos);
});

test('aiState functional updater reads latest state, not a stale closure', () => {
  assert.ok(aiState.includes('aiStateRef'), 'missing latest-state ref');
  assert.ok(
    /useCallback\([\s\S]*?\}, \[\]\)/.test(aiState),
    'setAiState must be stable (no aiState dep)',
  );
  assert.ok(!aiState.includes('(newState as (currentState: AiState) => AiState)(aiState)'));
});
