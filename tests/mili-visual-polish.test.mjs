import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokens = read('../src/renderer/src/theme/design-tokens.ts');
const settingStyles = read('../src/renderer/src/components/sidebar/setting/setting-styles.tsx');
const common = read('../src/renderer/src/components/sidebar/setting/common.tsx');
const settingUI = read('../src/renderer/src/components/sidebar/setting/setting-ui.tsx');
const tts = read('../src/renderer/src/components/sidebar/setting/tts.tsx');
const general = read('../src/renderer/src/components/sidebar/setting/general.tsx');
const agent = read('../src/renderer/src/components/sidebar/setting/agent.tsx');
const live2d = read('../src/renderer/src/components/canvas/live2d.tsx');
const drawer = read('../src/renderer/src/components/sidebar/history-drawer.tsx');
const sidebarStyles = read('../src/renderer/src/components/sidebar/sidebar-styles.tsx');
const dialog = read('../src/renderer/src/components/sidebar/setting/character-memory-dialog.tsx');

test('design tokens define one chat bubble fill (no per-file duplicates)', () => {
  assert.match(tokens, /userBubble:\s*'#20b8a6'/);
  assert.match(sidebarStyles, /miliTokens\.chat\.userBubble/);
  assert.doesNotMatch(sidebarStyles, /#20b8a6/);
});

test('settings styles come from tokens, not hardcoded dark palettes', () => {
  assert.match(settingStyles, /miliTokens\.color\.drawer/);
  assert.match(settingStyles, /miliTokens\.color\.surface/);
  assert.doesNotMatch(settingStyles, /gray\.800/);
  assert.doesNotMatch(settingStyles, /gray\.900/);
});

test('floating Live2D controls use tokens (no foreign fills or bad shades)', () => {
  assert.match(live2d, /miliTokens\.color\.elevated/);
  assert.match(live2d, /miliTokens\.color\.accent/);
  assert.doesNotMatch(live2d, /#6d5dfc/);
  assert.doesNotMatch(live2d, /whiteAlpha\.160/);
  assert.doesNotMatch(live2d, /whiteAlpha\.260/);
});

test('TTS tab renders an intentional empty state, never a blank box', () => {
  assert.match(tts, /settings\.tts\.emptyTitle/);
  assert.match(tts, /settings\.tts\.emptyBody/);
  assert.match(tts, /emptyState/);
});

test('settings tabs share one form language and section grouping', () => {
  assert.match(common, /SettingSection/);
  assert.match(general, /SettingSection/);
  assert.match(agent, /SettingSection/);
  // No second card/border system for sections.
  assert.doesNotMatch(common, /borderTopWidth/);
});

test('footer actions have one primary hierarchy (save solid, cancel quiet)', () => {
  assert.match(settingStyles, /saveButton/);
  assert.match(settingStyles, /cancelButton/);
  assert.match(settingUI, /saveButton/);
  assert.match(settingUI, /cancelButton/);
  assert.doesNotMatch(settingUI, /colorPalette="red"/);
  assert.doesNotMatch(settingUI, /colorPalette="blue"/);
});

test('history list has one divider system and a quiet active state', () => {
  assert.doesNotMatch(drawer, /sessionDivider/);
  assert.doesNotMatch(sidebarStyles, /sessionDivider/);
  assert.match(sidebarStyles, /titleSelected/);
  assert.doesNotMatch(sidebarStyles, /inset 2px 0 0/);
  // Chakra v3 truncates with lineClamp; the v2 noOfLines prop is dead.
  assert.doesNotMatch(sidebarStyles, /noOfLines/);
});

test('memory dialog uses valid token colors (no dead whiteAlpha steps)', () => {
  for (const dead of ['whiteAlpha.150', 'whiteAlpha.550', 'whiteAlpha.650', 'whiteAlpha.850', 'whiteAlpha.950']) {
    assert.doesNotMatch(dialog, new RegExp(dead.replace('.', '\\.')));
  }
  assert.match(dialog, /miliTokens\.color\.drawer/);
});
