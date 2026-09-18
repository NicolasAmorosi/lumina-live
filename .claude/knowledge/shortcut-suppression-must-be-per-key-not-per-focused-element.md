## Suppressing global shortcuts by focused ELEMENT kills the keys that element never handled — and Chromium focuses a button on click

**Area:** renderer / ui (`src/renderer/src/lib/hooks/use-global-shortcuts.ts`)
**Trigger:** "the B / NEGRO key stopped working", a shortcut that works only sometimes, before
adding any key to the global shortcut handler, or before choosing the focus model of a new
keyboard-driven widget (a menu, a popover, a combobox) in the control window.

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

### The other half: that table decides how a new popup must be built (2026-09-17)

The list is also a **constraint on every widget added afterwards**, and it is easy to read it as
a defensive measure only. A widget is protected from the global shortcuts exactly insofar as
`suppressesKey()` recognizes whatever holds DOM focus while it is open — and what it recognizes
for `Enter`/`" "` is `INPUT`/`SELECT`/`TEXTAREA`/`contentEditable` and `BUTTON`/`A`. Nothing else.
`ARROW_CONSUMING_ROLES` looks like it covers the rest, and it does not: it is gated on
`ARROW_KEYS.has(key)`, so a `role` **only ever suppresses the four arrows**, never Enter or Space.
`"menuitem"` is in that list; `"menuitemradio"` is not in it at all.

Building `components/ui/menu.tsx` (the sort-order button of the media library) ran straight into
it. The obvious move was to copy `Select`: keep focus on the trigger, or focus the list container,
and point at the highlighted option with `aria-activedescendant`. But `aria-activedescendant` is
not valid on `role="button"`, so the container is what would have to take focus — a
`<ul role="menu">`. Focused, that element is a `UL` with a role: `suppressesKey("Enter")` returns
**false**, and `Enter` would have picked the sort order *and* run the global `Enter` shortcut,
which is `goLive()`. Choosing how to order a folder would have sent the preview to the projector,
mid-service.

So `Menu` moves focus INTO the list, one real `<button role="menuitemradio">` per option, roving
with the arrows. It is the canonical ARIA menu pattern and it is also the only shape that lands
back inside `ACTIVATION_TAGS`.

The rule: **when adding a keyboard widget to the control window, pick the focus model by checking
`suppressesKey()` first.** If what will hold focus is not a text field, a `BUTTON` or an `A`, the
widget is unprotected for `Enter` and `" "` — and in this app `Enter` is the button that puts
something on the projector.

**Last updated:** 2026-09-17
