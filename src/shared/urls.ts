/**
 * URLs are capability tokens, never filesystem paths: `worship://asset/42`
 * resolves through the DB in the main process, so nothing here can
 * path-traverse and a relocated file keeps the same URL (React never has to
 * remount a player because a path changed).
 */
export function assetUrl(mediaAssetId: number): string {
  return `worship://asset/${mediaAssetId}`;
}

/**
 * A small, cached thumbnail of an image or video asset, generated on demand by
 * `main/media/thumbnail-service.ts`. 404 when there is none (an audio file, an
 * unsupported platform, a broken decode) so the renderer paints its own
 * themed fallback instead of a browser-drawn broken image.
 *
 * `version` is NOT optional on purpose. The response is served `immutable`, so
 * a stable URL would pin the first thumbnail ever generated for this id for a
 * year — exactly the bug the logo picker hit
 * (`.claude/knowledge/stable-capability-url-needs-a-cache-buster-to-refresh.md`).
 * Making the argument required turns "I forgot the cache-buster" into a
 * compile error rather than a stale picture nobody can explain.
 *
 * Build it with `assetThumbVersion(asset)` so every call site derives it the
 * same way.
 */
export function assetThumbUrl(mediaAssetId: number, version: string): string {
  return `worship://asset/${mediaAssetId}/thumb?v=${encodeURIComponent(version)}`;
}

/** The identity of an asset's *bytes*, as far as thumbnails care: size + mtime,
 *  the same cheap identity `slide_decks` already trusts for its cache hit.
 *  Deliberately not `updatedAt` — that changes on unrelated DB writes and does
 *  NOT change when the file is edited outside the app, which is precisely
 *  backwards for a cache-buster. */
export function assetThumbVersion(asset: {
  sizeBytes: number | null;
  mtimeMs: number | null;
}): string {
  return `${asset.sizeBytes ?? 0}-${asset.mtimeMs ?? 0}`;
}

/**
 * Slide images are addressed by deck id + index and resolved against
 * `deck_slides`. A (deckId, slideIndex) pair is immutable by construction —
 * changing the source file yields a different content hash and therefore a
 * different deck id — which is what lets the protocol handler serve them with
 * a long immutable Cache-Control.
 *
 * Built by main when assembling a `DeckDTO`; the renderer reads `slide.url`.
 */
export function slideUrl(deckId: number, slideIndex: number): string {
  return `worship://deck/${deckId}/${slideIndex}`;
}

export function slideThumbUrl(deckId: number, slideIndex: number): string {
  return `worship://deck/${deckId}/${slideIndex}/thumb`;
}

export function deckAudioUrl(audioId: number): string {
  return `worship://deck-audio/${audioId}`;
}

/** A deck's *linked* soundtrack — an external file the source presentation
 *  points at (or sits next to), resolved per media asset rather than baked
 *  into the content-addressed deck cache. See `linked-audio.ts`. */
export function linkedAudioUrl(mediaAssetId: number): string {
  return `worship://linked-audio/${mediaAssetId}`;
}

export const LOGO_URL = "worship://logo";
