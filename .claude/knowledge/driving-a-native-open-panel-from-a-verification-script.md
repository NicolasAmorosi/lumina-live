## A native Open panel is not reachable from CDP, and `keystroke … tell process "Electron"` mostly misses it

**Area:** build
**Trigger:** verifying a feature whose path goes through `dialog.showOpenDialog` /
`showSaveDialog` (relocate, add files, choose logo, import a Bible) against the running app.

- CDP cannot touch it at all: the panel is a native window, so `Input.dispatchMouseEvent` and
  `Runtime.evaluate` reach nothing. The renderer keeps running while it is up — `window.worship.invoke`
  answers normally — so "the app responds" is **not** evidence that the dialog was dismissed.
  Check `osascript -e 'tell application "System Events" to tell process "Electron" to get name of every window'`
  for a window named `Open` instead.
- What actually works, measured on 2026-09-14 (macOS 27, Electron 36): **AXPress on the buttons,
  which live in `splitter group 1`, not directly in the window.**

  ```applescript
  tell application "System Events" to tell process "Electron"
    set sg to splitter group 1 of (first window whose name is "Open")
    click (first button of sg whose title is "Cancel")   -- or "Open"
  end tell
  ```

  Enumerating `UI elements of (window "Open")` returns a bare `splitter group` and nothing else,
  which reads like an empty/broken tree and sends you looking for
  `com.apple.appkit.xpc.openAndSavePanelService` — that process exists but has **no windows**
  here, so it is a dead end.
- Keystrokes are the unreliable part, and they fail in two different ways:
  1. `tell process "Electron" … keystroke` after the panel has lost first responder does nothing
     at all — the panel opens key, so typing works in the seconds right after the click that
     opened it and stops working later.
  2. `keystroke` of a long string **drops characters**. A ⌘⇧G "Go to folder" with a 140-char
     path arrived as `/private/tmp/claue-501/…` (one `d` missing), which silently leaves the
     sheet open and looks exactly like "Return did not work". Always read the field back
     (`value of (first text field of sheet 1 of …)`) before blaming the key event. Setting that
     field's `value` via AX does update the text but does not commit it, so Return still does
     nothing.
- The reliable recipe: make the panel open where the file already is (the handler passes
  `defaultPath`), click the button that opens it, then `keystroke "<first letters>"` + `key code 36`
  **immediately**, and press Cancel/Open through AXPress if anything gets stuck. Never leave a
  stuck panel behind — the next CDP evaluate will succeed and hide it.
- Also worth knowing before scripting a service: `tell application "System Events" to click at {x, y}`
  fails with `Connection is invalid. (-609)` in this environment, so screen-coordinate clicking
  is not an escape hatch. And Return sent to the control window after the panel closes lands on
  the app's own `Enter` shortcut — which is **GO LIVE** — so a stray extra Return in a script
  projects whatever was in preview.

**Last updated:** 2026-09-14
