import { cn } from "@renderer/lib/utils";

/** One run of a string, flagged as matched or not. Structurally the same as
 *  `SnippetSegment` from `shared/types/bible.ts` (which is what produces these
 *  today) without this primitive having to know about scripture. */
export type TextSegment = { match: boolean; text: string };

type HighlightedTextProps = {
  className?: string;
  segments: readonly TextSegment[];
};

/**
 * Renders pre-split text with the matched runs emphasized.
 *
 * It takes SEGMENTS, never a string with markup in it — that is the whole
 * point. The search results used to be painted with
 * `dangerouslySetInnerHTML` over a string FTS5 had wrapped in `<mark>` tags,
 * which meant the text of a verse (from a JSON file the operator imported)
 * was interpreted as HTML in the control window, script and all. Segments
 * cannot do that: every piece goes through React as text.
 *
 * It also settles the highlight's colour, which the browser's default
 * `<mark>` (yellow on yellow, in a dark cabin) did not.
 */
export function HighlightedText({ className, segments }: HighlightedTextProps) {
  return (
    <span className={cn(className)}>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark className="rounded-sm bg-primary/30 px-0.5 text-foreground" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
