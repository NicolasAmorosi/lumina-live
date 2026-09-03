/**
 * URLs are capability tokens, never filesystem paths: the `worship://` protocol
 * handler (src/main/protocol/worship-protocol.ts) resolves them by DB id / session
 * id, so nothing here can path-traverse and a relocated file keeps the same URL.
 */
export function assetUrl(mediaAssetId: number): string {
  return `worship://asset/${mediaAssetId}`;
}

export function slideUrl(sessionId: string, slideIndex: number): string {
  return `worship://slide/${sessionId}/${slideIndex}.png`;
}

export const LOGO_URL = "worship://logo";
