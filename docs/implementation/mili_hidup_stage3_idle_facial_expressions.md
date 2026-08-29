# Mili Hidup — Stage 3: Autonomous Idle Facial Expressions

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