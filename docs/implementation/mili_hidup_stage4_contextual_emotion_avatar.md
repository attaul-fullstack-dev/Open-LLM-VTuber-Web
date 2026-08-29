# Mili Hidup — Stage 4: Contextual Emotion → Avatar

**Status:** DONE after final cleanup. Implemented, **live-verified on Android**
(audio-ON and audio-OFF/text-only both PASS), temporary instrumentation removed,
committed on its own frontend branch/worktree; backend patches committed to
`stage6-final-integration`. **NOT merged to main.** Stage 5 not started.

- Frontend branch: `mili-hidup-stage4-contextual-emotion`
- Frontend worktree: `/root/waifu/worktrees/mili-stage4-web` (base = Stage 3 final
  commit `8ff1ed2`)
- Frontend commits: `5aec82a` (initial Stage 4) → `a7f20ba` (turn-level latch +
  shared lifecycle + dedup + cleanup)
- Backend patch commits on `stage6-final-integration`: `b9895f9` (emotion action
  metadata) · `a8dccab` (strip emotion tags from visible/tts/history) ·
  `ab0dc1c` (marker-at-start + single authoritative turn-complete signal)
- This report commit: `6c97043` (docs record)

---

## 1. Existing emotion pipeline audit (verified from current code, not docs)

**Backend:**
1. Emotion marker = inline text tag `[emotion]` (e.g. `[anger]`, `[joy]`). The
   model is instructed to emit these via `live2d_expression_prompt` in
   `service_context.py` (injects `emo_str`, the lowercase keys of the model's
   `emotionMap`).
2. Parsing: `Live2dModel.extract_emotion(text)` scans for `[key]` tags and maps
   each to the **emotionMap value = a presentation INDEX** (ma0_pro:
   0=neutral,1=sad/fear,2=anger/disgust,3=joy/smirk/surprise).
3. `transformers.actions_extractor` sets `actions.expressions = [indices]`.
4. Transport: `Actions` -> `SentenceOutput` -> `conversation_utils.process_agent_output`
   -> `tts_manager.speak` -> `prepare_audio_payload` -> websocket `{type:"audio",
   actions:{expressions:[...]}}`.
5. Frontend: `websocket-handler` passes `actions.expressions` into the audio
   task queue; `use-audio-task` called `setExpression(expressions[0])` ->
   `lappAdapter.setExpression(exprName)` (a full **preset** expression) when
   audio bytes existed.

**Problems found (the "legacy emotionMap is wrong" root cause):**
- The transport carried ONLY a presentation index, **not** the emotion label
  (lossy: sadness & fear share index 1; joy & smirk & surprise share index 3).
- ma0_pro emotionMap maps sadness → exp_02 (happy!), anger → exp_03 (sleepy!),
  surprise → exp_04 (joy). Several real emotions produced the **wrong face**.
- The frontend only applied expressions **when TTS audio bytes existed**
  (text-only responses showed nothing).

## 2. Final semantic mapping (backend label → Stage 3 face)

| backend label | Stage 3 face | notes |
|---|---|---|
| neutral | neutral | |
| joy | small_smile | soft happy |
| smirk | squint_smile | playful/mischievous |
| sadness | sad_soft | concerned/sad |
| anger | angry_pout | clearly annoyed/mad |
| disgust | pout_small | can't do "yuck"; reads as ngambek |
| fear | neutral | rig cannot express fear safely (limitation) |
| surprise | neutral | rig cannot express surprise via Stage 3 params (limitation) |
| unknown / missing | neutral | safe fallback, no crash |

`contextual-emotion.ts` also keeps a conservative **legacy-index fallback**
(0→neutral, 1→sad_soft, 2→angry_pout, 3→squint_smile) used only when the label
is absent; semantic labels always win when present.

## 3. WHY a (minimal) backend change was required

`extract_emotion` discards the emotion label and returns only a presentation
index; the last hop to the frontend carries only that index. That is a proven
"emotion marker delivery" gap: surprise/fear are indistinguishable from
joy/sadness at the frontend boundary, so a purely frontend fix would map the
wrong face for surprise. The patch is small and adds no LLM call:

- `Live2dModel.extract_emotion_keys(text)` — returns the matched emotion LABELS,
  mirroring the existing scan. `extract_emotion` (index) is unchanged.
- `Actions.emotions: Optional[List[str]]` — new optional field; `to_dict` still
  drops None.
- `actions_extractor` sets `actions.emotions` (guarded by `hasattr` so any test
  double with only `extract_emotion` keeps working).
- `tests/test_stage4_emotion_labels.py` — backend tests (7).

Provider calls per response: **unchanged** (0 extra). Memory / relationship /
summary / proactive / persona: untouched.

## 4. Semantic emotion reuses the Stage 3 controller (no duplicate system)

A single `IdleFacialExpressionController` owns interpolation + per-frame
application + idle target selection. Stage 4 does NOT create a second facial
writer. It extends that controller with **response-face ownership**:

- `claimResponseFace(state, holdMs?)` — claims the face: pauses idle timers and
  sets the target to the response face, overriding any active idle face, **even
  while `speaking`** (where autonomous idle is suppressed). Auto-releases after
  `holdMs` (safety net).
- `releaseResponseFace()` — smooth neutral then normal idle scheduling resumes.
- A guard in `reconcileSchedule`/`armChange` means activity/suppression changes
  (e.g. speaking starting) and idle scheduling can never overwrite a claimed
  response face.

Ownership priority is therefore explicit:
**response face (Stage 4) > idle selection counter-priority (No fight)**; lip-sync
(ParamA) and Stage 2 movement remain fully untouched.

Wiring:
- New `response-face-bus.ts` — tiny pub/sub.
- `use-audio-task` resolves the face id (`resolveResponseFaceId`) for every
  segment **regardless of audio bytes** (TTS and text-only both work) and
  publishes it; on response end (`stopCurrentAudioAndLipSync`, reached from
  synth-complete/queue-drain) it publishes `null` to release.
- `use-live2d-idle-facial` subscribes: non-null id → `claimResponseFace`;
  `neutral`/`null` → release.
- Replaced the legacy wrong preset `setExpression(expressions[0])` call with the
  semantic path (removed the `useLive2DExpression` dependency there).

## 5. Behavior details

- **Speaking:** idle suppressed (unchanged); response face **active**.
- **TTS:** face claims on first audio-bearing segment, follows per-sentence
  emotion, releases on queue drain.
- **Text-only:** face claims from the (silent) segment payload, holds, auto-releases
  via `holdMs` if no synth-complete arrives — so text-only shows expressions too.
- **Proactive / ignored-question / semantic_auto:** identical label pipeline → face
  works automatically. No separate system.
- **Between responses:** each segment re-claims (fresh face), previous face
  released/replaced; no stale state.
- **Unknown label:** neutral; cannot crash.
- **Lip-sync:** Stage 4 writes only facial params (brows/mouth shape/eye-smile/
  form/cheek) via the controller; `ParamA` is never touched; mouth openness is
  left to lip-sync while mouth FORM changes for the emotion.
- **EyeOpen** remains a multiply (neutral 1.0), so blink keeps running.
- **Stage 2** movement params never touched.
- **Interpolation:** reuses the controller's frame-time-aware lerp — no snapping.
- **No new render loop / interval / network / provider call.**

## 6. ma0_pro rig limitations (carried from Stage 3, not reopened)

- Smile width capped (`ParamMouthUp` pinned at 1.0) → smiles sold via eyes+cheek.
- pout vs angry separation limited (accepted).
- **NEW (Stage 4): fear & surprise have NO safe Stage 3 representation** → mapped
  to neutral. Surprise could theoretically use `exp_07`, but full presets fight
  the Stage 3 controller / lip-sync / blink, so neutral is the safer choice.

## 7. Turn-level lifecycle, timing & cleanup (final)

This section records the work added after the initial `5aec82a` implementation,
all driven by live-test findings.

**Marker position (backend):** `live2d_expression_prompt.txt` now requires the
single marker at the VERY START of the response (`[joy]` then text), never at the
end/inline. Proven live: `idx=1 emotions=smirk has_marker=True` so the face is
known before sentence 1 audio starts (the old late-marker build claimed the face
only after all spoken sentences and held it ~64 ms).

**Turn-level latch (frontend):** a valid non-neutral emotion latches the face
for the whole assistant turn. Later sentences with no marker/`neutral` fallback
**keep** the face (`face_keep` / `decideResponseFace`); they no longer release
it. Release only on real turn end (`null`), interruption, or cancellation.

**Shared per-turn lifecycle (`response-turn-lifecycle.ts`):** `useAudioTask` is
mounted by several components (canvas, websocket-handler, every `useInterrupt`
consumer), so per-instance refs caused BOTH: (a) an audio turn being
misclassified as text-only (the releasing instance never played the audio), and
(b) a duplicate-release storm (every instance ran its own completion effect).
The per-turn state is now a module-level singleton: `markAudioPlayed` latches
`audioPlayed` from a real `audio_start` for the WHOLE turn, and `decideTurnFinalize`
returns exactly one authoritative decision per turn (`already_released`
afterward, kept as defense-in-depth with the idempotent frontend guard). Only
one mounted instance (first claimant) subscribes to `backendSynthComplete`, so
duplicates are suppressed at the source too.

**Watchdog / hold policies:** `RESPONSE_FACE_HOLD_MS` is 6s→**20s** (a pure
fallback for a genuinely stuck lifecycle, not the primary lifetime) and is
activity-refreshed (`refreshResponseFace`) on every audio task/start/end, text
segment and sentence publish, so healthy multi-sentence turns (long TTS gaps)
never time out. Audio turns release immediately at `playback_complete`; only a
turn with NO real audio playback (muted/text-only) gets a bounded perceptual
hold (`text_only_hold`, `pickTextOnlyHoldMs` = 2.5s min, ~8ms/char, 6s cap).

**Turn-complete dedup:** `backend-synth-complete` was sent twice per turn (in
`single_conversation.py`/`group_conversation.py` + in `finalize_conversation_turn`),
releasing the face and re-emitting `frontend-playback-complete` repeatedly. The
duplicate sends were removed — `finalize_conversation_turn` is the single
authoritative emitter.

**Temporary instrumentation removed before release:** `s4-trace.ts` + the
`/debug/s4trace` bridge and every server-side `[S4TRACE]` line were removed.
The served bundle contains **zero** S4TRACE/debug references.

## 8. Tests / validation (final)

**Frontend full regression:** **89/89 PASS** across 7 test files, including:
- `contextual-emotion`: label→face mapping, rig-limited→neutral, unknown→neutral,
  index fallback, label-wins-over-index, palette-id validity, claim-overrides-idle,
  idle-cannot-override-claim, active-during-speaking, claim-null-releases,
  consecutive-replace (no stale), only-facial-params (no ParamA/Stage2),
  lip-sync/EyeOpen-multiply, hold-policy bounds, **turn-level latch** (unmarked
  sentence keeps face; no neutral_sentence release), **LATCH text-only/perceptual
  hold**, **lifecycle latch** (audio never text_only_hold; second/third sentence
  cannot reset audio-played; new turn resets; interruption immediate; duplicate
  completion → one decision; idempotent).
- `response-turn-lifecycle`: pure state-machine tests (**8**).
- Stage 3 `live2d-idle-facial` 16/16 · Stage 2 `idle-behavior` 16/16 · Stage 1
  `activity` 10/10 · subtitle/display 7/7.
- **runtime-order regression** covers a response face surviving the real update order.
- Production build: **PASS** (`index-CuxzRkLo.js` final clean bundle, **0** S4TRACE
  markers after instrumentation removal).
- Typecheck (scoped to changed files): clean; only pre-existing `WebSDK/Framework`
  noise (project gate = electron-vite build = PASS). ESLint config `airbnb` not
  installed in this env (pre-existing).

**Backend:**
- `tests/test_stage4_emotion_labels.py`: 16/16 (incl. marker-at-start extraction,
  tag removed from visible/tts/persisted text, cleanup applies to proactive too).
- Proactive + architecture + stage4 + memory/relationship/summary/latency:
  **232/232 PASS**.
- `test_mili_ui_response_polish`: 1 pre-existing env failure (`ModuleNotFoundError:
  open_llm_vtuber` import convention clash) — unchanged, unrelated to this patch.
- Ruff: clean. compileall: OK. `git diff --check`: clean.

## 9. files changed

**Frontend (`mili-hidup-stage4-contextual-emotion`):**
- `src/renderer/src/utils/contextual-emotion.ts` (new) — label→face mapping + index fallback
- `src/renderer/src/utils/response-face-bus.ts` (new) — response-face pub/sub + decideResponseFace latch + pickTextOnlyHoldMs
- `src/renderer/src/utils/response-turn-lifecycle.ts` (new) — shared per-turn lifecycle state machine
- `src/renderer/src/utils/live2d-idle-facial.ts` — response-face ownership + watchdog refresh in controller
- `src/renderer/src/hooks/canvas/use-live2d-idle-facial.ts` — subscribe + claim/keep/release latch
- `src/renderer/src/hooks/utils/use-audio-task.ts` — publish face; turn-level lifecycle; heartbeat; drop legacy preset
- `src/renderer/src/hooks/utils/use-interrupt.ts` — pass `interruption` reason
- `src/renderer/src/services/websocket-handler.tsx` — forward `emotions`
- `src/renderer/src/services/websocket-service.tsx` — `emotions` type
- `tests/contextual-emotion.test.ts`, `tests/response-turn-lifecycle.test.ts` (new)
- `src/renderer/src/utils/s4-trace.ts` — temporary instrumentation, **deleted**

**Backend (committed to `stage6-final-integration`):**
- `src/open_llm_vtuber/live2d_model.py` — `extract_emotion_keys`
- `src/open_llm_vtuber/agent/output_types.py` — `Actions.emotions`
- `src/open_llm_vtuber/agent/transformers.py` — carry `actions.emotions`
- `prompts/utils/live2d_expression_prompt.txt` — marker-at-start instruction
- `src/open_llm_vtuber/conversations/single_conversation.py` / `group_conversation.py` — single-authoritative completion dedup
- `src/open_llm_vtuber/conversations/conversation_utils.py` — tag cleanup (metadata kept, text stripped); S4 trace added then removed
- `tests/test_stage4_emotion_labels.py` (new)

## 10. Android live-test procedure (after deploy)

1. Neutral: normal factual chat → neutral face.
2. Happy/positive chat → small_smile.
3. Mili teases/jokes → squint_smile (when `[smirk]`).
4. Sad/concerned → sad_soft.
5. Annoyed/nagging → pout_small (disgust) / angry_pout (anger).
6. Consecutive responses happy→neutral→angry→sad → no stale face.
7. TTS: lip-sync + mouth openness unaffected while the emotion face is on.
8. Text-only (TTS off): expression still appears for a perceivable duration.
9. Proactive: Mili's proactive message also drives a face from its emotion.

## 11. known limitations

- fear / surprise response emotions stay **neutral** (no safe Stage 3 face; using
  presets would fight the controller). Honest rig limit.
- Intensity: the backend provides label-only markers, so faces use deterministic
  full preset strengths (no smooth intensity ramp). Accepted per label-only design.
- If the model is NOT mao_pro, the same mapping still applies; faces that map to
  palette ids work for any model with those params, and absent params no-op safely.

**RESOLVED:** the `[emotion]` tag display/history cleanup was completed separately
on the backend (`a8dccab` — markers extracted as metadata, then stripped from
visible/tts/persisted text).

## 12. recommended Stage 5 handoff
- Emotion **intensity** (if a future backend labels intensity) → scale Stage 3
  offsets toward `FACIAL_RANGES`.
- Optional safe preset for surprise (exp_07) with strict release, IF proven not to
  fight the controller during live testing.
- Consider feeding response-visible duration (for text-only mode) from a backend
  timing hint instead of the current frontend bounded hold.