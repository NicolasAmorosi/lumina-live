# Knowledge Index

Atomic findings — one file per finding, dated. This index holds **pointers only**: never put
finding content here. Open a file when its hook or its `**Trigger:**` line matches what you are
about to touch.

Structural documentation of how the system works lives in `docs/knowledge/` instead; task state
lives in `HANDOFF.md`. See the "Las dos bases de conocimiento" table in `CLAUDE.md`.

To add an entry, run `/learn` — it enforces this format and appends the pointer below.

<!-- Add entries below as: - [Title](file.md) — one-line hook: the surprising part, not a summary -->
- [Slide pipeline gotchas (LibreOffice + pdf.js)](slides-libreoffice-pipeline.md) — hidden slides aren't exported to PDF, unquoted filter names, the pdf.js legacy build, and where `advTm` actually lives
- [IPC contract replaces the three-file lockstep](ipc-contract-replaces-lockstep.md) — `shared/ipc/contract.ts` + `main/ipc/index.ts`'s `Handlers` type make a missing/mis-typed handler a compile error
- [better-sqlite3 v13 ships N-API prebuilds](better-sqlite3-napi-prebuilds.md) — no native rebuild needed, cross-compile Windows installer from macOS; `node:sqlite` rejected for lacking FTS5
- [Video↔PPT live-transition fixes](video-ppt-live-transition-fixes.md) — projector's first-push race, and a stale-`useState`-in-a-hook bug that fed a video's id into a PPT conversion and blocked the queue for up to 10 minutes
- [`worship://` Range support + projector `<video>` lifecycle](worship-protocol-range-and-video-lifecycle.md) — the ignored `Range` header that made seeking impossible and killed playback with `-12909` after ~3 plays; plus `videoUnderlay`, and why NEGRO/LOGO pauses a video but not a deck's soundtrack
- [`mediaStatus` must be keyed per target](media-status-is-per-target-not-a-single-slot.md) — a single shared status slot let the deck transport silently read another media element's clock once more than one thing could play at once
- [The monitor stage must size itself by width, not by leftover flex height](monitor-stage-must-size-by-width-not-flex.md) — a deck's transport controls, passed as `Monitor`'s `footer`, silently shrank the LIVE rectangle only when a PPT was on air
- [A grid item's default `min-width: auto` overrides its children's `truncate`](grid-items-need-min-w-0-to-let-truncate-work.md) — a spaceless long filename ballooned a row past its column and pushed the trailing button into the clipped, unreachable overflow, even though the label itself had `truncate`
- [A fixed-width readout box inflates the visual gap around it, even with a uniform flex `gap`](fixed-width-readout-inflates-flex-gap.md) — `w-10`/`w-12` clock and counter boxes hid dead space that stacked on top of `gap-2`; two earlier "fix the spacing" attempts made it worse by touching the gap instead of the box
- [Two `soffice` invocations sharing a profile silently race](soffice-shared-profile-race.md) — the loser exits code 1 with no output and no error text, and it was being swallowed into a false "this deck has no timings"
- [Old hymnal `.pps` decks link audio externally, and the link doesn't survive a LibreOffice round-trip](legacy-pps-linked-audio-resolution.md) — the `.pps→.pptx` upgrade pass that recovers `advTm` perfectly drops the external audio link entirely; plus an NFC/NFD basename-matching trap on accented file names
- [A slides-pipeline fix does nothing for already-converted decks without a `SLIDES_CONVERTER_VERSION` bump](converter-version-must-bump-with-pipeline-fixes.md) — fixed the soffice race in code, but the user's saved service kept using a deck cached from before the fix, silently stuck at `timings_source: 'none'`
- [`MediaStatus.ended` is sticky and its key is reused across plays](media-status-ended-is-sticky-check-epoch.md) — a freshly mounted media element rebroadcasts the previous play's `ended: true` on mount, and the deck-soundtrack/video target keys never change across plays, so auto-clearing on end-of-playback had to also check `epoch`
