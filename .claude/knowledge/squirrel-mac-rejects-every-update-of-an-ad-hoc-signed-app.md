## Squirrel.Mac rejects every update of an ad-hoc signed app
**Area:** build
**Trigger:** touching `src/main/updates/mac-dmg.ts`, thinking of `MacUpdater` or a `zip` mac target, or changing the mac signing (`"identity": "-"`)

- electron-updater has a full macOS updater (`MacUpdater`), and the assumption was that it only
  needs a `.zip` next to the `.dmg`. **No ad-hoc signed build can ever pass it.** `MacUpdater`
  hands the new bundle to Squirrel.Mac. Squirrel checks it against the *designated requirement* of
  the app that is RUNNING (`SQRLCodeSignature.m`: `SecCodeCopyDesignatedRequirement` +
  `SecStaticCodeCheckValidityWithErrors`). For an ad-hoc signature, that requirement is the hash of
  that one build.
- Measured on 2026-10-23: `codesign -dr -` gives `designated => cdhash H"bebe758d…"` for 2.2.0-beta.4
  and `cdhash H"c8c817e3…"` for beta.5. A later test build gives a third hash. Checking beta.5
  against beta.4's requirement,
  `codesign --verify --deep --strict -R='cdhash H"bebe758d…"' <beta.5 .app>`, fails with
  `code failed to satisfy specified code requirement(s)`, exit 3. Beta.4 against its own requirement
  passes (exit 0).
- That's why `mac-dmg.ts` exists. The app downloads the `.dmg` itself with `net.fetch`, checks it
  against the `latest-mac.yml` sha512 and opens it, and the operator drags the app over the old one.
  The profile lives in `~/Library/Application Support/worship-app`, so replacing the bundle doesn't
  touch it.
- With a Developer ID, the designated requirement names the team instead of a hash. Then: add the
  `zip` mac target, let `MacUpdater` do it, and drop `mac-dmg.ts`. The interface doesn't change,
  since `opensInstaller` in the `downloaded` status is what tells it which buttons to show.

**Last updated:** 2026-10-26
