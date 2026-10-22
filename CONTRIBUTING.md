# Contribuir a Lumina Live

Gracias por querer ayudar. Lumina Live se usa en cultos en vivo, así que la prioridad es que nada
falle delante de la congregación: preferimos un cambio chico y probado a uno grande y ambicioso.

## Reportar un error

Abrí un [issue](https://github.com/NicolasAmorosi/lumina-live/issues/new/choose) con la versión, el
sistema operativo y, si podés, el archivo que falló y los registros (Configuración › Acerca de ›
Abrir carpeta de registros).

## Antes de escribir código

- Para algo más grande que un arreglo puntual, abrí primero un issue y conversémoslo.
- Leé [`CLAUDE.md`](CLAUDE.md). Aunque está escrito para Claude Code, es la guía del proyecto: la
  arquitectura, las convenciones que no se negocian y el porqué de cada una. `docs/knowledge/` tiene
  el detalle por capa, y `.claude/knowledge/` los hallazgos que costó descubrir.

## Convenciones

- Código, comentarios, nombres y mensajes de commit en **inglés**; documentación en español.
- Ningún texto de la interfaz va escrito en un componente: todo pasa por `useT()` y
  `src/renderer/src/lib/i18n/`.
- Ningún color, sombra o radio a mano: se usan las primitivas de `components/ui/` y los tokens de
  `styles/globals.css`.
- Commits con [Conventional Commits](https://www.conventionalcommits.org/) (`fix(bible): …`).
- El proyecto no usa Prettier: respetá el formato del archivo que tocás.

## Antes de abrir el PR

```bash
npm run typecheck && npm run lint && npm run test
```

Si el cambio toca lo que se proyecta, el teclado o la reproducción, corré también
`npm run test:e2e`. Contá en el PR cómo lo probaste.

## Licencia

Al contribuir, aceptás que tu aporte se publique bajo la misma licencia del proyecto,
[GPL-3.0-or-later](LICENSE).
