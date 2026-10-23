## Chromium reuses a media url's data across `<video>` elements, so bytes that change behind a url need a url that changes too — and `Cache-Control: no-store` does not stop it
**Area:** projection / renderer / protocol
**Trigger:** a `<video>`/`<audio>` that fails (`MEDIA_ERR_SRC_NOT_SUPPORTED`, code 4,
`DEMUXER_ERROR_COULD_NOT_OPEN` in the log) on a url main is now serving correctly; anything that
makes `worship://asset/<id>` serve different bytes during a session (the conversion service,
a relocate); touching `playableAssetUrl` in `stores/conversion.store.ts`.

- **Believed:** `worship://asset/<id>` is a capability token resolved fresh by main on every
  request, so once `conversion-service.ts` has a converted copy, every NEW element that loads the
  url gets the copy. **False within one renderer.** Measured on 2026-10-18 (Electron 44, macOS):
  an AVI previewed ~100 ms after import — before its "queued" state arrived — failed, as it
  should. Three seconds later the conversion finished, the PREVIEW monitor unmounted its status
  panel and mounted a brand-new `<video src="worship://asset/1">`, main served the MP4 (the
  `media_conversions` row and the file were both right), and the new element failed again with
  error code 4 and a second `DEMUXER_ERROR_COULD_NOT_OPEN` in the log. A detached
  `document.createElement("video")` with the same string failed too; the same url plus
  `?fresh=1` loaded the 1920-wide copy at once.
- **`Cache-Control: no-store` on the response changed nothing** (tried and reverted). This is
  Chromium's media data cache, keyed by url and shared by every media element of a renderer
  process, not the HTTP cache. It has the same shape as
  [stable-capability-url-needs-a-cache-buster-to-refresh.md](stable-capability-url-needs-a-cache-buster-to-refresh.md),
  but that one is an `<img>` whose `src` string never changed. Here a new element was given a
  string it had already loaded once.
- **The rule:** when the bytes behind a `worship://` url can change during a session, the url
  string has to change with them. `playableAssetUrl` / `usePlayableAssetUrl` add `?v=<copy>`, the
  converted file's name (`MediaConversionUpdate.version`). Main serves the copy ONLY to a url
  carrying it, and the bare url always serves the original.
- **Serving by url is the second half, and it matters as much.** The first version served the copy
  to every request for the id and ignored the query. Then an element that started on the original
  (a native-looking `.mkv` with AC3, projected before its probe finished) got the copy's bytes on its
  next Range request when the copy landed, and playback died mid-song (found in the review of the
  same day). A video's url is resolved once at GO LIVE and travels in `BaseContent` (`url`), because
  `selectOutput` must stay pure. Reading the store there would also have swapped the file on the
  next recompute, e.g. a BLACK toggle.
- **The same rule for slide clips:** `deckVideoUrl`/`deckAudioUrl` carry the clip's file name
  (`?f=`), which changes when `media/deck-clips.ts` replaces it, and the protocol serves the file
  named.
- **When this can bite:** any load of the original before its conversion state reaches the
  renderer: a click inside the 300 ms reconcile debounce, a "native-looking" `.mp4`/`.mov` whose
  codec only ffprobe can rule out (MPEG-4 part 2, ProRes, AC3), or HEVC on a GPU that cannot
  decode it during the first launch's probe of a whole library. Images are never converted and
  keep the plain `assetUrl`.

**Last updated:** 2026-10-18
