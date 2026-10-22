## Electron names the userData folder after package.json `name`, not `build.productName` — the rebrand never moved the data
**Area:** build
**Trigger:** touching `name`, `productName` or `appId` in `package.json`, `app.setName()`, `app.setPath("userData")`, or `userDataDir` in `src/main/paths.ts`; any rename or rebrand.

- Believed (2026-10-22, during the rename to Lumina Live): Electron derives `userData` from
  `productName`, so changing `build.productName` from "WorshipApp" would make the first launch of
  the renamed installer open an EMPTY profile. A pin to `<appData>/WorshipApp` was written for it.
  True: `productName` here lives inside `build`, which is electron-builder config. electron-builder
  does NOT copy it into the shipped `package.json` (checked with `@electron/asar` on
  `release/mac-arm64/Lumina Live.app/Contents/Resources/app.asar`: `name: "worship-app"`, no
  `productName`), so `app.name` is `"worship-app"` in dev AND packaged, and the profile has always
  been `<appData>/worship-app` (`%APPDATA%\worship-app` on the church PC; the legacy vanilla app
  had the same `name`). The pin would have pointed the church's app at an empty folder — the very
  bug it was meant to prevent. It was reverted before commit.
- What `build.productName` DOES change: the `.app`/`.exe` name, `CFBundleName`, the install folder,
  the shortcut and the installer file name. Not `app.name`, not the macOS menu's `app.name`
  labels, not `userData`.
- So the rule is the other way round: **never change package.json `name`** (`worship-app`) — THAT
  is what would orphan every profile. And keep `appId` (`com.worshipapp.app`): electron-builder
  derives the NSIS uninstall key from it, so a new `appId` installs beside the old app instead of
  replacing it.
- How it was caught: a probe that launches the packaged app WITHOUT `--user-data-dir` (the E2E
  suite always passes one, so it can never see the default) and reads `app.name` and
  `app.getPath("userData")`. Do that before trusting any reasoning about the default path. The
  probe itself creates a profile in whatever folder it resolves to.

**Last updated:** 2026-10-22
