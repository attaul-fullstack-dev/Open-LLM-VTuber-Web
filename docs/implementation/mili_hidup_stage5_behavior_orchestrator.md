# Mili Hidup Stage 5
## Behavior Integration / Avatar Orchestrator

**Status:** IMPLEMENTED, tests PASS, production build PASS. Committed on its own
frontend branch/worktree. **NOT merged, NOT deployed.** Stage 5 is an integration
stage — it coordinates ownership without reimplementing Stages 1–4. Stage 6 not
started.

- Frontend branch: `mili-hidup-stage5-behavior-orchestrator`
- Frontend worktree: `/root/waifu/worktrees/mili-stage5-web`
- Base: Stage 4 final commit `7d10a2a`
- Frontend commit: `d51d58b` (repo record)
- Backend: **not touched** (preferred zero-backend-change integration)

---

## 1. Why Stage 5 (the concrete gap found live in the code)

Stage 1–4 already work and already suppress via `activityState` + their own
`isDragging`/`isMotionPlaying`/`isMotionSpeaking` toggles. The one real
coordination gap:

- During a **proactive** response (user silent in `long_idle`), generation starts
  while the Stage 1 activity state is still `long_idle`. Only once audio actually
  plays does the state flip to `speaking`. In that pre-audio window, Stage 2
  (autonomous movement) and Stage 3 (idle face) kept running, because neither
  knew a response was starting.
- Stage 2 and Stage 3 were each recomputing the same "is it safe to move/act"
  logic in isolation (`activityState`, `isDragging`, `isMotionPlaying`), with no
  single source of truth and no shared notion of "a response owns the avatar".

Stage 5 fixes this by centralizing **who may act when** into one lightweight,
queryable orchestrator, and teaching Stage 2/3 to read the same decision.

## 2. Ownership model

New pure module `src/renderer/src/utils/behavior-orchestrator.ts`:

- **Owners**: `session_switch`, `interruption`, `response`, `speaking`,
  `user_active`, `drag`, `intentional_motion`, `idle_face`, `idle_movement`,
  `long_idle`, `neutral`.
- **Channels**: `face` (contextual face > idle face > neutral), `movement`
  (drag/explicit motion > safe idle), `lip` (lip-sync only), `lifecycle`
  (response / interruption / idle / session_switch).
- **`BEHAVIOR_PRIORITY`** — deterministic, documented order:
  interruption > response > speaking > user_active > drag > motion > idle_face >
  idle_movement > long_idle > neutral.
- **`resolveBehaviorOwnership(input): BehaviorOwnershipSnapshot`** — pure,
  side-effect free. Inputs are the live signals mapped by the React adapter.

Snapshot queries:
- `canRunIdleFace()` — idle/long_idle AND not speaking/drag/motion/interrupted
  AND no ongoing/owned response.
- `canRunIdleMovement()` — idle/long_idle AND not speaking/drag/motion/
  interrupted AND a response is not being generated. Unlike the face channel, it
  is NOT blocked by a latched response face (safe movement may continue while a
  contextual face is held — spec D).
- `isResponseOwned()`, `isUserActive()`, `isInterrupted()`.
- `shouldSuppressAutonomous()` → `{ face, movement }` used by Stage 2/3.

Stage 5 **never writes a Live2D parameter**. It only resolves ownership.

## 3. Runtime-order findings (verified from `lappmodel.ts`)

`LAppModel.update()`:
1. loadParameters → 2. motion → 3. eye blink → 4. expression manager → 5. drag →
6. breath → 7. physics → 8. lip sync → 9. pose → 10. **Stage 2** `applyIdleOffsets`
→ 11. **Stage 3/4** `applyIdleFacial` → 12. `_model.update()`.

So Stage 3/4 is already the LAST writer before `_model.update()`, and Stage 2
runs just before it. Stage 5 adds **no** render hook and changes no ordering; the
own-parameter separation (Stage 2 movement, Stage 3/4 facial, lip-sync ParamA) is
unchanged. The Stage 4 runtime-order regression test still passes unchanged.

## 4. React adapter & wiring

`src/renderer/src/hooks/canvas/use-behavior-ownership.ts`:
- Sources `activityState` (Stage 1), `isInterrupted`/`responseInProgress`
  (`aiState`, includes proactive generation while still `long_idle`), the Stage 4
  response-face latch (from `responseFaceBus`), drag/motion props, and session
  switch (`currentHistoryUid` change).
- On session switch: calls `clearTransientOwnership()` (publishes a null release
  through the Stage 4 idempotent path) and briefly disables autonomous behavior.
- Exports `clearTransientOwnership()` (idempotent release for callers).

`src/renderer/src/components/canvas/live2d.tsx`:
- Resolves `behavior.shouldSuppressAutonomous()` once and feeds **the same
  decision** to Stage 2 (`isMotionPlaying`) and Stage 3 (`isMotionPlaying`),
  replacing the previous hardcoded `false`. This is the only behavioral change:
  during a proactive/response/interruption window the idle face + movement yield
  in unison. Inside idle without a response, both stay active exactly as before.

## 5. Behavior integration (what each stage does / never does)

- **Stage 1** remains the source of activity state; Stage 5 only reads it.
- **Stage 2** owns AngleX/Y/Z, BodyAngleX, EyeBallX/Y; reads the shared movement
  gate. ParamA and facial params untouched.
- **Stage 3** owns facial params + EyeOpen multiply; reads the shared face gate.
- **Stage 4** claims/keeps/releases a Stage 3 face via its own latch; its
  response-FACE ownership is the face channel's top priority.
- **Lip sync** owns ParamA always (orange `lipOwner: 'lip_sync'`).

Priority result (deterministic):
  interruption > contextual response face (Stage 4) > speaking > drag/explicit
  motion > idle face (Stage 3) > idle movement (Stage 2) > neutral.

## 6. Conflict matrix (all covered by tests)

| from | to | resolution |
|---|---|---|
| A. active user | Stage 3 idle face | suppressed (`canRunIdleFace=false`) |
| B. speaking | Stage 3 idle face | suppressed |
| C. speaking | Stage 4 face | Stage 4 stays active (faceOwner `response`) |
| D. Stage 4 face | Stage 2 movement | safe movement may continue (movement not gated on face) |
| E. drag | Stage 2 movement | suppressed |
| F. explicit motion | Stage 2 movement | suppressed |
| G. response ends | Stage 3 idle | idle resumes only through idle lifecycle (no snap) |
| H. long_idle + proactive | idle face/movement | yield to response while generating |
| I. interruption | all response transient | clears (faceOwner `interruption`, both channels suppressed) |

## 7. Performance & provider impact

- LLM/provider calls: **unchanged (0 additional)** — Stage 5 never calls the
  backend or an LLM.
- Network: unchanged.
- Rendering: **no** new rAF/interval/render loop; the adapter only maps already
  available context/bus state each render.
- CPU/RAM: negligible (a pure rank + a couple of booleans per render; a small
  effect list of one bus subscription).

## 8. Tests

The pure orchestrator is fully unit-tested (`tests/behavior-orchestrator.test.ts`,
24 tests): priority order, active suppression, idle/long_idle coexistence,
response-face-over-idle, no-idle-during-response, speaking behavior, lip channel,
safe-movement-during-face, drag suppression, interruption authority, session
switch, proactive flows (generate / speak / completion), text-only & audio hold,
no-stuck-ownership, and the A–I conflict matrix. Runtime order unchanged and
still covered by the existing Stage 4 runtime-order test.

## 9. Validation

| Check | Result |
|---|---|
| Stage 5 tests | **24/24 PASS** |
| Full frontend regression (8 test files) | **113/113 PASS** |
| Production build (`build:web`) | PASS → `main-CdNrQm5m.js` |
| Typecheck (scoped to Stage 5 files) | clean |
| Lint | ESLint config `airbnb` not installed in this env (pre-existing); no noisy logs added |
| `git diff --check` | clean |
| Backend | not touched |

## 10. Manual live-test procedure (after deploy)

1. **IDLE** — stay silent; Stage 2 head/body movement + Stage 3 faces appear.
2. **USER ACTIVITY** — send a message; autonomous scheduling resets (active).
3. **RESPONSE** — trigger joy/smirk; Stage 4 face stays active through the whole
   response; no random Stage 3 face mid-response.
4. **RESPONSE END** — face releases; no instant random expression; idle resumes
   later via its cooldown.
5. **LONG IDLE → PROACTIVE** — wait for a proactive message; idle face/movement
   yield while Mili is generating; the proactive contextual face appears; on
   completion idle resumes.
6. **INTERRUPTION** — interrupt mid-response; face clears, no stale expression.
7. **DRAG** — drag Mili; autonomous movement pauses and resumes after.
8. **TEXT-ONLY** — audio off; contextual face holds; idle face does not overwrite.
9. **AUDIO ON** — contextual face + lip-sync + safe Stage 2 movement coexist.

Nothing is deployed automatically. Test first, then deploy the Stage 5 bundle.

## 11. Known limitations

- `user_active` (Stage 1 = active) is labeled below `response`; a user who is
  actively typing while Mili responds keeps the response as the face owner. This
  matches the "response owns the face" rule; user control (interrupt/drag) still
  always wins via `interruption`/`drag`.
- Session switch detection relies on `currentHistoryUid` changing; other reset
  paths (push/merge) that change uid are covered by the same effect.

## 12. Stage 6 handoff recommendations

- Emotion-specific BODY gestures (anger head-shake, joy bounce, sadness lean-down)
  belong to a future stage and should be gated by the same `isResponseOwned()`
  + `faceOwner` queries so they never fight idle behavior.
- If a future backend emits emotion **intensity**, feed it to Stage 3 offsets via
  the existing `FACIAL_RANGES` (Stage 5 exposes ownership, not strength).
- Optional: expose `owner` on a dev-only window flag for QA inspection without
  adding per-frame logs.