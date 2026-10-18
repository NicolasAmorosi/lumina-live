## The Windows **installer** cannot be cross-built on an Apple Silicon Mac without Rosetta — the Windows **app** builds fine
**Area:** build
**Trigger:** `npm run package:win` failing with `Cannot spawn …/nsis-3.0.4.1/…/mac/makensis: Error: spawn Unknown system error -86`, or any claim that the Windows installer cross-builds from macOS.

- `Unknown system error -86` is errno 86 = `EBADARCH`, "bad CPU type in executable". Node surfaces it
  raw, so the message names neither the architecture nor Rosetta, and the stack points only at
  `NsisTarget.executeMakensis`. The cause: electron-builder ships NSIS **3.0.4.1**, whose `mac/makensis`
  is a **2019 x86_64-only Mach-O**, and this machine is an M3 with the Rosetta 2 runtime absent
  (`/Library/Apple/usr/libexec/oah` holds only `RosettaLinux`, and `oahd` is not running).
- **Not a regression of the Electron 36 → 44 / electron-builder 25 → 26 upgrade.** electron-builder 25
  had already downloaded the *same* NSIS 3.0.4.1 into the older cache layout
  (`~/Library/Caches/electron-builder/nsis/nsis-3.0.4.1`), and that copy's `makensis` is x86_64 too. Both
  versions fail identically here for a reason that has nothing to do with either of them.
- **What still gets produced matters more than what fails.** The step that dies is only the last one,
  wrapping the payload in a `Setup.exe`. Before it, electron-builder writes a complete
  `release/win-unpacked/` — `WorshipApp.exe` as `PE32+ x86-64`, Electron v44.3.0, `bibles/` and
  `migrations/` in `resources/`, and better-sqlite3's `win32-x64.node` correctly unpacked out of the
  asar — plus `worship-app-2.0.0-x64.nsis.7z`, the installer's 132 MB payload. So a Windows build can
  be delivered as a zipped folder even while the installer cannot be produced on this machine.
- The fix is environmental, not a config change: `softwareupdate --install-rosetta` (admin, and it
  prompts for a licence, so it is the user's to run). Do **not** "fix" it by pinning a different NSIS
  or switching the target — the app packaging is already correct.
- Corollary for [`better-sqlite3-napi-prebuilds.md`](better-sqlite3-napi-prebuilds.md), which says the
  Windows installer cross-compiles from macOS: the *native module* half of that claim is confirmed here
  (the win32-x64 prebuild ships with zero rebuild), but the *installer* half does not reproduce on this
  machine today.

- **Update 2026-10-18: Rosetta is installed on this M3 now** (`arch -x86_64 /usr/bin/true` succeeds), and
  `npm run package:win` builds `WorshipApp Setup 2.2.0-beta.1.exe` end to end, NSIS included. The
  diagnosis above still holds for any other Apple Silicon machine without Rosetta. A Windows installer
  that builds is not one that is complete, though: see
  [electron-builder-platform-macro-is-the-build-host-not-the-target.md](electron-builder-platform-macro-is-the-build-host-not-the-target.md).
