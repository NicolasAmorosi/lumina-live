import { registerHandlers, type Handlers } from "./register";
import { displaysHandlers } from "./handlers/displays";
import { projectionHandlers } from "./handlers/projection";
import { filesHandlers } from "./handlers/files";
import { pptHandlers } from "./handlers/ppt";
import { bibleHandlers } from "./handlers/bible";
import { libraryHandlers } from "./handlers/library";
import { servicesHandlers } from "./handlers/services";
import { settingsHandlers } from "./handlers/settings";

/**
 * Assembling the object literal AS `Handlers` is what makes a missing or
 * mis-typed channel a compile error — TypeScript checks every key of
 * IpcContract is present with the right signature at this single call site.
 */
export function registerAllIpcHandlers(): void {
  const handlers: Handlers = {
    ...displaysHandlers,
    ...projectionHandlers,
    ...filesHandlers,
    ...pptHandlers,
    ...bibleHandlers,
    ...libraryHandlers,
    ...servicesHandlers,
    ...settingsHandlers,
  };
  registerHandlers(handlers);
}
