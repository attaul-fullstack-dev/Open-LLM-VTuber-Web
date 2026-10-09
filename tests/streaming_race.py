"""Deterministic regression test for the AI transcript append race.

Bundles tests/streaming-race.harness.tsx (which renders the REAL
ChatHistoryProvider) with esbuild into a temporary directory, serves it, and
drives it in headless Chromium.

The decisive case: two `appendAIMessage` calls inside ONE synchronous tick.
Production delivers audio segments from TaskQueue executions that can share a
React tick, so this is not a synthetic scenario:

  * buggy  (passive-effect read mirror): both calls read the same array and the
    second full-array `setMessages` replacement discards the first segment.
  * fixed  (synchronous single writer): the second call computes from the first
    call's result, so both segments survive.

Run:  ./.venv/bin/python tests/streaming_race.py
Exit: 0 = all assertions pass, 1 = failure.
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

import os
# RACE_SRC lets the A/B comparison bundle the harness against a different
# checkout of the app source (e.g. a pre-fix worktree) without editing files.
REPO = Path(os.environ.get("RACE_SRC") or Path(__file__).resolve().parent.parent)
ENTRY = Path(__file__).resolve().parent / "streaming-race.harness.tsx"
if os.environ.get("RACE_SRC"):
    ENTRY = REPO / "tests" / "streaming-race.harness.tsx"
ESBUILD = REPO / "node_modules" / ".bin" / "esbuild"
# An ephemeral port is picked at bind time so repeated (or concurrent)
# runs can never collide on a fixed port.
PORT = 0
BASE = ""

INDEX_HTML = """<!doctype html><html><head><meta charset="utf-8">
<title>streaming race harness</title></head><body><div id="root"></div>
<script src="./harness.js"></script></body></html>"""

FAILURES = []


def check(name, ok, detail=""):
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" :: {detail}" if detail else ""))
    if not ok:
        FAILURES.append(name)
    return ok


def bundle(outdir: Path):
    js = outdir / "harness.js"
    cmd = [
        str(ESBUILD), str(ENTRY), "--bundle", "--format=iife",
        "--jsx=automatic",
        "--loader:.tsx=tsx",
        "--define:process.env.NODE_ENV='\"production\"'",
        "--alias:@=" + str(REPO / "src/renderer/src"),
        f"--outfile={js}",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        print(proc.stdout[-3000:])
        print(proc.stderr[-3000:])
        raise SystemExit(f"esbuild failed: {proc.returncode}")
    (outdir / "index.html").write_text(INDEX_HTML)


def texts(page, role=None):
    rows = page.evaluate("() => window.__race.messages.map(m => ({role: m.role, content: m.content}))")
    return [r["content"] for r in rows if role is None or r["role"] == role]


def main():
    with tempfile.TemporaryDirectory(prefix="streaming-race-") as td:
        outdir = Path(td)
        bundle(outdir)
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=[
                "--no-sandbox", "--enable-unsafe-swiftshader",
            ])
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE + "/index.html", wait_until="load", timeout=30000)
            page.wait_for_function("() => window.__race && window.__race.ready === true",
                                    timeout=15000)

            # ---- 1. THE RACE: two appends inside one synchronous tick --------
            page.evaluate("""() => {
              window.__race.appendAI('segmen satu. ', 'turn-A');
              window.__race.appendAI('segmen dua. ', 'turn-A');
            }""")
            page.wait_for_timeout(120)
            ai = texts(page, "ai")
            check("R1 two same-tick appends keep BOTH segments (in one bubble)",
                  ai == ["segmen satu. segmen dua. "], f"ai={ai}")

            # ---- 2. many appends in one tick, no request identity -----------
            page.evaluate("() => { window.location.reload(); }")
            page.wait_for_function("() => window.__race && window.__race.ready === true",
                                    timeout=15000)
            page.evaluate("""() => {
              for (let i = 1; i <= 12; i += 1) {
                window.__race.appendAI('k ' + i + '. ');
              }
            }""")
            page.wait_for_timeout(150)
            ai = texts(page, "ai")
            # No request identity -> the legacy path merges into the last AI
            # bubble. The invariant is that EVERY segment survives, in order.
            expected_one = "".join(f"k {i}. " for i in range(1, 13))
            check("R2 twelve unlabeled appends in one tick keep every segment in order",
                  ai == [expected_one], f"n_bubbles={len(ai)} len={len(ai[0]) if ai else 0}")

            # ---- 3. repeated updates to the SAME bubble ----------------------
            page.evaluate("() => { window.location.reload(); }")
            page.wait_for_function("() => window.__race && window.__race.ready === true",
                                    timeout=15000)
            page.evaluate("""() => {
              window.__race.appendAI('bagian satu. ', 'turn-B');
            }""")
            for i in range(2, 7):
                page.evaluate(
                    "(i) => window.__race.appendAI('bagian ' + i + '. ', 'turn-B')", i)
                page.wait_for_timeout(25)
            page.wait_for_timeout(120)
            ai = texts(page, "ai")
            check("R3 five updates to one bubble concatenate in order",
                  ai == ["bagian satu. bagian 2. bagian 3. bagian 4. bagian 5. bagian 6. "],
                  f"ai={ai}")

            # ---- 4. new-turn boundary creates a separate bubble --------------
            page.evaluate("""() => {
              window.__race.setForceNewMessage(true);
              window.__race.appendAI('turn baru. ', 'turn-C');
            }""")
            page.wait_for_timeout(120)
            ai = texts(page, "ai")
            check("R4 forceNewMessage starts a separate bubble",
                  len(ai) == 2 and ai[1] == "turn baru. ", f"ai={ai}")

            # ---- 5. human rows survive concurrent AI appends ----------------
            page.evaluate("""() => {
              window.__race.appendHuman('pesan manusia', 'req-H');
              window.__race.appendAI('jawaban A. ', 'turn-D');
              window.__race.appendAI('jawaban B. ', 'turn-D');
            }""")
            page.wait_for_timeout(150)
            human = texts(page, "human")
            check("R5 a human append is not lost by same-tick AI appends",
                  human == ["pesan manusia"], f"human={human}")

            # ---- 6. canonical reconciliation still converges ----------------
            page.evaluate("() => window.__race.appendAI('teks parsial. ', 'turn-E')")
            page.wait_for_timeout(60)
            page.evaluate(
                "() => window.__race.applyCanonicalFinal('turn-E', "
                "'teks final kanonik yang lengkap. ', 'hist-1')")
            page.wait_for_timeout(150)
            ai = texts(page, "ai")
            check("R6 applied canonical text replaces the partial bubble",
                  ai[-1] == "teks final kanonik yang lengkap. ", f"last={ai[-1:]}")

            # ---- 7. flush gate still drops cancelled-turn segments -----------
            page.evaluate("""() => {
              window.__race.appendAI('diputar. ', 'turn-F');
            }""")
            page.wait_for_timeout(80)
            res = page.evaluate("""() => window.__race.appendFlushedSegments([
              { text: 'tidak diputar. ', requestId: 'turn-F' },
              { text: 'tanpa identitas. ', requestId: null },
            ])""")
            page.wait_for_timeout(150)
            ai = texts(page, "ai")
            # turn-F was never finalized -> its unplayed segment is dropped;
            # the identity-less segment keeps the legacy append-everything path.
            check("R7 flush gate drops unplayed segments of a non-finalized turn",
                  res.get("dropped") == 1 and res.get("healed") == 1
                  and "tidak diputar. " not in ai[-1] and "tanpa identitas. " in ai[-1],
                  f"res={res} last={ai[-1:]}")

            # ---- 8. resync + supersede (phantom-message guard) --------------
            # The real app always has an active history uid (set by the resume
            # decision); lastRequestRef is keyed by it, so the harness must too.
            page.evaluate("() => window.__race.setCurrentHistoryUid('hist-1')")
            page.wait_for_timeout(80)
            page.evaluate("""() => {
              window.__race.appendHuman('superseded', 'req-old');
              window.__race.appendHuman('latest', 'req-new');
            }""")
            page.wait_for_timeout(120)
            page.evaluate("() => window.__race.noteChainStart('hist-1')")
            page.wait_for_timeout(80)
            page.evaluate("""() => window.__race.applyHistoryData([
              { role: 'human', content: 'latest' },
              { role: 'ai', content: 'jawaban final kanonik yang lengkap. ' },
            ], 'hist-1')""")
            page.wait_for_timeout(200)
            human = texts(page, "human")
            check("R8 superseded pending human message is retired by the resync",
                  "superseded" not in human and "latest" in human, f"human={human}")

            check("R9 no uncaught page errors", not errors, f"errors={errors[:3]}")
            browser.close()

    print(f"\n=== {len(FAILURES)} failure(s) ===")
    if FAILURES:
        for f in FAILURES:
            print("  FAILED:", f)
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    # tiny static server for the bundled harness
    import http.server
    import os
    import socketserver
    import threading

    # serve the temp dir AFTER it is created by main(); instead, pre-create one
    # stable temp dir so the server can start before the bundle exists.
    tmp = Path(tempfile.mkdtemp(prefix="streaming-race-serve-"))
    bundle(tmp)
    (tmp / "index.html").write_text(INDEX_HTML)

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(tmp), **kw)

        def log_message(self, *a):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    httpd.allow_reuse_address = True
    port = httpd.server_address[1]
    globals()["BASE"] = f"http://127.0.0.1:{port}"
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        rc = main()
    finally:
        httpd.shutdown()
        httpd.server_close()
        for f in tmp.iterdir():
            f.unlink()
        tmp.rmdir()
    sys.exit(rc)
