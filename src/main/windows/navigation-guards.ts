import type { WebContents } from "electron";

/**
 * The two lines Electron's security checklist has called mandatory for years,
 * plus the webview one — none of which this app had.
 *
 * What made them urgent is not a hypothetical: dropping a file anywhere in the
 * control window that is NOT one of the two drop zones made Chromium navigate
 * the document to that file. The React tree, the IPC subscriptions and the
 * unsaved service order went with it, and the only way back was restarting the
 * app — mid-service, with a projector attached.
 *
 * Nothing already in place stops that. The CSP doesn't govern TOP-LEVEL
 * navigation (`navigate-to` was dropped from the spec), and `webSecurity` has
 * no opinion either: it isn't a security violation, it's an ordinary
 * navigation. The renderer-side drop guard (`lib/drop-guard.ts`) stops it at
 * the source; this is the net underneath, and it also catches the cases that
 * guard deliberately doesn't touch (a link dragged in from a browser, a
 * `window.location` assignment, a `target="_blank"`).
 */

/** Whether a navigation is the page reloading ITSELF rather than going
 *  somewhere else. Query and hash are ignored on purpose: the dev server
 *  appends them, and neither is a navigation away from the app. */
function isSamePage(current: string, next: string): boolean {
  try {
    const from = new URL(current);
    const to = new URL(next);
    return from.origin === to.origin && from.pathname === to.pathname;
  } catch {
    // No URL loaded yet, or an unparseable target. Nothing legitimate
    // navigates before the first load, so this is a block.
    return false;
  }
}

export function installNavigationGuards(contents: WebContents): void {
  // `loadURL`/`loadFile` are programmatic and never emit this, so the app's
  // own startup and the projection window's rebuild are unaffected. A reload
  // (⌘R, HMR) targets the same page and is allowed through.
  contents.on("will-navigate", (event, url) => {
    if (isSamePage(contents.getURL(), url)) return;
    event.preventDefault();
    console.warn("[security] blocked navigation to", url);
  });

  // No window in this app is ever opened from the renderer: the projection
  // window is created by main, on request, over IPC.
  contents.setWindowOpenHandler(({ url }) => {
    console.warn("[security] blocked window.open to", url);
    return { action: "deny" };
  });

  // There are no `<webview>`s. Denying the attach keeps it that way even if
  // markup ever reaches the renderer that thinks otherwise.
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}
