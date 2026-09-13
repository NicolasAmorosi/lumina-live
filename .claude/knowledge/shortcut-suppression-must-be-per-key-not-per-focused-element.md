## Suppressing global shortcuts by focused ELEMENT kills the keys that element never handled — and Chromium focuses a button on click

**Area:** renderer / ui (`src/renderer/src/lib/hooks/use-global-shortcuts.ts`)
**Trigger:** "the B / NEGRO key stopped working", a shortcut that works only sometimes, or before
adding any key to the global shortcut handler.

Found on 2026-09-13 auditing feature #5.

### The mechanism

The handler bailed out for **every** key whenever the focus was on an interactive element:

```ts
const INTERACTIVE_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A"]);
if (isInteractiveTarget(e.target)) return;
```

**Chromium focuses a `<button>` when you click it** (unlike Safari/WebKit, where clicking a button
does not move focus — which is why this reads as harmless to anyone who has tested the pattern in
a browser other than the one Electron ships). So after a single click on *any* button in the app —
EN VIVO, LOGO, NEGRO, save, any `IconButton` — `b`, `l`, `Delete` and `Backspace` were dead until
the operator happened to click on empty space. Nothing on screen said why.

NEGRO is the control an operator reaches for when something appears that the congregation should
not see. It was unavailable for the rest of the service, silently.

### Why the rule looked right

It genuinely is right for `Enter`, `" "` and the four arrows: a button activates on Enter/Space
natively, and the arrows drive the roving tabindex of the resource grid. Those are real conflicts.
The error was generalizing from them to keys a button has no behaviour for at all.

### The rule

Decide suppression on the pair **(element, key)**, never on the element alone:

- text entry (`INPUT`/`SELECT`/`TEXTAREA`/`contentEditable`) consumes everything — anything else
  would type into it;
- a `BUTTON`/`A` consumes only what activates or navigates it (`Enter`, `" "`, the arrows);
- everything else falls through to the global shortcut.

**Last updated:** 2026-09-13
