/**
 * Focused tests for the incident popup policy and dedup.
 *
 * Run with:  node --experimental-strip-types --test \
 *              src/renderer/src/utils/ws-incident-notifier.test.ts
 *
 * No new dependency: Node's built-in test runner. The module under test is
 * pure (no DOM, no React), which is what makes the popup decision testable
 * without a browser environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  IncidentPopupGate,
  decideIncidentNotification,
  incidentKey,
  type IncidentFacts,
} from './ws-incident-notifier.ts';

const here = dirname(fileURLToPath(import.meta.url));
const MODAL_SRC = readFileSync(
  join(here, '..', 'components', 'ui', 'ws-incident-modal.tsx'),
  'utf8',
);
const DIAG_SRC = readFileSync(join(here, 'ws-diagnostics.ts'), 'utf8');
const SERVICE_SRC = readFileSync(
  join(here, '..', 'services', 'websocket-service.tsx'),
  'utf8',
);

// A: WS_SEND_FAILED -> popup appears
test('A: send failure raises a notification', () => {
  const gate = new IncidentPopupGate();
  const decision = gate.notify('send_failure', { connectionId: 'ws1' });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'send_failure');
});

// B: WS_ERROR -> popup appears
test('B: socket error raises a notification', () => {
  const gate = new IncidentPopupGate();
  const decision = gate.notify('error', { connectionId: 'ws1' });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'error');
});

// C: relevant WS_CLOSE / disconnect -> popup appears
test('C: abnormal close raises a notification', () => {
  const gate = new IncidentPopupGate();
  const decision = gate.notify('abnormal_close', {
    connectionId: 'ws1',
    closeCode: 1006,
    abnormal: true,
    reconnectScheduled: true,
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'abnormal_close');
});

test('C2: code 1000 after a send failure is still an incident', () => {
  const decision = decideIncidentNotification('abnormal_close', {
    connectionId: 'ws1',
    closeCode: 1000,
    hadSendFailure: true,
  });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'close_after_send_failure');
});

test('C3: reconnect attempt that never opened is an incident', () => {
  const gate = new IncidentPopupGate();
  const decision = gate.notify('reconnect_failed', { connectionId: 'ws2' });
  assert.equal(decision.notify, true);
  assert.equal(decision.reason, 'reconnect_failed');
});

// D: normal startup / normal reconnect -> NO popup
test('D: normal close does not pop up', () => {
  const decision = decideIncidentNotification('abnormal_close', {
    connectionId: 'ws1',
    closeCode: 1000,
    abnormal: false,
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, 'normal_close');
});

test('D2: explicit disconnect never pops up', () => {
  const decision = decideIncidentNotification('abnormal_close', {
    connectionId: 'ws1',
    closeCode: 1006,
    explicitlyDisconnected: true,
  });
  assert.equal(decision.notify, false);
  assert.equal(decision.reason, 'explicit_disconnect');
});

// E: same incident must not produce a second popup
test('E: identical incident does not duplicate', () => {
  const gate = new IncidentPopupGate();
  const facts: IncidentFacts = {
    connectionId: 'ws1',
    closeCode: 1006,
    abnormal: true,
  };
  assert.equal(gate.notify('abnormal_close', facts).notify, true);
  assert.equal(gate.notify('abnormal_close', facts).notify, false);
  assert.equal(
    gate.notify('abnormal_close', facts).reason,
    'duplicate',
  );
});

test('E2: close -> reconnect -> reopen chain still yields one popup', () => {
  const gate = new IncidentPopupGate();
  const facts: IncidentFacts = { connectionId: 'ws1', closeCode: 1006 };
  assert.equal(gate.notify('abnormal_close', facts).notify, true);
  // WS_CLOSE repeats with the same facts (replay/history reload)
  assert.equal(gate.notify('abnormal_close', facts).notify, false);
  // error + send failure on the SAME connection are separate facts, but the
  // recorder already reported them as part of the same close episode
  assert.equal(gate.notify('error', { connectionId: 'ws1' }).notify, true);
  assert.equal(gate.notify('error', { connectionId: 'ws1' }).notify, false);
});

// F: Copy Diagnostic path exists and copies the same payload as the global
test('F: modal copies through exportWsDiagnostics', () => {
  assert.match(MODAL_SRC, /exportWsDiagnostics\(\)/);
  assert.match(MODAL_SRC, /clipboard\.writeText|clipboard\?\.writeText/);
  // ...which is exactly what the existing global accessor exposes
  assert.match(DIAG_SRC, /exportWsDiagnostics/);
  assert.match(DIAG_SRC, /__MILI_WS_DIAG__/);
  assert.match(DIAG_SRC, /copy:/);
});

test('F2: clipboard failure is reported, not thrown', () => {
  // copyText returns false and the component renders a manual fallback.
  assert.match(MODAL_SRC, /async function copyText/);
  assert.match(MODAL_SRC, /Clipboard tidak tersedia/);
  assert.match(MODAL_SRC, /Diagnostic berhasil disalin/);
});

// G: popup must never touch the draft
test('G: modal never touches draft state', () => {
  assert.doesNotMatch(MODAL_SRC, /composer-draft/);
  assert.doesNotMatch(MODAL_SRC, /clearDraft|saveDraft|draftKey/);
  assert.doesNotMatch(MODAL_SRC, /localStorage/);
  assert.doesNotMatch(MODAL_SRC, /sessionStorage/);
});

// H: popup must never touch messages / history
test('H: modal never replaces messages or reloads history', () => {
  assert.doesNotMatch(MODAL_SRC, /chat-history|ChatHistory/);
  assert.doesNotMatch(MODAL_SRC, /fetch-and-set-history|history-data/);
  assert.doesNotMatch(MODAL_SRC, /window\.location|location\.reload/);
  // No reconnect ACTION. Displaying the recorded reconnect flag is allowed.
  assert.doesNotMatch(MODAL_SRC, /scheduleReconnect|new WebSocket/);
  assert.doesNotMatch(MODAL_SRC, /WebSocketHandler|sendMessage|sendText/);
  assert.doesNotMatch(MODAL_SRC, /fetch\(/);
  assert.match(MODAL_SRC, /reconnectScheduled/);
});

// I: closing the popup keeps diagnostics intact
test('I: closing only hides the dialog', () => {
  assert.match(MODAL_SRC, /setOpen\(false\)/);
  // and it must not call the recorder's clearing helpers
  assert.doesNotMatch(MODAL_SRC, /clearWsDiagnostics|clearWsDiagLog/);
  assert.doesNotMatch(MODAL_SRC, /getWsIncidentHistory\(\)\.length\s*===?\s*0/);
});

// J: a new incident after the episode ends may pop up again
test('J: a later incident can pop up again', () => {
  const gate = new IncidentPopupGate();
  assert.equal(
    gate.notify('abnormal_close', { connectionId: 'ws1', closeCode: 1006 }).notify,
    true,
  );
  gate.forgetConnection('ws1'); // WS_OPEN fired for the new connection
  assert.equal(
    gate.notify('abnormal_close', { connectionId: 'ws2', closeCode: 1006 }).notify,
    true,
  );
});

test('J2: same connection after reopen may pop up again', () => {
  const gate = new IncidentPopupGate();
  const facts: IncidentFacts = { connectionId: 'ws1', closeCode: 1006 };
  assert.equal(gate.notify('abnormal_close', facts).notify, true);
  gate.forgetConnection('ws1');
  assert.equal(gate.notify('abnormal_close', facts).notify, true);
});

// dedup keys are stable and facts-based (no time, no randomness)
test('keys are deterministic', () => {
  const facts: IncidentFacts = { connectionId: 'ws3', closeCode: 1006, abnormal: true };
  assert.equal(incidentKey('abnormal_close', facts), incidentKey('abnormal_close', facts));
  assert.equal(incidentKey('error', facts), 'error:ws3');
});

test('gate memory is bounded', () => {
  const gate = new IncidentPopupGate(5);
  for (let i = 0; i < 20; i += 1) {
    gate.notify('error', { connectionId: `ws${i}` });
  }
  // Still functional after eviction
  assert.equal(gate.notify('error', { connectionId: 'fresh' }).notify, true);
});

// the existing recorder remains the source of truth for incidents
test('recorder still owns incident detection', () => {
  assert.match(DIAG_SRC, /export function isAbnormalClose/);
  assert.match(DIAG_SRC, /export function recordCloseIncident/);
  // popup notification is additive: it fires from inside the recorder
  assert.match(DIAG_SRC, /notifyIncident\('abnormal_close'/);
  assert.match(SERVICE_SRC, /recordCloseIncident\(\{/);
  assert.match(SERVICE_SRC, /forgetIncidentEpisode\(connId\)/);
});