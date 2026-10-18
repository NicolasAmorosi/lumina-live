# HANDOFF — Funciones ▸ Utilidades (time scenes), COMPLETE (F1, F2, F3, F4, F5)

**Date:** 2026-09-18 (numbers refreshed 2026-09-24)
**Branch:** `feat/funciones-utilidades` (branched off `main` at `8481322`)
**Plan:** [`utilidades.md`](utilidades.md) — read it before touching anything; it carries three
rounds of closed product decisions and the three-model architecture this code implements.
[`PLAN.md`](PLAN.md) has the five rules that bind all three Funciones tabs.

---

## 1. Executive summary

The Utilities tab of the Funciones panel is **finished**. Saved "time scenes" — a countdown by
duration, a countdown to a time of day, a wall clock and a stopwatch — preview, go live through
the normal two-stage flow, draw themselves on the projector from an absolute mark, are rows the
operator owns (editable, reorderable, duplicable, deletable, unchanged across a restart), and are
now rows of the **order of service** like any other content.

- **F1 (the contract and the projector) — done and verified.** Four built-in scenes, `TimerClock`
  as an absolute mark, the exhaustive `selectOutput` case, the transport, history exclusion.
- **F2 (persistence and the editor) — done and verified.** `utility_scenes` + migration `0010`,
  a repository, six IPC channels, and the «Escenas» modal with a live 16:9 preview rendered by
  the projector's own `OutputView`.
- **F3 (a scene as an order-of-service item) — done and verified.** `program_items.kind =
  'utility'` + migration `0011` (a hand-written table rebuild), the DTO/upsert variants, the
  draft's dead-reference filter generalized to scenes, the schedule row, the preview branch, the
  go-live branch, and the delete guard (`utility:usages` + a forced delete).
- **F4 (the transport on the media row) — done, suite-verified, real-app pass pending.** The
  transport left the Utilities tab for `UtilityTrackRow`, the same row in the PREVIEW bar and in
  the LIVE media panel: value, start/pause, restart, and a draggable bar for a countdown by
  duration. `clockForScene` now reads the projector's copy first and `commitClock` decides where
  a gesture lands, which is what keeps two rows for one scene showing one number. The list row
  keeps the running value and a single STOP (`scene-readout.tsx`); `timer-transport.tsx` is gone.
  See the fourth round of decisions in [`utilidades.md`](utilidades.md).

- **F5 (the three aesthetic adjustments asked for on 2026-09-18) — done, suite-verified, real-app
  pass pending.** (a) EN VIVO now starts a countdown **where the PREVIEW bar was left**
  (`ensureStarted` resumes the armed clock instead of rebuilding it — the same promise a video's
  preview scrub makes through `startAtSeconds`); (b) the Utilities list no longer paints the
  on-air rail (`ListRow`'s new `rail` prop) — the live row already shows a running clock;
  (c) a whole **«Al terminar la cuenta»** group: the end message, its own `SceneTextStyle`, and
  two opt-in hides for the number and the title — `SceneStyle.end` (`SceneEnd`), validated,
  normalized, drawn by `TimerScene`, and previewable in the editor with the «Ver como termina»
  switch.

F1–F3 were verified by **driving the real app**, not just the suite. F4 and F5 are only
suite-verified: the CDP port was not reachable from the session that wrote them, so **their
manual pass against the real projector is still owed**.

**The branch carries more than Utilidades.** Between 2026-09-18 and 2026-09-22, five unrelated
features were built on this same branch in separate sessions. They were committed on 2026-09-24,
one commit per feature, and each commit passes `typecheck`, `lint` and `test` on its own:
settings (volume, per-kind picker folders, removing the logo), PDF decks, slide-embedded video,
Bible (verse style, format importer, version manager), and 4K video performance. None of them
belongs to this plan. Each has its own entries in `docs/knowledge/` and `.claude/knowledge/`.

Nothing of Utilidades is left. The next thing in `PLAN.md` is **Overlays**, which reuses
`SceneStyle`, `ColorField` and the `FieldGroup`/`FieldRow` pair this feature built.

---

## 2. Numbers / current state

Run from the repo root. These are the numbers to check against; they were confirmed on
2026-09-24, after the last commit:

```bash
npm run typecheck   # PASS (tsc over the node and web projects)
npm run lint        # 0 errors, 5 warnings
npm run test        # 20 files, 280 tests
npm run build       # electron-vite build, clean
git status          # clean
git log --oneline main..HEAD   # 13 commits
```

| Check | Expected | Note |
|---|---|---|
| `npm run test` | **280** passing, 20 files | **169** in `main` (11 files), **111** in `renderer` (9 files) (`npx vitest run --project main`) |
| `npm run lint` | 0 errors, **5** warnings | all 5 pre-existing (`react-refresh/only-export-components` in `icon.tsx` ×1 and `i18n-provider.tsx` ×4). **A 6th is yours.** |
| `ls drizzle/*.sql \| wc -l` | **14**, last is `0013_bible_version_sort_order.sql` | F2 and F3 added `0010`/`0011`; `0012` (slide video) and `0013` (Bible sort order) are the other features' |
| `git log --oneline main..HEAD` | 13 commits | see below |

Test count history: **113** before this feature → **147** after F1 → **176** after F2 → **181**
after F3 → **197** after F4 (the transport moved onto the media rows) → **200** after F5 (the preview seek surviving EN VIVO, a paused count surviving it too, and the end state's normalizer fallback). Per commit
as committed: **205** (F4+F5) → 205 (settings) → 213 (PDF) → 228 (slide video) → 270 (Bible) →
**280** (4K performance). F4+F5's commit shows 205, not 200, because it also carries a few cases
of the style validators that it pulled forward. The 29 cases F2 added are `tests/main/scene-validators.test.ts` (17), the
`describe("Utility scenes")` block in `tests/main/data-layer.test.ts` (5), `describe("The
editor's two text fields")` in `tests/main/timer.test.ts` (4) and `describe("editing the scene
that is live")` in `tests/renderer/select-output.test.ts` (3). F3's 5 are the
`describe("A time scene as an order-of-service item")` block in `data-layer.test.ts`, which is
where the widened CHECK, the `restrict` FK, the forced delete and the draft filter are asserted.
`CLAUDE.md`'s command table says 280.

The commits:

| | |
|---|---|
| `66e7292` | feat(functions): project countdowns, clocks and a stopwatch as time scenes — **F1** |
| `4ceb6d5` | docs(plans): close the utilities decisions and record the tick finding |
| `de0dd3e` | refactor(ui): promote the settings row primitives into the design system |
| `6d7f1fb` | feat(functions): persist time scenes and add the «Escenas» editor — **F2** |
| `d93caee` | docs: record the F2 rules and correct the CDP recipe's control-window match |
| `a5e9f12` | docs(plans): rewrite the utilities handoff as an F2 runbook |
| `cedc067` | feat(functions): make a time scene a row of the order of service — **F3** |
| `ce8d7e4` | feat(functions): drive a time scene from its media row and dress its end — **F4 + F5** |
| `0700e33` | feat(settings): full default volume, a picker folder per kind and removing the logo |
| `b91bb24` | feat(slides): project a PDF as a deck |
| `5a76c42` | feat(slides): play a video embedded in a slide |
| `2c8afeb` | feat(bible): style the projected verse, import any module and manage versions |
| `e95a337` | perf(projection): keep a 4K video smooth and let the operator measure it |

The last five are not Utilidades. See §1.

`ce8d7e4` also contains `style-validators.ts`, `components/shared/style-fields.tsx`, `Slider` and
`lib/transition.ts`. They were split out of the scene editor later, for the verse style, and
land in that commit because the scene editor there already imports them.

---

## 3. Data source / environment

- **macOS, single monitor.** This matters and is not incidental: with one display the projection
  window is an ordinary 800×600 window that the control window covers, so
  `document.visibilityState` is `"hidden"` and Chromium throttles its timers. That is the exact
  condition the tick design defends against — see
  [`a-self-drawing-clock-must-not-derive-its-own-dependency.md`](../../.claude/knowledge/a-self-drawing-clock-must-not-derive-its-own-dependency.md).
- **LibreOffice is irrelevant to this feature.** Nothing here touches the slides pipeline.
- **Database.** Two migrations. `drizzle/0010_utility_scenes.sql` (F2) is purely additive — one
  `CREATE TABLE` plus one index — so the user's real database only gains a table, four seeded
  rows and one `settings` row on its next launch. `drizzle/0011_program_item_utility.sql` (F3)
  **rebuilds `program_items`**: it copies every row into a new table with `utility_scene_id` and
  a three-branch `CHECK`. That was verified apart from the suite, on a database migrated to 0010
  and filled with a `media` and a `bible` row: both survived with their ids and titles,
  `integrity_check` returned `ok`, `foreign_key_check` was empty and `ix_items_program` was back.
  **All verification ran against a throwaway profile**, so the real library was never opened;
  there is nothing to roll back.

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

F3 added two more rules that must not be "simplified" away:

3. **Every migration touching `program_items` is hand-written, whatever the operation.** For F3
   `drizzle-kit generate` emitted a single `ALTER TABLE … ADD COLUMN … REFERENCES utility_scenes(id)`
   that SQLite **accepts** — while silently dropping the `ON DELETE restrict` and leaving the
   CHECK ignorant of the new kind. Nothing fails; the guard simply is not there. Diagnosis in
   [`sqlite-table-rename-must-alter-not-recreate.md`](../../.claude/knowledge/sqlite-table-rename-must-alter-not-recreate.md).
4. **A deleted scene is cleaned out of the open schedule by the RENDERER.** An FK protects a
   saved program and `DraftRepo.load` filters the persisted draft, but the order of service the
   operator has open right now is neither — so `deleteScene` calls
   `program.store.removeByUtilityScene` and clears a preview target pointing at it, exactly as
   `purgeAsset` does for a deleted media asset.

`utility:usages`, deliberately left out of F2 because nothing referenced a scene yet, landed with
F3's foreign key — the thing it was meant to look at.

F5 adds one:

5. **A new field of a JSON column that SPLITS an existing one falls back to the row's own
   sibling, never to the app default.** `SceneEnd.message` is the end message's own type; every
   row written before it existed drew that line with `style.message`, so `normalizeSceneEnd`
   takes the row's normalized `message` as its fallback. Defaulting to
   `DEFAULT_SCENE_STYLE.end.message` would have silently restyled every scene an operator had
   already dressed, the first time this build read it. A test asserts it
   (`scene-validators.test.ts`).

Also F5: **`hideValue`/`hideTitle` apply at zero whether or not there is an end message.** The
operator asked for the choice to be theirs — «quiero una opción que me dé la opción de elegir
ocultar» — so the switches are opt-in, off by default, and the app never decides on its own that
a finished countdown should erase itself.

---

## 5. Runbook

### 5.1 Where the code lives

| Layer | File | What it is |
|---|---|---|
| shared | `types/timer.ts`, `types/scene-style.ts`, `types/utility.ts` | the three models (F1) |
| shared | `timer.ts` | every time calculation, pure `(clock, now)`; F2 appended the four parsers |
| shared | `scene-validators.ts` | one predicate per field + the normalizers |
| main | `db/schema.ts`, `drizzle/0010_utility_scenes.sql` | `tool` as a column, `config_json`/`style_json` as JSON |
| main | `drizzle/0011_program_item_utility.sql` | F3: the hand-written `program_items` rebuild — new column, new FK, widened CHECK |
| main | `db/repositories/programs.repo.ts` | F3: the `utility` case of `toItemDTO`/`toRow`, `findSceneUsages`, `deleteItemsByUtilityScene` |
| main | `db/repositories/draft.repo.ts` | F3: `withLiveAssetsOnly` now drops dead scene references too |
| main | `services/utility-scene-removal.ts` | F3: the forced delete, both tables in one transaction |
| main | `db/repositories/utility.repo.ts` | CRUD + `reorder` (one `json_each` statement) + `insertMany` |
| main | `db/seed/seed-utility-scenes.ts` | seeds the four defaults once, flag-guarded |
| main | `ipc/handlers/utility.ts` | seven channels, every write validated |
| renderer | `stores/utility.store.ts` | the scenes mirror + the ONE armed timer (`TimerRun`), and `clockForScene` — the projector's copy wins |
| renderer | `stores/projection.store.ts` | `setTimerClock` + `setLiveScene`, both `base` patches |
| renderer | `lib/actions/utility.ts` | the transport (`toggleTimer`/`resetTimer`/`seekTimer` over `commitClock`) + `loadScenes`/`saveScene`/`duplicateScene`/`deleteScene`/`reorderScenes` |
| renderer | `lib/utility-output.ts` | `timerOutputFor` — shared by `selectOutput` AND both previews |
| renderer | `components/shared/timer-scene.tsx` | what the projector actually paints |
| renderer | `components/ui/field.tsx`, `ui/color-field.tsx` | `FieldGroup`/`FieldRow`, `ColorField` |
| renderer | `components/shared/utility-track-row.tsx` | F4: the transport row — which control each tool gets, and the memoized clock |
| renderer | `components/shared/media-track-row.tsx` | F4: `readout`/`readoutTone`/`readoutNote`, `onRestart`, `playLabel`/`pauseLabel` |
| renderer | `components/pages/functions/` | `utilities-panel` (its footer adds to the schedule), `scene-readout` (F4), `ScenesModal` (+ `DeleteUsages`), `scene-form`, `scene-draft`, `scene-preview` |
| renderer | `lib/hooks/use-program-item-display.ts`, `lib/dnd.ts`, `pages/schedule/SchedulePanel.tsx` | F3: the schedule row's label/icon, the scene drag payload, the drop |
| renderer | `lib/hooks/use-timer-now.ts`, `use-local-fonts.ts` | the self-correcting tick; `queryLocalFonts()` with a real fallback |

### 5.2 Verify the feature still works before touching it

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

**The F3 gate**, once the above passes:

8. Funciones ▸ Utilidades → click a scene → the footer's «Agregar al programa» → the row appears
   in the order of service under the scene's name. Dragging the row there does the same.
9. Save the program (the TopBar's «Guardar» → name it), **restart the app**, open it from
   «Administrar programas» and send the row **EN VIVO**. The projector must show the scene,
   counting, with the on-air rail on that row.
10. «Escenas…» → that scene → **Eliminar**. The confirmation must NAME the program and count its
    items, and «Eliminar igualmente» must leave: no scene, no item in the saved program, no row
    in the open schedule — and the projector **still counting**, because `base` holds a resolved
    copy and what is on screen is never the app's decision.

**Measured on 2026-09-18:** the row saved as «Culto F3»; after a full restart, loading it and
going live put the projector at `09:53` falling to `09:47` with the rail lit; the delete
confirmation read «Culto F3 / 1 elementos»; the forced delete left 3 scenes, 0 items, an empty
schedule and a projector at `09:26`.

The **F1 gate** still applies and is cheaper to re-check: with a countdown live, run
`window.worship.invoke("projection:close")` then
`window.worship.invoke("projection:open", { displayId })`. **The count must CONTINUE**, not
restart.

---

## 6. Pending / next steps

**Nothing is left to build in Utilidades.** F1–F5 are done and committed. F1–F3 were verified
against the real projector. **F4 and F5 still owe that manual pass:** the transport on the
PREVIEW and LIVE rows, dragging the countdown bar, EN VIVO resuming where PREVIEW was left, and
«Al terminar la cuenta» on the projector.

`PLAN.md`'s order stands: **Overlays** next — it reuses `SceneStyle`, `ColorField` and the
`FieldGroup`/`FieldRow` pair this feature built, and its genuinely new problem is composing a
layer above the scene without touching the scene's transitions. Then **Entradas**, larger by an
order of magnitude, with its own plan and its own spike gate.

Two things F3 deliberately did NOT do, both already decided rather than forgotten:

- **A per-item title override exists in the data (`program_items.title`) but has no UI.** A
  `utility` row falls back to the scene's name, exactly like a `media` row falls back to the
  asset's. Renaming a row in place is a schedule-wide feature, not this one's.
- **No dedicated badge colour.** See open question 3 below.

### Open questions for the user

1. **Merge this branch?** Thirteen commits, each of which builds, tree clean. It now carries
   five features beyond Utilidades (§1), so merging to `main` also ships them. Overlays is a new
   area and would be cleaner off `main`.
2. **`/HANDOFF.md` at the repo root is stale.** It belongs to the 2026-09-08 video↔PPT hang,
   whose work is merged and whose findings already graduated to `.claude/knowledge/`. Two
   handoffs invite the next session to read the wrong one. Delete it, or move it under its own
   plan folder? *(Raised at the end of F1, still unanswered.)*
3. ~~**Badge colour for utilities.**~~ **Closed 2026-09-18:** stays `neutral`, in the Utilidades
   list and in the order of service. Every ALPS hue is already taken by another content type and
   inventing one outside the palette is against `docs/knowledge/06-ui-and-theme.md`; the tool's
   own icon is what tells a countdown from a clock.
