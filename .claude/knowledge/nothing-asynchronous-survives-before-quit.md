## Nothing asynchronous scheduled during `before-quit` ever runs — and a detached child outlives a crash
**Area:** slides, build
**Trigger:** touching `app.on("before-quit")` in `src/main/index.ts`, `shutdownSlides`, `killRunningSoffice`/`killTree` in `src/main/slides/libreoffice.ts`, or adding any cleanup that has to happen on exit.

- `killTree` did SIGTERM and then armed a `setTimeout(…, 5000).unref()` as the backup SIGKILL. On the
  quit path **that timer never fired once**: the process is gone in milliseconds. So the "backup"
  did not exist, and a `soffice` mid-render — which does ignore SIGTERM for a while — simply
  survived the app. Same trap on Windows: `execFile("taskkill", …)` with a callback is asynchronous,
  so it was being abandoned before it ran. The shutdown path now sends SIGTERM **and** SIGKILL in the
  same synchronous call (`killTree(child, immediate)`), and uses `execFileSync` on Windows.
  Generalize it: on `before-quit` there is no event loop turn left — no timer, no promise, no
  callback, no `fs.promises`. Only straight-line synchronous work.
- The survivor is not merely untidy. Children are spawned `detached` (their own process group, so
  `killTree` can reach `soffice.bin` behind `soffice`), which also means they outlive main — and a
  live `soffice` keeps the lock file and named pipe of the shared `-env:UserInstallation` profile.
  Every conversion on the **next** start then fails silently, producing nothing and exiting 1: the
  exact failure the dedicated profile exists to prevent
  ([soffice-shared-profile-race.md](soffice-shared-profile-race.md)).
- A crash skips `before-quit` entirely, so the quit-path fix cannot be the only defence.
  `reapOrphanedSoffice()` runs at startup, before `locateSoffice`, and kills by matching our own
  `-env:UserInstallation=<profile url>` in the command line (`pkill -f`). Matching on that argument
  rather than the image name is what makes it safe: a copy of LibreOffice the user has open as a
  normal GUI app runs on the default profile and is never touched. The profile path lives under the
  user data directory and routinely contains regex metacharacters, so it must be escaped before it
  reaches `pkill`. Verified against real processes — two `soffice` alive, one on our profile and one
  on another, both paths containing `(` and `[`; only ours died.
- **Windows has no equivalent** that can filter by command line without PowerShell/WMI, which this
  project deliberately does not use. There, a crash's orphan is still only cleared by
  `resetSofficeProfile` after the resulting timeouts — a known, documented gap, not an oversight.

**Last updated:** 2026-09-11
