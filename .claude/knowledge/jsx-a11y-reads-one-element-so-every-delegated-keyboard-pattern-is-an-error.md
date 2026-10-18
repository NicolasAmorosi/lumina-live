## `jsx-a11y` reads one element, so every delegated keyboard pattern in this design system reports as an error
**Area:** ui
**Trigger:** adding a primitive to `components/ui/` and getting `no-noninteractive-element-interactions`, `interactive-supports-focus`, `click-events-have-key-events` or `no-noninteractive-tabindex` on something that is demonstrably accessible — or writing an `eslint-disable` directive with a reason and watching ESLint report a rule that does not exist

- The belief going in was that `eslint-plugin-jsx-a11y` (added 2026-09-15 for `H9`) would mostly
  agree with code that already had roving tabindex, `aria-setsize`/`aria-posinset` and
  `aria-activedescendant` written by hand. It reported 9 errors, and **8 of them were the same
  error**: the rule's unit of analysis is one JSX element, and every keyboard contract in this
  project is **delegated** to the element that actually holds the tab stop.
  - `Tabs` (`components/ui/tabs.tsx`): the arrows are handled on `role="tablist"`, which is not
    focusable and must not be — the `0` of the roving tabindex is on the selected `role="tab"`
    button, and the keys reach the list only by bubbling. → `interactive-supports-focus`.
  - `VirtualGrid` (`components/ui/virtual-grid.tsx`): same shape on `role="list"`, and handling
    the arrows at the container is precisely what lets `moveFocus` target a row that is **not
    mounted yet**. → `no-noninteractive-element-interactions`.
  - `Select` (`components/ui/select.tsx`): the `<li role="option">` elements never take focus at
    all — the trigger keeps it and points with `aria-activedescendant` — so the keyboard
    equivalent of the option's `onClick` lives in the trigger's `onKeyDown`, and a key handler on
    the option **could not fire**. → `click-events-have-key-events`.
  - `Modal` (`components/shared/modal/Modal.tsx`): the two focus sentinels want `tabIndex={0}` on
    an `aria-hidden` `<span>` because being landed on for one frame and bounced back is their
    entire job. → `no-noninteractive-tabindex`.
  The consequence: **do not "fix" these by making the container focusable or by adding a key
  handler to an option.** Either change breaks the pattern (a tab stop that lands on nothing; a
  handler on an element that never receives keys). Suppress with the reason written out, the way
  those four files already do. Only one of the nine was real — `M18`, a genuine `onKeyDown` on a
  bare `<div>` in `program-side-panel.tsx`.
- `media-has-caption` is off for the whole renderer in `eslint.config.js`, not suppressed per
  site: every `<video>`/`<audio>` here plays a file the operator picked off their own disk seconds
  earlier, so there is no caption track and nowhere one could come from.
- **Two traps in the `-- reason` directive syntax**, both of which cost a round trip:
  1. The directive and its reason must be **one comment**. Writing
     `// eslint-disable-next-line rule --` and continuing the reason on the next `//` line makes
     the rule name literally `rule --`, and ESLint answers
     `Definition for rule 'jsx-a11y/interactive-supports-focus --' was not found` while the
     original error stays. A multi-line reason needs a `/* … */` block comment.
  2. `disable-next-line` must precede the **line ESLint reports**, which for a JSX element is its
     opening tag — not the offending attribute, and not the `return` above it. A directive placed
     above `onClick={…}` inside a `<li>` silences nothing and then reports itself as an
     `Unused eslint-disable directive`.
- **A prop of your own called `role` is read as an ARIA role, and whether it fires depends on the
  CALL rather than on the component.** `aria-role` rejected `<SceneText role="leaving" />`
  (2026-09-18, the time scene's end fade) even though `SceneText` is not a DOM element and the
  value is consumed as a `LayerRole`, never spread onto one. Its older sibling
  `<SceneLayer role={…} />` in `output-view.tsx` carries the same prop and has never fired, only
  because its value is an expression the rule cannot evaluate — so the same prop lints or not
  depending on whether the caller wrote a literal. Renaming the prop (`layerRole`) beats
  suppressing here: unlike the four delegated-keyboard cases above, nothing about the pattern
  needs the name `role`, and a suppression would sit on the call site rather than on the design.
- The cost the `H9` finding warned about ("type-aware rules are notably slower") did not
  materialize: full `eslint .` with `recommendedTypeChecked` + `projectService` runs in **~4 s**,
  and the project's ~40 `void api.*` calls produced **zero** false positives — `void` is exactly
  the escape `no-floating-promises` documents. The rules found a real defect nothing else had:
  `no-base-to-string` on `normalizeVerses` in `src/main/db/seed/bible-source.ts`, where a verse of
  an unexpected shape was seeded as the literal `"[object Object]"`.

**Last updated:** 2026-09-18
