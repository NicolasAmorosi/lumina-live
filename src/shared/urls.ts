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
