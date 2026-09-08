## Two `soffice` invocations sharing a `UserInstallation` profile silently race — the loser exits 0 output, code 1
**Area:** slides
**Trigger:** touching `deck-service.ts`'s conversion pipeline, adding a new LibreOffice call site, or debugging a legacy `.ppt`/`.pps` deck that has no auto-advance and no embedded audio despite a real `advTm`/audio inside it.

- `runConversion` in `src/main/slides/deck-service.ts` used to launch `convertToPdf` and
  `readMetadata` inside a `Promise.all`. For a legacy binary `.ppt`/`.pps`, `readMetadata` itself
  runs a second LibreOffice pass (`convertToPptx`, in `src/main/slides/libreoffice.ts`) purely to
  recover `advTm` and embedded audio through an OOXML round-trip. Both calls share the exact same
  `-env:UserInstallation` (`baseArgs()` in `libreoffice.ts`) — a dedicated profile chosen precisely
  so a user's own open LibreOffice GUI can't lock us out.
- Verified by hand with the bare CLI: launching two `soffice --headless ... -env:UserInstallation=<same dir>`
  processes at once produces no observable error message — the second process exits with code
  `1` and writes nothing to its `--outdir`. There is no exception text pointing at "profile
  already locked"; it's a plain silent failure.
- `readMetadata`'s `catch` swallowed this into `{ meta: emptyMeta(), timingsSource: "none" }` with
  no log line, which disables BOTH auto-advance (`advance_ms` all `null`) and embedded-audio
  extraction (`deck-service.ts` used to gate audio extraction behind `timingsSource !== "none"`)
  for every legacy binary deck, indistinguishable from "this deck genuinely has no timings."
  `npm run slides:smoke` never caught it because `scripts/convert-smoke.ts` reimplements the
  conversion calls sequentially, never via `Promise.all`.
- Fix: serialize every `soffice` invocation through a module-level promise chain wrapped around
  the single choke point, `runSoffice()` in `libreoffice.ts` — not just the one `Promise.all` call
  site in `deck-service.ts`. Fixing only the call site would leave `warmProfile()` or any future
  caller free to reintroduce the exact same race. The `readMetadata` catch now also logs the real
  error instead of swallowing it silently.

**Last updated:** 2026-09-08
