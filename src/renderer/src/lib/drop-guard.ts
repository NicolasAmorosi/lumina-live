/**
 * Neutralizes Chromium's default action for a file dropped on the document,
 * which is to NAVIGATE the window to that file.
 *
 * Only two elements in the whole tree accept OS files — the schedule panel and
 * the media browser. Everything else (the top bar, the monitors column, the
 * gaps between panels) let the event reach the document, and this app is
 * drag-and-drop by design: missing the panel by 30px is the ordinary mistake,
 * not the exotic one. The cost of getting it wrong is the control window
 * ceasing to be an application — React tree gone, IPC subscriptions gone,
 * unsaved service order gone — with no way back but a restart.
 *
 * Scoped to drags that actually carry OS files: an in-app drag (a library
 * tile, a verse, a playlist row, a saved-program row — all custom MIME types)
 * is left completely alone, so none of the reorder flows can be affected by
 * this. Anything else that could navigate is caught by the main-process net in
 * `main/windows/navigation-guards.ts`.
 */

function carriesOsFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes("Files") ?? false;
}

export function installDropGuard(): void {
  document.addEventListener("dragover", (event) => {
    if (!carriesOsFiles(event)) return;
    // A real drop zone has already called `preventDefault` by now: React
    // delegates to the root container, which is a descendant of `document`,
    // so its handler runs first on the way up. What's left here is a drag
    // over dead space — and saying so with the cursor is better than letting
    // it read as droppable and then silently doing nothing.
    if (!event.defaultPrevented && event.dataTransfer) event.dataTransfer.dropEffect = "none";
    event.preventDefault();
  });

  document.addEventListener("drop", (event) => {
    if (!carriesOsFiles(event)) return;
    event.preventDefault();
  });
}
