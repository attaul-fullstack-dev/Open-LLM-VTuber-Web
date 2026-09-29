import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveComposerCollapsed, getComposerMode } from '@/utils/composer-visibility';

test('A. composer expanded + open Settings/menu => composer collapsed', () => {
  assert.equal(resolveComposerCollapsed(false, true), true);
});

test('B. composer collapsed + open Settings/menu => stays collapsed', () => {
  assert.equal(resolveComposerCollapsed(true, true), true);
});

test('C. close Settings/menu => composer back to user state, never forced expand', () => {
  assert.equal(resolveComposerCollapsed(false, false), false);
  assert.equal(resolveComposerCollapsed(true, false), true);
});

test('D. repeated open/close is stable and idempotent', () => {
  let userCollapsed = false;
  for (let i = 0; i < 5; i++) {
    assert.equal(resolveComposerCollapsed(userCollapsed, true), true);
    assert.equal(resolveComposerCollapsed(userCollapsed, false), userCollapsed);
  }
  userCollapsed = true;
  for (let i = 0; i < 5; i++) {
    assert.equal(resolveComposerCollapsed(userCollapsed, true), true);
    assert.equal(resolveComposerCollapsed(userCollapsed, false), true);
  }
});

test('pure: no input mutation, boolean output', () => {
  const out = resolveComposerCollapsed(false, true);
  assert.equal(typeof out, 'boolean');
  assert.equal(out, true);
});

test('mode: empty and single line are compact', () => {
  assert.equal(getComposerMode(''), 'compact');
  assert.equal(getComposerMode('n'), 'compact');
  assert.equal(getComposerMode('nnnjjjnnn'), 'compact');
  assert.equal(getComposerMode('long wrapped text without newlines stays compact'), 'compact');
});

test('mode: explicit newlines are expanded', () => {
  assert.equal(getComposerMode('a\nb'), 'expanded');
  assert.equal(getComposerMode('1\n2\n3'), 'expanded');
  assert.equal(getComposerMode('1\n2\n3\n4\n5'), 'expanded');
});

test('mode: deleting back to one line returns to compact', () => {
  assert.equal(getComposerMode('a\nb'), 'expanded');
  assert.equal(getComposerMode('ab'), 'compact');
});

test('mode: trailing newline still counts as multiline', () => {
  assert.equal(getComposerMode('abc\n'), 'expanded');
});
