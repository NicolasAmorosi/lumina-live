/** The control window's answer to main's `close-requested` — see
 *  `main/windows/close-guard.ts` for what each one does. */
export type CloseDecision = "close" | "hold" | "cancel";
