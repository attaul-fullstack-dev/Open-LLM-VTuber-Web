import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachmentDisplayName,
  collectRemainingSources,
  normalizeAttachmentRecords,
  resolveAttachmentDeleteOutcome,
} from '../src/renderer/src/utils/attachment-memory-status.ts';
import type {
  AttachmentPurgeStatus,
} from '../src/renderer/src/utils/attachment-memory-status.ts';

function purge(over: Partial<AttachmentPurgeStatus> = {}): AttachmentPurgeStatus {
  return {
    found: true,
    record_id: 'rec-1',
    filename: 'kucing.png',
    attachment_removed: true,
    episodic_removed: [],
    episodic_failed: [],
    character_memories_remaining: [],
    transcripts_remaining: [],
    summaries_remaining: [],
    world_state_match: false,
    complete: true,
    ...over,
  };
}

test('complete=true with record removed renders full deletion', () => {
  const result = resolveAttachmentDeleteOutcome({ success: true, purge: purge() });
  assert.equal(result.outcome, 'complete');
  assert.deepEqual(result.remaining, []);
});

test('record gone without complete=true renders partial with sources', () => {
  const result = resolveAttachmentDeleteOutcome({
    success: true,
    purge: purge({
      complete: false,
      transcripts_remaining: ['sess-a', 'sess-b'],
      summaries_remaining: ['sess-a'],
      world_state_match: true,
    }),
  });
  assert.equal(result.outcome, 'partial');
  assert.deepEqual(result.remaining, [
    { kind: 'transcripts', count: 2 },
    { kind: 'summaries', count: 1 },
    { kind: 'world', count: 1 },
  ]);
});

test('partial lists every non-empty remaining source in stable order', () => {
  const remaining = collectRemainingSources(purge({
    complete: false,
    episodic_failed: ['e1'],
    transcripts_remaining: ['s1'],
    summaries_remaining: ['s1'],
    character_memories_remaining: ['fact'],
    world_state_match: true,
  }));
  assert.deepEqual(remaining.map((item) => item.kind), [
    'episodic',
    'transcripts',
    'summaries',
    'character',
    'world',
  ]);
});

test('record not removed renders failure even when complete is claimed', () => {
  const result = resolveAttachmentDeleteOutcome({
    success: false,
    purge: purge({ attachment_removed: false, complete: true }),
  });
  assert.equal(result.outcome, 'failed');
  assert.deepEqual(result.remaining, []);
});

test('unknown record id renders failure, never success', () => {
  const result = resolveAttachmentDeleteOutcome({
    success: false,
    record_id: 'nope',
    purge: {
      found: false, record_id: 'nope', attachment_removed: false, complete: false,
    },
  });
  assert.equal(result.outcome, 'failed');
});

test('missing message renders unknown, never success', () => {
  assert.equal(resolveAttachmentDeleteOutcome(null).outcome, 'unknown');
  assert.equal(resolveAttachmentDeleteOutcome(undefined).outcome, 'unknown');
});

test('malformed purge renders unknown, never success', () => {
  assert.equal(
    resolveAttachmentDeleteOutcome({ success: true, purge: 'gone' as never }).outcome,
    'unknown',
  );
  assert.equal(
    resolveAttachmentDeleteOutcome({ success: true, purge: null }).outcome,
    'unknown',
  );
  assert.equal(
    resolveAttachmentDeleteOutcome({ success: true, purge: ['x'] as never }).outcome,
    'unknown',
  );
});

test('legacy response without purge stays compatible without complete claims', () => {
  const ok = resolveAttachmentDeleteOutcome({ success: true, record_id: 'rec-9' });
  assert.equal(ok.outcome, 'legacy-success');
  assert.deepEqual(ok.remaining, []);
  const bad = resolveAttachmentDeleteOutcome({ success: false });
  assert.equal(bad.outcome, 'failed');
  const empty = resolveAttachmentDeleteOutcome({});
  assert.equal(empty.outcome, 'failed');
});

test('purge fields survive untouched from socket message to UI result', () => {
  const status = purge({
    complete: false,
    episodic_removed: ['e1', 'e2'],
    episodic_failed: ['e3'],
    transcripts_remaining: ['sess-a'],
  });
  const result = resolveAttachmentDeleteOutcome({ success: true, purge: status });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.remaining.find((item) => item.kind === 'episodic')?.count, 1);
  assert.equal(result.remaining.find((item) => item.kind === 'transcripts')?.count, 1);
});

test('normalize keeps renderable records and drops malformed entries', () => {
  const records = normalizeAttachmentRecords([
    {
      id: 'r1', filename: 'kucing.png', mime_type: 'image/png', source: 'upload',
      received_at: '2026-10-10T10:00:00+00:00', session_uid: 's1',
      status: 'processed', summary: 'Kucing.', created_at: '2026-10-10T10:01:00+00:00',
      extra: 'ignored',
    },
    { id: 'r2', status: 'failed', summary: '' },
    { filename: 'no-id.png' },
    'junk',
    null,
    42,
    { id: 7 },
    { id: '  ' },
  ]);
  assert.equal(records.length, 2);
  assert.equal(records[0].id, 'r1');
  assert.equal(records[0].filename, 'kucing.png');
  assert.equal((records[0] as Record<string, unknown>).extra, undefined);
  assert.equal(records[1].id, 'r2');
  assert.equal(records[1].filename, undefined);
});

test('normalize rejects non-array payloads without throwing', () => {
  assert.deepEqual(normalizeAttachmentRecords(null), []);
  assert.deepEqual(normalizeAttachmentRecords({}), []);
  assert.deepEqual(normalizeAttachmentRecords('x'), []);
});

test('display name prefers filename and falls back safely', () => {
  assert.equal(attachmentDisplayName({ filename: 'kucing.png' }, 'fallback'), 'kucing.png');
  assert.equal(attachmentDisplayName({ filename: '  ' }, 'fallback'), 'fallback');
  assert.equal(attachmentDisplayName({}, 'fallback'), 'fallback');
  assert.equal(attachmentDisplayName(null, 'fallback'), 'fallback');
});
