import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearWsDiagnostics,
  exportWsDiagnostics,
  getLastWsIncident,
  getWsIncidentHistory,
  getWsDiagLog,
  isAbnormalClose,
  logWsDiag,
  markConnError,
  markConnSendFailure,
  nextConnectionId,
  recordCloseIncident,
} from '../src/renderer/src/utils/ws-diagnostics.ts';

const memStore = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
};

function withSessionStorage(fn: () => void) {
  const store = memStore();
  const g = globalThis as Record<string, unknown>;
  const prevWindow = g.window;
  g.window = { sessionStorage: store };
  try {
    fn();
  } finally {
    if (prevWindow === undefined) delete g.window;
    else g.window = prevWindow;
  }
}

test('ring buffer caps at 200, oldest evicted', () => {
  clearWsDiagnostics();
  for (let i = 0; i < 250; i++) logWsDiag('WS_SEND', 'ws9', `type=text-input n=${i}`);
  const log = getWsDiagLog();
  assert.equal(log.length, 200);
  assert.ok(log[0].detail!.includes('n=50'));
  assert.ok(log[199].detail!.includes('n=249'));
});

test('connection IDs are unique and non-sensitive', () => {
  const a = nextConnectionId();
  const b = nextConnectionId();
  assert.notEqual(a, b);
  assert.match(a, /^ws\d+$/);
});

test('ws-open / ws-send recorded without payload', () => {
  clearWsDiagnostics();
  logWsDiag('WS_OPEN', 'ws1');
  logWsDiag('WS_SEND', 'ws1', 'type=text-input readyState=1');
  const exported = exportWsDiagnostics();
  assert.ok(exported.includes('WS_OPEN'));
  assert.ok(!exported.includes('password rahasia'));
});

test('ws-error and ws-close carry code/reason', () => {
  clearWsDiagnostics();
  markConnError('ws2');
  logWsDiag('WS_ERROR', 'ws2', 'readyState=3', 3);
  withSessionStorage(() => {
    const inc = recordCloseIncident({
      connId: 'ws2', code: 1006, reason: '', readyStateAtClose: 3, reconnectScheduled: true,
    });
    assert.ok(inc);
    assert.equal(inc!.closeCode, 1006);
    assert.equal(inc!.abnormal, true);
    assert.equal(inc!.hadError, true);
    assert.equal(inc!.reconnectScheduled, true);
  });
});

test('normal close (1000, clean) is not abnormal', () => {
  assert.equal(isAbnormalClose(1000, 'ws-clean'), false);
  assert.equal(isAbnormalClose(1006, 'ws-clean'), true);
  assert.equal(isAbnormalClose(1001, 'ws-clean'), true);
  markConnSendFailure('ws-flaky');
  assert.equal(isAbnormalClose(1000, 'ws-flaky'), true);
});

test('abnormal close produces retrievable snapshot', () => {
  clearWsDiagnostics();
  withSessionStorage(() => {
    logWsDiag('WS_OPEN', 'ws3');
    logWsDiag('WS_SEND', 'ws3', 'type=text-input readyState=1');
    recordCloseIncident({
      connId: 'ws3', code: 1006, reason: '', readyStateAtClose: 3, reconnectScheduled: true,
    });
    const last = getLastWsIncident();
    assert.ok(last);
    assert.equal(last!.connectionId, 'ws3');
    assert.ok(last!.eventsBeforeClose.length >= 2);
  });
});

test('reconnect events stay separated per connectionId', () => {
  clearWsDiagnostics();
  logWsDiag('WS_CLOSE', 'wsA', 'code=1006 reason=');
  logWsDiag('RECONNECT_START', 'wsA', 'reason=onclose');
  logWsDiag('WS_CREATE', 'wsB');
  logWsDiag('WS_OPEN', 'wsB');
  const log = getWsDiagLog();
  assert.ok(log.some((e) => e.conn === 'wsA' && e.event === 'RECONNECT_START'));
  assert.ok(log.some((e) => e.conn === 'wsB' && e.event === 'WS_OPEN'));
});

test('incident history capped at 5', () => {
  clearWsDiagnostics();
  withSessionStorage(() => {
    for (let i = 0; i < 7; i++) {
      recordCloseIncident({
        connId: `wsH${i}`, code: 1006, reason: '', readyStateAtClose: 3, reconnectScheduled: true,
      });
    }
    const hist = getWsIncidentHistory();
    assert.equal(hist.length, 5);
    assert.equal(hist[0].connectionId, 'wsH6');
    const last = getLastWsIncident();
    assert.equal(last!.connectionId, 'wsH6');
  });
});

test('clear diagnostics wipes buffer and incidents', () => {
  withSessionStorage(() => {
    logWsDiag('WS_OPEN', 'wsZ');
    recordCloseIncident({
      connId: 'wsZ', code: 1006, reason: '', readyStateAtClose: 3, reconnectScheduled: false,
    });
    clearWsDiagnostics();
    assert.equal(getWsDiagLog().length, 0);
    assert.equal(getLastWsIncident(), null);
    assert.deepEqual(getWsIncidentHistory(), []);
  });
});

test('export contains no secrets even with hostile content nearby', () => {
  clearWsDiagnostics();
  // Simulate hostile strings existing elsewhere; recorder only stores metadata.
  const hostile = ['password rahasia', 'draft user', 'authorization token'];
  logWsDiag('WS_SEND', 'wsS', 'type=text-input readyState=1');
  const exported = exportWsDiagnostics();
  for (const h of hostile) assert.ok(!exported.includes(h));
  assert.ok(exported.includes('WS_SEND'));
});

test('recorder failure never breaks caller flow', () => {
  // No window/sessionStorage here (deleted); every call must survive.
  const g = globalThis as Record<string, unknown>;
  const prev = g.window;
  delete g.window;
  try {
    logWsDiag('WS_OPEN', 'wsN');
    markConnError('wsN');
    const inc = recordCloseIncident({
      connId: 'wsN', code: 1006, reason: '', readyStateAtClose: 3, reconnectScheduled: true,
    });
    assert.ok(inc); // incident still built + logged, storage skipped
    assert.equal(inc!.connectionId, 'wsN');
    assert.equal(getLastWsIncident(), null);
    assert.equal(exportWsDiagnostics().length > 0, true);
  } finally {
    if (prev !== undefined) g.window = prev;
  }
});
