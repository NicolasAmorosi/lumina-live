# Handoff — media-chain audit (updated after session 5, 2026-09-13)

Companion to [`2026-09-11-cadena-de-media.md`](2026-09-11-cadena-de-media.md), which is the audit
itself: it holds every finding with its location and symptom, and is the place to look up one by
id. This file is the runbook — what state the repo is in, what was fixed, how to verify it, and
what to do next.

---

## 1. Executive summary

A full end-to-end audit of the media processing chain (import → conversion → cache → serving →
projection), the two panels of the first column (`SchedulePanel`, `ResourcePanel`) and the system
around them (window lifecycle, IPC, database, stores, effects).

- **Session 1** — 3 blocking defects and 18 high-severity ones found and fixed; 53 medium/minor
  documented with proposed fixes.
- **Session 2** — the 7 medium findings on the priority list.
- **Session 3** — 31 findings in full and 2 in part, plus `N1` and `N2`.
- **Session 4** — `N3` fixed (`content_hash` on `media_assets`) and the 21 outstanding manual
  checks run against the real app.
- **Session 5 (2026-09-13)** — two things:
  1. **11 of the 13 remaining performance findings** closed (`M2`, `M4`, `M5`, `M6`, `M8`, `M10`,
     `M11`, `M15`, `M16`, `M17` in full, `M14` in part) plus the `AbortError` log noise. **2 stay
     open on purpose**, not for lack of time — see §6.
  2. **A question the user brought that was not in the audit, and turned out bigger than reported:**
     "hymns 51–63 in both folders have no auto-advance". It is **222 of 1226 hymnal decks**, it is
     **LibreOffice's PPTX export filter**, and it is fixed — with the 122 already-converted decks
     backfilled in **42 ms without reconverting anything**. Full analysis in report **§11**.

**No defect is open.** The two remaining findings are `M23` (Linux-only, unverifiable here) and
`M42` (a feature with a UI decision, not a performance tweak).

### The part worth carrying forward from session 5

**LibreOffice's `.pps → .pptx` upgrade pass is not lossless, and two knowledge entries said it
was.** Its PPTX export only writes a `<p:transition>` element when the slide has a visual
transition EFFECT — and `advTm` is an attribute of that element, so a slide set to "no transition,
advance after 27 s" comes back with nothing. The import is fine: the same file exported to `.odp`
has every `presentation:duration`. Both stale claims were corrected in place, and the diagnosis
lives in
[`.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md`](../../.claude/knowledge/libreoffice-pptx-export-drops-advtm-without-a-transition-effect.md).

**A second defect fell out of `M14`.** `backupBeforeMigrate` ran on *every* launch and kept the
last 3 — so three ordinary launches after a migration consumed all three slots with post-migration
copies and **rotated out the pre-migration snapshot the function exists to keep**. Gating the
backup on "is anything actually pending?" fixes the cost and the defect with one change.

---

## 2. Current state — numbers

| | |
|---|---|
| Audited | `src/` in full: 18.268 lines, 176 files |
| Findings | 3 critical + 18 high + 52 of the 54-row catalogue fixed, plus `N1`, `N2`, `N3`. **2 open, both performance, both deliberately deferred** |
| Git | **Nothing committed yet.** Branch `main`, last commit `4ec5ff3` ("chore: beta 0.2.0"). The user chose, in session 5, to **commit by intent at the end of the session** — see §7 |
| Session 5 source files | 15 changed + 2 new (`src/main/slides/ppt-binary-timings.ts`, `src/main/slides/backfill-timings.ts`) |

Confirm against the report itself (these must match the table rows, not memory):

```bash
R=auditorias/reports/2026-09-11-cadena-de-media.md
grep -cE '^\| \*\*C[0-9]+\*\*' $R        # 3
grep -cE '^\| \*\*(A|B)[0-9]+\*\*' $R    # 18
# The catalogue is §5 only — §4.3's summary table uses the same row shape, so
# a bare grep over the whole file now over-counts. Scope it:
awk '/^## 5\. Hallazgos/,/^## 6\. Inventario/' $R | grep -cE '^\| (\*\*)?(M|L|N)[0-9]+'        # 54
awk '/^## 5\. Hallazgos/,/^## 6\. Inventario/' $R | grep -cE '^\| (\*\*)?(M|L|N)[0-9]+(\*\*)? ✅'  # 52
ls src/main/slides/ppt-binary-timings.ts src/main/slides/backfill-timings.ts  # session 5 is present
```

The 2-row gap is `M23` and `M42` — report §10.

### ⚠️ The working tree mixes six sessions

All uncommitted, all mixed: the earlier optimization work
(`plans/2026-09-10-import-y-prewarm-optimizacion/`), then sessions 1–5 of the audit. They touch
overlapping files (`deck-service.ts`, `slides.repo.ts`, `projection.store.ts`), so **`git diff`
cannot separate them**. Session 2's files are listed in report §8, session 3's in the old §4.2 file
list, session 4's in the previous handoff, session 5's in §4 below.

---

## 3. Environment and how to confirm you are on the right data

- macOS (`darwin`), Node via the repo's own toolchain, no CI.
- LibreOffice must be installed (`brew install --cask libreoffice`). Verified against 26.8.0.3.
- `db:smoke` uses a throwaway DB under `.scratch/smoke.db`; it never touches `userData`.
- The real database is `~/Library/Application Support/worship-app/worship.db`.

Canonical sanity check — the library as session 5 left it (identical to how it started):

```bash
sqlite3 ~/Library/Application\ Support/worship-app/worship.db "
  SELECT kind||': '||COUNT(*) FROM media_assets GROUP BY kind;
  SELECT 'deck rows: '||COUNT(*) FROM slide_decks;
  SELECT 'programs: '||COUNT(*) FROM programs;
  SELECT 'verses: '||COUNT(*) FROM bible_verses;"
```

Expect `audio: 3`, `image: 2`, `ppt: 1235`, `video: 259`, `deck rows: 682`, `programs: 4`,
`verses: 31102`.

And the check that proves session 5's fix on real data — **36, and all 36 are real `.pptx`**:

```bash
sqlite3 ~/Library/Application\ Support/worship-app/worship.db "
  SELECT 'slides still without a timing', COUNT(*)
    FROM deck_slides s JOIN slide_decks d ON d.id = s.deck_id
   WHERE s.advance_ms IS NULL AND d.status='ready';
  SELECT 'legacy decks WITH auto-advance', COUNT(*) FROM slide_decks d
   WHERE d.status='ready' AND d.timings_source='ooxml-converted'
     AND EXISTS (SELECT 1 FROM deck_slides s WHERE s.deck_id=d.id AND s.advance_ms IS NOT NULL);
  SELECT 'legacy decks total', COUNT(*) FROM slide_decks
   WHERE status='ready' AND timings_source='ooxml-converted';"
```

Expect `36`, then **`676` of `676`**. (Before session 5: 1012 and 554 of 676.)

A pre-session-5 copy of the database was taken before anything ran; if the backfill ever has to be
reasoned about again, note that it is idempotent and only writes `NULL`s, so re-running it is safe.

Real decks used for verification (the user's own files, not fixtures):
`~/Downloads/PPT test/Himnario Nuevo {Cantado,Instrumental}/*.pps` (614 + 613),
`~/Downloads/Ta doido.pptx`, `~/Documents/Cosas para la iglesia/Comunicación en la Iglesia.pptx`.

---

## 4. What session 5 changed

### 4.1 Auto-advance (report §11)

| File | What |
|---|---|
| `src/main/slides/ppt-binary-timings.ts` **(new)** | OLE2 reader + MS-PPT record walker. Returns per-slide `autoAdvanceMs`/`hidden` in presentation order. Reads only the `PowerPoint Document` stream, by sector, on demand |
| `src/main/slides/backfill-timings.ts` **(new)** | The same recovery applied backwards to already-converted decks. Four guards: source still matches `(size, mtime)`, slide counts match, the two readings agree, and only `NULL`s are written (enforced in the SQL) |
| `src/main/slides/deck-service.ts` | `mergeBinaryTimings()` — gap-fills the converted `.pptx`'s metadata, self-checked; abandons the whole merge on one disagreement past 1 s |
| `src/main/db/repositories/slides.repo.ts` | `decksNeedingTimings`, `slideAdvanceTimes`, `fillSlideAdvanceTimes` |
| `src/main/index.ts` | The backfill, in the same deferred slot as the content-hash one |
| `scripts/db-smoke.ts` | Check 15 — **builds a minimal OLE2 `.ppt` in memory** (persist directory, slide list, `SlideShowSlideInfoAtom`) so the reader and both guards are tested with no binary in the repo |
| `scripts/convert-smoke.ts` | Reports how many timings the `.pptx` lost and the binary recovered |

### 4.2 Performance (report §4.3)

`settings.repo.ts` (in-memory cache), `slides.repo.ts` + `media.repo.ts` (prepared statements, one
JOIN instead of two queries, minimal columns), `rasterizer.ts` + `deck-service.ts` (`dirSize`
deleted, `bytesOnDisk` accumulated), `linked-audio.ts` (TTL directory cache), `deck-service.ts`
(paged eviction, cheap `cacheUsage()`, `setImmediate` before the sweep), `migrate.ts` (backup only
when pending), `seed-bible.ts` (hash the Buffer), `migrate-legacy-data.ts` (split + deferred),
`broadcast.ts` + `control-window.ts` (registry instead of `getAllWindows()`),
`worship-protocol.ts` (expected cancellations no longer logged).

### 4.3 Three decisions inside it that the diff does not explain

1. **The merge only fills gaps and self-destructs on disagreement.** Trusting the binary over the
   `.pptx` would have been simpler and produces unrounded (more faithful) times everywhere — but a
   silent ordering bug in a brand-new parser would then advance decks on the wrong slide's timing,
   mid-service, with nothing to catch it. Cross-checking against the reading we already trust is
   what makes a new 400-line binary parser safe to ship.
2. **`cacheOverBudget()` was made cheaper, not rarer.** The audit's `M11` proposed checking once
   per chunk instead of per asset. Making `cacheStats` stop materializing `allDeckDirs()` keeps the
   per-asset granularity that cancellation depends on.
3. **`deck_slides.advance_on_click` was left alone.** The binary carries `fManualAdvance` and the
   column is write-only today — nothing reads it. Populating it would change stored data with no
   consumer and no request.

### 4.4 Measured, not assumed

| | Before | After |
|---|---|---|
| Legacy decks with auto-advance | 554 of 676 | **676 of 676** |
| Slides with no `advance_ms` | 1012 | **36** (all in real `.pptx`) |
| Backfill cost | — | 122 decks, **42 ms**, once, no reconversion |
| 400 × `worship://deck/<id>/<n>` resolution | 3.6 ms | **0.5 ms** |
| `dirSize` after a 400-slide conversion | ~41 ms of blocked main | **0** |
| `bytesOnDisk` vs. real sum of files | — | **exact to the byte** (2 decks checked) |
| DB `copyFileSync` per launch | 10.2 MB, 4.3 ms, and rotated the good backup out | not done |

**Said plainly: `M14`/`M15` were far cheaper than the audit estimated on this machine** — the whole
synchronous startup block measures ~12 ms on an SSD, and `sweepCache`'s `readdir` of 683 entries is
0.5 ms. The fixes stand because they scale with the library and because one of them uncovered a
real defect, not because there were seconds to reclaim.

### 4.5 Driven in the real app

Hymn **055** (one of the range the user reported), projected for real with its `.mp3` playing:

| Transition | Measured audio clock | Expected boundary |
|---|---|---|
| 1 → 2 | 15 431 ms | 15 303 ms |
| 2 → 3 | 45 401 ms | 45 208 ms |
| 3 → 4 | 76 290 ms | 76 190 ms |

And the **fresh-conversion** path (not just the backfill), importing two copies into a clean
folder: `063` converted with its 9 times **unrounded** (7219, 28156, …) because they came from the
binary, `200` with its own **rounded to the second** (15000, 15000, 14000, …) because LibreOffice
kept them and the merge left them alone. `deck-progress` and `library-changed` both arrived at the
control window, which is what proves the `M17` broadcast retargeting did not break event delivery.

**Everything the checks added was removed afterwards**, and one side effect was repaired: the two
fresh conversions replaced the deck rows for hymns 063/200 by content identity, leaving their
`source_path` pointing at the scratch copies — re-opened through the app so they point back at the
real files. Verified with the §3 sanity check: 682 deck rows, 0 paths under `/private/tmp`.

---

## 5. Runbook — verify the current state

```bash
cd /Users/nicolasamorosi/Projects/Personal/WorshipApp
npm run typecheck && npm run lint && npm run db:smoke && npm run build
```

| Step | Expected |
|---|---|
| `typecheck` | clean |
| `lint` | `5 problems (0 errors, 5 warnings)` — all pre-existing `react-refresh/only-export-components` |
| `db:smoke` | `[15/15] … All checks passed.` (15 is the auto-advance regression test) |
| `build` | 3 bundles, no errors |

The slides pipeline has an end-to-end check that needs no Electron — use it after touching anything
in `src/main/slides/`:

```bash
npm run slides:smoke -- "$HOME/Downloads/PPT test/Himnario Nuevo Cantado/055.pps"
npm run slides:smoke -- "$HOME/Downloads/PPT test/Himnario Nuevo Cantado/200.pps"
```

`055` is now the more valuable of the two: it is one of the 222 decks whose timings the `.pptx`
drops, so the run should report `recuperados del binario (el .pptx los perdió): 8` — if that line
is missing, the binary reader has regressed. `200` should report none (LibreOffice keeps them).

To drive the app: `npm run dev -- --remoteDebuggingPort=9222`; the control window's target url is
`http://localhost:5173/`, the projector's `…/projection.html`. Filter `rasterizer` out of
`/json/list`, and scope DOM queries to the visible `[role=tabpanel]`. Node 22+ has a global
`WebSocket`, so a CDP driver needs no `ws` dependency.

---

## 6. Pending — ranked

**Two findings, both performance, both deferred with a reason rather than by oversight.**

1. **`M23` — thumbnails on Linux.** The fix is to do the resize in the offscreen rasterizer window:
   a new channel and a new job type, written blind for a platform that cannot be tested here, for a
   symptom that is nil on macOS/Windows. Waiting on a Linux machine.
2. **`M42` — paginate `library:list` / bound `listFolder`.** Measured on the real library:
   `library:list("ppt")` returns **6 rows** (the other 1229 are linked-folder entries that never go
   through it), and `listFolder` already goes through `importPaths`, which chunks with yields. What
   remains is hypothetical (a 50.000-file folder) and the honest fix is real pagination — a silent
   cap would lie to the operator about how many files their folder has, which is exactly what the
   "monitors never lie" rule forbids. A feature with a UI decision, not a performance tweak.

Outside the catalogue, unchanged: **`M19`'s missing half** — per-channel payload validation, a
~100-channel refactor best done with a shared schema.

### Still unverifiable here

- **Linux** (`M23`) — no machine.
- **Windows, for `M18`** — the orphan reaper is POSIX-only by design.
- **A genuinely orphaned `soffice`** — on macOS it does not survive the parent's SIGKILL.
- **A linked folder on an unplugged drive** (`A9`) — only the half that does not depend on the
  hardware could be verified.

---

## 7. Commit strategy — decided, and the next thing to do

The user chose, in session 5: **commit by intent at the end of the session, shown before being
executed.** The suggested split, coarsest first:

1. `perf:` — the earlier optimization work in `plans/2026-09-10-import-y-prewarm-optimizacion/`.
2. `fix:` — sessions 1–4 of the audit (blocking + high + medium fixes, `N1`–`N3`).
3. `perf:` — session 5's performance findings.
4. `fix(slides):` — the auto-advance recovery and its backfill.
5. `docs:` — the report, this handoff, `docs/knowledge/`, `.claude/knowledge/`.

`git diff` cannot separate 1 from 2–3 inside the overlapping files (`deck-service.ts`,
`slides.repo.ts`, `projection.store.ts`), so those commits are by *file*, not by hunk, and the
boundary between 1 and 2 is approximate. That is the cost of six uncommitted sessions, and it does
not get cheaper by waiting.
