# Mili Hidup Stage 3
## Autonomous Idle Facial Expressions

**Status: MILI HIDUP STAGE 3 SELESAI (frontend-only; NOT deployed/merged to production)**

## 1. Status
Implemented, deterministic tests green, production build passing. Committed on its own branch/worktree. Not merged, not deployed.

## 2. Branch
`mili-hidup-stage3-idle-emotions`

## 3. Worktree
`/root/waifu/worktrees/mili-stage3-web`

## 4. Base commit
`005447a` (`feat: touch-reliable drag-to-move + deeper zoom`) — the latest committed FINAL Stage 2 frontend state.

## 5. Commit hash
`92f07b0` on `mili-hidup-stage3-idle-emotions`

## 6. Files changed
| File | Change |
|---|---|
| `src/renderer/src/utils/live2d-idle-facial.ts` | New pure Stage 3 controller + mao_pro ambient palette |
| `src/renderer/WebSDK/src/lapplive2dfacialhook.ts` | New WebSDK facial-hook registry (mirrors Stage 2) |
| `src/renderer/WebSDK/src/lappmodel.ts` | Consumes facial hook after the Stage 2 movement hook |
| `src/renderer/src/hooks/canvas/use-live2d-idle-facial.ts` | New React adapter publishing per-frame apply |
| `src/renderer/src/components/canvas/live2d.tsx` | Mounts `useLive2DIdleFacial` |
| `tests/live2d-idle-facial.test.ts` | New deterministic tests (12) |

## 7. Current Live2D runtime order found
Inside `LAppModel._update()` the existing chain is (from inspection):
1. motion update
2. expression / lip-sync (`ParamA` + vowels)
3. pose
4. Stage 2 idle movement hook (`applyIdleOffsets`, auto-linked from `getLive2DIdleApplyHook`)
5. `this._model.update()`

Breath and eye blink are applied by the Cubism framework before/around these. Stage 2's fix moved its hook to be last so nothing overwrites it.

## 8. Final Stage 3 hook location
Immediately AFTER the Stage 2 `applyIdleOffsets` hook and BEFORE `this._model.update()`, inside `LAppModel._update()`.

## 9. Why that location is safe
- Runs after motion/expression/physics/pose/breath/lip-sync, so nothing later can clobber Stage 3's facial contribution.
- Stage 3 owns *facial* params (brows, mouth shape, eye-smile, blush) and an EyeOpen **multiply**; Stage 2 owns *movement* params. They do not overlap, so applying one after the other is safe and they don't fight.
- A mandatory runtime-order regression test replicates this exact order and proves Stage 3 lands last.

## 10. Parameter ownership
**Stage 3 owns (additive):** `ParamBrowLY/RY`, `ParamBrowLAngle/RAngle`, `ParamBrowLForm/RForm`, `ParamMouthUp`, `ParamMouthDown`, `ParamMouthAngry`, `ParamMouthAngryLine`, `ParamEyeLSmile/RSmile`, `ParamEyeLForm/RForm`, `ParamCheek`.
**Eye open (multiply only):** `ParamEyeLOpen/ROpen`, neutral `1.0`.
**Never touched:** `ParamA / ParamI/U/E/O` (lip-sync), and Stage 2 movement: `ParamAngleX/Y/Z`, `ParamBodyAngleX`, `ParamEyeBallX/Y`.

## 11. mao_pro parameter audit
Verified from `mao_pro.cdi3.json`: all owned IDs exist in the model. Confidence the writes land on real parameters: the adapter resolves ids through `CubismFramework.getIdManager()` lazily (same mechanism Stage 2 uses), and the CubismModel clamps final values to the rig's min/max.

## 12. Facial semantic states
`neutral`, `small_smile`, `mild_pout`, `mildly_annoyed`, `curious_soft`, `relaxed`, `sleepy_soft` — implemented as small additive offsets (roughly 15–45% of conservative ranges) plus optional eye factor.

## 13. Idle palette
`neutral`, `small_smile`, `mild_pout`, `mildly_annoyed`, `curious_soft`, `relaxed`.

## 14. Long idle palette
`neutral`, `relaxed`, `sleepy_soft`, `small_smile`, `mild_pout` (sleepy becomes available — `sleepy_soft` is `longIdleOnly`).

## 15. Timing/cadence
- **idle:** change facial target every 4–8s (randomized).
- **long_idle:** every 5–10s (randomized).
- Suppression-end cooldowns: speaking 1.8s, drag 1.2s, motion 1.2s.
- Event cadence is setTimeout-driven; per-frame work is trivial interpolation only.

## 16. Interpolation behavior
Frame-time-aware exponential smoothing toward the target additive and eye factor. No snapping: on suppression it eases back to neutral; on speaking-end it waits a cooldown before resuming.

## 17. EyeOpen handling
Always MULTIPLY. Neutral `1.0`; `relaxed` 0.94; `sleepy_soft` 0.82. Never absolute-set, so blink / runtime eye animation keeps working and the factor smoothly returns to 1.0 when suppressed.

## 18. Speaking suppression
`activityState === 'speaking'` arms the `speaking` suppression; the controller eases the face to neutral. Applies to autonomous gestures and response-expression priority — Stage 3 never overrides the response emotion path.

## 19. Motion/drag suppression
Reuses Stage 1's suppression state (`isDragging`) and Stage 2's motion flag wiring. During drag or an explicit non-idle motion, Stage 3 eases out and does not fight.

## 20. Response-expression compatibility
No change to the insertion point of the response emotion system. Stage 3 is only active while `idle`/`long_idle` and un-suppressed; when speaking/response-expression ownership is active it is neutralized.

## 21. Stage 2 compatibility
Stage 2 thresholds (idle 5s / long 15s), movement ranges (AngleX ±26, AngleY ±16, AngleZ ±22, BodyAngleX ±7, EyeBall ±0.8), zoom (0.5–4.5), pointer drag, and suppression are all untouched. Stage 2 tests still pass (16/16).

## 22. ParamA protection
Stage 3 never writes `ParamA` (nor I/U/E/O). No Stage 3 write touches lip-sync ownership. Confirmed by test.

## 23. Network / LLM impact
Zero: no LLM, no backend call, no websocket message, no network. Purely local frontend autonomous behavior.

## 24. CPU/RAM considerations
No second render loop, no `setInterval`, no per-frame logging, no object churn beyond the tiny facial additive struct. Rides the existing Cubism render loop. Suitable for Android.

## 25. Tests added
- active → no autonomous target
- idle enables facial
- long_idle enables facial
- speaking suppresses
- speaking end allows resume (cooldown honoured)
- palette has no strong anger/sad/surprise
- sleepy_soft is long_idle only
- anti-repeat prevents immediate repetition
- EyeOpen multiply semantics + neutral 1.0
- controller output uses only facial keys (guards ParamA / movement params out)
- **runtime-order overwrite-regression test** (mandatory)
- dispose resets to neutral

## 26. Runtime-order regression test
Replicates `LAppModel._update` ordering: earlier face system → Stage 2 hook → Stage 3 hook. Asserts the order is preserved AND Stage 3's contribution wins over an earlier strong writer (catches a Stage-2-style overwrite bug).

## 27. Targeted test results
`tests/live2d-idle-facial.test.ts` → **12/12 PASS**.

## 28. Full frontend test results
- Stage 1 `avatar-activity-controller.test.ts` → 10 PASS
- Stage 2 `live2d-idle-behavior.test.ts` → 16 PASS
- Stage 3 `live2d-idle-facial.test.ts` → 12 PASS
- `subtitle-playback.test.ts` → 5 PASS
- `clean-display-text.test.ts` → 2 PASS
- `avatar-activity-integration.test.mjs` → 7 PASS
- `chat-delivery-reconnect.test.mjs` → 4 PASS
- `memory-ui-contract.test.mjs` → 5 PASS

## 29. Production build result
`npm run build` → **PASS** (`electron-vite build`, all chunks emitted).

## 30. Lint/typecheck result
- Typecheck (`tsc -p tsconfig.web.json --composite false`): the WebSDK/Framework folder already emits 583 **pre-existing** errors at base `005447a` (unrelated to this patch); **zero** errors in any Stage 3 file or `cannot find module`. The project's actual gate is `electron-vite build`, which passes.

## 31. Git diff check
`git diff --check` — clean.

## 32. Manual Android test procedure
Follow spec section 24 TEST A–I. Key checks: interact → no idle face; idle >5s → subtle facial micro-expressions; long idle >15s → relaxed/sleepy possible; speaking → face neutralizes with lip-sync intact; after speech → resumes after ~1.8s; drag → no fighting; real motion → not overridden; watch ≥10 min for stuck/looping/clamped-face regressions.

## 33. Known limitations
- Value strengths are conservative by spec (micro-expressions). They can be dialed per-state in `IDLE_FACIAL_PALETTE` / `FACIAL_RANGES` without code rework.
- Visual correctness on real Android hardware is NOT yet verified (no visual capture available in this environment); parameter-level tests + build prove the mechanism, not the final look.

## 34. Recommended Stage 4 handoff
Stage 4 "Contextual Emotion → Avatar" should fix the response `emotionMap` mismatches (anger/fear/sadness/surprise, underused exp_05–08) and decide whether response emotions use presets vs direct parameter modulation. Stage 3's per-parameter additive approach and its `applyIdleFacial` render slot are ready to be reused/extended there.