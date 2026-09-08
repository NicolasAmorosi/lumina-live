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
