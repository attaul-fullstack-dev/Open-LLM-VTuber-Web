# Mili Hidup — Stage 3: Autonomous Idle Facial Expressions

## FINAL — stable production build (2026-08-29)

Status: **STABLE / COMPLETE.** User confirmed Stage 3 is visually sufficient.
Remaining pout/angry separation differences are **accepted `mao_pro` Live2D rig
limitations** and are not being chased further. All temporary development
instrumentation has been removed.

### Accepted rig limitations (do not re-tune)
- **Smile width is capped** — `ParamMouthUp` is pinned at 1.0 (idle motion) and
  its real max is 1.0, so a truly wide/big smile is physically impossible on
  this model. Smiles are sold via eye-smile + cheek + eye narrowing only.
- **pout vs angry separation is limited** — with only `MouthUp/-Down/-Angry/-
  AngryLine` for the mouth and no dedicated frown/brow-bone deformation, a
  small pout and a stronger angry/pout are distinguishable but cannot reach the
  drama of a fully rigged anger face. This is accepted as-is.

### Final production palette (weighted random, anti-repeat)
| state | mouth | eyes/brows | eyeOpen | idle wt | long_idle wt |
|---|---|---|---|---|---|
| neutral | — | — | 1.0 | 30 | 30 |
| small_smile | — | eye-smile 0.45, cheek 0.45 | 1.0 | 22 | 22 |
| squint_smile | — | eye-smile 0.85, cheek 0.5, eye form 0.2 | 0.82 | 13 | 9 |
| sad_soft | MouthDown 0.4, MouthUp -0.3 | brow up 0.22, brow angle 0.15 | 0.97 | 7 | 7 |
| pout_small | MouthAngry/Line 0.7, MouthUp -0.6 | brows ≈ neutral | 1.0 | 13 | 10 |
| angry_pout | MouthAngry/Line 1.0, MouthUp -1.0, MouthDown 0 | eye form 1.0, brow angle -0.7, form -0.6 | 0.85 | 7 | 7 |
| sleepy_soft | — | eye-smile 0.18, brows down | 0.78 | 0 (excl.) | 22 |

### Cleanup done (this commit)
- **Removed** the deterministic debug facial cycle (`DEBUG_IDLE_FACIAL_CYCLE`,
  `setCycle`, cycle options/path in the controller) and its two cycle tests.
- **Removed** the runtime beacon + all dev logging from
  `use-live2d-idle-facial.ts` (no more `/__facial_beacon` requests).
- **Restored** pure weighted-random autonomous idle selection (the controller's
  only selection path).
- No facial parameter value was changed in this cleanup pass.

### Final tests (all green)
- Stage 3 facial: **16/16** PASS (incl. runtime-order overwrite-regression,
  weighted selection, EyeOpen multiply, no ParamA / no Stage 2 writes)
- Stage 2 idle-behavior: 16, Stage 1 activity: 10, subtitle: 5, display-text: 2
- Integration: avatar (7), chat-delivery/reconnect (4), memory-ui (5)
- Production build: **PASS**; typecheck scope: clean; `git diff --check`: clean

### Commit history (branch `mili-hidup-stage3-idle-emotions`, not merged)
- `005447a` base (Stage 2 final committed state)
- `92f07b0 ab0c047` baseline Stage 3 implementation
- `23266ab` mouth fix + debug beacon
- `1c1bf73` mouth-separation tuning + cycle
- `87c7677` natural arc + angry-not-sad fix
- `e164e08` final 7-state weighted palette (big_smile/relaxed/curious removed)
- `72af388` pout/angry rig-recipe tuning
- `3981a82` **final clean commit** — debug cycle + beacon removed

Roll forward intentionally kept on its own branch/worktree; **NOT merged to
main, backend untouched, Stage 4 not started.**

---

## pout/angry tuning pass (2026-08-29): read anger from the rig's own recipe

Live-test verdict: smiles + sad_soft + squint separated; `pout_small` and
`angry_pout` still under-read. The rig's own angry expression (`exp_08`)
revealed the missing cue: **sharp angular eyes via `ParamEyeLForm/ParamEyeRForm`
= 1** — we had it at 0.2, far too weak. It also uses a FULL mouth-corner frown
`MouthUp -1` with `MouthDown 0`, i.e. the frown-and-pout-line (not the sad droop).

- `pout_small`: mouth-driven ngambek — `MouthUp -0.6` (clear downturn) +
  `MouthAngry/Line 0.7`; `MouthDown 0` (not sad); brows/eyes near neutral.
- `angry_pout`: follows exp_08 — `MouthUp -1.0` + `MouthAngry/Line 1.0` +
  `EyeL/RForm 1.0` (sharp eyes), plus furrowed/lowered brows and narrowed eyes
  (×0.85) so it clearly reads more kesal than pout_small; `MouthDown 0`.

No other state touched. Size side untouched. Debug cycle + beacon retained for
the final verification.

---

## Final polish pass (2026-08-29): visual separation + rig-limit cleanup

### Beacon ground-truth (from /tmp/server_setsid.log)
The runtime beacon proved a hard rig limitation that shapes the final palette:

- **`ParamMouthUp` is pinned at 1.0 by idle motion `mtn_01` AND has a real
  `max` of 1.0.** Every positive mouth offset (`small_smile`/`squint_smile`/
  `big_smile`) resolves to `up_val=1.00 up_clp=1` — the mouth cannot open any
  wider than neutral. Smiles must therefore be sold by EYES + CHEEK, never by
  raising the mouth. `big_smile` is visually identical to `small_smile` on the
  mouth axis and was **REMOVED** from the autonomous palette.
- `MouthDown` / `MouthAngry` / `MouthAngryLine` reach the rig intact (not
  clamped), so the negative side has full power.

### Decisions driven by the beacon
- **Removed** `big_smile` (mouth pinned at 1.0, indistinguishable), `relaxed`
  (collapses into `neutral`; relaxed feel now comes from EyeOpen ×0.94 during
  long_idle) and `curious_soft` (reduces clutter). Palette = **7 readable
  states**: `neutral`, `small_smile`, `squint_smile`, `sad_soft`, `pout_small`,
  `angry_pout`, `sleepy_soft` (long_idle).
- `angry_pout` carries anger via full pout line + furrowed, sharp **inward
down** brows + narrowed eyes (EyeOpen ×0.9). Zero `MouthDown` → reads angry, not
  sad.
- `sad_soft` vs `pout_small` separated: sad_soft = BROWS (lifted inner) + eyes +
  mild droop; pout_small = MOUTH ONLY (pout line), brows/eyes near neutral.
- `small_smile` vs `squint_smile` separated by eye-smile / blush / eye narrowing
  (×0.82) — the only live smile axes.

### Weighted random selection
Each state now has `weight` (+ optional `longIdleWeight`). Calm/subtly-positive
states dominate; negatives are rare:
| state | idle weight | long_idle weight |
|---|---|---|
| neutral | 30 | 30 |
| small_smile | 22 | 22 |
| squint_smile | 13 | 9 |
| pout_small | 13 | 10 |
| sad_soft | 7 | 7 |
| angry_pout | 7 | 7 |
| sleepy_soft | 0 (excluded) | 22 |

### Debug cycle (final verification, temporary)
```
neutral → sad_soft → pout_small → angry_pout → neutral → small_smile → squint_smile → small_smile
```
will be removed together with the beacon once the user confirms final
separation on Android; production then uses weighted random selection.

### Tests (17) + regressions green; build PASS; bundle deployed for live check.

---

## Revision pass (2026-08-29): natural emotion arc + angry-not-sad fix

### Shared root cause of "cedeut, terkesan sedih"

On `mao_pro` the ONE rig signal that separates ANGRY from SAD is the mouth:

- **angry** = `ParamMouthAngry` + `ParamMouthAngryLine` (pout / frown line); the
  corners must NOT droop.
- **sad** = `ParamMouthDown` (corners pulled DOWN).

The previous `obvious_sulk` used `MouthDown: 0.3` + `MouthUp: -0.8` + lowered
brows — i.e. the sad recipe — so it read as *sad*, not *angrier*. The isolated
`mildly_annoyed` with `MouthUp: -1.0` (corners down hard, exp_08) also leaned
toward a frown rather than a crisp ngambek/annoyed.

Reworked so anger NEVER uses `MouthDown`.

### New ambient palette (per-parameter additive, no preset spam)

| state | mouth recipe | brow / eye recipe | eyeOpen |
|---|---|---|---|
| neutral | — | — | 1.0 |
| relaxed | `MouthUp +0.25` | brows soft down `-0.1`, eye-smile 0.2 | 0.94 |
| curious_soft | — | brow form `+0.3`, eye form 0.12 | 1.0 |
| small_smile | `MouthUp +0.5` | eye-smile 0.45, brows slightly up 0.15 | 1.0 |
| **squint_smile** (NEW) | `MouthUp +0.8` | eye-smile 0.85, cheek 0.5, soft brows | **0.82** (hepi-sipit) |
| big_smile | `MouthUp +1.0` | eye-smile 0.9, cheek 0.6, sparkle form | 1.15 |
| **sad_soft** (NEW) | `MouthDown +0.5, MouthUp -0.4` | brows down/angled soft | 0.96 |
| pout_small | `MouthAngry +0.5, Line +0.5, MouthUp -0.2` | brow angle `-0.3` | 1.0 |
| **angry_pout** | `MouthAngry +1.0, Line +1.0, MouthUp -0.4` (NO droop) | brow angle `-0.6`, brow form `-0.5` | 0.97 |
| sleepy_soft (long_idle) | `MouthUp +0.15, MouthDown +0.15` | brows down, eye-smile | 0.8 |

Removed/renamed: `obvious_smile`→`big_smile`, `mild_pout`→`pout_small`,
`obvious_sulk`/`mildly_annoyed`→`angry_pout`; added `sad_soft`, `squint_smile`.

### New natural debug cycle (murung → netral → senyum lebar)

```
sad_soft → pout_small → angry_pout → neutral → relaxed → small_smile → squint_smile → big_smile
```

All parameters (mouth up/down/angry line, eye smile/open, brow angle/form) are
synchronized per state so the emotion reads as a whole face, not random parts.

---

## Earlier (baseline) Stage 3 summary

**status** committed on `mili-hidup-stage3-idle-emotions` (own worktree), not
merged/deployed except for manual Android bundle testing.

### Event timing
- idle: new face every 4–8 s; long_idle: 5–10 s
- cooldown after suppression ends: speaking 1.8 s, drag/motion 1.2 s
- setTimeout-driven, no new render loop / interval / network / LLM

### Ownership & safety
- Owns ONLY facial params (brows, mouth shape, eye-smile, form, cheek)
- EyeOpen always MULTIPLY (neutral 1.0) — blink keeps running
- NEVER writes `ParamA` (lip-sync) or Stage 2 movement params
  (AngleX/Y/Z, BodyAngleX, EyeBallX/Y)

### Runtime order
Stage 3 facial hook is genuinely LAST in `LAppModel._update()` — after
motion/expression/drag/breath/physics/lip-sync/pose and after the Stage 2
movement hook — immediately before `_model.update()`, so its facial writes
survive the rest of the frame.

### Tests
- Stage 3: 16 unit tests incl. runtime-order overwrite-regression
- Regressions green: Stage 2 (16), Stage 1 (10), subtitle (5), display-text (2),
  integration (16)
- Production build PASS, git diff --check clean

### Files changed
- `src/renderer/src/utils/live2d-idle-facial.ts` — pure controller + palette
- `src/renderer/src/hooks/canvas/use-live2d-idle-facial.ts` — adapter + beacon
- `src/renderer/WebSDK/src/lapplive2dfacialhook.ts` — WebSDK hook registry
- `src/renderer/WebSDK/src/lappmodel.ts` — hook wiring (last in update)
- `src/renderer/src/components/canvas/live2d.tsx` — adapter mount
- `tests/live2d-idle-facial.test.ts` — unit + runtime-order tests
- `tests/live2d-idle-behavior.test.ts` (unchanged, regression)

### Debug instrumentation (temporary)
- `DEBUG_FACIAL_CYCLE=true` deterministic visual cycle
- `__facial_beacon` 404 URL logs per-state mouth targets, actual values,
  clamp bounds and delayed overwrite check
- To be removed before final release.