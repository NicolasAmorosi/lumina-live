## electron-builder's `${platform}` macro is the BUILD host's platform, so a top-level `extraResources` built a Windows installer with no FFmpeg in it
**Area:** build
**Trigger:** adding anything per-platform to `build.extraResources`/`files` in `package.json`; a
cross-built installer missing a resource that the macOS build has; `file source doesn't exist` in
the `electron-builder` log; touching `scripts/fetch-ffmpeg.ts`.

- **Believed:** `"from": "resources/ffmpeg/${platform}-${arch}"` at the top level of `build.extraResources`
  resolves per TARGET, so `npm run package:win` on the Mac picks `resources/ffmpeg/win32-x64`.
  **False.** Measured on 2026-10-18: `${arch}` follows the target (`x64`), but `${platform}` is
  `process.platform` of the machine running electron-builder, so the cross-build looked for
  `resources/ffmpeg/darwin-x64`. It printed `• file source doesn't exist from=…/resources/ffmpeg/darwin-x64`
  (twice), carried on, exited 0, and produced a complete-looking `WorshipApp Setup 2.2.0-beta.1.exe` of
  133 MB with no `resources/ffmpeg/` at all. The macOS build was correct, because host and target
  happen to match there. Only a Windows build can show the bug.
- **The fix:** an `extraResources` entry inside each platform block (`build.win`, `build.mac`,
  `build.linux`), naming the platform literally and keeping only `${arch}`. The shipped Windows build
  then carries `ffmpeg.exe`, `ffprobe.exe`, `LICENSE.txt` and `NOTICE.txt`, and the installer grows
  to 189 MB.
- **A second trap with the same symptom:** `electron-builder --win --dir` ignores the `arch: ["x64"]`
  of the NSIS target and packages the HOST arch (`win-arm64-unpacked`, looking for `win32-arm64`).
  Check a Windows package with `npm run package:win`, never `--dir`.
- **The check that catches it:** `ls release/win-unpacked/resources/ffmpeg/` after `package:win`, and
  for the Mac `WORSHIP_E2E_EXECUTABLE=…/WorshipApp.app/Contents/MacOS/WorshipApp npx playwright test`,
  which runs the E2E suite (conversion included) against the packaged app.

**Last updated:** 2026-10-18
