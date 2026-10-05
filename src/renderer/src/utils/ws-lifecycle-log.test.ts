/**
 * Focused tests for the diagnostic instrumentation added to investigate the
 * abnormal-close (1006) blind spot.
 *
 * Run with:  node --experimental-strip-types --test \
 *              src/renderer/src/utils/ws-lifecycle-log.test.ts
 *
 * No new dependency: Node's built-in test runner, same convention as
 * ws-incident-notifier.test.ts. The module under test is pure (no DOM, no
 * React), with DOM access injected, so lifecycle behaviour is testable
 * without a browser environment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  LIFECYCLE_EVENTS,
  describeInboundFrame,
  formatLifecycleDetail,
  installLifecycleLogging,
  isLifecycleLoggingInstalled,
  readLifecycleDetail,
  sanitizeToken,
  type LifecycleDetail,
  type LifecycleEventTarget,
} from "./ws-lifecycle-log.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SERVICE_SRC = readFileSync(
  join(here, "..", "services", "websocket-service.tsx"),
  "utf8",
);
const DIAG_SRC = readFileSync(join(here, "ws-diagnostics.ts"), "utf8");

/** Minimal fake EventTarget that records listeners and can dispatch. */
function fakeTarget(): LifecycleEventTarget & {
  listeners: Map<string, Array<(event?: unknown) => void>>;
  dispatch(name: string, event?: unknown): void;
  count(name: string): number;
} {
  const listeners = new Map<string, Array<(event?: unknown) => void>>();
  return {
    listeners,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(name, event) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(event);
    },
    count(name) {
      return (listeners.get(name) ?? []).length;
    },
  };
}

// 1. lifecycle events are recorded
test("1: every lifecycle transition is recorded with a safe detail", () => {
  const doc = fakeTarget();
  const win = fakeTarget();
  const seen: Array<{ detail: LifecycleDetail; formatted: string }> = [];

  const uninstall = installLifecycleLogging({
    doc,
    win,
    probe: {
      visibilityState: () => "hidden",
      hidden: () => true,
      readyState: () => 1,
    },
    log: (detail, formatted) => seen.push({ detail, formatted }),
  });

  doc.dispatch("visibilitychange");
  win.dispatch("pagehide");
  win.dispatch("pageshow", { persisted: true });
  win.dispatch("freeze");
  win.dispatch("resume");
  uninstall();

  assert.equal(seen.length, 5);
  assert.deepEqual(
    seen.map((entry) => entry.detail.name),
    ["visibilitychange", "pagehide", "pageshow", "freeze", "resume"],
  );
  // timestamp-free detail, but carries the three facts we need
  assert.equal(
    seen[0].formatted,
    "event=visibilitychange visibility=hidden hidden=1 readyState=1",
  );
  assert.match(seen[2].formatted, /persisted=1/);
  assert.match(seen[3].formatted, /event=freeze/);
  uninstall();
});

test("1b: missing probe values degrade instead of throwing", () => {
  const detail = readLifecycleDetail("resume", {}, undefined);
  assert.equal(detail.visibilityState, null);
  assert.equal(detail.hidden, null);
  assert.equal(detail.persisted, null);
  assert.equal(detail.readyState, null);
  assert.equal(formatLifecycleDetail(detail), "event=resume readyState=na");
});

test("1c: a throwing probe cannot break logging", () => {
  const detail = readLifecycleDetail("visibilitychange", {
    visibilityState: () => {
      throw new Error("boom");
    },
    readyState: () => {
      throw new Error("boom");
    },
  });
  assert.equal(detail.visibilityState, null);
  assert.equal(detail.readyState, null);
});

// 2. receive-path events are recorded
test("2: inbound frames are described by type and size only", () => {
  // sanitizeToken keeps [a-z0-9_-], so hyphens in a wire type survive.
  const json = describeInboundFrame(
    '{"type":"conversation-chain-start","payload":"secret"}',
  );
  assert.equal(json.detail, "type=conversation-chain-start bytes=54");

  const audio = describeInboundFrame({ size: 2048 });
  assert.equal(audio.detail, "type=unknown bytes=2048");

  const binary = describeInboundFrame(new ArrayBuffer(64));
  assert.equal(binary.detail, "type=unknown bytes=64");

  const junk = describeInboundFrame("not json at all");
  assert.equal(junk.detail, "type=unknown bytes=15");
});

test("2b: the service records the receive path on both outcomes", () => {
  assert.match(
    SERVICE_SRC,
    /logWsDiag\('WS_RECV', connId, inbound\.detail, socket\.readyState\)/,
  );
  assert.match(
    SERVICE_SRC,
    /logWsDiag\('WS_RECV_UNPARSED', connId, inbound\.detail, socket\.readyState\)/,
  );
  // the receive log happens BEFORE parsing, so a binary frame still proves
  // the socket delivered bytes
  const recvAt = SERVICE_SRC.indexOf("logWsDiag('WS_RECV'");
  const parseAt = SERVICE_SRC.indexOf("JSON.parse(event.data)");
  assert.ok(
    recvAt > 0 && parseAt > recvAt,
    "WS_RECV must be logged before parsing",
  );
});

// 3. no sensitive payload can reach the diagnostics
test("3: sensitive fields never appear in a described frame", () => {
  const frames = [
    '{"type":"ai-response","content":"my secret answer","token":"abc"}',
    '{"type":"conversation-chain-start","prompt":"draft text here"}',
    '{"type":"x","authorization":"Bearer hunter2"}',
  ];
  for (const frame of frames) {
    const { detail } = describeInboundFrame(frame);
    for (const secret of [
      "secret",
      "draft",
      "hunter2",
      "Bearer",
      "content",
      "token",
      "prompt",
    ]) {
      assert.ok(!detail.includes(secret), `leaked ${secret} in ${detail}`);
    }
  }
});

test("3b: lifecycle detail carries no user content", () => {
  const detail = readLifecycleDetail(
    "visibilitychange",
    { visibilityState: () => "visible" },
    { persisted: false, secret: "do-not-log" },
  );
  const formatted = formatLifecycleDetail(detail);
  assert.equal(
    formatted,
    "event=visibilitychange visibility=visible persisted=0 readyState=na",
  );
  assert.ok(!formatted.includes("do-not-log"));
});

test("3c: hostile values are collapsed to a safe token", () => {
  assert.equal(sanitizeToken("../../etc/passwd"), "etcpasswd");
  assert.equal(sanitizeToken(""), "unknown");
  assert.equal(sanitizeToken(undefined), "unknown");
  assert.equal(sanitizeToken("a".repeat(80)).length, 24);
});

test("3d: the recorder contract is unchanged", () => {
  for (const key of ["mili-ws-last-incident", "mili-ws-incidents"]) {
    assert.ok(DIAG_SRC.includes(key), `storage key ${key} must survive`);
  }
  assert.match(DIAG_SRC, /const MAX_ENTRIES = 200;/);
  assert.match(DIAG_SRC, /const MAX_INCIDENTS = 5;/);
});

// 4. listeners are installed exactly once
test("4: repeated installs do not duplicate listeners", () => {
  const doc = fakeTarget();
  const win = fakeTarget();
  const log = () => {};

  const first = installLifecycleLogging({ doc, win, log });
  const second = installLifecycleLogging({ doc, win, log });

  assert.equal(
    first,
    second,
    "a second install must return the same uninstaller",
  );
  assert.equal(doc.count("visibilitychange"), 1);
  assert.equal(win.count("pagehide"), 1);
  assert.equal(win.count("pageshow"), 1);
  assert.equal(win.count("freeze"), 1);
  assert.equal(win.count("resume"), 1);
  assert.ok(isLifecycleLoggingInstalled(win));

  first();
  assert.equal(doc.count("visibilitychange"), 0);
  assert.equal(win.count("freeze"), 0);
  assert.ok(!isLifecycleLoggingInstalled(win));

  // after teardown a fresh install is allowed again
  installLifecycleLogging({ doc, win, log });
  assert.equal(win.count("freeze"), 1);
});

test("4b: uninstall is idempotent", () => {
  const doc = fakeTarget();
  const uninstall = installLifecycleLogging({ doc, win: null, log: () => {} });
  uninstall();
  uninstall();
  assert.equal(doc.count("visibilitychange"), 0);
});

test("4c: one failing target does not block the others", () => {
  const win = fakeTarget();
  const seen: string[] = [];
  const broken = {
    addEventListener() {
      throw new Error("blocked");
    },
    removeEventListener() {},
  } as unknown as LifecycleEventTarget;

  installLifecycleLogging({
    doc: broken,
    win,
    log: (detail) => seen.push(detail.name),
  });
  win.dispatch("freeze");
  assert.deepEqual(seen, ["freeze"]);
});

test("4d: the service installs it once, in the constructor", () => {
  const ctorAt = SERVICE_SRC.indexOf("constructor()");
  const installAt = SERVICE_SRC.indexOf("installLifecycleLogging({");
  assert.ok(
    ctorAt > 0 && installAt > ctorAt,
    "install must live in the constructor",
  );
  assert.equal(SERVICE_SRC.split("installLifecycleLogging({").length - 1, 1);
  assert.match(
    SERVICE_SRC,
    /logWsDiag\(\s*'LIFECYCLE',\s*getActiveConnectionId\(\)/,
  );
});

// 5. the existing recorder keeps working
test("5: existing recorder API and incident snapshot are intact", () => {
  for (const symbol of [
    "export function logWsDiag",
    "export function recordCloseIncident",
    "export function getLastWsIncident",
    "export function getWsIncidentHistory",
    "export function exportWsDiagnostics",
  ]) {
    assert.ok(DIAG_SRC.includes(symbol), `missing ${symbol}`);
  }
  // The global accessor is installed at module scope (not exported) and is the
  // supported way to pull a diagnostic out of a live tab.
  assert.match(DIAG_SRC, /w\.__MILI_WS_DIAG__ = \{/);
  assert.match(DIAG_SRC, /installGlobalAccessor\(\);/);
  // the incident snapshot still captures the ring buffer tail, so lifecycle
  // and receive events land in mili-ws-last-incident automatically
  assert.match(DIAG_SRC, /eventsBeforeClose: entries\.slice\(-50\)/);
});

test("5b: every documented lifecycle event is wired", () => {
  assert.deepEqual(
    [...LIFECYCLE_EVENTS],
    ["visibilitychange", "pagehide", "pageshow", "freeze", "resume"],
  );
});

// 6. existing reconnect behaviour is unchanged
test("6: reconnect policy is untouched by the instrumentation", () => {
  // backoff formula, guard conditions and the single retry timer are intact
  assert.match(
    SERVICE_SRC,
    /const delayMs = Math\.min\(1000 \* \(2 \*\* this\.reconnectAttempt\), 10000\)/,
  );
  assert.match(SERVICE_SRC, /logWsDiag\('RECONNECT_SCHEDULED', this\.connId/);
  assert.match(SERVICE_SRC, /logWsDiag\('RECONNECT_SUPPRESSED', this\.connId/);
  // the close handler still snapshots BEFORE scheduling a reconnect
  const snapshotAt = SERVICE_SRC.indexOf("recordCloseIncident({");
  const reconnectAt = SERVICE_SRC.indexOf("this.scheduleReconnect('onclose')");
  assert.ok(
    snapshotAt > 0 && reconnectAt > snapshotAt,
    "snapshot must precede reconnect",
  );
  // instrumentation added nothing to the close handler itself
  const closeHandler = SERVICE_SRC.slice(
    SERVICE_SRC.indexOf("socket.onclose"),
    SERVICE_SRC.indexOf("socket.onerror"),
  );
  assert.ok(
    !closeHandler.includes("LIFECYCLE"),
    "close handler must stay untouched",
  );
  assert.ok(
    !closeHandler.includes("WS_RECV"),
    "close handler must stay untouched",
  );
});

test("6b: instrumentation never calls reconnect or closes the socket", () => {
  const lifecycleModule = readFileSync(
    join(here, "ws-lifecycle-log.ts"),
    "utf8",
  );
  // Strip comments so prose about WebSockets is not mistaken for usage.
  const code = lifecycleModule
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  for (const banned of [
    "scheduleReconnect",
    ".close(",
    "new WebSocket",
    "WebSocket.",
    "setTimeout",
    "setInterval",
    "fetch(",
    "sendMessage",
  ]) {
    assert.ok(
      !code.includes(banned),
      `lifecycle module must stay observation-only (found ${banned})`,
    );
  }
});
