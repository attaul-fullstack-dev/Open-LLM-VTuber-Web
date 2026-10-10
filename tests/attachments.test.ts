import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_ATTACHMENTS_TOTAL_BYTES,
  createAttachmentId,
  estimateDataUrlBytes,
  formatFileSize,
  loadAttachmentEntries,
  mergeAttachments,
  removeAttachment,
  validateAttachmentFile,
  __resetAttachmentSeqForTests,
} from '../src/renderer/src/utils/attachments.ts';
import type { AttachmentEntry, ReadableFile } from '../src/renderer/src/utils/attachments.ts';

function entry(over: Partial<AttachmentEntry> = {}): AttachmentEntry {
  return {
    id: over.id ?? createAttachmentId(),
    name: over.name ?? 'foto.png',
    size: over.size ?? 1024,
    mimeType: over.mimeType ?? 'image/png',
    source: 'upload',
    data: over.data ?? 'data:image/png;base64,AAAA',
    dataBytes: over.dataBytes ?? 3,
  };
}

test('selecting multiple files in one operation keeps all of them', () => {
  __resetAttachmentSeqForTests();
  const added = [entry({ name: 'a.png' }), entry({ name: 'b.png' }), entry({ name: 'c.png' })];
  const result = mergeAttachments([], added);
  assert.equal(result.merged.length, 3);
  assert.deepEqual(result.merged.map((e) => e.name), ['a.png', 'b.png', 'c.png']);
  assert.equal(result.droppedByCount.length, 0);
  assert.equal(result.droppedByTotal.length, 0);
});

test('adding files across selections appends instead of replacing', () => {
  __resetAttachmentSeqForTests();
  const first = mergeAttachments([], [entry({ name: 'a.png' })]);
  const second = mergeAttachments(first.merged, [entry({ name: 'b.png' })]);
  assert.deepEqual(second.merged.map((e) => e.name), ['a.png', 'b.png']);
});

test('removing one attachment preserves the others', () => {
  __resetAttachmentSeqForTests();
  const all = [entry({ name: 'a.png' }), entry({ name: 'b.png' }), entry({ name: 'c.png' })];
  const merged = mergeAttachments([], all).merged;
  const rest = removeAttachment(merged, merged[1].id);
  assert.deepEqual(rest.map((e) => e.name), ['a.png', 'c.png']);
});

test('same filename twice keeps both with distinct stable ids', () => {
  __resetAttachmentSeqForTests();
  const twins = [entry({ name: 'foto.png' }), entry({ name: 'foto.png' })];
  assert.notEqual(twins[0].id, twins[1].id);
  const merged = mergeAttachments([], twins).merged;
  assert.equal(merged.length, 2);
  const rest = removeAttachment(merged, merged[0].id);
  assert.equal(rest.length, 1);
  assert.equal(rest[0].id, twins[1].id);
});

test('identical content never overwrites an unrelated entry', () => {
  __resetAttachmentSeqForTests();
  const same = 'data:image/png;base64,iVBORw0KGgo=';
  const pair = [entry({ name: 'a.png', data: same }), entry({ name: 'b.png', data: same })];
  const merged = mergeAttachments([], pair).merged;
  assert.equal(merged.length, 2);
  assert.notEqual(merged[0].id, merged[1].id);
});

test('merge is idempotent for already-present ids', () => {
  __resetAttachmentSeqForTests();
  const one = entry({ name: 'a.png' });
  const merged = mergeAttachments([one], [one]);
  assert.equal(merged.merged.length, 1);
});

test('count cap keeps first-N in order and reports the rest', () => {
  __resetAttachmentSeqForTests();
  const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 2 }, (_, i) =>
    entry({ name: `f${i}.png` }));
  const result = mergeAttachments([], many);
  assert.equal(result.merged.length, MAX_ATTACHMENTS_PER_MESSAGE);
  assert.deepEqual(result.merged.map((e) => e.name),
    many.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).map((e) => e.name));
  assert.deepEqual(result.droppedByCount.map((e) => e.name),
    many.slice(MAX_ATTACHMENTS_PER_MESSAGE).map((e) => e.name));
});

test('aggregate-bytes cap fills in order and reports overflow', () => {
  __resetAttachmentSeqForTests();
  const big = Math.floor(MAX_ATTACHMENTS_TOTAL_BYTES / 2);
  const a = entry({ name: 'a.png', dataBytes: big });
  const b = entry({ name: 'b.png', dataBytes: big });
  const c = entry({ name: 'c.png', dataBytes: big });
  const result = mergeAttachments([], [a, b, c]);
  assert.deepEqual(result.merged.map((e) => e.name), ['a.png', 'b.png']);
  assert.deepEqual(result.droppedByTotal.map((e) => e.name), ['c.png']);
});

test('removing frees aggregate room for a later selection', () => {
  __resetAttachmentSeqForTests();
  const big = Math.floor(MAX_ATTACHMENTS_TOTAL_BYTES / 2);
  const start = mergeAttachments([], [
    entry({ name: 'a.png', dataBytes: big }),
    entry({ name: 'b.png', dataBytes: big }),
  ]).merged;
  const afterRemove = removeAttachment(start, start[0].id);
  const result = mergeAttachments(afterRemove, [entry({ name: 'c.png', dataBytes: big })]);
  assert.deepEqual(result.merged.map((e) => e.name), ['b.png', 'c.png']);
  assert.equal(result.droppedByTotal.length, 0);
});

test('validation rejects non-images and oversize files', () => {
  assert.deepEqual(validateAttachmentFile({ type: 'application/pdf', size: 10 }), {
    ok: false, code: 'not-image',
  });
  assert.deepEqual(validateAttachmentFile({ type: '', size: 10 }), {
    ok: false, code: 'not-image',
  });
  assert.deepEqual(
    validateAttachmentFile({ type: 'image/png', size: MAX_ATTACHMENT_FILE_BYTES + 1 }), {
      ok: false, code: 'too-large',
    });
  assert.deepEqual(
    validateAttachmentFile({ type: 'image/jpeg', size: MAX_ATTACHMENT_FILE_BYTES }), { ok: true });
});

test('formatFileSize renders bytes, KB and MB', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(3 * 1024 * 1024), '3 MB');
  assert.equal(formatFileSize(-1), '0 B');
});

test('estimateDataUrlBytes decodes base64 length', () => {
  // 'AAAA' -> 3 bytes; 'AAA=' -> 2 bytes
  assert.equal(estimateDataUrlBytes('data:image/png;base64,AAAA'), 3);
  assert.equal(estimateDataUrlBytes('data:image/png;base64,AAA='), 2);
  assert.equal(estimateDataUrlBytes(''), 0);
  assert.equal(estimateDataUrlBytes('data:image/png;base64,'), 0);
});

test('ids are unique across rapid creation', () => {
  __resetAttachmentSeqForTests();
  const ids = new Set(Array.from({ length: 200 }, () => createAttachmentId()));
  assert.equal(ids.size, 200);
});

test('loadAttachmentEntries keeps siblings when one file fails', async () => {
  const good = (name: string) => ({
    name, type: 'image/png', size: 4,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }) as unknown as File;
  const read = async (file: ReadableFile) => {
    if (file.name === 'bad.png') {
      throw new Error('boom');
    }
    return 'data:image/png;base64,AAAA';
  };
  const files = [good('a.png'), good('bad.png'), good('c.png')] as unknown as ReadableFile[];
  const outcome = await loadAttachmentEntries(files, read);
  assert.deepEqual(outcome.loaded.map((e) => e.name), ['a.png', 'c.png']);
  assert.deepEqual(outcome.failed.map((f) => f.name), ['bad.png']);
  assert.notEqual(outcome.loaded[0].id, outcome.loaded[1].id);
});

test('boundary: 1, 2, 5 and 10 images pass; the 11th is refused', () => {
  __resetAttachmentSeqForTests();
  for (const n of [1, 2, 5, 10]) {
    const batch = Array.from({ length: n }, (_, i) => entry({ name: `f${i}.png` }));
    const result = mergeAttachments([], batch);
    assert.equal(result.merged.length, n, `n=${n}`);
    assert.equal(result.droppedByCount.length, 0, `n=${n}`);
  }
  const eleven = Array.from({ length: 11 }, (_, i) => entry({ name: `f${i}.png` }));
  const over = mergeAttachments([], eleven);
  assert.equal(over.merged.length, 10);
  assert.deepEqual(over.droppedByCount.map((e) => e.name), ['f10.png']);
});

test('boundary: gradual selection up to 10 keeps everything; past it keeps prior', () => {
  __resetAttachmentSeqForTests();
  let state: AttachmentEntry[] = [];
  for (let i = 0; i < 10; i += 1) {
    state = mergeAttachments(state, [entry({ name: `g${i}.png` })]).merged;
  }
  assert.equal(state.length, 10);
  const before = state.map((e) => e.id);
  const past = mergeAttachments(state, [entry({ name: 'extra.png' })]);
  assert.deepEqual(past.merged.map((e) => e.id), before);
  assert.deepEqual(past.droppedByCount.map((e) => e.name), ['extra.png']);
});

test('serial composition of overlapping selections loses nothing', () => {
  __resetAttachmentSeqForTests();
  // Two selections finishing back-to-back must compose, not overwrite.
  const afterFirst = mergeAttachments([], [entry({ name: 'a.png' })]).merged;
  const afterSecond = mergeAttachments(afterFirst, [entry({ name: 'b.png' })]).merged;
  assert.equal(afterSecond.length, 2);
});

test('REGRESSION (Android single-file report): one selection operation with '
  + 'two files retains both, and a second selection appends', async () => {
  // Mirrors handleFileSelect end to end: FileList -> load -> merge.
  // The reported failure was single-file picker behavior; if the state
  // layer ever replaced instead of appending, this fails even when the
  // picker hands over several files at once.
  __resetAttachmentSeqForTests();
  const asReadable = (names: string[]): ReadableFile[] =>
    names.map((name) => ({ name, type: 'image/png', size: 4 }) as unknown as ReadableFile);
  const read = async () => 'data:image/png;base64,AAAA';

  // First operation: two files selected at once.
  const firstOp = await loadAttachmentEntries(asReadable(['satu.png', 'dua.png']), read);
  assert.equal(firstOp.failed.length, 0);
  let state = mergeAttachments([], firstOp.loaded).merged;
  assert.deepEqual(state.map((e) => e.name), ['satu.png', 'dua.png']);

  // Second operation: one more file must append, not replace.
  const secondOp = await loadAttachmentEntries(asReadable(['tiga.png']), read);
  state = mergeAttachments(state, secondOp.loaded).merged;
  assert.deepEqual(state.map((e) => e.name), ['satu.png', 'dua.png', 'tiga.png']);
  assert.equal(new Set(state.map((e) => e.id)).size, 3);
});
