# Lumina Live

(Repositorio `WorshipApp`.) Aplicación de proyección para iglesias — Electron + TypeScript + React + Vite + Tailwind, con
SQLite embebido. Ver `CLAUDE.md` para la guía técnica completa y `docs/knowledge/` para el
detalle de cada capa.

## Funcionalidades
- Presentación de PowerPoint (.ppt, .pptx) con vista previa de diapositivas (Windows, vía COM)
- Reproducción de video e imagen en segunda pantalla
- Reproducción de audio (con audio vinculado a PowerPoint)
- Biblia integrada (RV1960) con búsqueda por texto sin acentos (FTS5) y proyección de versículos
- Playlists guardadas como programas reutilizables (abrir/duplicar/editar un culto anterior)
- Biblioteca de medios persistente (videos, imágenes, audios) con detección de archivos movidos/borrados
- Controles de negro/logo con toggle
- Tema claro/oscuro
- Sincronización minimizar/restaurar con pantalla de proyección

## Requisitos
- Node.js 22+
- Microsoft PowerPoint en Windows (para presentaciones — el resto de la app es multiplataforma
  para desarrollo, aunque el target de distribución es Windows)

## Instalación y desarrollo
```bash
npm install         # better-sqlite3 trae binarios precompilados, no compila nada
npm run dev          # electron-vite dev
npm run typecheck     # verificación de tipos
npm run test           # Vitest: capa de datos, zip reader, audio vinculado y estado del renderer
```

## Empaquetado
```bash
npm run package:win    # instalador NSIS
npm run package:mac     # dmg
npm run package:linux    # AppImage
```

## Identidad visual
La de Lumina Live: navy, acento teal y la llama del logo, con Noto Sans (y su corte
ExtraCondensed para títulos). Tema oscuro por defecto (pensado para operarse en una cabina a
oscuras) y tema claro alternativo. Detalle en `docs/knowledge/06-ui-and-theme.md`.

## `legacy/`
Contiene la versión previa de la app (Electron vanilla JS, sin bundler). Se conserva solo como
referencia hasta validar la paridad funcional en Windows con PowerPoint real — ver
`docs/knowledge/07-roadmap-and-debt.md`.
