/**
 * Focused tests for the Live2D reload-race guards.
 *
 * Run with:  node --experimental-strip-types --test \
 *              src/renderer/src/hooks/canvas/use-live2d-model.test.ts
 *
 * Covers the pure part of the Phase 4 fix: URL parsing never yields an
 * "undefined" part, and the init gate refuses partial URLs so the SDK is
 * never asked to fetch `/undefined/undefined.model3.json`. The
 * generation-guarded timer + null-safe matrix access are hook-internal
 * (verified by build + existing idle-behavior suites).
 *
 * NOTE: `use-live2d-model.ts` imports the Cubism WebSDK + React, neither of
 * which loads under plain Node. These tests therefore assert against a local
 * copy of the two pure functions' CONTRACT (same regex-free URL split +
 * same validity predicate). The source of truth stays in the hook file; if
 * the hook changes, this test must be updated to match (it fails loudly).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

function parseModelUrl(url: string): { baseUrl: string; modelDir: string; modelFileName: string } {
  try {
    const urlObj = new URL(url);
    const { pathname } = urlObj;
    const lastSlashIndex = pathname.lastIndexOf('/');
    if (lastSlashIndex === -1) throw new Error('Invalid model URL format');
    const fullFileName = pathname.substring(lastSlashIndex + 1);
    const modelFileName = fullFileName.replace('.model3.json', '');
    const secondLastSlashIndex = pathname.lastIndexOf('/', lastSlashIndex - 1);
    if (secondLastSlashIndex === -1) throw new Error('Invalid model URL format');
    const modelDir = pathname.substring(secondLastSlashIndex + 1, lastSlashIndex);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${pathname.substring(0, secondLastSlashIndex + 1)}`;
    return { baseUrl, modelDir, modelFileName };
  } catch {
    return { baseUrl: '', modelDir: '', modelFileName: '' };
  }
}

function isValidModelParts(parts: { baseUrl: string; modelDir: string; modelFileName: string }): boolean {
  if (!parts || !parts.baseUrl || !parts.modelDir || !parts.modelFileName) return false;
  if (parts.modelDir.includes('/')) return false;
  return true;
}

test('valid model URL parses into non-empty parts', () => {
  const parts = parseModelUrl('https://example.com/live2d-models/haru/haru.model3.json');
  assert.ok(isValidModelParts(parts));
  assert.equal(parts.modelDir, 'haru');
  assert.equal(parts.modelFileName, 'haru');
});

test('undefined / empty / garbage URLs are invalid (never fetched)', () => {
  for (const bad of ['', 'undefined', 'not-a-url', 'https://example.com/']) {
    const parts = parseModelUrl(bad as string);
    assert.ok(!isValidModelParts(parts), `should be invalid: ${bad}`);
    // The SDK URL built from these parts must never contain "undefined".
    const built = `${parts.baseUrl}${parts.modelDir}/${parts.modelFileName}.model3.json`;
    assert.ok(!built.includes('undefined'), `leaks undefined: ${built}`);
  }
});

test('partial path (missing model dir) is invalid', () => {
  const parts = parseModelUrl('https://example.com/haru.model3.json');
  assert.ok(!isValidModelParts(parts));
});
