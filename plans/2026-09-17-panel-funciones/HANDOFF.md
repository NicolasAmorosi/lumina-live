# HANDOFF — Funciones ▸ Utilidades (time scenes), phases F1 and F2 done

**Date:** 2026-09-18
**Branch:** `feat/funciones-utilidades` (branched off `main` at `8481322`)
**Plan:** [`utilidades.md`](utilidades.md) — read it before touching anything; it carries the
closed product decisions (three rounds now) and the three-model architecture this code implements.
**Everything is committed**, in four commits on this branch.

---

## Executive summary

The Utilities tab of the Funciones panel is a finished feature except for F3. Saved time scenes —
four seeded on first launch, editable, reorderable, duplicable, deletable — preview, go live
through the normal two-stage flow, draw themselves on the projector from an absolute mark, and
survive a restart.

**F2 is done and verified against the real projector**, not just against the test suite. **F3 (a
scene as an order-of-service item) is not started**; its scope is fully specified at the end of
`utilidades.md` and every decision it needs is already closed.

What still does not exist: `program_items.kind = 'utility'` and everything behind it (the
hand-written migration, the draft's dead-reference filter, the delete guard with `usages`). There
is also deliberately no `utility:usages` channel yet — see the note below.

---

## Current state — numbers, and the check that confirms them

Run from the repo root:

```bash
npm run typecheck   # PASS (tsc over node + web projects)
npm run lint        # 0 errors, 5 warnings — ALL 5 pre-existing (react-refresh/only-export-components
                    # in icon.tsx and i18n-provider.tsx). If you see a 6th, it is yours.
npm run test        # 13 files, 176 tests: 98 in `main`, 78 in `renderer`
npm run build       # electron-vite build, clean
```

`176` is the number to check against: it was **147** at the end of F1 and **113** before this
whole feature. The 29 new cases are `tests/main/scene-validators.test.ts` (17), the
`describe("Utility scenes")` block appended to `tests/main/data-layer.test.ts` (5), the
`describe("The editor's two text fields")` block in `tests/main/timer.test.ts` (4) and the
`describe("editing the scene that is live")` block in `tests/renderer/select-output.test.ts` (3).

`CLAUDE.md`'s command table was updated from 147 to 176 in the same session.

---

## Environment

- macOS, single monitor. Still the condition the tick design defends against — see the F1 notes in
  git history and the knowledge entry on occluded windows.
- LibreOffice is irrelevant to this feature.
- **This phase adds the first migration of the feature**, `drizzle/0010_utility_scenes.sql`
  (CREATE TABLE + one index). It is additive: nothing existing is touched, and the user's real
  database only gains a table plus four seeded rows and one `settings` row on next launch. All
  verification below ran against a **throwaway profile**, so the real library was never opened.

---

## What F2 added, in one screen

| Layer | File | What it is |
|---|---|---|
| shared | `scene-validators.ts` | one predicate per field (`Record<keyof …>`), plus `normalizeSceneStyle`/`normalizeTimerConfig` |
| shared | `timer.ts` (appended) | `parseDuration`/`formatDuration`/`parseMinuteOfDay`/`formatMinuteOfDay` — the editor's two text fields |
| main | `db/schema.ts` + `drizzle/0010_utility_scenes.sql` | the table: `tool` as a column, `config_json`/`style_json` as JSON |
| main | `db/repositories/utility.repo.ts` | CRUD + `reorder` (`json_each`, one statement) + `insertMany`, defensive parse on read |
| main | `db/seed/seed-utility-scenes.ts` | seeds the four defaults ONCE, guarded by `settings["utility.seeded"]` |
| main | `ipc/handlers/utility.ts` | six channels, every write validated with `isUtilitySceneUpsert` |
| renderer | `stores/utility.store.ts` | `scenes` is now a MIRROR of the table; `setScenes` drops an armed timer whose scene is gone |
| renderer | `stores/projection.store.ts` | `setLiveScene` — patches `base.scene` in place, no `beginScene()` |
| renderer | `lib/actions/utility.ts` | `loadScenes`/`saveScene`/`duplicateScene`/`deleteScene`/`reorderScenes` |
| renderer | `components/ui/field.tsx` | `FieldGroup`/`FieldRow`, promoted out of `pages/settings/` |
| renderer | `components/ui/color-field.tsx` | `ColorField`: ALPS swatches + native picker + hex, portalled |
| renderer | `components/pages/functions/` | `ScenesModal`, `scene-form`, `scene-draft`, `scene-preview` |
| renderer | `lib/hooks/use-local-fonts.ts` | `queryLocalFonts()` with a real fallback |

---

## Gotchas that are already handled — do not "simplify" them away

The six from F1 all still hold (the tick's memo key, the rounding asymmetry, `backgroundThrottling`,
the history exclusion, and above all **nothing that touches `base.clock` may call `beginScene()`**).
F2 adds four:

1. **`setLiveScene` is the F2 gate, and it must stay a `base` patch.** Routing an edit through
   `setBase` would reset `videoPaused`/`videoVolume` and mean "something new is live"; calling
   `beginScene()` would cross-fade the projector into a near-identical copy of itself mid-service.
   Three tests in `select-output.test.ts` assert the epoch and the mark do not move.
2. **Validate on write, normalize field by field on read — they are not the same function.** The
   validator is strict because the operator is still looking at the form; the normalizer is
   forgiving because the row is already stored and has to be shown anyway. There is a test
   asserting every normalizer output passes the validator.
3. **The seed is guarded by a flag, never by a row count.** "Seed when the table is empty" would
   resurrect a scene the operator deleted. Tested both ways.
4. **Save is gated by `canSave`, not by `dirty`.** A brand new scene has nothing to differ from, so
   the `dirty` gate left the button permanently dead — found by driving the real app, not by the
   suite. `dirty` keeps its own meaning for the discard guard and «Deshacer cambios».

And one non-obvious call: **`utility:usages` was deliberately NOT added.** Nothing references a
scene until F3's FK exists, so the channel could only ever answer `[]`. It arrives with the thing
it is meant to look at.

---

## Runbook — how to confirm F2 still works before starting F3

The suite does not prove the thing that matters (that editing a LIVE scene changes the projector
without a transition and without restarting the count). Drive the real app:

```bash
SCRATCH=/tmp/worship-verify && mkdir -p "$SCRATCH/profile"
npx electron-vite dev -- --remote-debugging-port=9222 --user-data-dir="$SCRATCH/profile"
```

Then, by hand or with a CDP driver. **Read the recipe in
`.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md` first** — it now
includes the two traps that cost time this session: the control window must be matched by url
EQUALITY (`http://localhost:<port>/`), because the projector's url passes a `startsWith`, and the
port is not always 5173 (a stale server pushes Vite to 5174 — read it out of the dev log).

1. Funciones ▸ Utilidades → the four seeded scenes are listed → «Cuenta 10 minutos» → EN VIVO.
2. Wait 3 s: the projector must have decreased by exactly 3.
3. Mark the projector's scene layer (`document.querySelector("p.leading-none").closest("div.absolute.inset-0").dataset.probe = "layer"`).
4. «Escenas…» → change the scene's top line → Guardar. **The projector must show the new text, the
   marked element must still be there (no transition), and the count must not restart.** This is
   the F2 gate.
5. Change its colour with `ColorField` and its vertical align → both reach the projector live.
6. Restart the app: the edits are still there, and the seed has NOT run again (still 4 scenes).
7. Delete every scene, restart: the list stays empty and the panel shows its empty state.

Measured on 2026-09-18: `08:32 → 08:31` across the edit with the same layer element and the new
title; then `rgb(205, 73, 0)` + `flex-start` on the projector with the count still running; the row
in the database reading `{ title: "EMPEZAMOS EN", color: "#cd4900", align: "top" }` after a full
restart; create → 5 scenes, tool change countdown→stopwatch persisted, delete → 4; drag reorder
persisted (`Cronómetro` moved to the top); wipe + restart → 0 scenes and the empty state.

---

## Next step — F3, the scene as an order-of-service item

Unchanged from the F1 handoff, and every decision it needs is closed:

`program_items.kind = 'utility'` + `utility_scene_id` (FK `ON DELETE restrict`). **The `CHECK`
constraint is invisible to Drizzle**, so this is a hand-written table rebuild — copy
`drizzle/0009_drop_text_program_items.sql`, which did exactly this. Then `PROGRAM_ITEM_KINDS`, the
DTO/upsert variants, `toItemDTO`/`toRow`, `DraftRepo`'s dead-reference filter (generalize
`withLiveAssetsOnly` to cover scenes), `use-program-item-display`, the schedule row, the
`goLiveWithScheduleItem` case, `usePreviewContent`, and a delete guard built on a NEW
`utility:usages` channel, modelled on `library:remove`'s `force` path.

**F3 gate:** save a program with a scene, restart the app, load it, send it live. Deleting a scene
a saved program uses must name the program before it destroys anything.

---

## Open questions for the user

1. **`/HANDOFF.md` at the repo root is stale** — it belongs to the 2026-09-08 video↔PPT hang, whose
   work is merged and whose findings already graduated to `.claude/knowledge/`. Two handoffs invite
   the next session to read the wrong one. Delete it, or move it under its own plan folder? (Asked
   at the end of F1, still unanswered.)
2. **Badge colour for utilities.** The list still uses the `neutral` badge: every ALPS hue is taken
   by another content type, and inventing one outside the palette is against the rules in
   `docs/knowledge/06-ui-and-theme.md`. Say so if you want a dedicated colour and it becomes a
   token. (Same.)
3. **Merge this branch, or keep stacking F3 on it?** Four commits, each of which builds.
