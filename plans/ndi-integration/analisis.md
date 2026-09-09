# Plan: Integración NDI en WorshipApp

**Fecha:** 2026-09-08  
**Estado:** Análisis completado — listo para implementar cuando se decida

---

## Resumen Ejecutivo

La arquitectura actual de WorshipApp hace que la integración NDI sea **muy factible y limpia**. El flujo de datos ya es declarativo y serializable:

```
Control Window (Zustand) → selectOutput() → IPC (display-content) → Projection Window (React)
```

La ventana de proyección es **puramente funcional** (stateless) — recibe `ProjectionOutput` + audio tracks y renderiza. NDI puede conectarse al mismo pipeline sin tocar lógica de dominio.

---

## Tres Enfoques Posibles

### 1. NDI desde la Ventana de Proyección (Más Simple)
- Agregar `@ndi/sdk` en `ProjectionApp.tsx`
- Captura frames via `canvas.captureStream()` o `webContents.capturePage()`
- **Pros:** Cero cambios en main, aprovecha render loop existente
- **Contras:** Requiere GPU, ventana de proyección debe estar abierta, readback WebGL

### 2. NDI Sender en Main Process **(RECOMENDADO)**
- Ventana oculta offscreen (`BrowserWindow` con `offscreen: true`)
- Carga `projection.html` igual que la ventana real
- Main reenvía `display-content` + `audio-tracks` a esta ventana
- Ventana NDI renderiza `OutputView` → captura frames → `@ndi/sdk` (bindings Node)
- **Pros:** Funciona headless, sin GPU readback, SDK nativo, sobrevive a cierre de ventana proyección
- **Contras:** Ventana Electron extra, módulo nativo `@ndi/sdk`

### 3. NDI como "Display" Virtual (UX Más Nativo)
- Aparece en `displays:list` como monitor más
- Operador lo selecciona igual que proyector físico
- **Pros:** UX consistente, reusa selector de displays
- **Contras:** NDI no es display real; necesita driver virtual o handling custom

---

## Implementación Recomendada (Enfoque 2)

### Nuevos Canales IPC (`contract.ts`)
```typescript
"ndi:start": { req: { sourceName: string }; res: void };
"ndi:stop": { req: void; res: void };
"ndi:status": { req: void; res: { running: boolean; sourceName: string | null } };
```

### Estructura Nueva
```
src/main/ndi/
├── ndi-sender.ts      # Offscreen window + @ndi/sdk + capture loop
├── ndi-window.ts      # Crea BrowserWindow offscreen cargando projection.html
└── index.ts           # Handlers ndi:start/stop/status
```

### Flujo de Datos
1. Operador click "Iniciar NDI" → `ndi:start { sourceName }`
2. Main crea `BrowserWindow` offscreen → carga `projection.html`
3. Main suscribe a `projectionState` y reenvía cada `display-content` a `ndiWindow.webContents.send('display-content', output)`
4. `ProjectionApp` en ventana NDI renderiza `OutputView` (igual que proyección real)
5. Loop de captura: `webContents.capturePage()` @ 30fps → `ndi.send_video_v2()`
6. Audio: stream separado NDI audio o mix en main (ver preguntas abiertas)

---

## Preguntas Abiertas (Resolver Antes de Codear)

| Pregunta | Impacto |
|----------|---------|
| **Audio**: NDI video + audio embebido, o streams separados? | Define si hay que mezclar audio en main o mandar tracks aparte |
| **Performance target**: 1080p60? 4K30? | Determina método captura: `capturePage()` (CPU) vs OffscreenCanvas + `requestVideoFrameCallback` (GPU) |
| **Discovery**: ¿Auto-anunciar como source NDI al arrancar, o solo bajo demanda? | Afecta `ndi:start` implícito vs explícito |
| **Persistencia**: ¿Recordar `sourceName`? ¿Auto-start al launch? | Settings en `SettingsMap` |
| **Mac vs Windows**: `@ndi/sdk` binarios distintos por plataforma | Empaquetado `electron-builder` `extraResources` |

---

## Qué Ya Es Compatible (Zero Effort)

| Feature | Compatible |
|---------|------------|
| Slides (imágenes pre-rasterizadas) | ✅ |
| Video en vivo + underlay | ✅ (`LiveVideo` en output) |
| Texto bíblico | ✅ React puro |
| Overlays NEGRO/LOGO | ✅ Manejados en `selectOutput` |
| Deck auto-advance | ✅ Control lo drivea, proyección solo renderiza |
| Audio tracks | ⚠️ Requiere decisión arquitectura |

---

## Qué Requiere Trabajo

1. **Captura frames eficiente**: `capturePage()` es async + CPU-bound. Para 60fps hace falta OffscreenCanvas + `requestVideoFrameCallback` (Chrome 112+) o módulo nativo.
2. **Canal alpha**: NDI soporta alpha; `OutputView` renderiza sobre negro — necesitaría modo fondo transparente para lower-thirds.
3. **Dependencia nativa**: `@ndi/sdk` o `ndi-lib` → empaquetar en `electron-builder` (extraResources o nodeModules).
4. **Sync audio/video**: Si audio va por NDI separado, hace falta clock compartido.

---

## Próximos Pasos Sugeridos

1. **Decidir enfoque** (recomiendo Enfoque 2)
2. **Resolver preguntas abiertas** arriba
3. **Probar `@ndi/sdk`** en branch aparte: `npm i @ndi/sdk` + hello world sender
4. **Crear IPC channels** (`add-ipc` skill)
5. **Implementar `ndi-window.ts` + `ndi-sender.ts`**
6. **UI en control window**: botón "Iniciar NDI" + input source name + status indicator
7. **Test real** con OBS/vMix recibiendo NDI

---

## Referencias Código Clave

| Archivo | Qué Hace |
|---------|----------|
| `src/shared/types/projection.ts` | `ProjectionOutput` — el payload que NDI debe renderizar |
| `src/renderer/src/components/shared/output-view.tsx` | `OutputView` — componente único que pinta TODO (proyección + monitores + NDI) |
| `src/renderer/src/projection/ProjectionApp.tsx` | Ventana proyección pura — modelo para ventana NDI offscreen |
| `src/main/ipc/handlers/projection.ts` | Handlers `projection:show` → `projectionState.send()` — patrón a replicar |
| `src/main/services/projection-state.ts` | Estado singleton + broadcast — NDI se suscribe acá |
| `src/shared/ipc/contract.ts` | Contrato IPC — agregar canales NDI acá |

---

## Notas de Empaquetado

- NDI SDK runtime (`Processing.Audio.dll`, `Processing.Video.dll`, `ndi.dll` en Windows; `libndi.dylib` en Mac) → `extraResources` en `electron-builder`
- `@ndi/sdk` npm package incluye binarios? Verificar. Si no, descargar SDK oficial NewTek y empaquetar manualmente.
- `asarUnpack` para módulos nativos si van en `node_modules`.

---

## Conclusión

**Factibilidad: 95/100**. La arquitectura declarativa + stateless projection window hace que NDI sea "solo otro consumidor" del mismo `ProjectionOutput`. No hay refactors invasivos necesarios.

El trabajo real está en:
1. Captura de frames performante (OffscreenCanvas vs `capturePage`)
2. Empaquetado runtime NDI cross-platform
3. Decisiones UX (audio, discovery, persistencia)