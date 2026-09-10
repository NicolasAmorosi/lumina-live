# 02 — Contrato IPC

## Una sola fuente de verdad

Todo el contrato vive en **`src/shared/ipc/contract.ts`**: un tipo `IpcContract` con un entry
por canal (`{ req, res }`), agrupado por prefijo de dominio (`displays:`, `projection:`,
`files:`, `ppt:`, `bible:`, `library:`, `programs:`, `settings:`). Los push events (main →
renderer sin invoke) están aparte, en `IpcEvents`.

Esto reemplaza el viejo "lockstep de 3 archivos" (`main.js` + `preload.js` + `app.js`, todo a
mano, sin verificación). Ahora:

1. **`src/main/ipc/handlers/<dominio>.ts`** implementa un subconjunto de `Handlers`
   (`src/main/ipc/register.ts`), tipado como `Pick<Handlers, "canal-a" | "canal-b">`.
2. **`src/main/ipc/index.ts`** ensambla todos los handlers en un solo objeto tipado como
   `Handlers` completo — **si falta un canal o tiene la firma equivocada, no compila.**
3. **`src/preload/index.ts`** no cambia nunca: expone `invoke(channel, req)` / `on(channel, cb)`
   genéricos. No es un agujero de seguridad — `ipcRenderer.invoke` a un canal sin
   `ipcMain.handle` simplemente rechaza; la superficie real la define qué se registra en el paso
   2, no el preload.
4. **`src/renderer/src/lib/ipc.ts`** tiene el `invoke<K>`/`onIpc<K>` tipados a partir del
   contrato, y **`src/renderer/src/lib/api.ts`** es una fachada por dominio
   (`api.bible.search(...)`) — puro azúcar de legibilidad, sus tipos salen inferidos de
   `invoke`, no son una tercera declaración del contrato.

## Cómo agregar un canal

1. Agregá la línea a `IpcContract` en `shared/ipc/contract.ts`.
2. Implementalo en el handler de dominio correspondiente (o creá uno nuevo en
   `main/ipc/handlers/`).
3. Si es un handler nuevo, agregalo al spread de `main/ipc/index.ts`.
4. (Opcional) Agregá el método correspondiente a la fachada en `renderer/src/lib/api.ts`.

El compilador te avisa en el paso 3 si te olvidaste del paso 2.

## `Result<T>` — errores tipados de punta a punta

Cada `ipcMain.handle` registrado por `registerHandlers` envuelve la respuesta en
`{ok:true,data}` / `{ok:false,error:{code,message}}` (`shared/ipc/result.ts`). `invoke<K>` en el
renderer desenvuelve esto una sola vez y relanza como `IpcError` si `ok:false` — el resto del
código del renderer llama `await api.dominio.metodo(...)` como si nunca pudiera fallar por el
lado del transporte, y atrapa errores de negocio con try/catch normal.

## Push events

`display-content` y `video-command` van de main a la ventana de proyección;
`window.worship.on(channel, cb)` devuelve una función de limpieza — a diferencia del preload
legacy, que no tenía forma de des-suscribirse. `useIpcEvent` (`renderer/src/lib/hooks/`) es el
hook que envuelve esto con `useEffect`.

## Mapeo de canales legacy → nuevos

| Legacy | Nuevo | Nota |
|---|---|---|
| `get-displays` | `displays:list` | igual |
| `open/close-presentation` | `projection:open`/`projection:close` | igual |
| `show-content`/`show-black`/`show-logo` | `projection:show` (uno solo) | colapsan en variantes de `ProjectionOutput` |
| `presentation-show/hide`, `ppt-show/hide-overlay` | `projection:setOverlayVisible` | eran el mismo show()/hide() cuatro veces |
| `read-file-url` | eliminado | reemplazado por `worship://` |
| `load-bible` (JSON de 4MB entero) | `bible:books` + `bible:chapter` + `bible:search` | ya no cruza el JSON completo por IPC |
| `load/save-media-library` | `library:list`/`library:add`/`library:remove` | escritura incremental, no el archivo entero |
| `import-bible` | `bible:import` | ya no escribe dentro del bundle de la app |
