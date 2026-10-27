## A renderer `fetch` of `worship://` needs `connect-src`, or a model slide never paints
**Area:** renderer
**Trigger:** a slide drawn from its model (`ModelSlide`, `lib/slide-models.ts`) shows nothing in the app but draws in a test page; adding any `fetch`, `FontFace` or XHR against `worship://` in the control or projection window

- The CSP in `src/renderer/index.html` and `src/renderer/projection.html` allowed `worship:` only
  where the app had used it so far: `img-src` and `media-src`. A `fetch()` is `connect-src` and a
  `FontFace` url is `font-src`, and both were `'self'` only — so the first renderer code that
  *fetched* from the protocol (a slide's `SlideModel` JSON, 2026-10-26) was blocked.
- It fails silently: `fetch` rejects, `loadSlideModel` returns `null`, and the stage stays empty.
  The only trace is a console line in the app log:
  `Connecting to 'worship://deck/2/1/model' violates the following Content Security Policy
  directive: "connect-src 'self'". The action has been blocked.`
- The page the renderer's fidelity is measured in mounts `SlideView` with no CSP, so every slide
  drew there while the app drew none. Only the E2E suite, which runs the real windows, caught it.
- Both windows now carry `connect-src 'self' worship:` and `font-src 'self' worship:`. Anything new
  the renderer loads from the protocol by a means other than `<img>`/`<video>`/`<audio>` needs its
  directive checked in BOTH files — and verifying it means the E2E suite or the app, never a
  harness page.

**Last updated:** 2026-10-26
