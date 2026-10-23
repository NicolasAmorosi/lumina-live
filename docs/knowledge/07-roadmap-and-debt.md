# 07 — Roadmap y deuda conocida

## Estado de esta migración

Se completó: andamiaje `electron-vite` + TS estricto, el design system (`components/ui`+
`shared`), la capa de datos completa (SQLite + Drizzle + FTS5, con smoke test verificado), el
contrato IPC tipado end-to-end, el protocolo `worship://`, el pipeline de diapositivas con
LibreOffice headless (multiplataforma, ver `03-slides-libreoffice.md`), la
ventana de proyección declarativa, y una UI de control funcional para las 6 áreas auditadas
(playlist, biblioteca, biblia, PPT, negro/logo, display) más el módulo
nuevo de servicios guardados.

**No se implementó** (fuera de alcance explícito de esta tarea, acordado con el usuario):
canciones/letras con secciones proyectables.

## Deuda dejada conscientemente para una siguiente sesión

- **Drag & drop real de archivos del SO** al playlist/biblioteca: la legacy lo tenía
  (`setupDragDrop`, `app.js:116`); esta migración prioritizó la persistencia y el contrato tipado
  y dejó el alta de archivos solo vía el diálogo (`files:pick`). El drag interno
  playlist↔biblioteca (`draggable` en las filas) está scaffoldeado pero sin `onDrop` implementado.

- **UI de favoritos e historial bíblico**: las tablas `bible_favorites` y `projection_history` y
  sus repos existen y funcionan (`HistoryRepo.record()` ya se llama en cada
  `projection:show`), pero no hay pantalla que los liste todavía.
- ~~**Video embebido dentro de una diapositiva**~~: **implementado el 2026-09-20** como overlay
  posicionado. Queda un límite duro que no es deuda sino formato: los `.ppt`/`.pps` legacy pierden
  el video entero, así que la feature es solo para `.pptx`/`.ppsx` — medido en
  [`.claude/knowledge/an-embedded-deck-video-survives-to-the-pdf-but-never-survives-a-ppt.md`](../../.claude/knowledge/an-embedded-deck-video-survives-to-the-pdf-but-never-survives-a-ppt.md).
  Lo que sí queda abierto: un video cuyo `p:pic` no trae `a:xfrm` propio (hereda la geometría de un
  placeholder del layout, que el parser no resuelve) se descarta en vez de adivinarse, y un
  `.wmv`/`.avi` se extrae pero se marca `playable: false`. En los dos casos la diapositiva se sigue
  viendo bien: el fotograma de portada ya está rasterizado en su lugar.
- ~~**Ajustes de proyección configurables** para biblia/texto~~: **implementado el 2026-09-20**.
  El estilo del versículo vive en la clave `bible.style` de `SettingsMap` —un estilo global, no una
  fila por preset— con `BibleStyle` (`shared/types/bible-style.ts`), sus validadores/normalizadores
  y la primera entrada de `SETTINGS_NORMALIZERS`. Se edita en Ajustes ▸ Biblia ▸ Estilo, con la
  vista previa dibujada por el mismo `OutputView` del proyector, y se guarda al instante: `App` lo
  espeja a `projection.store`, que recalcula `selectOutput` **sin** tocar `sceneEpoch`, así que
  editar lo que está EN VIVO es un parche en el lugar y no una transición.
- **UI de favoritos bíblicos**: `bible_favorites` sigue sin pantalla. Ojo con una decisión ya
  tomada: borrar una versión **no** borra sus favoritos (están keyed por código, no por FK)
  justamente para que borrar-y-reimportar no sea destructivo.
- **Pantalla de Configuración**: cuatro categorías (Proyección, Diapositivas, Biblia, Sistema) con
  tema, idioma, `media.volume`, las carpetas por tipo (`files.defaultFolders`) y las claves
  `slides.*` ya expuestas. Desde el 2026-10-22, Diapositivas abre con un grupo **LibreOffice**
  (estado, versión y ruta, «Descargar», «Comprobar de nuevo», «Buscar soffice…» y el switch
  `slides.warnMissingSoffice`). Lo que sigue sin UI es **borrar** el override
  (`slides.sofficePath`): una ruta elegida a mano manda sobre la detección automática, así que si
  apunta a algo que no es LibreOffice la única salida es elegir otra con «Buscar soffice…».

## Revisión pre-lanzamiento del 2026-10-18 — lo que quedó abierto a propósito

La revisión completa de esa fecha (main, slides, renderer, UI y Windows) cerró todos sus hallazgos
críticos, altos y medios. Quedó abierto esto, cada cosa con su motivo:

- **Una música vinculada en WMA/AIFF no se convierte**, se rechaza (`LINKABLE_AUDIO_EXTENSIONS` en
  `ipc/handlers/library.ts`). `worship://linked-audio/<id>` sirve el archivo tal cual, y los 1229 audios
  vinculados del himnario real son MP3. Si hiciera falta, pasa por `conversion-service.ts`.
- **Las filas clickeables de `ListRow` no se alcanzan con el teclado** (Escenas, Placas, Utilidades,
  Overlays). Hacerlas focusables choca con Enter = EN VIVO: es una decisión de interacción, no un arreglo.
- **Violaciones de estilo en `pages/`** (la tabla de la revisión de UI): los botones a mano de
  `media-source-bar.tsx` y del selector de tema (el rebrand a Lumina Live solo les cambió forma y
  foco, siguen escritos a mano), unas 25 clases de tipografía escritas a mano en
  `pages/`, la nota de advertencia duplicada entre `remove-asset-confirm` y `program-side-panel`, y dos
  copias de la caja de `FieldGroup`. Son cosméticas y cada una necesita una pasada visual.
- **Las unidades `s`, `px` y `%` siguen escritas en el código.** Son tipografía, no palabras; los
  nombres de colores neutros sí pasaron por i18n.
- **El paquete de Windows lleva los prebuilds de better-sqlite3 de otras plataformas** y sus fuentes
  de SQLite (~24 MB). Excluirlos por plataforma es posible, pero se tocaría la carga del módulo nativo
  justo antes del lanzamiento.
- **Volver a sembrar RV1909 con un JSON distinto borraría la versión de los versículos guardados**
  (`seed-bible.ts`). No ocurre: el archivo no cambió desde el primer commit.
- **Sin firma de código** (SmartScreen avisa «Windows protegió su PC») — `I1`, cuesta dinero.
- **A comprobar a mano en la PC de la iglesia**: Win+P en «Extender»; escalas distintas por monitor;
  apagar y prender el proyector en pleno culto (la ventana se oculta, el sonido sigue, y vuelve sola a
  pantalla completa); prender el proyector con la app ya abierta; plan de energía; LibreOffice 64 bits
  en un primer arranque en frío; «Probar video» con HEVC de iPhone; la salida de audio por HDMI; y la
  suite E2E contra el `.exe` instalado (`WORSHIP_E2E_EXECUTABLE`), con `WORSHIP_E2E_HYMNAL` apuntando
  a la carpeta del himnario de esa PC para que corra también `hymnal.spec.ts`. Y, desde el rebrand a
  **Lumina Live** (2026-10-22), que el instalador nuevo REEMPLACE al de WorshipApp: un solo acceso
  directo, una sola entrada en «Aplicaciones instaladas», y los programas, la biblioteca y las Biblias
  de esa PC presentes en el primer arranque (`userData` sigue en `%APPDATA%\worship-app`, mismo
  `appId`).
- **Las escenas y placas guardadas antes del rebrand conservan los colores de ALPS** (`#04132b`,
  `#84adfc`, la cuenta regresiva en `#cd4900`/`#d0021b`): los defaults de Lumina Live solo visten lo
  que se crea desde el 2026-10-22, y las cuatro escenas de ejemplo se siembran una sola vez. Es a
  propósito —son contenido del operador—; pasarlas a la paleta nueva es editarlas a mano.
- **Cuatro E2E fallaron una vez en una corrida completa del 2026-10-22 y pasaron solos al
  repetirlos**: `bible.spec` «after clicking EN VIVO…» y «a file that is not a Bible…» (el tab de
  Ajustes se desmontaba bajo el click), `keyboard.spec` «↓ after clicking a library tile…» y
  `logo.spec` «L covers what is live…». En la corrida completa siguiente (ese mismo día, todo ya
  commiteado) pasaron los cuatro; no se investigó si alguno es del producto.
- **El EN VIVO que abre el proyector espera a que su ventana cargue** (desde el arreglo de la
  diapositiva 1, 2026-10-22): 0,2 s normalmente, hasta 3 s con la máquina ocupada. Una tecla pulsada
  en ese lapso no mueve nada, porque todavía no hay nada en vivo. Antes avanzaba un deck que el
  proyector aún no había mostrado. Si en un culto molesta, se puede encolar.
- **Lo que la suite E2E no puede ejercitar**: soltar archivos desde Finder/Explorer
  (`getPathForFile` exige un `File` nativo), dos pantallas reales, y los diálogos nativos — esos se
  contestan reemplazando `dialog.showOpenDialog` en main (`answerOpenDialog`), así que el botón y todo
  lo que sigue sí son los reales.
- **31 de los 35 `Select` no tienen nombre accesible.** Los que viven en un `FieldRow` quedan
  nombrados solo por el `role="group"`, no el combobox; los tres del navegador de la Biblia y el
  filtro de Programas, por nada. El arreglo es en el primitivo (que `Select` tome el `labelId` del
  `FieldRow` que lo contiene) más un `aria-label` en los cuatro sueltos.

## Multiplataforma — resuelto

Ya no hay nada Windows-only. El COM/PowerShell se eliminó por completo y las presentaciones se
convierten con LibreOffice headless, que corre igual en macOS, Windows y Linux. LibreOffice **no
se empaqueta**: la app lo detecta en el sistema (con override manual en `slides.sofficePath`) y,
si falta, avisa y traba solo convertir PowerPoint; los PDF, los decks ya convertidos y todo lo
demás siguen andando — ver «Sin LibreOffice» en `03-slides-libreoffice.md`.

**Linux se empaquetó y probó por primera vez el 2026-10-22**, en Docker (Ubuntu 24.04 x86_64
emulado): arranca, convierte con el LibreOffice del sistema y pasa `startup.spec` y `decks.spec`;
el resto de la suite no se corrió ahí. Abierto: sin espacios de nombres de usuario el sandbox de
Chromium aborta («The SUID sandbox helper binary was found, but is not configured correctly»), y
Ubuntu 23.10+ los restringe por AppArmor, así que un doble click en el AppImage probablemente falle
en un Ubuntu de escritorio. Las salidas son un `.deb` (instala `chrome-sandbox` con permisos de
root) o documentar `--no-sandbox`; es decisión del dueño.

Verificado en macOS contra decks reales de iglesia, incluyendo un `.ppt` binario de 52
diapositivas y un fixture con auto-avance + audio embebido. `legacy/` se retiró del repo el
2026-10-22; sigue en la historia de git.

## Idiomas

Desde el 2026-10-22 la app habla `es`, `en`, `it` y `pt` (portugués de Brasil). Sumar otro es:
el código en `LOCALES` (`shared/types/settings.ts`), un archivo en `lib/i18n/messages/` y otro en
`main/i18n/messages/` (los dos tipados contra su `es`), sus nombres de libros bíblicos en
`main/db/seed/bible-formats/book-names.ts` y su endónimo en `settings.locales`. Sin tocar
componentes: los mapas de diccionarios están tipados sobre `Locale`, así que olvidarse de uno no
compila.

Pendiente: las capturas (`npm run screenshots`) y la landing muestran la interfaz en español en
todos los idiomas.
