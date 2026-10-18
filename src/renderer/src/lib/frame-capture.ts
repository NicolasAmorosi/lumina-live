/**
 * The canvas size for a still of a video frame shown in a `boxWidth` ×
 * `boxHeight` device-pixel box with `object-contain`: the contained size,
 * never larger than the source (upscaling adds bytes, not detail). A box
 * with no size — not laid out, or already detached — falls back to the
 * source size, which is what the still used to be before it was sized at all.
 */
export function frameCaptureSize(
  videoWidth: number,
  videoHeight: number,
  boxWidth: number,
  boxHeight: number,
): { width: number; height: number } {
  if (boxWidth <= 0 || boxHeight <= 0) return { width: videoWidth, height: videoHeight };
  const scale = Math.min(1, boxWidth / videoWidth, boxHeight / videoHeight);
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}
