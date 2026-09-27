import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toLifeSnapshot } from "@/utils/life-state-sync";
import { canFetchLifeState } from "@/utils/life-state-preference";

const SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "renderer",
  "src",
);

test("world-state message maps 1:1 onto the widget snapshot (C/D/E)", () => {
  const snapshot = toLifeSnapshot({
    location: "room",
    activity: "idle",
    energy: 56,
    mood: "irritated",
    time_context: "night",
    activity_started_at: "2026-09-27T01:00:00+00:00",
    last_update_at: "2026-09-27T01:05:00+00:00",
  });
  assert.equal(snapshot.mood, "irritated");
  assert.equal(snapshot.energy, 56);
  assert.equal(snapshot.activity, "idle");
  assert.equal(snapshot.location, "room");
  assert.equal(snapshot.time_context, "night");
  assert.equal(snapshot.activity_started_at, "2026-09-27T01:00:00+00:00");
  assert.equal(snapshot.last_update_at, "2026-09-27T01:05:00+00:00");
  assert.equal(snapshot.error, undefined);
});

test("backend error payload maps through untouched", () => {
  const snapshot = toLifeSnapshot({ error: "unavailable" });
  assert.equal(snapshot.error, "unavailable");
  assert.equal(snapshot.mood, undefined);
});

test("fetch guard allows OPEN only, never CLOSED/CONNECTING (B/I)", () => {
  assert.equal(canFetchLifeState("OPEN"), true);
  assert.equal(canFetchLifeState("CONNECTING"), false);
  assert.equal(canFetchLifeState("CLOSED"), false);
  assert.equal(canFetchLifeState("CLOSING"), false);
  assert.equal(canFetchLifeState(null), false);
  assert.equal(canFetchLifeState(undefined), false);
  assert.equal(canFetchLifeState(""), false);
});

test("life-state files create no polling/scheduler (F)", () => {
  const files = [
    "components/canvas/life-state-widget.tsx",
    "context/life-state-context.tsx",
    "utils/life-state-preference.ts",
    "utils/user-timezone.ts",
    "services/websocket-handler.tsx",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(SRC, file), "utf8");
    assert.ok(
      !source.includes("setInterval("),
      `${file} must not poll with setInterval`,
    );
  }
});

test("life-state files open no second WebSocket (G)", () => {
  const files = [
    "components/canvas/life-state-widget.tsx",
    "context/life-state-context.tsx",
    "utils/life-state-preference.ts",
    "utils/user-timezone.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(SRC, file), "utf8");
    assert.ok(
      !source.includes("new WebSocket("),
      `${file} must not open its own socket`,
    );
  }
});

test("single fetch trigger per turn end: chain-end only (no duplicates)", () => {
  const source = fs.readFileSync(
    path.join(SRC, "services/websocket-handler.tsx"),
    "utf8",
  );
  const triggers =
    source.match(/sendMessage\(\{\s*type:\s*['"]fetch-world-state['"]/g) ?? [];
  // Exactly two legitimate send sites: conversation-chain-end refresh and
  // the ws (re)connect resync. Anything more is a duplicate-fetch risk.
  assert.equal(triggers.length, 2);
});
