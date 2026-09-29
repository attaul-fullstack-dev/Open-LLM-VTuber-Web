import { test } from 'node:test';
import assert from 'node:assert/strict';
import { miliTokens } from '@/theme/design-tokens';

// Contract: composer visuals must come from tokens, never hardcoded in
// components. If a key is missing here, a component imports it — fail fast.
test('composer token contract: all required keys present', () => {
  const required = [
    'bg',
    'border',
    'divider',
    'text',
    'placeholder',
    'icon',
    'iconMuted',
    'iconHoverBg',
    'accent',
    'accentInk',
    'micActiveBg',
  ] as const;
  for (const key of required) {
    const value = miliTokens.composer[key];
    assert.equal(typeof value, 'string', `composer.${key} must be a string`);
    assert.ok(value.length > 0, `composer.${key} must not be empty`);
  }
});

test('composer accent is flat warm orange, not neon', () => {
  assert.equal(miliTokens.composer.accent, '#E8935A');
  assert.ok(!miliTokens.composer.accentInk.includes('gradient'));
});
