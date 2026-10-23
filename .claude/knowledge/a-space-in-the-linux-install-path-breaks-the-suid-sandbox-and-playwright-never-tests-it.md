## A space in the Linux install path breaks Chromium's setuid sandbox, and the E2E suite can't see it because Playwright adds `--no-sandbox` on Linux
**Area:** build
**Trigger:** touching `build.linux` or `package:linux` in `package.json`; `LaunchProcess: failed to execvp:`
or `Zygote process exited prematurely` from a Linux build; «The SUID sandbox helper binary was found,
but is not configured correctly»; reading a green E2E run against a Linux package as proof that it
opens.

- **The .deb installs to `/opt/<productName>`**, and `productName` is «Lumina Live». Chromium's setuid
  sandbox puts its helper in front of the zygote with `CommandLine::PrependWrapper`, which splits the
  wrapper string on spaces ("gdb --args" style), so `/opt/Lumina Live/chrome-sandbox` became
  `execvp("/opt/Lumina")`. Measured 2026-10-23 in Ubuntu 24.04 (Docker): the installed .deb died at
  once with `LaunchProcess: failed to execvp: /opt/Lumina` and
  `FATAL:zygote_host_impl_linux.cc:213] Zygote process exited prematurely with exit code 127` —
  from the desktop entry, from `/usr/bin/worship-app` and from the full path alike.
- **It only bites in setuid mode.** The .deb's postinst (`app-builder-lib/templates/linux/after-install.tpl`)
  runs `unshare --user true`: if user namespaces work it leaves `chrome-sandbox` at 0755 and installs an
  AppArmor profile with `userns` (Ubuntu 24.04+), and Chromium never prepends a wrapper; only without
  them does it `chmod 4755` and take the broken path. So a desktop Ubuntu would probably have opened —
  and a Debian without unprivileged user namespaces, a hardened kernel or a container would not.
- **Fix:** `package:linux` passes `-c.productName=lumina-live` (there is no per-platform `productName`
  in `build`), so the app lives in `/opt/lumina-live`; `build.linux.desktop.entry.Name` keeps «Lumina
  Live» in the menu. `productName` doesn't reach the packaged `package.json`, so the userData folder is
  unchanged (see [electron-userdata-follows-package-name-not-build-productname.md](electron-userdata-follows-package-name-not-build-productname.md)).
  Verified the same day in both modes: `live.spec` + `startup.spec` 11/11 with `chrome-sandbox` at
  755 (namespaces) and at 4755 (`/proc/sys/user/max_user_namespaces` set to 0 in a `--privileged`
  container), every process without `--no-sandbox`.
- **Why the suite never caught it:** Playwright's `_electron.launch` adds `--no-sandbox` on Linux
  (seen in `/proc/<pid>/cmdline` of the browser and the zygotes during `startup.spec`). A green run
  against the AppImage or the .deb says nothing about whether a double-click opens it. To run the
  suite with the real sandbox, point `WORSHIP_E2E_EXECUTABLE` at a wrapper that drops that flag:
  `args=(); for a in "$@"; do [ "$a" = --no-sandbox ] || args+=("$a"); done; exec /opt/lumina-live/worship-app "${args[@]}"`.
- **Docker's own limits, so they aren't mistaken for the app's:** without `--privileged` neither mode
  works (`Failed to move to new namespace: … errno = Operation not permitted`: no `CAP_SYS_ADMIN`, not
  even for a setuid helper), and there is no AppArmor, so the Ubuntu 24.04 desktop path (namespaces +
  the installed profile) is the one thing only a real Ubuntu can confirm. Measured natively the same
  day on an Ubuntu host with `kernel.apparmor_restrict_unprivileged_userns=1`: `unshare --user true`
  still succeeds there (creating the namespace is allowed, its capabilities are not), so the postinst
  leaves `chrome-sandbox` at 0755 and everything rests on the AppArmor profile loading — in a
  container it can't, and the app aborts with the SUID helper message. The AppImage has no root-owned
  helper and no profile, so on Ubuntu 24.04+ it needs `--no-sandbox` — that is why the .deb exists.

**Last updated:** 2026-10-23
