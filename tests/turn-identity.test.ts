import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCanonicalFinal,
  bubbleIndexForTurn,
  createSegmentTextBuffer,
  resolveAiTarget,
  selectFlushSegments,
  type IdentityBubble,
} from "../src/renderer/src/utils/turn-identity.ts";

const ai = (
  id: string,
  content: string,
  requestId?: string,
): IdentityBubble => ({
  id,
  role: "ai",
  content,
  type: "text",
  requestId,
});
const human = (id: string, content: string): IdentityBubble => ({
  id,
  role: "human",
  content,
});

const SHORT = ["aku cuma mau kamu."];
const LONG = [
  "kalimat satu. ",
  "kalimat dua. ",
  "kalimat tiga. ",
  "kalimat empat. ",
  "kalimat lima. ",
  "kalimat enam. ",
  "kalimat tujuh. ",
  "kalimat delapan.",
];

/** Simulate sequential streaming appends through resolveAiTarget. */
function stream(
  bubbles: IdentityBubble[],
  chunks: string[],
  requestId: string,
  forceNewFirst = true,
): IdentityBubble[] {
  let out = bubbles.slice();
  let forceNew = forceNewFirst;
  let seq = out.length;
  chunks.forEach((chunk) => {
    const target = resolveAiTarget(out, { requestId, forceNew });
    if (target.mode === "merge") {
      const base = out[target.index];
      out[target.index] = { ...base, content: base.content + chunk };
    } else {
      seq += 1;
      out.push({
        id: `b${seq}`,
        role: "ai",
        content: chunk,
        type: "text",
        requestId,
      });
    }
    forceNew = false;
  });
  return out;
}

test("1. SHORT response: live == canonical == history", () => {
  let live: IdentityBubble[] = [human("h1", "hai")];
  live = stream(live, SHORT, "req-1");
  const canonical = SHORT.join("");
  assert.equal(live[live.length - 1].content, canonical);
  const applied = applyCanonicalFinal(live, "req-1", canonical);
  assert.equal(applied.matched, true);
  assert.equal(applied.changed, false); // already complete: stable
  assert.equal(applied.bubbles[applied.bubbles.length - 1].content, canonical);
  assert.equal(applied.finalizedIds.length, 1);
});

test("2. LONG response (8 sentences): single bubble, exact canonical", () => {
  let live: IdentityBubble[] = [human("h1", "hai")];
  live = stream(live, LONG, "req-8");
  const canonical = LONG.join("");
  const aiRows = live.filter((m) => m.role === "ai");
  assert.equal(aiRows.length, 1); // identity, not just contains: one bubble
  assert.equal(aiRows[0].content, canonical);
  const applied = applyCanonicalFinal(live, "req-8", canonical);
  assert.equal(applied.changed, false);
  assert.equal(applied.bubbles.length, live.length);
});

test("3. RAPID TURNS: no cross-turn contamination", () => {
  let live: IdentityBubble[] = [human("h1", "q1")];
  live = stream(live, ["turn satu selesai."], "req-A");
  live.push(human("h2", "q2"));
  live = stream(live, ["turn dua selesai."], "req-B");
  const a = live.filter((m) => m.requestId === "req-A");
  const b = live.filter((m) => m.requestId === "req-B");
  assert.equal(a.length, 1);
  assert.equal(a[0].content, "turn satu selesai.");
  assert.equal(b.length, 1);
  assert.equal(b[0].content, "turn dua selesai.");
  // Canonical each: stable, independent.
  assert.equal(
    applyCanonicalFinal(live, "req-A", "turn satu selesai.").changed,
    false,
  );
  assert.equal(
    applyCanonicalFinal(live, "req-B", "turn dua selesai.").changed,
    false,
  );
});

test("4. INTERRUPT: partial bubble reconciles to canonical full", () => {
  // Only 2 of 4 sentences displayed before the turn was cut off locally;
  // backend completed and persisted the full row.
  const live: IdentityBubble[] = [
    human("h1", "hai"),
    ai("a1", "aku cuma mau kamu ", "req-I"),
  ];
  const canonical = "aku cuma mau kamu menyelesaikan tugas itu hari ini.";
  const applied = applyCanonicalFinal(live, "req-I", canonical);
  assert.equal(applied.matched, true);
  assert.equal(applied.changed, true);
  assert.equal(applied.bubbles[1].content, canonical);
  assert.deepEqual(applied.finalizedIds, ["a1"]);
});

test("5. MUTED rapid stream: N chunks, one bubble, exact text", () => {
  let live: IdentityBubble[] = [];
  live = stream(live, LONG, "req-M", false);
  assert.equal(live.length, 1);
  assert.equal(live[0].content, LONG.join(""));
});

test("6/11. DUPLICATE final event: idempotent, one bubble", () => {
  const live: IdentityBubble[] = [
    human("h1", "hai"),
    ai("a1", "aku cuma ", "req-D"),
  ];
  const canonical = "aku cuma mau kamu.";
  const first = applyCanonicalFinal(live, "req-D", canonical);
  assert.equal(first.changed, true);
  assert.equal(first.bubbles.filter((m) => m.role === "ai").length, 1);
  const second = applyCanonicalFinal(first.bubbles, "req-D", canonical);
  assert.equal(second.changed, false);
  assert.deepEqual(second.bubbles, first.bubbles);
});

test("9. TRAILING payload after force-new: merges owned bubble, no stray", () => {
  // Turn 1 streamed 3 chunks; force-new arrived; trailing chunk of turn 1
  // arrives late (sender-queue overtake).
  let live: IdentityBubble[] = [
    human("h1", "hai"),
    ai("a1", "aku cuma mau kamu ", "req-T"),
  ];
  const target = resolveAiTarget(live, { requestId: "req-T", forceNew: true });
  assert.deepEqual(target, { mode: "merge", index: 1 });
  live = stream(live, ["menyelesaikan."], "req-T", true);
  assert.equal(live.filter((m) => m.role === "ai").length, 1);
  assert.equal(live[1].content, "aku cuma mau kamu menyelesaikan.");
  // Canonical collapses even a pre-split state by identity.
  const split: IdentityBubble[] = [
    human("h1", "hai"),
    ai("a1", "aku cuma mau kamu ", "req-T"),
    ai("a2", "menyelesaikan.", "req-T"),
  ];
  const healed = applyCanonicalFinal(
    split,
    "req-T",
    "aku cuma mau kamu menyelesaikan.",
  );
  assert.equal(healed.bubbles.filter((m) => m.role === "ai").length, 1);
  assert.equal(healed.bubbles[1].content, "aku cuma mau kamu menyelesaikan.");
});

test("9b. UNKNOWN turn chunk opens exactly one bubble (legacy semantics)", () => {
  const live: IdentityBubble[] = [human("h1", "hai")];
  const target = resolveAiTarget(live, {
    requestId: "req-zzz",
    forceNew: false,
  });
  assert.deepEqual(target, { mode: "new" });
});

test("10. MID-STREAM resync then completion: no duplicate tail", () => {
  // Snapshot replaced live with the full row; stream already complete, so
  // canonical lands on the snapshot bubble and stays stable.
  const afterResync: IdentityBubble[] = [
    human("h1", "hai"),
    { id: "snap-a1", role: "ai", content: "aku cuma mau kamu menyelesaikan." },
  ];
  const applied = applyCanonicalFinal(
    afterResync,
    "req-X",
    "aku cuma mau kamu menyelesaikan.",
  );
  // Snapshot rows carry no requestId: no match, no change, no duplicate.
  assert.equal(applied.matched, false);
  assert.equal(applied.bubbles.length, 2);
});

test("canonical ignores other turns and non-text rows", () => {
  const live: IdentityBubble[] = [
    human("h1", "hai"),
    ai("a1", "old answer.", "req-old"),
    { id: "t1", role: "ai", content: "tool…", type: "tool_call_status" },
    ai("a2", "aku cuma ", "req-new"),
  ];
  const applied = applyCanonicalFinal(live, "req-new", "aku cuma mau kamu.");
  assert.equal(applied.matched, true);
  assert.equal(applied.bubbles[0].content, "hai");
  assert.equal(applied.bubbles[1].content, "old answer.");
  assert.equal(applied.bubbles[2].content, "tool…");
  assert.equal(applied.bubbles[3].content, "aku cuma mau kamu.");
  assert.equal(bubbleIndexForTurn(live, "req-old"), 1);
  assert.equal(bubbleIndexForTurn(live, "nope"), -1);
});

test("legacy path without requestId is unchanged", () => {
  const live: IdentityBubble[] = [human("h1", "hai"), ai("a1", "abc")];
  assert.deepEqual(resolveAiTarget(live, { forceNew: false }), {
    mode: "merge",
    index: 1,
  });
  assert.deepEqual(resolveAiTarget(live, { forceNew: true }), { mode: "new" });
  assert.deepEqual(resolveAiTarget([human("h1", "x")], { forceNew: false }), {
    mode: "new",
  });
  assert.deepEqual(resolveAiTarget([], { forceNew: false }), { mode: "new" });
});

test("canonical guards: empty/unknown input is a no-op", () => {
  const live: IdentityBubble[] = [ai("a1", "abc", "req-1")];
  assert.equal(applyCanonicalFinal(live, "", "abc").matched, false);
  // Empty text must never wipe a bubble, even for a known turn.
  const kept = applyCanonicalFinal(live, "req-1", "");
  assert.equal(kept.matched, false);
  assert.equal(kept.bubbles[0].content, "abc");
  assert.equal(applyCanonicalFinal([], "req-1", "abc").matched, false);
});

test("segment buffer: FIFO pairing, flush drains once, no duplicates", () => {
  const buf = createSegmentTextBuffer();
  assert.deepEqual(buf.flush(), []);
  buf.push({ text: "satu. " });
  buf.push({ text: "dua. " });
  buf.push({ text: "tiga. " });
  assert.equal(buf.size(), 3);
  // Task 1 executes: shifts its entry; flush yields only the unplayed tail.
  buf.shiftForText("satu. ");
  assert.deepEqual(
    buf.flush().map((e) => e.text),
    ["dua. ", "tiga. "],
  );
  assert.equal(buf.size(), 0);
  // Double flush: nothing left to duplicate.
  assert.deepEqual(buf.flush(), []);
  // Duplicate texts pair FIFO: first shift takes the head instance.
  buf.push({ text: "ok. " });
  buf.push({ text: "ok. " });
  buf.shiftForText("ok. ");
  assert.deepEqual(
    buf.flush().map((e) => e.text),
    ["ok. "],
  );
  // Unknown text: buffer untouched.
  buf.push({ text: "a. " });
  buf.shiftForText("zzz");
  assert.equal(buf.size(), 1);
  // Empty/blank pushes ignored.
  buf.push({ text: "" });
  assert.equal(buf.size(), 1);
});

test("1. INTERRUPTED + PENDING: cancelled turn gains no trailing text", () => {
  // Production shape (req 53dd52e0): turn played 61 chars, 93 more chars
  // sat unplayed when the interrupt + next chain-start landed. No ai-final
  // exists for a cancelled turn, so every pending segment must drop.
  const live: IdentityBubble[] = [
    human("h1", "q"),
    ai("a1", "played part. ", "req-C"),
  ];
  const pending = [
    { text: "unplayed one. ", requestId: "req-C" },
    { text: "unplayed two. ", requestId: "req-C" },
  ];
  const { heal, drop } = selectFlushSegments(pending, new Set(), live);
  assert.deepEqual(heal, []);
  assert.equal(drop.length, 2);
  // Live bubble stays exactly what was played: no invention.
  assert.equal(live[1].content, "played part. ");
});

test("2. COMPLETED + PENDING: finalized turn keeps healing path", () => {
  const live: IdentityBubble[] = [
    human("h1", "q"),
    ai("a1", "full text. ", "req-D"),
  ];
  const pending = [{ text: "full text. ", requestId: "req-D" }];
  const { heal, drop } = selectFlushSegments(pending, new Set(["req-D"]), live);
  // Gated through: at runtime the finalized guard turns this append into a
  // verified no-op, so healing is preserved without ever duplicating.
  assert.equal(heal.length, 1);
  assert.deepEqual(drop, []);
});

test("3. RAPID FOLLOW-UP: turns stay isolated at flush", () => {
  const live: IdentityBubble[] = [
    human("h1", "q1"),
    ai("a1", "first. ", "req-A"),
    human("h2", "q2"),
  ];
  const pending = [
    { text: "first-tail. ", requestId: "req-A" },
    { text: "second-head. ", requestId: "req-B" },
  ];
  // Neither finalized (turn A interrupted, turn B just started).
  const gated = selectFlushSegments(pending, new Set(), live);
  assert.deepEqual(gated.heal, []);
  assert.equal(gated.drop.length, 2);
  // After turn B completes (ai-final received) AND its bubble exists,
  // only B heals; A's interrupted tail still drops.
  const liveB: IdentityBubble[] = [...live, ai("b1", "second", "req-B")];
  const healed = selectFlushSegments(pending, new Set(["req-B"]), liveB);
  assert.deepEqual(
    healed.heal.map((s) => s.text),
    ["second-head. "],
  );
  assert.deepEqual(
    healed.drop.map((s) => s.text),
    ["first-tail. "],
  );
});

test("4. NORMAL MULTI-TURN: one correct bubble per finalized turn", () => {
  const live: IdentityBubble[] = [
    human("h1", "q1"),
    ai("a1", "one. ", "req-1"),
    human("h2", "q2"),
    ai("a2", "two. ", "req-2"),
  ];
  const r1 = applyCanonicalFinal(live, "req-1", "one. ");
  const r2 = applyCanonicalFinal(r1.bubbles, "req-2", "two. ");
  assert.equal(r1.changed, false);
  assert.equal(r2.changed, false);
  assert.equal(r2.bubbles.filter((m) => m.role === "ai").length, 2);
  assert.equal(r2.bubbles[1].content, "one. ");
  assert.equal(r2.bubbles[3].content, "two. ");
});

test("7. RESYNC/RELOAD path untouched by the gate", () => {
  // Legacy segments without identity keep legacy append-everything.
  const live: IdentityBubble[] = [human("h1", "q"), ai("a1", "part. ")];
  const { heal, drop } = selectFlushSegments(
    [{ text: "more. ", requestId: null }],
    new Set(),
    live,
  );
  assert.equal(heal.length, 1);
  assert.deepEqual(drop, []);
  // Unknown turns drop even when other turns finalized (and the
  // finalized turn heals only while its bubble still exists).
  const liveOk: IdentityBubble[] = [...live, ai("b9", "y", "req-ok")];
  const mixed = selectFlushSegments(
    [
      { text: "x. ", requestId: "req-ghost" },
      { text: "y. ", requestId: "req-ok" },
    ],
    new Set(["req-ok"]),
    liveOk,
  );
  assert.deepEqual(
    mixed.heal.map((s) => s.text),
    ["y. "],
  );
  assert.deepEqual(
    mixed.drop.map((s) => s.text),
    ["x. "],
  );
  // Missing bubble (e.g. replaced by resync): drop, never stray.
  const gone = selectFlushSegments(
    [{ text: "z. ", requestId: "req-ok" }],
    new Set(["req-ok"]),
    [human("h1", "q")],
  );
  assert.deepEqual(gone.heal, []);
  assert.equal(gone.drop.length, 1);
});
