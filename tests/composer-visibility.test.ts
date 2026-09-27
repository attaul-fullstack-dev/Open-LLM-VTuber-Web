import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveComposerCollapsed } from '@/utils/composer-visibility';

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
