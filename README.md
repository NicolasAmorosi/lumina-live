# Lumina Live

**Software libre de proyección para iglesias.** Diapositivas, video, imágenes, audio, la Biblia y
temporizadores en una segunda pantalla, con el mismo flujo de dos pasos que EasyWorship: elegís,
mirás la vista previa y recién ahí lo mandás EN VIVO.

![La ventana de control de Lumina Live: el programa del culto a la izquierda, la vista previa en el centro y lo que está en el proyector a la derecha](docs/screenshots/control-dark.webp)

> *Free and open-source church presentation software for Windows, macOS and Linux, in English,
> Spanish, Italian and Portuguese.*

## Qué hace

- **Presentaciones** `.ppt`, `.pptx`, `.pps`, `.ppsx`, `.odp` y `.pdf`, incluidos los himnarios
  `.pps` con auto-avance y música: respeta los tiempos de cada diapositiva y el audio embebido.
- **Cualquier video o audio.** Lo que el reproductor no puede decodificar (AVI, WMV, ProRes, AC3…) se
  convierte solo en segundo plano con FFmpeg, que viene incluido. El original no se toca.
- **Biblia** con búsqueda por texto (sin importar acentos). Trae la Reina-Valera 1909 y podés
  importar otras versiones en JSON, Zefania, USFX, OSIS o módulos MyBible/MySword.
- **Temporizadores** (cuenta regresiva, reloj, cronómetro) y **placas** sobre lo que se proyecta
  (nombre del predicador, logo).
- **NEGRO y LOGO** que pausan lo que se está reproduciendo y lo retoman donde estaba.
- **Pensada para un culto en vivo:** si se desconecta el proyector, la imagen vuelve sola cuando
  se reconecta; el orden de culto se guarda solo; cerrar la app por accidente pregunta antes.
- Programas guardados, biblioteca de medios, tema claro y oscuro.
- **En español, inglés, italiano y portugués.** La primera vez arranca en el idioma de la
  computadora; se cambia en Configuración › Sistema.

## Descargar

Los instaladores están en [Releases](https://github.com/NicolasAmorosi/lumina-live/releases/latest):
Windows (instalador), macOS con Apple Silicon (`.dmg`) y Linux (`AppImage`).

- **LibreOffice** hace falta para las presentaciones de PowerPoint (los PDF no lo necesitan). Si no
  está instalado, la app lo detecta y explica cómo instalarlo.
- Los instaladores **todavía no están firmados**. En Windows: «Más información» → «Ejecutar de todas
  formas». En macOS: Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente».

## Desarrollo

Requiere Node.js 22 o superior.

```bash
npm install          # también baja Electron y el FFmpeg de tu plataforma
npm run dev          # la app con recarga en caliente
npm run typecheck && npm run lint && npm run test   # lo mínimo antes de un PR
npm run test:e2e     # recorridos de la app real con Playwright
npm run package:win  # o package:mac / package:linux
```

Antes de tocar código, leé [`CLAUDE.md`](CLAUDE.md): es la guía de arquitectura y de convenciones
del proyecto, y [`docs/knowledge/`](docs/knowledge/) tiene el detalle de cada capa. Para contribuir,
mirá [`CONTRIBUTING.md`](CONTRIBUTING.md).

Stack: Electron, TypeScript, React, Vite, Tailwind, Zustand y SQLite (`better-sqlite3` + Drizzle).

## Licencia

[GPL-3.0-or-later](LICENSE). Podés usarla, estudiarla, modificarla y compartirla; si distribuís una
versión modificada, tiene que seguir siendo libre bajo la misma licencia.

FFmpeg se distribuye junto a la app como un programa aparte, bajo su propia licencia GPL-3.0 (ver
[`resources/ffmpeg-NOTICE.txt`](resources/ffmpeg-NOTICE.txt)). El texto de la Reina-Valera 1909 es
de dominio público.
