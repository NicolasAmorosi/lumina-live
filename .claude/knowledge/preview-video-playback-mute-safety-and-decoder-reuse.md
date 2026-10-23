## Muting a preview `<video>` is airtight against the OS, but not against hardware media keys — and the preview element must be reused, not re-keyed
**Area:** projection, renderer
**Trigger:** touching `OutputView`'s `mode` prop, `LiveVideo`, `preview.store.ts`, or anything that lets a video actually play in the preview/monitor column instead of showing a frozen frame.

- `HTMLMediaElement.muted`/`volume` are per-element flags applied inside the renderer's audio
  pipeline, before samples reach the OS mixer. The system mute key and volume keys change output
  *gain*; they cannot un-mute an element — amplified silence is still silence. There is no path
  from the OS to `element.muted`. `webContents.setAudioMuted()` is the same kind of app-level gate,
  one level up.
- The real risk is Chromium's Media Session integration: hardware media keys (macOS F8, Bluetooth/
  AirPods controls, the *Now Playing* widget) can **pause/resume** a media element system-wide.
  This is a latent risk on the projector's own live video too, independent of any preview feature —
  an accidental F8 can pause what the congregation is watching. A muted element likely doesn't
  claim a Media Session (it requires audible content), but this was not empirically verified.
  `app.commandLine.appendSwitch("disable-features", "HardwareMediaKeyHandling,MediaSessionService")`
  in `src/main/index.ts` before `app.whenReady()` removes the whole class of risk for both windows,
  but was intentionally left out as a default — it's a one-line follow-up, not implemented.
- `output-view.tsx`'s mute must be a whitelist (`muted={mode !== "live"}`), not a check against one
  named mode (`mode === "monitor"`) — a third mode (`"preview"`) added later must be muted by
  default without anyone remembering to update the condition. A second, independent gate
  (`element.volume = 0` for every non-`"live"` mode, set in the ref-attach callback) exists so a
  future regression in one gate doesn't make the element audible on its own.
- The preview's `<video>` (see [`worship-protocol-range-and-video-lifecycle.md`](worship-protocol-range-and-video-lifecycle.md)
  for why `videoUnderlay` exists at all) keeps `epoch` **frozen at 0 forever** across every target
  change in the preview, unlike the live video's `videoEpoch` which increments per GO LIVE. The
  preview target changes on every single click in the resource library; re-keying the element on
  each one would tear down and rebuild a decoder in rapid succession — the exact churn pattern that
  produces `PIPELINE_ERROR_DECODE (-12909)` on macOS's hardware decoder. Only the `src` attribute
  changes; React reuses the same `<video>` element across clips.
- Preview playback is therefore never automatic: only an explicit play button
  (`togglePreviewPlayback` in `lib/actions/preview-playback.ts`) starts it, and `goLive()` always
  calls `stopPreviewPlayback()` before projecting — so there is never more than one active decode
  of a given file, and the preview and the projector never fight over the same source concurrently.
- The preview's own clock (`positionSeconds`/`durationSeconds`/`playing` in `preview.store.ts`,
  reported by `use-preview-media-status.ts`) is intentionally **local and non-IPC** — it must never
  be written into `projection.store.mediaStatus`, which is keyed by `mediaTargetKey` and belongs
  exclusively to the projection window's real elements (see
  [`media-status-is-per-target-not-a-single-slot.md`](media-status-is-per-target-not-a-single-slot.md)).
  Mixing them in would let the preview's clock collide with the live video's under the same key.

**Last updated:** 2026-09-09
