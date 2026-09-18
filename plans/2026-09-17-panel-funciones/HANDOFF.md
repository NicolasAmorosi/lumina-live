# HANDOFF — Funciones ▸ Utilidades (time scenes), phase F1 done

**Date:** 2026-09-18
**Branch:** `feat/funciones-utilidades` (branched off `main` at `8481322`)
**Plan:** [`utilidades.md`](utilidades.md) — read it before touching anything; it carries the
closed product decisions and the three-model architecture this code implements.
**Nothing is committed.** 34 files, +2199/−151, all in the working tree.

---

## Executive summary

The Utilities tab of the new Funciones panel now works end to end: four saved "time scenes"
(duration countdown, countdown to a time of day, wall clock, stopwatch) that preview, go live
through the normal two-stage flow, and draw themselves on the projector from an absolute mark.

**F1 is done and verified against the real projector**, not just against the test suite. **F2
(persistence + the scene editor) and F3 (a scene as an order-of-service item) are not started** —
their scope is fully specified in `utilidades.md` and every decision they need is already closed
with the user.

What F1 deliberately does NOT have yet: no database (the four scenes are built-in constants), no
editor (nothing is configurable from the UI), no background image (the type exists and
`selectOutput` resolves it, but nothing can set one), no program item.

---

## Current state — numbers, and the check that confirms them

Run from the repo root:

```bash
npm run typecheck   # PASS (tsc over node + web projects)
npm run lint        # 0 errors, 5 warnings — ALL 5 pre-existing (react-refresh/only-export-components
                    # in icon.tsx and i18n-provider.tsx). If you see a 6th, it is yours.
npm run test        # 12 files, 147 tests: 72 in `main`, 75 in `renderer`
npm run build       # electron-vite build, clean
```

`147` is the number to check against: it was **113** before this session. The 34 new cases are
`tests/main/timer.test.ts` (27) and the `describe` blocks appended to
`tests/renderer/select-output.test.ts` (7).

`CLAUDE.md`'s command table was updated from the stale "103 casos" to 147 in the same session.

---

## Environment

- macOS, single monitor. **This matters:** with one display the projection window is an ordinary
  800×600 window that the control window covers, so `document.visibilityState` is `"hidden"` and
  Chromium throttles its timers. That is the exact condition the tick design defends against —
  see the knowledge entry below.
- LibreOffice is irrelevant to this feature; nothing here touches the slides pipeline.
- No migrations were added, so **the user's real database is untouched** and there is nothing to
  roll back. F2 is what introduces the first migration (`utility_scenes`).

---

## The architecture, in one screen

Three separate models. Confusing them is the mistake the plan exists to prevent.

| Type | File | Who uses it |
|---|---|---|
| `TimerClock` | `src/shared/types/timer.ts` | **only** the projector: an absolute mark (`endsAtMs`/`startedAtMs`) plus `running`/`held` |
| `TimerConfig` | same file | the control window: duration, target minute of day, end message, `TimerFormat` |
| `SceneStyle` | `src/shared/types/scene-style.ts` | shared, and **meant to be reused** by Overlays and by the Bible/text projection settings that are debt today |

Two collapses that fell out of it and must not be undone:

- `"held"` means both *paused* and *not started yet*. The projector draws them identically; only
  the control window needs the difference, and it keeps it in `TimerRun.started`
  (`src/renderer/src/stores/utility.store.ts`).
- `countdown` and `countdown-to-time` are the **same** `TimerClock` variant. The control resolves
  "today at 10:00" into a mark; the projector never learns there was a difference.

**The invariant everything rests on:** while a countdown runs, the `ProjectionOutput` does not
change. Zero IPC pushes, zero history rows, zero scene transitions. There is a test for it
(`"a running countdown produces no new output as time passes"`).

---

## Files

New:

```
src/shared/types/timer.ts            TimerClock / TimerFormat / TimerConfig / TIMER_TOOLS
src/shared/types/scene-style.ts      SceneBackground / SceneTextStyle / SceneStyle + cssFontFamily, cssSceneBackground
src/shared/types/utility.ts          UtilityScene, UtilitySceneUpsert, UtilitySceneUsage, DEFAULT_UTILITY_SCENES
src/shared/timer.ts                  every time calculation, pure (clock, now) — no deps at all
src/renderer/src/stores/utility.store.ts          scenes + the ONE armed timer (TimerRun)
src/renderer/src/lib/utility-output.ts            timerOutputFor(scene, clock) — shared by selectOutput AND the preview
src/renderer/src/lib/actions/utility.ts           startTimer / resetTimer / toggleTimer (+ syncs the live clock)
src/renderer/src/lib/hooks/use-timer-now.ts       the self-correcting tick
src/renderer/src/components/shared/timer-scene.tsx        what the projector paints
src/renderer/src/components/pages/functions/              utilities-panel, timer-transport, tool-display
tests/main/timer.test.ts                                   27 cases
.claude/knowledge/a-self-drawing-clock-must-not-derive-its-own-dependency.md
```

Touched (all small, all additive): `projection.ts` (two new variants), `projection.store.ts`
(`case "utility"` + `setTimerClock`), `preview.store.ts`, `use-preview.ts`, `playback.ts`
(`goLiveWithUtilityScene`), `preview.ts`, `use-live.ts`, `output-view.tsx`, `functions-tabs.tsx`,
`SlidesPanel.tsx`, `live-media-panel.tsx`, `media-track-row.tsx`, `icon.tsx` (3 icons),
`es.ts`, `history.repo.ts`.

---

## Gotchas that are already handled — do not "simplify" them away

1. **Nothing that touches `base.clock` may call `beginScene()`.** Pausing is not a new scene;
   bumping the epoch would cross-fade the projector into an almost identical copy of itself,
   mid-service. `setTimerClock` patches `base` in place, exactly like `setVideoResumeAt`.
2. **`clockForScene(run, scene, now)` takes `now` as a parameter.** It used to read `Date.now()`
   inside, which made `TimerTransport` a hot render loop. Full diagnosis in the new knowledge
   entry; the summary is that a component which both derives its clock in render and ticks on it
   re-arms its own effect forever. The memo key is today's midnight, not the current instant.
3. **The tick is scheduled to the next boundary of its own value** (`msUntilNextTick`), never to
   the wall-clock second, and it returns `null` when the text can never change again.
4. **A countdown rounds up, a stopwatch rounds down.** Both directions have tests; flipping
   either one is visible on the first frame.
5. **`backgroundThrottling` is deliberately left alone.** The value is always recomputed from a
   fresh `Date.now()` and re-synced on `visibilitychange`, so a throttled window can only show a
   stale number while nobody is looking at it. Turning throttling off has a known blank-window
   bug (electron#42378).
6. **A timer is excluded from `projection_history`** (`history.repo.ts`) — otherwise every pause
   and resume writes a row carrying a whole serialized scene.

---

## Runbook — how to confirm F1 still works before starting F2

The unit tests do not prove the thing that matters (that a rebuilt projection window continues
the count). Drive the real app:

```bash
SCRATCH=/tmp/worship-verify && mkdir -p "$SCRATCH/profile"
npx electron-vite dev -- --remote-debugging-port=9222 --user-data-dir="$SCRATCH/profile"
```

Then, by hand (or with a CDP driver — the recipe is in
`.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`; note the control
window's dev-server port was **5174**, not 5173, and `window.worship.invoke` returns
`{ ok, data }`, so unwrap `.data`):

1. Funciones ▸ Utilidades → click "Cuenta 10 minutos" → EN VIVO.
2. Wait 3 s. The projector must have decreased by exactly 3.
3. `window.worship.invoke("projection:close")`, then
   `window.worship.invoke("projection:open", { displayId })`. **The count must CONTINUE**, not
   restart. This is the F1 gate.
4. NEGRO → the projector goes fully black and the count keeps running underneath. Uncover → the
   number is the one for the elapsed time, not the one from when it was covered.
5. Both control monitors must read the same number as the projector.

Measured on 2026-09-18: `09:34 → 09:31` (3 s) `→ 09:29` (after the close+reopen) `→ 09:25`
(after ~4 s under NEGRO), with both monitors at `09:25`. The countdown to a time of day resolved
`9:40:46` at 00:19; the stopwatch counted to `00:02` and froze there when paused.

---

## Next steps, in order

### F2 — persistence + the «Escenas» editor modal (start here)

All product decisions are closed (see the decisions table in `utilidades.md`). In order:

1. **Table + repo.** `utility_scenes` (`id`, `name`, `tool` as a column, `config_json`,
   `style_json`, `title`, `message`, `sort_order`, timestamps) in `src/main/db/schema.ts`, then
   `npm run db:generate`. Repo modelled on `programs.repo.ts` — copy its `topSortOrder()` and its
   `json_each` reorder. **Parse defensively on read**: a corrupt `config_json` must fall back
   field by field to the defaults, never throw at startup (same discipline as `DraftRepo.load`).
2. **`src/shared/scene-validators.ts`** — one predicate per field, `Record<keyof SceneStyle, …>`
   so a new field cannot be added without a validator, mirroring `SETTINGS_VALIDATORS`. Main
   validates on write; the editor reuses the same predicates.
3. **IPC**: `utility:list|create|update|delete|duplicate|reorder|usages` via `/add-ipc`. Seed the
   four `DEFAULT_UTILITY_SCENES` when the table is empty, then have `utility.store.setScenes()`
   fill from `utility:list` instead of the constant. The store's shape does not change.
4. **The editor**: `components/pages/functions/ScenesModal.tsx`, `Modal size="2xl" height="tall"`,
   scene list on the left, grouped rows on the right, and a 16:9 live preview at the top rendered
   with the **same `OutputView`**. Promote `SettingsGroup`/`SettingsRow` out of `pages/settings/`
   into `components/ui/` as `FieldGroup`/`FieldRow` (second consumer = the reuse rule fires) and
   update the four settings sections' imports.
5. **New primitives**: `ColorField` (swatches from the ALPS palette in
   `docs/knowledge/06-ui-and-theme.md`, plus a custom hex) and a font picker over
   `queryLocalFonts()` — always allowed in Electron, but guard for its absence and warn when a
   scene's stored family is no longer installed. `cssFontFamily()` already sanitizes and falls
   back; do not bypass it.
6. **Editing a live scene** needs a `setLiveScene(scene)` next to `setTimerClock` — patch `base`
   in place, no `beginScene()`. It was deliberately left out of F1 rather than shipped dead.

**F2 gate:** editing the scene that is EN VIVO updates the projector without running a scene
transition and without restarting the count.

### F3 — the scene as an order-of-service item

`program_items.kind = 'utility'` + `utility_scene_id` (FK `ON DELETE restrict`). **The `CHECK`
constraint is invisible to Drizzle**, so this is a hand-written table rebuild — copy
`drizzle/0009_drop_text_program_items.sql`, which did exactly this. Then `PROGRAM_ITEM_KINDS`,
the DTO/upsert variants, `toItemDTO`/`toRow`, `DraftRepo`'s dead-reference filter (generalize
`withLiveAssetsOnly` to cover scenes), `use-program-item-display`, the schedule row, the
`goLiveWithScheduleItem` case, `usePreviewContent`, and a delete guard with `usages` modelled on
`library:remove`'s `force` path.

**F3 gate:** save a program with a scene, restart the app, load it, send it live. Deleting a
scene a saved program uses must name the program before it destroys anything.

---

## Open questions for the user

1. **Commit now or keep accumulating?** Nothing is committed. The natural split is two commits:
   `feat(functions): project countdowns, clocks and a stopwatch as saved time scenes` and
   `docs(plans): close the utilities decisions and record the tick finding`.
2. **`/HANDOFF.md` at the repo root is stale** — it belongs to the 2026-09-08 video↔PPT hang,
   whose work is merged and whose findings already graduated to `.claude/knowledge/`. Two
   handoffs invite the next session to read the wrong one. Delete it, or move it under its own
   plan folder?
3. **Badge colour for utilities.** The list uses the `neutral` badge: every ALPS hue is already
   taken by another content type, and inventing one outside the palette is against the rules in
   `docs/knowledge/06-ui-and-theme.md`. Say so if you want a dedicated colour and it becomes a
   token.
