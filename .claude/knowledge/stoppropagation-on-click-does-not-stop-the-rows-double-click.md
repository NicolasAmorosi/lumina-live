## `stopPropagation()` on a button's `onClick` does not stop the row's `onDoubleClick`, and in this app that row goes LIVE

**Area:** renderer
**Trigger:** putting any `<button>` inside a `ListRow` — or any element that already carries
`onDoubleClick` — and reaching for `e.stopPropagation()` to keep the row from reacting.

- **What was believed:** stopping propagation on the button's click is what isolates it from the
  row, and it is the pattern the repo already uses (`program-row.tsx`, `ProgramsModal.tsx`).
  **What is actually true:** `dblclick` is a *separate* native event, dispatched after the second
  `click` and bubbling on its own. Stopping the click stops the click. The row's
  `onDoubleClick` still fires — and in this app that handler is never harmless: on a schedule
  row, a resource row and a scene row it is `goLive()`, and on a program row it is
  `onOpen` (load this program into the order of service).

- **The evidence:** `src/renderer/src/components/pages/programs/program-row.tsx` is a standing
  instance, found by inspection on 2026-09-18 while adding the STOP button to the Utilities
  list. Its `ListRow` carries `onClick={onPreview}` **and** `onDoubleClick={onOpen}`, and its
  four `IconButton`s (favourite, edit, duplicate, delete) stop only the click. Double-clicking
  any of them runs that button's action twice *and* loads the program. The new
  `scene-readout.tsx` is the first row button in the repo that guards both.

- **The consequence:** a button inside a row that has `onDoubleClick` needs **both** guards —
  `onClick={(e) => { e.stopPropagation(); … }}` and `onDoubleClick={(e) => e.stopPropagation()}`.
  Two clicks in quick succession is not an exotic gesture in a dark booth, and the failure mode
  is the worst one this app has: something reaches the congregation because the operator pressed
  a small button twice. The same row button also wants `className="-my-0.5"` at `size="xs"`,
  or the one row that has a button is 4 px taller than every other row in the list.

**Last updated:** 2026-09-18
