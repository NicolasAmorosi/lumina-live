## `element.click()` over CDP makes the next programmatic focus match `:focus-visible`, so focus-only UI appears in the probe and never for a real operator

**Area:** build (verification), ui

**Trigger:** a CDP screenshot that shows a focus ring, a tooltip or any other `:focus-visible`
styling on something nobody hovered or tabbed to — typically a dialog's first focusable right
after the probe opened it. Also: before "fixing" anything a screenshot-driven probe reported.

- **Believed:** `Runtime.evaluate("el.click()")` is a click, so what the screenshot shows after it
  is what an operator sees. **False for anything keyed off `:focus-visible`.** Chrome decides
  whether a *programmatic* `.focus()` draws the focus indicator from the last real input: after a
  genuine mouse press there is a pointer interaction to suppress it, and after `el.click()` there
  is none, so the heuristic falls back to "keyboard" and the element matches `:focus-visible`.

- Measured on 2026-09-21 against the running app, on `Modal`'s initial focus
  (`src/renderer/src/components/shared/modal/Modal.tsx` focuses `focusablesIn(dialog)[0]`, which
  in `SettingsModal` is the close button):

  | how Settings was opened | `document.activeElement` | `matches(":focus-visible")` |
  |---|---|---|
  | `Input.dispatchMouseEvent` mousePressed + mouseReleased on the gear | the close button | **false** |
  | `Runtime.evaluate("…click()")` on the gear | the close button | **true** |

  With `true`, the `Tooltip` that had just been put on that button opened its bubble by itself in
  the screenshot, which read exactly like a real defect: "opening Settings greets you with a
  «Close» tooltip". It cannot happen with a mouse. The revert it caused was harmless only by
  luck — the close button went back to the native `title` the other three modals use.

- **So: drive anything focus-sensitive with real input events.** `Input.dispatchMouseEvent`
  (`mouseMoved` → `mousePressed` → `mouseReleased`) and `Input.dispatchKeyEvent`, not
  `el.click()` / `el.focus()`. `el.click()` stays fine for a plain state change nothing visual
  hangs off — and note the two are not interchangeable in the other direction either: a real
  press needs viewport coordinates, so it cannot reach an element that is scrolled out of view.

- And the general rule this is the second instance of: **a probe artifact reads exactly like a
  bug.** Before acting on something only the probe has seen, reproduce it through real input.
  Companions: [one-cdp-evaluate-is-one-react-commit-so-n-clicks-measure-one.md](one-cdp-evaluate-is-one-react-commit-so-n-clicks-measure-one.md)
  (React batches a loop of clicks into one commit) and
  [occluded-electron-window-has-no-rendering-lifecycle.md](occluded-electron-window-has-no-rendering-lifecycle.md)
  (an occluded window runs no frames, so force one with `Page.captureScreenshot` before
  measuring). A third trap of the same family: a `TabPanel` that is merely `invisible` is still
  laid out, so `getBoundingClientRect()` on a hidden section returns plausible coordinates and a
  hover lands on nothing — scope every query to the visible panel (`#settings-panel-<section>`).

**Last updated:** 2026-09-21
