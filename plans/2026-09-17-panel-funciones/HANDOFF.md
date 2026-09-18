# HANDOFF — Funciones ▸ Utilidades (time scenes), phases F1 and F2 done

**Date:** 2026-09-18
**Branch:** `feat/funciones-utilidades` (branched off `main` at `8481322`)
**Plan:** [`utilidades.md`](utilidades.md) — read it before touching anything; it carries three
rounds of closed product decisions and the three-model architecture this code implements.
[`PLAN.md`](PLAN.md) has the five rules that bind all three Funciones tabs.

---

## 1. Executive summary

The Utilities tab of the Funciones panel is a finished feature **except for F3**. Saved "time
scenes" — a countdown by duration, a countdown to a time of day, a wall clock and a stopwatch —
preview, go live through the normal two-stage flow, draw themselves on the projector from an
absolute mark, and are now rows the operator owns: editable, reorderable, duplicable, deletable,
and unchanged across a restart.

- **F1 (the contract and the projector) — done and verified.** Four built-in scenes, `TimerClock`
  as an absolute mark, the exhaustive `selectOutput` case, the transport, history exclusion.
- **F2 (persistence and the editor) — done and verified.** `utility_scenes` + migration `0010`,
  a repository, six IPC channels, and the «Escenas» modal with a live 16:9 preview rendered by
  the projector's own `OutputView`.
- **F3 (a scene as an order-of-service item) — NOT started.** Fully specified at the end of
  `utilidades.md`; every decision it needs is already closed with the user.

Both phases were verified by **driving the real app**, not just the suite. Everything is
committed: five commits on this branch, each of which builds, and the working tree is clean.

What deliberately does not exist yet: `program_items.kind = 'utility'` and everything behind it
(the hand-written migration, the draft's dead-reference filter, the delete guard), and the
`utility:usages` channel — see §4.

---

## 2. Numbers / current state

Run from the repo root. These are the numbers to check against; they were confirmed on
2026-09-18, after the last commit:

```bash
npm run typecheck   # PASS (tsc over the node and web projects)
npm run lint        # 0 errors, 5 warnings
npm run test        # 13 files, 176 tests
npm run build       # electron-vite build, clean
git status          # clean
git log --oneline main..HEAD   # 5 commits
```

| Check | Expected | Note |
|---|---|---|
| `npm run test` | **176** passing, 13 files | **98** in `main`, **78** in `renderer` (`npx vitest run --project main`) |
| `npm run lint` | 0 errors, **5** warnings | all 5 pre-existing (`react-refresh/only-export-components` in `icon.tsx` ×1 and `i18n-provider.tsx` ×4). **A 6th is yours.** |
| `ls drizzle/*.sql \| wc -l` | **11**, last is `0010_utility_scenes.sql` | F2 added exactly one migration |
| `git log --oneline main..HEAD` | 5 commits, top is `d93caee` | see below |

Test count history: **113** before this feature → **147** after F1 → **176** after F2. The 29
cases F2 added are `tests/main/scene-validators.test.ts` (17), the `describe("Utility scenes")`
block in `tests/main/data-layer.test.ts` (5), `describe("The editor's two text fields")` in
`tests/main/timer.test.ts` (4) and `describe("editing the scene that is live")` in
`tests/renderer/select-output.test.ts` (3). `CLAUDE.md`'s command table says 176.

The five commits:

| | |
|---|---|
| `66e7292` | feat(functions): project countdowns, clocks and a stopwatch as time scenes — **F1** |
| `4ceb6d5` | docs(plans): close the utilities decisions and record the tick finding |
| `de0dd3e` | refactor(ui): promote the settings row primitives into the design system |
| `6d7f1fb` | feat(functions): persist time scenes and add the «Escenas» editor — **F2** |
| `d93caee` | docs: record the F2 rules and correct the CDP recipe's control-window match |

---

## 3. Data source / environment

- **macOS, single monitor.** This matters and is not incidental: with one display the projection
  window is an ordinary 800×600 window that the control window covers, so
  `document.visibilityState` is `"hidden"` and Chromium throttles its timers. That is the exact
  condition the tick design defends against — see
  [`a-self-drawing-clock-must-not-derive-its-own-dependency.md`](../../.claude/knowledge/a-self-drawing-clock-must-not-derive-its-own-dependency.md).
- **LibreOffice is irrelevant to this feature.** Nothing here touches the slides pipeline.
- **Database.** F2 adds the first migration of the feature, `drizzle/0010_utility_scenes.sql`
  (one `CREATE TABLE` plus one index). It is purely additive — nothing existing is altered — so
  the user's real database only gains a table, four seeded rows and one `settings` row on its
  next launch. **All verification ran against a throwaway profile**, so the real library was
  never opened; there is nothing to roll back.

**How to confirm the environment is the right/fresh one**, on a throwaway profile:

```js
// in the CONTROL window, over CDP or the devtools console
(await window.worship.invoke("utility:list", undefined)).data.length          // → 4
(await window.worship.invoke("settings:get", undefined)).data["utility.seeded"] // → true
```

Four scenes and `utility.seeded === true` means migration 0010 ran and the seed fired exactly
once. On the user's own profile the count will be whatever they have left it at — the flag is
what says the seed already happened, never the row count (see §4, bug 2).

---

## 4. Bugs found & fixes

Three real defects surfaced this session. Two were found only by driving the app; the suite was
green throughout.

### B1 — «Guardar» was permanently disabled for a brand-new scene

- **Root cause.** The save button was gated on `dirty`, computed as
  `JSON.stringify(draft) !== JSON.stringify(baseline)`. On «Nueva escena» the modal sets
  `baseline = draft` (the same fresh object), so a scene that does not exist yet can never be
  dirty and the button was dead from birth. Creating a scene was impossible.
- **Fix.** A separate gate, in
  `src/renderer/src/components/pages/functions/ScenesModal.tsx`:
  `canSave = isDraftSavable(draft) && (sceneId === null || dirty)`. `dirty` keeps its own meaning
  and still drives the discard guard and «Deshacer cambios».
- **Gotcha for reproduction.** The suite cannot see this: it is a disabled attribute on a button,
  not a wrong value. It showed up on the first UI-driven create attempt as `DISABLED: Guardar`.

### B2 — re-seeding would have resurrected deleted scenes (caught in design, before shipping)

- **Root cause.** The plan's own wording was "seed the four `DEFAULT_UTILITY_SCENES` when the
  table is empty". That makes an operator who deletes a scene find it back on the next launch,
  and makes deleting all four impossible.
- **Fix.** The seed is guarded by `settings["utility.seeded"]`, a flag, never a row count —
  `src/main/db/seed/seed-utility-scenes.ts`. Confirmed by the user as a decision before
  implementing (third round of decisions in `utilidades.md`) and covered by two tests.

### B3 — the recorded CDP recipe matched the wrong window

- **Root cause.** `.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md`
  prescribed identifying the control window with
  `url.startsWith("http://localhost:5173/")`. The projector's url is
  `http://localhost:5173/projection.html`, which **passes that check**. A driver taking the first
  match read the projector's DOM while sending clicks meant for the control window; every query
  came back empty and the panel looked unmounted, twice, before the url was printed.
- **Fix.** The knowledge entry now says to match by url **equality**
  (`url === "http://localhost:<port>/"`), and not to hardcode the port: a stale dev server
  holding 5173 makes Vite take **5174** silently, so read it out of the dev log
  (`grep -o "localhost:517[0-9]"`).
- **Why it matters beyond this session.** Every future UI probe of this app hits it.

### Gotchas already handled — do NOT "simplify" them away

The six from F1 still hold (the tick's memo key is today's midnight, a countdown rounds up while
a stopwatch rounds down, `backgroundThrottling` is deliberately left alone, timers are excluded
from `projection_history`, and above all **nothing that touches `base.clock` may call
`beginScene()`**). F2 adds two:

1. **`setLiveScene` must stay a `base` patch.** Routing an edit through `setBase` would reset
   `videoPaused`/`videoVolume` and mean "something new is live"; calling `beginScene()` would
   cross-fade the projector into a near-identical copy of itself mid-service, and restart the
   count. Three tests in `select-output.test.ts` assert the epoch and the mark do not move.
2. **Validate on write, normalize field by field on read — not the same function.** The validator
   (`isUtilitySceneUpsert`) is strict because the operator is still looking at the form; the
   normalizer (`normalizeSceneStyle`) is forgiving because the row is already stored and has to
   be shown anyway. A test asserts every normalizer output passes the validator.

One deliberate omission: **`utility:usages` was not added.** Nothing references a scene until
F3's foreign key exists, so the channel could only ever answer `[]`. It arrives with the thing it
is meant to look at.

---

## 5. Runbook

### 5.1 Where the code lives

| Layer | File | What it is |
|---|---|---|
| shared | `types/timer.ts`, `types/scene-style.ts`, `types/utility.ts` | the three models (F1) |
| shared | `timer.ts` | every time calculation, pure `(clock, now)`; F2 appended the four parsers |
| shared | `scene-validators.ts` | one predicate per field + the normalizers |
| main | `db/schema.ts`, `drizzle/0010_utility_scenes.sql` | `tool` as a column, `config_json`/`style_json` as JSON |
| main | `db/repositories/utility.repo.ts` | CRUD + `reorder` (one `json_each` statement) + `insertMany` |
| main | `db/seed/seed-utility-scenes.ts` | seeds the four defaults once, flag-guarded |
| main | `ipc/handlers/utility.ts` | six channels, every write validated |
| renderer | `stores/utility.store.ts` | the scenes mirror + the ONE armed timer (`TimerRun`) |
| renderer | `stores/projection.store.ts` | `setTimerClock` + `setLiveScene`, both `base` patches |
| renderer | `lib/actions/utility.ts` | transport + `loadScenes`/`saveScene`/`duplicateScene`/`deleteScene`/`reorderScenes` |
| renderer | `lib/utility-output.ts` | `timerOutputFor` — shared by `selectOutput` AND both previews |
| renderer | `components/shared/timer-scene.tsx` | what the projector actually paints |
| renderer | `components/ui/field.tsx`, `ui/color-field.tsx` | `FieldGroup`/`FieldRow`, `ColorField` |
| renderer | `components/pages/functions/` | `utilities-panel`, `timer-transport`, `ScenesModal`, `scene-form`, `scene-draft`, `scene-preview` |
| renderer | `lib/hooks/use-timer-now.ts`, `use-local-fonts.ts` | the self-correcting tick; `queryLocalFonts()` with a real fallback |

### 5.2 Verify F2 still works before starting F3

The suite does not prove the thing that matters — that editing a LIVE scene changes the projector
**without a transition and without restarting the count**. Drive the real app.

```bash
SCRATCH=/tmp/worship-verify && mkdir -p "$SCRATCH/profile"
npx electron-vite dev -- --remote-debugging-port=9222 --user-data-dir="$SCRATCH/profile"
# read the actual port out of the output — it is NOT always 5173
```

Read the CDP recipe in
[`occluded-electron-window-has-no-rendering-lifecycle.md`](../../.claude/knowledge/occluded-electron-window-has-no-rendering-lifecycle.md)
first — it now carries both traps from §4/B3, plus the rule that an occluded window needs a
forced frame (`Page.captureScreenshot`) between changing state and measuring.

Then, in order:

1. Funciones ▸ Utilidades → the four seeded scenes are listed → click «Cuenta 10 minutos» →
   **EN VIVO**.
2. Wait 3 s. The projector's number must have decreased by exactly 3.
3. Mark the projector's scene layer, so a transition becomes observable:
   ```js
   const big = document.querySelector("p.leading-none");
   big.dataset.probe = "number";
   big.closest("div.absolute.inset-0").dataset.probe = "layer";
   ```
4. **The F2 gate.** «Escenas…» → select the live scene → change its top line → **Guardar**. The
   projector must show the new text, **the marked element must still be there** (a transition
   would have mounted a new layer and dropped it), and the count must not restart.
5. Change its colour with `ColorField` and its vertical align — both must reach the projector
   live, with the count still running.
6. Restart the app: the edits are still there and the seed has NOT run again (still 4 scenes).
7. Delete every scene and restart: the list stays empty and the panel shows its empty state.

**Measured on 2026-09-18:** `08:32 → 08:31` across the edit, same layer element, new title;
then `rgb(205, 73, 0)` (Campfire) and `flex-start` on the projector with the count still running;
the row reading `{ title: "EMPEZAMOS EN", color: "#cd4900", align: "top" }` after a full restart;
create → 5 scenes, tool change countdown→stopwatch persisted, delete → 4; drag reorder persisted
(`Cronómetro` moved to the top); wipe + restart → 0 scenes and the empty state.

The **F1 gate** still applies and is cheaper to re-check: with a countdown live, run
`window.worship.invoke("projection:close")` then
`window.worship.invoke("projection:open", { displayId })`. **The count must CONTINUE**, not
restart.

---

## 6. Pending / next steps

### F3 — the scene as an order-of-service item (the only thing left in Utilidades)

Every decision it needs is already closed. In order:

1. **The migration, by hand.** `program_items.kind = 'utility'` + `utility_scene_id` (FK
   `ON DELETE restrict`). The table's `CHECK` constraint is **invisible to Drizzle**, so this is a
   table rebuild written by hand — copy `drizzle/0009_drop_text_program_items.sql`, which did
   exactly this (new table, copy, drop, rename, index), and widen the `CHECK` to three branches.
   See [`sqlite-table-rename-must-alter-not-recreate.md`](../../.claude/knowledge/sqlite-table-rename-must-alter-not-recreate.md).
2. `PROGRAM_ITEM_KINDS`, the DTO/upsert variants, `toItemDTO`/`toRow`.
3. **`DraftRepo`'s dead-reference filter**: generalize `withLiveAssetsOnly` to cover scenes too,
   or a draft row pointing at a deleted scene comes back as a tile that can neither preview nor
   explain itself.
4. `use-program-item-display`, the schedule row, the `goLiveWithScheduleItem` case,
   `usePreviewContent`.
5. **The delete guard.** A NEW `utility:usages` channel plus a confirmation that names the
   programs, modelled on `library:remove`'s `force` path. Note that an FK `restrict` rejection
   arrives as `SQLITE_CONSTRAINT_TRIGGER` and **a `void asyncCall()` swallows it** — see
   [`fk-restrict-delete-is-silently-swallowed.md`](../../.claude/knowledge/fk-restrict-delete-is-silently-swallowed.md).

**F3 gate:** save a program with a scene, close the app, reopen it, load the program and send the
scene live. And deleting a scene that a saved program uses must name the program before it
destroys anything.

### After F3

`PLAN.md`'s order stands: **Overlays** next (it reuses `SceneStyle`, `ColorField` and the
`FieldGroup`/`FieldRow` pair that F2 already built), then **Entradas**, which is larger by an
order of magnitude and has its own plan and its own spike gate.

### Open questions for the user

1. **Merge this branch, or keep stacking F3 on it?** Five commits, each of which builds, tree
   clean.
2. **`/HANDOFF.md` at the repo root is stale.** It belongs to the 2026-09-08 video↔PPT hang,
   whose work is merged and whose findings already graduated to `.claude/knowledge/`. Two
   handoffs invite the next session to read the wrong one. Delete it, or move it under its own
   plan folder? *(Raised at the end of F1, still unanswered.)*
3. **Badge colour for utilities.** The list still uses the `neutral` badge: every ALPS hue is
   already taken by another content type, and inventing one outside the palette is against the
   rules in `docs/knowledge/06-ui-and-theme.md`. Say so if you want a dedicated colour and it
   becomes a token. *(Same.)*
