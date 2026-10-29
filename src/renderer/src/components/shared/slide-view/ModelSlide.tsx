import type { ReactNode } from "react";
import type { SlideTextSettings } from "@shared/types/slide-model";
import { partResolver, useSlideModel } from "@renderer/lib/slide-models";
import { useProjectionStore } from "@renderer/stores/projection.store";
import { SlideView } from "./SlideView";

/**
 * A slide drawn from its model, fitted into whatever box it is given the way
 * `<img object-contain>` fits a slide image: centred, its own proportions,
 * letterboxed. The box is a size container of its own because the views it
 * sits in (`OutputView`) are `inline-size` containers, where `cqh` resolves
 * against something else entirely.
 *
 * `text` is the output's on a monitor and on the projector, which has no
 * settings; a grid or a library tile takes the control window's own, the
 * same value `App` mirrors into every output.
 */
export function ModelSlide({ onError, text, url }: { onError?: () => void; text?: SlideTextSettings; url: string }): ReactNode {
  const shown = useSlideModel(url, onError);
  const mirrored = useProjectionStore((s) => s.slideText);
  if (!shown) return null;
  const ratio = shown.model.width / shown.model.height;
  return (
    // `aria-hidden` for the reason the slide image had `alt=""`: what names a
    // tile is its number, and the slide's own text inside a button's name
    // would bury it.
    <div
      aria-hidden="true"
      className="absolute inset-0 flex items-center justify-center"
      // The slide actually painted, which lags `url` while the next one loads.
      data-slide-model={shown.url}
      style={{ containerType: "size" }}
    >
      <div style={{ width: `min(100cqw, ${ratio} * 100cqh)` }}>
        {/* Keyed by slide, so a new slide is a new tree. Reused, its SVG (in
            EMU) was repainted only up to x ≈ 8.39M EMU — 2^23 — and the rest
            of the previous slide stayed on the projector. See
            .claude/knowledge/a-slide-svg-in-emu-repaints-only-below-2-23-so-a-new-slide-must-be-a-new-tree.md */}
        <SlideView key={shown.url} model={shown.model} resolve={partResolver(shown.url)} text={text ?? mirrored} />
      </div>
    </div>
  );
}
