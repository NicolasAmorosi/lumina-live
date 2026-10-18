import { app, Menu, type MenuItemConstructorOptions } from "electron";

/**
 * The app's own menu, replacing Electron's default one.
 *
 * Not cosmetic — the default menu ships two accelerators this app cannot
 * afford:
 *
 *   - **Cmd/Ctrl+W (Window -> Close).** It closes whichever window has focus,
 *     and the projection window is a window: one stray Cmd+W in a dark booth
 *     took the projector down mid-service. There is no Close item here at all;
 *     the control window is closed from the OS chrome, and Cmd+Q still quits.
 *   - **Cmd/Ctrl+R and Shift+Cmd/Ctrl+R (View -> Reload / Force Reload).**
 *     A reload restarts the renderer. The draft autosave now survives that,
 *     but an operator has no reason to reach it, so the whole development
 *     block is packaged-build-only.
 *
 * Labels are hardcoded Spanish, like every other user-facing string in main
 * (`dialog.showErrorBox` in `index.ts`): the i18n dictionary lives in the
 * renderer and a menu is built before any window exists.
 *
 * **No menu at all on Windows** (the operator's call, 2026-10-18). There it is
 * a bar inside the window, and a stray Alt gives it the keyboard: the next
 * arrows and Enter walk the menu instead of the slides. Nothing in it is
 * needed there — Chromium handles copy, paste and undo in a text field on its
 * own, and the window's X quits — and no menu also means none of the default
 * accelerators above.
 */
export function installApplicationMenu(): void {
  if (process.platform === "win32") {
    Menu.setApplicationMenu(null);
    return;
  }
  const isMac = process.platform === "darwin";

  /** Only in a development build — see the note above. */
  const developmentItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { type: "separator" },
        { role: "reload", label: "Recargar" },
        { role: "forceReload", label: "Forzar recarga" },
        { role: "toggleDevTools", label: "Herramientas de desarrollo" },
      ];

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about", label: `Acerca de ${app.name}` },
              { type: "separator" },
              { role: "services", label: "Servicios" },
              { type: "separator" },
              { role: "hide", label: `Ocultar ${app.name}` },
              { role: "hideOthers", label: "Ocultar otros" },
              { role: "unhide", label: "Mostrar todo" },
              { type: "separator" },
              { role: "quit", label: `Salir de ${app.name}` },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "Edición",
      submenu: [
        { role: "undo", label: "Deshacer" },
        { role: "redo", label: "Rehacer" },
        { type: "separator" },
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "selectAll", label: "Seleccionar todo" },
      ],
    },
    {
      label: "Ver",
      submenu: [
        { role: "resetZoom", label: "Tamaño real" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        ...developmentItems,
      ],
    },
    {
      label: "Ventana",
      submenu: [
        { role: "minimize", label: "Minimizar" },
        ...(isMac
          ? ([
              { role: "zoom", label: "Zoom" },
              { type: "separator" },
              { role: "front", label: "Traer todo al frente" },
            ] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    ...(isMac
      ? []
      : ([
          {
            label: "Archivo",
            submenu: [{ role: "quit", label: "Salir" }],
          },
        ] satisfies MenuItemConstructorOptions[])),
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
