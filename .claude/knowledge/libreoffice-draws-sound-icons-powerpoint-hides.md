## LibreOffice draws a sound's icon that PowerPoint hides during the show

**Area:** slides
**Trigger:** a speaker icon on the projected first slide of a hymn; comparing a native slide with
LibreOffice's PDF and finding a ~192×192-unit difference in the middle of slide 1.

- The hymnal's linked sound sits on slide 1 as a picture frame (the speaker icon) with an
  `ExObjRefAtom` (0x0BC1) and an `AnimationInfoAtom` (0x0FF1) whose flags carry **`fHide`
  (0x1000)**, «hide while not playing» — PowerPoint's «Hide sound icon during slide show». All 1030
  icons that fall on the slide carry it (`0x1104` / `0x1504`); the other 200 are off the slide.
- LibreOffice ignores the flag in its PDF export, which is why the LibreOffice path put the icon
  on the projector (the 2026-10-14 rehearsal saw it; the owner ruled it «no importa»). The native
  reader skips such shapes (`hiddenMedia` in `ppt-binary.ts`), as PowerPoint does — so the icon is
  gone from every hymn read natively. That is a deliberate difference from the LibreOffice output,
  not a regression, and a pixel diff against LibreOffice must expect it.
- Over each hymn's first and last slide there is ALSO a white Adventist logo (a plain PNG, no
  `ExObjRefAtom`), which PowerPoint does draw: that one is drawn natively too.

**Last updated:** 2026-10-26
