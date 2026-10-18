## Chromium plays a file it can only half-decode without ever firing `error`: sound over black, or a picture with no sound
**Area:** projection / renderer
**Trigger:** a video that projects black while its audio plays, or plays with no sound; deciding
whether a file "plays" by its extension or by waiting for `onError`; touching
`src/main/media/media-compat.ts`, `ASSET_EXTENSIONS` or the media `onError` reporting in `output-view.tsx`.

- **Believed:** a file Chromium cannot play fails, the projector's `onError` fires, and the red band
  tells the operator (`projection:reportMediaError`). **True only when the CONTAINER cannot be opened.**
  Measured on 2026-10-18 with Electron 44 on macOS, one generated file per container/codec pair
  (frames decoded and `webkitAudioDecodedByteCount` after 1.2 s of play):
  - Opening fails with `MEDIA_ERR_SRC_NOT_SUPPORTED` and `DEMUXER_ERROR_COULD_NOT_OPEN`: AVI with any codec,
    ASF (WMV/WMA), FLV, MPEG-PS (MPG/VOB), MPEG-TS, AIFF, AC3/E-AC3/DTS elementary streams.
  - **No error at all, and sound over a black picture:** ProRes or DNxHD in a `.mov`, MPEG-4 part 2
    (Xvid/DivX) or MJPEG in an `.mp4`, Theora in Ogg. `readyState` reaches 4, `videoWidth` stays 0,
    and the audio plays.
  - **No error at all, and a picture with no sound:** AC3, E-AC3, DTS or ALAC audio next to a valid
    H.264 track, and MP2 audio even inside an `.mp3`.
  - PCM plays in WAV (u8, s16/24/32, f32, µ-law), not ADPCM.
- **Consequence:** whether a file plays has to be decided from its STREAMS (ffprobe), before the
  operator ever projects it. Neither the extension nor the `error` event can say it. That is
  `planPlayback` in `media-compat.ts`, and the table above is its test suite
  (`tests/main/media-compat.test.ts`).
- **H.264 is only trusted in 8-bit 4:2:0** even though macOS decoded High 10, 4:2:2 and 4:4:4 fine:
  that was VideoToolbox, and the church machine is Windows, where hardware decoders take none of those.
  HEVC's support depends on the GPU, so the control window asks Chromium
  (`MediaSource.isTypeSupported('video/mp4; codecs="hvc1…"')`) and reports it
  (`conversion:reportDecoders`). Main decides nothing about an HEVC file before that.
- The calibration harness (an Electron script that loads each file in a `<video>` and prints frames and
  audio bytes) is the way to re-measure after an Electron upgrade, and especially on Windows.

**Last updated:** 2026-10-18
