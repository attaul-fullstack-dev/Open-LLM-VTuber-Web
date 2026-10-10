import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const agent = read('../src/renderer/src/components/sidebar/setting/agent.tsx');
const dialog = read('../src/renderer/src/components/sidebar/setting/attachment-memory-dialog.tsx');
const handler = read('../src/renderer/src/services/websocket-handler.tsx');
const service = read('../src/renderer/src/services/websocket-service.tsx');
const status = read('../src/renderer/src/utils/attachment-memory-status.ts');
const en = JSON.parse(read('../src/renderer/src/locales/en/translation.json'));
const id = JSON.parse(read('../src/renderer/src/locales/id/translation.json'));
const zh = JSON.parse(read('../src/renderer/src/locales/zh/translation.json'));

test('agent settings subscribe to attachment memory message types', () => {
  assert.match(agent, /attachment-memories/);
  assert.match(agent, /delete-attachment-memory/);
  assert.match(agent, /clear-attachment-memories/);
  assert.match(agent, /fetch-attachment-memories/);
});

test('agent settings refresh the list after delete and clear actions', () => {
  assert.match(agent, /attachment-memory-deleted/);
  assert.match(agent, /attachment-memories-cleared/);
  assert.match(agent, /normalizeAttachmentRecords/);
  assert.match(agent, /resolveAttachmentDeleteOutcome/);
});

test('memory fetching is gated on the resumed history uid (race fix)', () => {
  assert.match(agent, /planMemoryFetch/);
  assert.match(agent, /lastFetchedHistoryUidRef/);
  assert.match(agent, /lastFetchedHistoryUidRef\.current = null/);
  assert.doesNotMatch(agent, /if \(wsState === 'OPEN'\) \{\s*\n\s*sendMessage\(\{ type: 'fetch-character-memory' \}\)/);
});

test('opening the attachment dialog refetches only for an unfetched history', () => {
  assert.match(agent, /onOpenChange=\{\(open\) => \{/);
  assert.match(agent, /if \(open && currentHistoryUid\)/);
  assert.match(agent, /fetch-attachment-memories/);
});

test('attachment dialog renders records, confirms, and shows purge outcome', () => {
  assert.match(dialog, /records\.map/);
  assert.match(dialog, /deleteAttachmentConfirm/);
  assert.match(dialog, /clearAttachmentsConfirm/);
  assert.match(dialog, /purgeComplete/);
  assert.match(dialog, /purgePartial/);
  assert.match(dialog, /purgeFailed/);
  assert.match(dialog, /purgeUnknown/);
  assert.match(dialog, /purgeLegacy/);
});

test('attachment dialog uses i18n keys instead of hard-coded labels', () => {
  assert.match(dialog, /settings\.agent\.attachmentMemoryDescription/);
  assert.match(dialog, /settings\.agent\.clearAttachments/);
  assert.match(dialog, /settings\.agent\.noAttachmentMemory/);
});

test('websocket handler maps purge status instead of raw success flag', () => {
  assert.match(handler, /case 'attachment-memories':/);
  assert.match(handler, /case 'attachment-memory-deleted':/);
  assert.match(handler, /case 'attachment-memories-cleared':/);
  assert.match(handler, /resolveAttachmentDeleteOutcome\(message\)/);
  assert.match(handler, /attachmentDeleteComplete/);
  assert.match(handler, /attachmentDeletePartial/);
  assert.match(handler, /attachmentRemainingEpisodic/);
});

test('message event type carries purge fields for typecheck', () => {
  assert.match(service, /purge\?: AttachmentPurgeStatus/);
  assert.match(service, /record_id\?: string/);
  assert.match(service, /removed\?: number/);
});

test('resolver never upgrades a bare success flag into a complete claim', () => {
  assert.match(status, /'complete'/);
  assert.doesNotMatch(status, /success === true[\s\S]{0,120}complete/);
  assert.match(status, /legacy-success/);
  assert.match(status, /unknown/);
});

for (const [name, locale] of [['en', en], ['id', id], ['zh', zh]]) {
  test(`locale ${name} has attachment memory strings`, () => {
    const agentKeys = locale.settings.agent;
    for (const key of [
      'attachmentMemory', 'attachmentMemoryDescription', 'openAttachments',
      'attachmentCount', 'noAttachmentMemory', 'forgetAttachment',
      'deleteAttachmentConfirm', 'clearAttachments', 'clearAttachmentsConfirm',
      'untitledAttachment', 'attachmentNeverRead', 'attachmentStatusFailed',
      'purgeComplete', 'purgePartial', 'purgeFailed', 'purgeUnknown', 'purgeLegacy',
    ]) {
      assert.equal(typeof agentKeys[key], 'string', `${name}: settings.agent.${key}`);
    }
    const notificationKeys = locale.notification;
    for (const key of [
      'attachmentDeleteComplete', 'attachmentDeletePartial', 'attachmentDeleteSuccess',
      'attachmentDeleteFail', 'attachmentsCleared', 'attachmentRemainingEpisodic',
      'attachmentRemainingTranscripts', 'attachmentRemainingSummaries',
      'attachmentRemainingCharacter', 'attachmentRemainingWorld',
    ]) {
      assert.equal(typeof notificationKeys[key], 'string', `${name}: notification.${key}`);
    }
  });
}
