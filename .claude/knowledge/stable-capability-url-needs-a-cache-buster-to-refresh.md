## A stable `worship://` URL (like `worship://logo`) never re-fetches its `<img>` unless something in the URL string actually changes
**Area:** renderer, protocol
**Trigger:** adding or touching a setting that replaces a single file served behind a fixed
capability host (not one addressed by a DB id), e.g. the logo picker or any future "upload one
file for X" setting.

- `worship://logo` is resolved in `worship-protocol.ts` by reading `settings.logo.path` fresh on
  every request — the *server* side was never the problem. The bug was entirely on the renderer
  side: `App.tsx` rebuilt the `<img>` URL as the literal constant `"worship://logo"` inside a
  `useEffect` keyed on `logoPath`. The effect *did* re-fire when a new file was picked, but the
  value it produced (`"worship://logo"`) was byte-identical to the previous render, so React never
  changed the `src` attribute and the browser never re-requested the file — the old image stayed
  on screen (in both the settings thumbnail and the projector) until a full reload.
- This is not primarily an HTTP-caching problem (the protocol handler sets no `Cache-Control` for
  `logo`) — it's that an unchanged `src` string is a no-op for `<img>` regardless of what the
  server would return.
- Fix: fold the thing that actually changed into the URL itself —
  `${LOGO_URL}?p=${encodeURIComponent(logoPath)}` — so the string only changes exactly when the
  file changes, and stays stable otherwise (no needless re-fetch on unrelated re-renders). No
  protocol change needed: `worship-protocol.ts` resolves purely by `url.hostname`/`pathname` and
  never inspects the query string, so an extra `?p=...` is silently ignored server-side. Applied in
  both `App.tsx` (drives the projector's logo) and `pages/settings/sections/projection-section.tsx`
  (drives the settings thumbnail) — keep both in sync if this pattern is reused elsewhere.

**Last updated:** 2026-09-09
