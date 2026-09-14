import { BrowserWindow } from "electron";
import type { Handlers } from "../register";
import { getDraftRepo } from "../../services/repos";
import { resolveClose } from "../../windows/close-guard";

export const programDraftHandlers: Pick<
  Handlers,
  "program:saveDraft" | "program:loadDraft" | "window:closeDecision"
> = {
  "program:saveDraft": (draft) => {
    if (draft === null) getDraftRepo().clear();
    else getDraftRepo().save(draft);
  },
  "program:loadDraft": () => getDraftRepo().load(),

  // The control window answering the `close-requested` it was sent. Resolved
  // against the sender rather than a remembered handle: `ev.sender` is by
  // definition the window that was asked.
  "window:closeDecision": ({ decision }, ev) => {
    const win = BrowserWindow.fromWebContents(ev.sender);
    if (win) resolveClose(win, decision);
  },
};
