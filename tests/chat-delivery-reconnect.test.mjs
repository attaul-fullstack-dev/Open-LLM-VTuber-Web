import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const service = read('../src/renderer/src/services/websocket-service.tsx');
const input = read('../src/renderer/src/hooks/footer/use-text-input.tsx');
const context = read('../src/renderer/src/context/websocket-context.tsx');

test('websocket send reports whether an open socket accepted the payload', () => {
  assert.match(context, /sendMessage: \(message: object\) => boolean/);
  assert.match(service, /sendMessage\(message: object\): boolean/);
  assert.match(service, /this\.ws\.send\(JSON\.stringify\(outgoing\)\);\s*return true/);
  assert.match(service, /this\.scheduleReconnect\(\);\s*return false/);
});

test('a failed send cannot create a phantom bubble or erase the draft', () => {
  const sendPosition = input.indexOf('const sent = wsContext.sendMessage');
  const guardPosition = input.indexOf('if (!sent) return');
  const appendPosition = input.indexOf('appendHumanMessage(messageText)');
  const clearPosition = input.indexOf("setInputText('')");

  assert.ok(sendPosition >= 0);
  assert.ok(sendPosition < guardPosition);
  assert.ok(guardPosition < appendPosition);
  assert.ok(appendPosition < clearPosition);
});

test('disconnect recovery uses one bounded reconnect timer', () => {
  assert.match(service, /private reconnectTimer/);
  assert.match(service, /Math\.min\(1000 \* \(2 \*\* this\.reconnectAttempt\), 10000\)/);
  assert.match(service, /if \(this\.ws !== socket\) return/);
  assert.match(service, /this\.scheduleReconnect\(\)/);
});

test('explicit disconnect cancels retries', () => {
  assert.match(service, /this\.explicitlyDisconnected = true/);
  assert.match(service, /this\.clearReconnectTimer\(\)/);
});
