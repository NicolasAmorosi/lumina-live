# HANDOFF — Tanda 2 of the general cross-cutting audit + both field bugs (2026-09-14)

Runbook for the next session. The diagnosis lives in the two immutable reports
([`2026-09-13-transversal-general.md`](2026-09-13-transversal-general.md) §1.quater and
[`2026-09-13-bugs-de-campo.md`](2026-09-13-bugs-de-campo.md) §8); **this file is the state of the
repo and what to do next.**

---

## 1. Executive summary

Ten findings closed and verified against the **real running app**, not just by reading code:

| | What | Verified how |
|---|---|---|
| 🟠 `H1` | Modals now trap focus, take it on open, return it on close, and mark the background `inert` | CDP: 1 dialog, `aria-modal`, `aria-labelledby` resolves, Tab wraps, focus returns to the opener |
| 🟠 `H2` | The unsaved order of service is mirrored to SQLite; own app menu; close guard | Full app restart restores the schedule; ⌘W inert; ⌘Q asks, cancels, re-asks, exits |
| 🟠 `H3` | `programs:peek` — previewing a program no longer adopts it in main | 9 items returned, `lastOpenedAt` unchanged |
| 🟠 `H5` | Pre-migration backup uses `VACUUM INTO` + `integrity_check` | `db:smoke` 18/18: hot 4.1 MB WAL → 5000 rows vs 4977 for a plain copy |
| 🟠 `H6` | `settings:set` validates every key at runtime | 4 bad payloads rejected `INVALID_SETTING`, valid one accepted, DB clean |
| 🟠 `H7` | The other half of dark-theme contrast: the `-ink` ramp | 6 measured pairs, 2.35–3.70 → 5.01–6.33 |
| 🟡 `M16` `M22` `M27` `M31` | Live region always mounted · `warning` uses its own token · DB closed on quit · `as never` replaced by an exhaustive switch | `-wal`/`-shm` deleted on exit; typecheck |
| 🟠 `F1` | The "can't remove" toast fired once per mounted resource tab | 5 panels mounted → **1** toast and **1** dialog (was 4) |
| 🟠 `F2` | video → video did not crossfade | frozen frame 1.000→0.009 against video 0.000→0.991, simultaneous, 300 ms, no black, no jump |

**Nothing is committed.** The branch is `fix/golive-race-and-live-audit`, still carrying the
uncommitted feature-5 and Tanda-1 work from the previous sessions.

**Still open and untouched:** the remaining blocker `C2` (Electron 36 is EOL), `H9`, `M7`–`M10`,
and the product decisions `M1`/`M2`/`M3`/`M5`. See §6.

---

## 2. Current state — the numbers, and how to confirm them

```bash
npm run typecheck   # clean
npm run lint        # 0 errors, 5 pre-existing react-refresh warnings
npm run db:smoke    # 18/18 — was 15/15; 3 cases added this session
npm run build       # clean
npx tsx .scratch/audit/i18n-check.ts   # 257 defined, 229 used, 0 MISSING
```

`db:smoke`'s last line is the canonical sanity check for `H5`:

```
[18/18] Pre-migration backup is WAL-aware…
      WAL 4120032 B · VACUUM INTO 5000 rows · plain copy 4977 rows
```

If `plain copy` ever equals `VACUUM INTO`, the fixture stopped reproducing the bug (the WAL was
checkpointed) — the assertion catches that and says so rather than passing silently.

The three new `db:smoke` cases: `[16/18]` draft round-trip + dead-reference filtering, `[17/18]`
settings validators, `[18/18]` the WAL-aware backup.

**The user's real database, after this session's testing (unchanged from before it):**

```bash
node -e '
const D=require("better-sqlite3");
const db=new D(process.env.HOME+"/Library/Application Support/worship-app/worship.db",{readonly:true});
console.log("assets", db.prepare("SELECT count(*) n FROM media_assets").get().n,      // 1498
            "programs", db.prepare("SELECT count(*) n FROM programs").get().n,        // 4
            "draft", db.prepare("SELECT count(*) n FROM program_draft").get().n);     // 0
db.close();'
```

A pre-session snapshot of that database is at
`/private/tmp/claude-501/…/scratchpad/worship-pre-0008.db` (verified `integrity_check: ok`, 1498
assets) — **it lives in a session-scoped temp dir and will be gone.** The app's own
pre-migration backup is the durable one: `userData/backups/worship-2026-09-14T13-11-56-454Z.db`,
9 986 048 B, taken with `VACUUM INTO` (hence smaller than the 10 190 848 B plain copies next to
it), and confirmed to be genuinely pre-migration — it has no `program_draft` table.

---

## 3. Environment

- Branch `fix/golive-race-and-live-audit`, last commit `0ea7cbc`.
- macOS, Electron 36.4.0 (`C2`: this line is EOL — still open).
- **A new migration ran against the user's real database**: `drizzle/0008_program_draft.sql`.
  Confirm with `SELECT name FROM sqlite_master WHERE name='program_draft'`.
- The app is driven for verification through CDP: `npm run dev -- --remote-debugging-port=9222`.
  Helper scripts from this session are in the session scratchpad (`cdp.mjs`, `lib-drive.mjs`,
  `click-real.mjs`) and are **not** in the repo.

### Three gotchas that cost real time here

1. **The projection window is occluded behind the control window on a single display**:
   `document.visibilityState === "hidden"`, zero rAF frames, so no animation can be measured
   there. Measure on the **LIVE monitor** instead — it is the same `OutputView` by design. The
   stage is `[...document.querySelectorAll('div')].filter(d => d.className.includes('@container')
   && d.className.includes('bg-black'))[1]` (index `0` is PREVIEW, which never animates).
2. **Synthetic `el.click()` does not always drive this UI** — the "Agregar al programa" button
   reads as `disabled` at the instant the tile's selection has not yet re-rendered. Use real
   input: `Input.dispatchMouseEvent` at the element's centre (`click-real.mjs`).
3. **`window.close()` from the renderer does not fire the cancellable `close` event**, so it
   cannot be used to test the close guard. Drive the real path with AppleScript:
   `osascript -e 'tell application "System Events" to set frontmost of (first process whose name
   is "Electron") to true'` then `keystroke "q" using command down`. The same tool reads the menu
   back (`get name of menu items of menu 1 of menu bar item "Ventana" of menu bar 1`).

---

## 4. What was wrong, and where the fix lives

### `H2` — the unsaved schedule (three layers, all three shipped)

| Layer | Where |
|---|---|
| Draft table | `src/main/db/schema.ts` (`programDraft`), `drizzle/0008_program_draft.sql`, `src/main/db/repositories/draft.repo.ts` |
| Autosave + restore | `src/renderer/src/effects/draft-autosave.ts`, `restoreDraft` in `lib/actions/programs.ts` and `stores/program.store.ts`, booted from `app/App.tsx` |
| App menu | `src/main/windows/app-menu.ts` |
| Close guard | `src/main/windows/close-guard.ts`, `src/main/ipc/handlers/program-draft.ts`, `shared/types/window.ts` |

Items are a **JSON blob**, not `program_items` rows: a draft must be able to reference an asset the
operator is about to delete, which is exactly what that table's `onDelete: "restrict"` FK forbids —
a draft must never be what blocks a deletion. `DraftRepo.load()` drops items whose asset is gone,
main-side, because it is the only place that can answer that without one IPC round trip per item.

**The bug I introduced and then found in verification** (worth knowing, it is subtle): the first
design used two channels, `confirmClose` and `cancelClose`, and "I'm asking the operator" cleared
the same global `quitRequested` flag the later confirmation needed. "Cerrar igualmente" then called
`win.close()` instead of `app.quit()` — and **vetoing a window's close during a quit cancels the
whole quit**, so `will-quit` never ran and `closeDatabase()` never happened, while the app still
exited and looked fine. Collapsed to a single `window:closeDecision` (`"close" | "hold" |
"cancel"`) with the intent captured in `PendingClose.wasQuit`. Full write-up:
[`.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md`](../../.claude/knowledge/vetoing-a-close-during-a-quit-cancels-the-quit.md).

**Second self-inflicted bug, also caught by measuring:** putting the hook's `t` in the boot
effect's dependency array made the whole boot — every `start*Effects()` — re-run whenever
`loadSettings` changed the locale. And StrictMode's double-invoke made the restore toast appear
twice. Both fixed: the toast moved into `restoreDraft` (where the module-level `t` already lives,
same rule as `F1`), and the restore is guarded by a module-level `draftRestoreStarted`.

### `H1` — focus

`inert` is applied to `#root` from `modal-stack.ts`'s `pushModal`/`popModal`, **not** from a
component's render. That ordering is the whole point: it is in place before the new dialog runs its
focus effect, and off before the closing dialog restores focus into the background. Effects clean
up in declaration order, which is why `Modal`'s focus-restore cleanup (declared last) runs after
`popModal`. `ToastHost` had to be portaled to `document.body` in the same change, or `inert` would
have made its actions ("Deshacer", "Eliminar igualmente") unclickable.

### `F2` — the frozen frame

The only place the outgoing video's pixels are still reachable is a **`useLayoutEffect` cleanup
with empty deps inside `LiveVideo`** — layout cleanups run in the mutation phase, in the same
commit that removes the node. Read the element from a ref that is never nulled (`lastElementRef`),
because React detaches the `ref` callback in that same phase. Capture with `<canvas>` +
`drawImage` (a blit), never `toDataURL` (tens of ms of synchronous work at the exact instant a
transition starts), and a **fresh canvas per capture**.

### `H7` — why a colour cannot be both a fill and text

`bg-danger` needs to be dark so white reads on it; `text-danger` on `bg-card` needs to be light so
it reads itself. One value cannot do both, and it was the text that lost (2.35:1). Hence
`--color-<tone>-ink`, for the five tones that appear as bare text or icon. Derivations and the full
table: `docs/knowledge/06-ui-and-theme.md`.

---

## 5. Runbook

### Reproduce the verification

```bash
npm install                       # if node_modules is cold
npm run typecheck && npm run lint && npm run db:smoke && npm run build
npm run dev -- --remote-debugging-port=9222
```

Then, against the running app:

| Check | Steps | Expect |
|---|---|---|
| `F1` | Visit all 5 resource tabs, select an asset used by a saved program (asset 7), press `Supr` | exactly 1 toast; its action opens exactly 1 dialog |
| `F2` | Videos tab → tile 0 → EN VIVO → wait → tile 1 → EN VIVO | a canvas layer fading 1→0 while the `<video>` fades 0→1, simultaneously, over the configured duration |
| `H1` | open any modal | `#root` has `inert`, focus is inside, Tab wraps, Escape restores focus to the opener |
| `H2` draft | add items, wait ~1 s, restart the app | the schedule comes back with the "Se recuperó…" toast, badge "No guardado" |
| `H2` guard | ⌘Q with unsaved changes | "¿Cerrar sin guardar?"; Cancelar keeps the app; a second ⌘Q asks again; "Cerrar igualmente" exits and **deletes `worship.db-wal`/`-shm`** |
| `H2` menu | `osascript … menu bar item "Ventana"` | `Minimizar, Zoom, (separator), Traer todo al frente` — no Cerrar |
| `H3` | `programs:peek` over IPC | items returned, `lastOpenedAt` unchanged |
| `H6` | `settings:set {"ui.theme":"purple"}` over IPC | rejected `INVALID_SETTING` |

### If a draft is stuck from testing

Press **Vaciar** in the schedule panel: an empty schedule is not unsaved work, so the autosave
clears the row. Confirm with `SELECT count(*) FROM program_draft` → 0.

---

## 6. Pending, ranked

1. **`C2` — Electron 36 is EOL** (installed 36.4.0; the supported line is 44.x). Still the only
   open blocker in the whole report. Drags `electron-builder` and `electron-vite` behind it, so it
   needs its own session and a full re-verification pass afterwards.
2. **`H9` — ESLint without type information or a11y rules.** Now more valuable than when it was
   written: this session added a focus trap, `inert`, `aria-modal` and `aria-labelledby` by hand,
   which is exactly what `eslint-plugin-jsx-a11y` would keep honest. Stagger it: a11y first (cheap,
   no types), then `recommendedTypeChecked`.
3. **`M9`/`M10` — virtualize the two content grids.** Psalm 119 is 176 tiles, twice over (live grid
   + preview grid); a 200–400-slide deck is worse. `VirtualGrid` already exists.
4. **`M7`/`M8` — the N+1 in `ProgramsRepo`.** `list()` runs one `SELECT count(*)` per program,
   inside a `map`, and `reorder()` calls it after emitting one `UPDATE` per id.
5. **Light-theme contrast, newly measured and NOT fixed**: `--wa-warning` on `bg-muted` is 4.00 and
   `--wa-text-muted` on `bg-muted` is 4.22, both just under AA. Not touched because raising them
   means moving ALPS neutrals and collapsing the hierarchy against `--wa-text-secondary` — a design
   decision, not an adjustment.
6. **Three measurements still not taken** (from the field-bug report §6.2): `fade-through-black`
   video→video (asserted correct by reading the keyframe after the `videoRole` change, not
   measured), deck→video, and video→deck.

### Open questions for the user

- **Commit?** Nothing has been committed. The working tree now carries six sessions of work
  (feature 5, Tanda 1, the two field bugs, Tanda 2) across 85 changed/untracked paths, plus
  `package-lock.json`, which `H8` un-ignored and which still needs its first commit.
- **The product decisions** the audit flagged as needing a choice, not an implementation: `M1`
  (where the "Relocalizar…" button goes — `library:relocate` is fully wired with zero call sites,
  so a missing file has no recovery path), `M2` (where volume lives — per track, global, or in
  Ajustes), `M3` (keep text program items or delete the type), `M5` (what to expose about the
  slide cache).
