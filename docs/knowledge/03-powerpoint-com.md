# 03 — Integración con PowerPoint (COM / PowerShell)

Sigue siendo la parte más frágil y la razón por la que la app es Windows-only en la práctica —
el mecanismo COM (`src/main/powerpoint/com.ts`) no cambió de fondo respecto a la versión legacy,
solo el **transporte** hacia PowerShell.

## Escapado seguro (el fix de esta migración)

La versión legacy interpolaba rutas de archivo directo en el script de PowerShell, escapadas a
mano con `.replace(/\\/g,'\\\\').replace(/'/g,"''")` — superficie de inyección si una ruta traía
un carácter no contemplado. `src/main/powerpoint/powershell.ts` reemplaza esto por:

- El script completo se pasa como **`-EncodedCommand`** (base64 UTF-16LE) — nunca se interpola
  nada dentro de la sintaxis de PowerShell.
- Las rutas de archivo viajan como **variables de entorno** (`WORSHIP_PPT_PATH`,
  `WORSHIP_PPT_OUTDIR`, `WORSHIP_PPT_SLIDE`) que el script lee con `$env:NOMBRE` — su contenido
  nunca se parsea como código.

## `assertWindows()` — falla rápido, no espera el timeout

Cada función de `com.ts` (excepto `preOpenPowerPoint`/`closePresentation`/`quitPowerPoint`, que
son best-effort) llama `assertWindows()` primero. En macOS/Linux esto lanza inmediato en vez de
dejar que el handler cuelgue hasta `PPT_OPEN_TIMEOUT_MS`/`PPT_EXPORT_TIMEOUT_MS`
(`shared/constants.ts`) — el desarrollo en Mac de cualquier feature que toque un handler `ppt:*`
ya no espera 15-30 segundos por cada intento.

## La danza del overlay

Sin cambios de comportamiento respecto al legacy, pero ahora es explícita en un solo lugar:
`src/renderer/src/effects/projection-effects.ts` diffea el `ProjectionOutput` anterior contra el
siguiente y, si se entra o sale de `{kind:'ppt'}`, llama `projection:setOverlayVisible` en el
orden correcto (mostrar overlay ANTES de mandar contenido al salir de PPT; ocultarlo DESPUÉS de
mandar `{kind:'ppt'}` al entrar). Ver `docs/knowledge/04-renderer-state.md`.

## Cache de slides exportados

`src/main/ipc/handlers/ppt.ts` cachea en memoria (`sourcePath + mtime` como key) las rutas de PNG
ya exportadas para un PPT — reabrir el mismo archivo sin haberlo modificado reutiliza el export
anterior en vez de pagar de nuevo los ~30s de export vía COM. `cleanupSlideTempDirs()` corre en
`before-quit` y borra los directorios de `os.tmpdir()/worship_slides_*` — el legacy los dejaba
acumularse para siempre.

## Servido de miniaturas

Las miniaturas se sirven por `worship://slide/<sessionId>/<n>.png`
(`src/main/protocol/worship-protocol.ts`), resueltas contra un mapa en memoria de
`sessionId -> paths[]`, nunca por ruta de filesystem embebida en la URL.

## Por qué sigue siendo Windows-only

Sin cambios: `GetActiveObject`/`New-Object -ComObject` son APIs de Windows. Multiplataforma real
requeriría un camino alternativo (LibreOffice headless, exportar a imágenes de antemano) —
evaluado y explícitamente dejado fuera de alcance de esta migración, ver
`07-roadmap-and-debt.md`.
