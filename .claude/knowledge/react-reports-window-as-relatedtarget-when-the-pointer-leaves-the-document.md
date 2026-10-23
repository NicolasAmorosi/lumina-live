## React's `onMouseLeave` reports `window` as `relatedTarget` when the pointer leaves the document
**Area:** ui (`src/renderer/src/components/ui/tooltip.tsx`)
**Trigger:** «An unexpected error occurred» after moving the mouse; `Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'.`; any `node.contains(e.relatedTarget)` in a leave/blur handler.

- `Tooltip.close()` did `triggerRef.current?.contains(e.relatedTarget as Node)`. The cast is a lie:
  React's enter/leave plugin synthesizes `onMouseLeave` from `mouseout`, and when the native event
  has no `relatedTarget` (the pointer left the document) it substitutes the `window` object. Native
  `mouseout` would have said `null`, which `contains()` accepts; `window` throws.
- So moving the pointer from any button with a tooltip straight out of the window — up from the top
  bar into the title bar, or across to the projector's screen — threw an uncaught `TypeError`, and
  `lib/global-error-handlers.ts` showed the operator the «unexpected error» toast. Found by the E2E
  teardown's unexpected-error check (intermittent there: it depends on the path Playwright's mouse
  takes), then reproduced deterministically with `mouse.move(x, -20)` after a hover
  (`tests/e2e/robustness.spec.ts`, «the pointer leaving the window…»).
- Rule: narrow with `instanceof Node` before `contains()`, never cast. Drag events
  (`onDragLeave`) are not synthesized by that plugin and pass the native `relatedTarget`.

**Last updated:** 2026-10-18
