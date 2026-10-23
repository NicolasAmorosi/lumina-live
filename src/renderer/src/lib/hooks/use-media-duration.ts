import { useEffect, useState } from "react";

/**
 * Reads a video/audio file's duration without playing it — a detached element
 * (never mounted, never appended to the DOM) loaded with `preload="metadata"`
 * only. Used by the preview media bar, which must stay silent: the operator
 * hasn't gone live yet.
 *
 * Returns `null` while unknown (no url, or metadata not loaded yet).
 */
export function useMediaDuration(url: string | null, kind: "video" | "audio"): number | null {
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    setDuration(null);
    if (!url) return;

    const element = document.createElement(kind);
    element.preload = "metadata";
    element.src = url;

    const onLoadedMetadata = () => {
      if (Number.isFinite(element.duration)) setDuration(element.duration);
    };
    element.addEventListener("loadedmetadata", onLoadedMetadata);

    return () => {
      element.removeEventListener("loadedmetadata", onLoadedMetadata);
      // Stop the request in flight; an unmounted element with no listeners
      // would otherwise keep downloading in the background.
      element.src = "";
    };
  }, [url, kind]);

  return duration;
}
