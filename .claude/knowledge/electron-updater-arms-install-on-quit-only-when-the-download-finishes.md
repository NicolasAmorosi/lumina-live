## electron-updater arms «install on quit» when the download finishes, not when you flip the flag
**Area:** build
**Trigger:** touching `src/main/updates/updater.ts`, «When the app closes», `autoInstallOnAppQuit`, or an update that downloaded but never installed on exit

- The obvious design (it was in the in-app updates plan of 2026-10-23) is to keep
  `autoInstallOnAppQuit = false` so a quit never installs in silence, and set it to `true` when
  the operator picks «When the app closes». **That installs nothing.** In electron-updater 6.8.9
  `BaseUpdater.executeDownload`'s `done` calls `addQuitHandler()`, which returns at once unless
  `autoInstallOnAppQuit` is ALREADY true at that moment — and it is never called again. The
  property is only re-read inside a handler that, with the flag off at download time, was
  never registered.
- `updater.ts` therefore leaves the flag off for good and registers its own `app.once("quit")`,
  which calls `BaseUpdater.install(true, false)` (or opens the `.dmg` on macOS) only if the
  status says `installOnQuit` and the exit code is 0. `quit` only fires once the close guard let
  the quit through, so a «Cancel» in that dialog installs nothing.
- The other two traps of this library are in the plan and in the code comments:
  `quitAndInstall()` launches the installer BEFORE quitting (so the operator's confirmation
  has to come first and the close guard has to be released with `releaseForUpdate()`), and
  the named `import { autoUpdater }` throws at startup in this ESM main
  («Named export 'autoUpdater' not found») while `typecheck` passes.

**Last updated:** 2026-10-25
