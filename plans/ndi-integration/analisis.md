# Plan: Integración NDI en WorshipApp

**Fecha:** 2026-09-17
**Estado:** Diseño validado — pendiente de spike técnico del sender nativo

---

## Resumen ejecutivo

La integración NDI es factible sin alterar la lógica de dominio de WorshipApp: el control ya calcula un `ProjectionOutput` serializable y `ProjectionApp` lo materializa mediante `OutputView`.

La implementación recomendada es un **sender NDI en main**, alimentado por una segunda ventana Electron offscreen que renderiza el mismo `projection.html` que el proyector físico.

```
Control Window → ProjectionState (snapshot + broadcast)
                         ├─ Projection Window física
                         └─ NDI offscreen renderer → paint frames → sender NDI nativo
```

No se modelará NDI como una pantalla en `displays:list`: es una salida de red, no un monitor físico. La primera entrega será **video-only a 1080p30**, con audio, alpha y 60 fps como hitos posteriores y medibles.

---

## Decisiones de arquitectura

### Enfoque elegido: sender NDI + renderer offscreen

- `BrowserWindow` offscreen, sin mostrarse al usuario, con `projection.html` y la resolución de salida configurada.
- El renderer reutiliza `ProjectionApp` y `OutputView`; por tanto, slides, Biblia, overlays y underlay de video se ven exactamente como en proyección.
- Electron entrega los frames por `webContents.on("paint")`; se configura la tasa con `webContents.setFrameRate(30)`.
- Main pasa el bitmap BGRA/BGRX al sender NDI nativo.
- La instancia NDI continúa activa si se cierra la ventana física de proyección.

No se usa un loop con `capturePage()`: es una captura asíncrona de screenshots, no el mecanismo de streaming continuo. Tampoco se asume cero copias GPU/CPU: el modo offscreen normal entrega bitmap en CPU. El modo `useSharedTexture` queda fuera del MVP porque exige interop GPU en código nativo.

### Sender NDI nativo

No existe `@ndi/sdk` ni `ndi-lib` en npm, por lo que no forman parte del plan. Antes de integrar se hará un spike para elegir una de estas opciones:

1. Un addon N-API propio, pequeño y mantenido dentro del proyecto, que cargue dinámicamente el SDK oficial NDI y exponga crear/detener sender y enviar BGRA.
2. Un helper nativo versionado junto a la aplicación, con un protocolo IPC local para recibir frames.

Se prefiere el addon N-API si el spike confirma compatibilidad con Electron 44 y el empaquetado macOS/Windows; evita una copia y un proceso extra. El helper es el plan alternativo si la integración del addon o la firma de macOS lo vuelven frágil.

### Estado y sincronización entre renderers

`ProjectionState` actualmente conserva una sola ventana. Debe evolucionar a un snapshot más un conjunto de consumidores registrados, para entregar `display-content`, `audio-tracks` y los comandos que correspondan tanto al proyector físico como al renderer NDI.

La variante NDI de `ProjectionApp` debe saber que es un consumidor secundario para no informar `media-status` ni `media-error` duplicados al control. Conserva, no obstante, el mismo snapshot inicial y los mismos eventos de contenido.

---

## Alcance por fases

### Fase 0 — Spike obligatorio

Objetivo: validar el binding y la cadena de distribución antes de modificar la UI o el estado de proyección.

1. Crear un sender NDI de prueba desde Electron main con el SDK oficial.
2. Enviar un bitmap BGRA de 1920×1080 a 30 fps y recibirlo en OBS, vMix o NDI Studio Monitor.
3. Confirmar en Windows x64 y macOS de las arquitecturas que se vayan a distribuir: carga dinámica, firma/notarización y shutdown limpio.
4. Medir CPU, memoria, FPS efectivo y latencia durante 15 minutos con escenas estáticas, transiciones y video.

**Criterio para continuar:** 1080p30 estable, sin crecimiento de memoria y con carga aceptable en el hardware objetivo.

### Fase 1 — NDI video-only (MVP)

1. Crear `NdiService`, que posee el sender nativo, la ventana offscreen y sus métricas.
2. Refactorizar `ProjectionState` de referencia única a broadcaster de consumidores.
3. Crear la ventana offscreen a una resolución NDI explícita (por defecto 1920×1080) y con `offscreen: true`.
4. Enviar frames desde `paint`, descartando frames si el sender aún procesa el anterior; nunca acumular una cola sin límite.
5. Agregar IPC, UI y settings para iniciar/detener, nombre de fuente, resolución y FPS.
6. Mostrar de forma explícita “solo video” mientras audio no esté implementado.

### Fase 2 — Audio NDI

El audio no se obtiene de los píxeles ni de los elementos `<audio>/<video>` del renderer. Esta fase requiere un pipeline PCM propio que decodifique y mezcle los tracks declarativos de WorshipApp, emita PCM float a 48 kHz y lo entregue al sender NDI con timestamps coherentes.

La implementación debe definir antes:

- fuentes soportadas y códecs;
- mezcla, volumen, pausa, seek y reinicio;
- política de clock/timestamps de audio y video;
- pruebas de deriva A/V prolongada.

No se declarará NDI con audio hasta que esta fase esté validada.

### Fase 3 — Rendimiento y alpha opcionales

- Medir 1080p60; no prometerlo por diseño. Si el bitmap CPU no alcanza, evaluar `useSharedTexture` más interop nativo GPU↔NDI.
- Agregar alpha solo como un modo de salida separado para lower-thirds. Requiere que `OutputView` pueda renderizar transparente y que se definan semánticas de fondos/overlays; la salida normal sigue siendo opaca.
- Evaluar 4K únicamente después de métricas reales de CPU, GPU y red.

---

## Contrato IPC y settings

### Canales nuevos (`src/shared/ipc/contract.ts`)

```ts
"ndi:start": {
  req: { sourceName: string; width: number; height: number; frameRate: 30 | 60 };
  res: void;
};
"ndi:stop": { req: void; res: void };
"ndi:status": {
  req: void;
  res: {
    running: boolean;
    sourceName: string | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    videoOnly: boolean;
    error: string | null;
  };
};
```

Persistir en `SettingsMap` el nombre, resolución, FPS y si se debe iniciar automáticamente. El autostart queda desactivado por defecto hasta validar distribución y recuperación ante errores.

---

## Estructura propuesta

```
src/main/ndi/
├── ndi-service.ts      # Ciclo de vida, estado, ventanas y backpressure
├── ndi-window.ts       # BrowserWindow offscreen y carga de projection.html
├── ndi-native.ts       # Fachada tipada del addon N-API o helper nativo
└── index.ts            # Handlers ndi:start/stop/status
```

La modificación de `src/main/services/projection-state.ts` queda junto a esta entrega: snapshot común y registro/eliminación segura de consumidores. No se duplica lógica de selección de contenido dentro de `src/main/ndi/`.

---

## Flujo de datos del MVP

1. El operador inicia NDI con un nombre y perfil de video.
2. `NdiService` crea el sender y una ventana offscreen con esas dimensiones.
3. La ventana se registra como consumidor de `ProjectionState`, recibe el snapshot y posteriores actualizaciones de contenido.
4. `ProjectionApp` renderiza el mismo `OutputView` que la proyección física.
5. Cada evento `paint` entrega el frame más reciente al sender NDI; la política de backpressure conserva baja latencia sobre completitud de frames.
6. Al detener, se desregistran el consumidor, la ventana y el sender, en ese orden seguro.

---

## Compatibilidad actual

| Feature | Fase 1 video-only |
|---|---|
| Slides pre-rasterizadas | Sí |
| Texto bíblico | Sí |
| Imagen, negro y logo | Sí |
| Transiciones | Sí, según los frames que pinte Chromium |
| Video/underlay visual | Sí, si Chromium puede decodificarlo |
| Deck auto-advance | Sí; lo decide el control |
| Audio de tracks | No; fase 2 |
| Alpha/lower thirds | No; fase 3 |

---

## Empaquetado y distribución

- Usar exclusivamente el SDK oficial NDI y revisar sus condiciones de redistribución, EULA y requisitos de identificación visual.
- Empaquetar por plataforma y arquitectura los binarios del addon/helper y el runtime NDI que corresponda; no codificar una lista de DLLs heredada en el plan.
- Desempaquetar (`asarUnpack`) binarios nativos cuando sea necesario y validar su ruta en producción, no solo en desarrollo.
- Para macOS, validar firma, hardened runtime y notarización con el runtime final; para Windows, probar en una instalación limpia sin herramientas NDI previas.
- El build actual tiene `npmRebuild: false`; cualquier dependencia nativa debe entregarse como prebuild compatible con Electron o mediante N-API estable, nunca confiar en recompilación implícita al instalar.

---

## Pruebas de aceptación

1. OBS/vMix/NDI Studio Monitor descubre la fuente, la conecta y recibe la última escena aun si se conecta luego de iniciada.
2. Las escenas de slides, Biblia, negro, logo, transiciones y underlay se corresponden visualmente con la ventana física.
3. Cerrar/reabrir el proyector físico no detiene la fuente NDI.
4. Detener/reiniciar NDI no afecta el proyector físico ni la lógica EN VIVO.
5. El sender no aumenta memoria de forma sostenida ni acumula frames bajo carga.
6. La fuente usa el nombre, resolución y FPS configurados; los nombres inválidos se validan antes de crear el sender.
7. En fase 2, una prueba de al menos 30 minutos confirma audio PCM, niveles correctos y deriva A/V aceptable.

---

## Referencias de código clave

| Archivo | Papel en la integración |
|---|---|
| `src/shared/types/projection.ts` | `ProjectionOutput` y tracks declarativos |
| `src/renderer/src/components/shared/output-view.tsx` | Render único a reutilizar |
| `src/renderer/src/projection/ProjectionApp.tsx` | Requiere modo secundario para evitar reportes duplicados |
| `src/main/services/projection-state.ts` | Debe pasar de una ventana a varios consumidores |
| `src/main/ipc/handlers/projection.ts` | Emite el estado y comandos actuales |
| `src/shared/ipc/contract.ts` | Fuente de verdad de IPC |
| `package.json` | `npmRebuild: false` condiciona módulos nativos |

---

## Conclusión

**Factibilidad:** alta para video-only a 1080p30, condicionada al spike del sender nativo. No hay refactor de dominio, pero sí uno acotado y necesario en la distribución del estado de proyección.

El enfoque seleccionado es la mejor relación entre fidelidad visual, independencia del proyector físico y mantenimiento. La implementación no debe empezar por UI ni por `capturePage()`: primero se valida el sender NDI nativo y el empaquetado, luego se construye el broadcaster y el MVP de video.
