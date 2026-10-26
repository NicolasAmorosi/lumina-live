## The update installer kills the app within seconds, so the close question has to come before it starts
**Area:** build
**Trigger:** touching `installUpdate` in `src/main/updates/updater.ts`, `releaseForUpdate()` in `src/main/windows/close-guard.ts`, «Restart and update», or any call to `quitAndInstall()` / `install()`

- The obvious wiring is `autoUpdater.quitAndInstall()` and letting the close guard ask as usual,
  since it already holds a quit in `before-quit` until the control window answers. **That leaves a
  «Cancel» that cancels nothing.** In electron-updater 6.8.9, `BaseUpdater.quitAndInstall` calls
  `install()`, which starts the installer detached, and only then calls `app.quit()` in a
  `setImmediate`. The installer is already running when the question appears.
- The NSIS installer started with `--updated` doesn't wait for anyone. `_CHECK_APP_RUNNING` in
  app-builder-lib's `templates/nsis/include/allowOnlyOneInstallerInstance.nsh` sleeps 300 ms, sleeps
  another 1000 ms if the app is still there, and then kills every process whose path starts with
  `$INSTDIR`: `Stop-Process`, or `taskkill` without PowerShell, and a forced kill on the retry. If
  the operator answers «Cancel» because something is live, the app dies anyway ~1.3 s later, with
  the projector on and the service in progress.
- What the app does instead: «Restart and update» asks first, in the control window, with
  `quitRisks()` (`effects/draft-autosave.ts`), the same function that answers `close-requested`.
  Only with the OK does it send `updates:install`. Main calls `BaseUpdater.install(true, true)`
  directly, never `quitAndInstall`. Only if the installer started does it call
  `releaseForUpdate()`, which marks the control window as already cleared so the guard doesn't ask
  a second time, and then `app.quit()`. If the installer couldn't start, the app stays open and the
  guard still protects the next quit.
- The same reasoning holds for «When the app closes». It installs from `app.once("quit")`, which
  only fires after the close guard has let the quit through.
- The E2E suite can only show the macOS side of this (`updates.spec.ts`: with something live,
  «Cancelar» opens no installer). The kill timing is NSIS's, and it gets checked on a real Windows
  machine.

Related: [the install-on-quit handler](electron-updater-arms-install-on-quit-only-when-the-download-finishes.md),
[vetoing a close during a quit](vetoing-a-close-during-a-quit-cancels-the-quit.md).

**Last updated:** 2026-10-26
