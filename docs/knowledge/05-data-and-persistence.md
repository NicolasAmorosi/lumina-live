# 05 — Datos y persistencia

**Ya no hay JSON plano.** Todo vive en SQLite (`app.getPath('userData')/worship.db`), vía
`better-sqlite3` + Drizzle ORM. Ver `src/main/db/schema.ts` para el DDL completo.

## Por qué `better-sqlite3` y no `node:sqlite`

Verificado contra el runtime real de Electron 36 (Node 22.15.1): `node:sqlite` existe pero es
experimental y **no tiene FTS5** (`no such module: fts5`), inviable para la búsqueda bíblica.
`better-sqlite3@^13` es Node-API puro y su tarball trae **8 binarios precompilados**
(`darwin/win32/linux` × `x64/arm64`) — `npm install` no compila nada, sin `electron-rebuild`, y
se puede generar el instalador de Windows cross-compilando desde macOS. Único requisito de
empaquetado: `asarUnpack: ["**/node_modules/better-sqlite3/**"]` en `package.json > build`
(ya configurado). **No bajar a `^12`** — esa versión no trae prebuilds N-API.

## Tablas

`settings` (key/value), `media_assets` (video/imagen/audio/PPT en una sola tabla — todos
comparten el mismo problema de "el usuario movió el archivo"), `programs`+`program_items`
(playlists guardadas, polimórfico con `CHECK` sobre cuatro tipos de ítem; renombradas desde `services`/`service_items` en la
migración `0004_rename_programs.sql` con `ALTER TABLE ... RENAME` — un recreate de tabla habría
perdido el `CHECK`, que Drizzle no materializa en el snapshot), `bible_versions`+`bible_books`+`bible_verses`+
`bible_verses_fts` (FTS5 external-content), `bible_favorites`, `projection_history`,
`slide_decks`+`deck_slides`+`deck_audio`+`deck_videos` (cache persistente de presentaciones convertidas,
direccionado por hash de contenido — ver `03-slides-libreoffice.md`), `program_draft` y
`utility_scenes` (las escenas de tiempo guardadas de Funciones ▸ Utilidades).

`program_draft` es **una sola fila** (`id = 1`), reescrita entera, con el orden de culto que el
operador está armando y todavía no guardó. Era el único dato de usuario sin respaldo: vivía solo en
`program.store` del renderer, así que una recarga, un cierre, un crash o un corte de luz se llevaban
15–40 minutos de trabajo. `effects/draft-autosave.ts` lo escribe con debounce de 600 ms y `App` lo
recupera al arrancar.

Sus ítems son un **blob JSON**, no filas de `program_items`, y eso es deliberado: un borrador tiene
que poder referenciar un asset que el operador está por borrar, que es exactamente lo que la FK
`onDelete: "restrict"` de esa tabla existe para prohibir — un borrador nunca puede ser lo que
bloquea un borrado. `DraftRepo.load()` filtra al leer los ítems cuyo destino ya no existe —un asset
borrado de la biblioteca, una escena de tiempo borrada del editor—, del lado de main, que es el
único que puede responder eso sin un round-trip IPC por ítem.

### Los cinco tipos de ítem, y por qué cada migración de `program_items` se escribe a mano

`kind` es `media | ppt | bible | utility | plate`, y el `CHECK` de la tabla exige que cada uno
traiga exactamente su propia referencia y ninguna otra (`media_asset_id`, `bible_text`,
`utility_scene_id`, `overlay_plate_id`). Ese `CHECK` **no existe para Drizzle**: vive sólo en el SQL y el snapshot lo
reporta vacío. Consecuencia práctica, ya cobrada tres veces: renombrar exige `ALTER TABLE`
(`0004`), borrar una columna que el `CHECK` nombra exige una reconstrucción a mano (`0009`), y
**agregar una columna también** (`0011`, y otra vez `0015` para `overlay_plate_id`) — ahí `drizzle-kit` emite un `ADD COLUMN` que SQLite
acepta, perdiendo en silencio el `ON DELETE restrict` de la FK y dejando el `CHECK` sin enterarse
del tipo nuevo. El diagnóstico completo está en
[`sqlite-table-rename-must-alter-not-recreate.md`](../../.claude/knowledge/sqlite-table-rename-must-alter-not-recreate.md).

`utility_scene_id` es `ON DELETE restrict` por lo mismo que `media_asset_id`: borrar una escena que
un programa guardado usa es una decisión del operador (`utility:usages` nombra los programas y
«Eliminar igualmente» borra los ítems y la escena en una transacción), nunca una fila que
desaparece sola. `overlay_plate_id` repite el mismo trato con `overlay:usages`.

## `utility_scenes` — `tool` en columna, el resto en JSON, y una siembra que ocurre UNA vez

`tool` es una **columna** y no un campo de `config_json` porque es el discriminante: la lista
muestra un ícono y una etiqueta por escena, y no puede tener que parsear un blob por fila para
hacerlo. Lo demás se parte en dos JSON con roles distintos: `config_json` es lo que el operador
configuró (`TimerConfig`) y `style_json` es cómo se ve (`SceneStyle`, pensado para que Overlays y
los ajustes de proyección de la Biblia lo reutilicen). Son JSON y no treinta columnas para que un
cambio de forma sea una rama en `shared/scene-validators.ts` y no una migración.

De ahí salen las dos reglas que sostienen la tabla:

- **Main valida al ESCRIBIR** (`isUtilitySceneUpsert`), estricto: `registerHandlers` castea el
  request desde `unknown`, el renderer es otro proceso y una fila mal escrita sobrevive a la sesión
  que la escribió. Es el mismo argumento de `SETTINGS_VALIDATORS` sobre una forma más grande.
- **El repo normaliza al LEER** (`normalizeSceneStyle`/`normalizeTimerConfig`), tolerante y **campo
  por campo**: una fila escrita por una versión futura, editada a mano o truncada tiene que poder
  mostrarse igual, y un color roto cuesta el color, no la escena. Misma disciplina que
  `DraftRepo.load` y el seed de la Biblia. Lo que sale de un normalizador siempre pasa el validador
  — hay un test que lo afirma.

La siembra de las cuatro escenas de fábrica está guardada por el flag `utility.seeded` de
`settings`, **no por un conteo de filas**. Sembrar "cuando la tabla está vacía" significaría que el
operador que borra una escena la encuentra de vuelta el lunes, y que borrarlas todas es imposible.
Con el flag, borrar es borrar: el panel muestra su estado vacío y ofrece crear una.

## "¿Está convertido?" se pregunta por CONTENIDO, no por propiedad de la fila

`media_assets.content_hash` (migración `0007_media_content_hash.sql`) guarda el SHA-256 del
archivo — la misma identidad por la que `slide_decks` está indexado — junto a
`content_hash_size` y `content_hash_mtime_ms`, que son el **sello** que lo valida: el hash sólo
se usa mientras esos dos sigan coincidiendo con el `size_bytes`/`mtime_ms` de la fila. Es la misma
regla de invalidación que `tryCacheHit` ya aplicaba a una fila de deck, y es lo que evita tener
que releer el archivo para saber si el digest sigue describiéndolo.

Existe porque `slide_decks.media_asset_id` es **exclusivo** y `relinkDeck` lo mueve: preguntar
"¿este asset es dueño de una fila?" nunca puede dar "sí" para los dos archivos de un par idéntico.
Con la biblioteca real eso eran 555 de 1235 presentaciones marcadas como pendientes sin trabajo
real que hacer. Ahora `statusesByAsset` hace JOIN por hash y sólo cae a la propiedad de la fila
como respaldo, para un asset que el backfill todavía no selló.

El hash se escribe en dos lugares, nunca en otro:

- `runConversion` (`deck-service.ts`) lo guarda apenas lo calcula — ya lo necesitaba, así que es
  gratis y deja correcto un deck recién importado en el momento;
- `backfillContentHashes()` (`src/main/media/content-hash.ts`) barre en background 2 s después
  del arranque todo `ppt` sin sello válido, en chunks de 25 con un yield entre chunks, y emite
  `deck-statuses-changed` para que la grilla se repinte. Es idempotente: el segundo arranque
  cuesta una query indexada. Medido sobre la biblioteca real: 1235 archivos, 1,78 GB, 1,98 s.

**No lo reemplaces por `(size, mtime)`.** Es tentador porque la fila ya los trae, pero en la
biblioteca del usuario hay 34 pares `(tamaño, mtime)` que corresponden a contenidos distintos —
`Himnario Nuevo Cantado/035.pps` y `Himnario Nuevo Instrumental/035.pps` se copiaron juntos. La
cuenta daría bien igual; la miniatura del tile y el pin de desalojo de `adoptProgram` apuntarían
al deck equivocado. Diagnóstico completo en
[`.claude/knowledge/deck-cache-is-content-addressed-but-status-is-asset-owned.md`](../../.claude/knowledge/deck-cache-is-content-addressed-but-status-is-asset-owned.md).

## El orden de `programs` es manual, no por recencia

`programs.sort_order` (migración `0006_program_sort_order.sql`, índice `ix_programs_order`) es el
orden que el operador arma arrastrando filas en el modal de programas, y es el **único** criterio
de `ProgramsRepo.list()`. Abrir un programa ya no lo mueve: `last_opened_at` se sigue escribiendo
en `load()` pero ya no ordena nada. Reglas del campo:

- Un programa nuevo o duplicado entra con `MIN(sort_order) - 1` (puede ser negativo) para quedar
  arriba sin reescribir las otras filas; `reorder(ids)` renormaliza toda la columna a `0..n-1`.
- `reorder()` recibe la lista completa de ids en su nuevo orden y **no toca `updatedAt`** —
  arrastrar no es editar contenido, igual que `setFavorite()`.
- La migración siembra `sort_order` con el ranking que la lista mostraba antes
  (`last_opened_at DESC NULLS LAST, updated_at DESC, id ASC`), así que al actualizar nadie ve su
  lista reordenada.
- El drag se desactiva en el renderer cuando hay búsqueda o filtro activo: reordenar una vista
  parcial no se puede mapear a la lista completa.

## FTS5 sin acentos

`bible_verses_fts` usa `tokenize="unicode61 remove_diacritics 2"` — buscar "espiritu" encuentra
"Espíritu". La tabla es *external content* sobre `bible_verses` (no duplica los ~4MB de texto) y
se sincroniza con triggers `AFTER INSERT/UPDATE/DELETE`. El seed usa
`INSERT INTO bible_verses_fts(bible_verses_fts) VALUES('rebuild')` una sola vez al final en vez
de dejar que los triggers corran 31.102 veces — la carga completa mide ~550ms en esta máquina
(`npm run test`, proyecto `main`).

## `media_conversions` — hechos y resultados, nunca la decisión

Una fila por video o audio ya revisado con ffprobe (migración `0016_media_conversions`, `cascade` con
su asset). Guarda dos cosas: lo que dijo ffprobe (`probe_json`, un `MediaProbe` versionado por
`MEDIA_PROBE_VERSION`) y el archivo convertido (`output_file`). El nombre es **relativo** a
`userData/converted-media/`, por la misma razón que hizo daño el `cache_dir` absoluto de los decks: un
perfil copiado o movido apuntaría al perfil viejo. Las dos son válidas mientras `source_size` y
`source_mtime_ms` sigan siendo los del asset.

**No se guarda si hace falta convertir.** Eso se recalcula en cada arranque (`planPlayback`), porque
una de sus entradas pertenece a la MÁQUINA: si la GPU decodifica HEVC. Una biblioteca que se lleva a otra
PC no conserva la respuesta de la anterior, y una copia que en la máquina nueva ya no hace falta se
borra. **Tampoco se guarda un fallo**: se reintenta en el próximo arranque o con «Reintentar».

`worship://asset/<id>` sirve la copia cuando existe y coincide el sello (`ConversionsRepo.outputFor`).
Un `.part` interrumpido y las copias que ninguna fila referencia se barren al arrancar. Los clips
embebidos en un `.pptx` no usan esta tabla: se convierten adentro de la caché del deck y actualizan
su propia fila de `deck_videos`/`deck_audio` (`media/deck-clips.ts`).

## Archivos faltantes — nunca se borran filas

`media_assets.missing_since` se marca en un barrido (`MediaRepo.sweep()`, lo programa
`library-sweeper.ts`) sobre las filas `in_library=1` **y las de carpetas vinculadas que usa un programa
guardado**; sin estas últimas, un ítem de una carpeta vinculada nunca mostraba «Relocalizar…». Un
archivo ausente **nunca borra la fila** — puede ser un pendrive desconectado. La UI muestra un badge y
ofrece `library:relocate`, que reescribe `path`/`pathKey` sin tocar el id — cualquier `program_item`
que lo referencie por `mediaAssetId` sigue funcionando solo. Si el archivo elegido YA es una fila (lo
normal cuando un pendrive volvió con otra letra y su carpeta se volvió a vincular), las dos filas se
FUSIONAN en la que el programa referencia: programas, placas, decks e historial pasan a ese id y el
duplicado se borra, todo en una transacción.

Una carpeta vinculada que no está (`library:listFolder`) responde `FOLDER_MISSING`, no una lista vacía:
eran indistinguibles. Y ninguna importación acepta un `._x.pps` (el AppleDouble que macOS deja en un
pendrive FAT/exFAT), un `~$x.pptx` (el lock de PowerPoint) ni un archivo cuya extensión no sea de su
`kind` (`importable` en `library-import.ts`).

`pathKey` normaliza (`NFC` + lowercase en Windows) para que `C:\a.mp4` y `c:\A.MP4` no entren dos
veces — Windows es case-insensitive y el legacy no lo contemplaba.

## Migración de datos legacy

`src/main/services/migrate-legacy-data.ts` corre una sola vez al primer arranque: si existen
`settings.json`/`media_library.json` en `userData` (de una instalación de la versión vanilla),
importa `logoPath` y cada entrada de biblioteca a SQLite (el `lastFolder` del archivo legacy
ya no tiene dónde caer: el selector abre una carpeta por tipo, no la última usada), y renombra los archivos
originales a `*.migrated` para que no se reprocesen. Best-effort: un JSON corrupto no bloquea el
arranque.

## Seed de la Biblia — nunca se escribe dentro del bundle

`resources/bibles/rv1960.json` se empaqueta con `extraResources` (`build/electron-builder`) y se
importa a las tablas en el **primer arranque**, no en build time — así una actualización de la
app nunca pisa la DB del usuario. `bible:import` hace exactamente lo mismo: parsea el archivo en
memoria e inserta filas. **Nunca escribe un archivo dentro del directorio de la app** — el bug
legacy de `import-bible` escribiendo en `data/bible/` (roto en una instalación empaquetada por
permisos) no existe en este diseño.

Idempotencia por `sourceHash` (sha256 del archivo) en `bible_versions` — reimportar el mismo
archivo no vuelve a sembrar nada. Un reseed **conserva el nombre que la fila ya tiene**: la
versión se puede renombrar desde Ajustes (es lo que el proyector escribe debajo del versículo), y
un `rv1960.json` corregido en un build posterior no puede deshacer ese renombre.

### La bandera `bible.builtinSeeded` — y por qué se consulta solo si la fila NO está

`seedBuiltinBibles()` corre en cada arranque, así que sin bandera la RV1960 volvía al siguiente
inicio y «borrar» no significaba borrar. Pero la bandera **no** puede apagar la siembra sin más,
porque la siembra es también el camino de actualización. Las tres reglas, en orden:

| Estado | Qué hace |
|---|---|
| la fila existe | siembra igual — el corto-circuito por hash la vuelve un digest por arranque, y es así como un `rv1960.json` corregido llega a una instalación ya hecha |
| no existe y la bandera está puesta | el operador la borró: se respeta |
| no existe y la bandera no está | base nueva: siembra y pone la bandera |

Por eso `seedBuiltinBibles` corre **después** de `initRepos()` (necesita `SettingsRepo`), igual
que la siembra de escenas de tiempo y por la misma razón.

## Formatos de Biblia — el formato lo deciden los BYTES

`src/main/db/seed/bible-formats/` acepta cinco familias y `seed-bible.ts` no sabe cuál fue:

| Formato | Cómo se lee | Identidad del libro |
|---|---|---|
| JSON (el del bundle y cualquier variante) | `json.ts`, tolerante a toda forma conocida | el `abbrev` del propio archivo |
| Zefania XML (`.xml`, `.zip`) | modelo de objetos de `fast-xml-parser` | `bnumber` (1..66) |
| USFX XML | recorrido **ordenado** (`xml-ordered.ts`) | `<book id="GEN">` |
| OSIS XML | el mismo recorrido; dos formas legales de versículo | `osisID="Gen.1.1"` |
| MyBible.zone / MySword | `better-sqlite3` en `readonly` | `book_number` (10..730) / `Book` (1..66) |

`detectBibleFormat` sniffea números mágicos (`SQLite format 3\0`, `PK\x03\x04`) y después el
elemento raíz — **nunca la extensión**, igual que `container-kind.ts` con una presentación. Un
`.zip` se abre con `readZipEntries` (no `unzipSync`) y gana la entrada más grande; un módulo
SQLite comprimido **no** se soporta, porque haría falta escribirlo a un temporal.

Todo lo que no es el JSON pasa por `BookCollector`, que deduplica (el UNIQUE de `bible_verses`
abortaría la transacción entera por un solo versículo repetido), descarta versículos vacíos y
reordena los libros al orden canónico. El testamento sale de la **posición** canónica, nunca de
una lista de nombres — ver
[`.claude/knowledge/a-book-code-namespace-is-per-format-and-testament-was-never-derived-right.md`](../../.claude/knowledge/a-book-code-namespace-is-per-format-and-testament-was-never-derived-right.md),
que además documenta las 23 filas que estuvieron mal desde el primer commit. Las trampas de cada
formato (milestones, Latin-1, apparatus de los módulos) están en
[`.claude/knowledge/a-bible-module-is-milestoned-xml-or-latin-1-or-sqlite-and-never-what-its-name-says.md`](../../.claude/knowledge/a-bible-module-is-milestoned-xml-or-latin-1-or-sqlite-and-never-what-its-name-says.md).

## Gestión de versiones

`bible:rename` / `bible:delete` / `bible:usages`. El nombre es el **único** campo editable: el
`code` es la identidad contra la que el seed compara el hash y la clave a la que apuntan las filas
de `bible_favorites`, así que editarlo huerfanaría favoritos y duplicaría la versión en el próximo
arranque.

Borrar cae en cascada sobre `bible_books`/`bible_verses` (y los índices FTS5 por trigger) y
deliberadamente **no** toca dos cosas: las filas de `program_items`, cuyo FK es `set null` —el
programa guardado conserva texto y referencia y pierde solo el vínculo—, y las de
`bible_favorites`, que están keyed por CÓDIGO justamente para sobrevivir a un
borrar-y-reimportar. `force` acá es consentimiento informado y nada más: a diferencia del de una
escena de tiempo, este borrado no puede fallar por FK.

## `SETTINGS_NORMALIZERS` — la primera clave de `settings` que es una ESTRUCTURA

Hasta `bible.style` toda clave era un escalar o un `Record` de escalares: una mal escrita cae a su
default y no se pierde nada más. Un `BibleStyle` no: un degradado al que le falta un color tiene
que volver con el fondo por defecto y la tipografía que el operador eligió, no como un extraño.
Así que `SettingsRepo.load()` aplica un normalizador por clave cuando lo hay
(`shared/types/settings.ts`), que es la misma disciplina de `utility_scenes.style_json` —
**validar al escribir, normalizar campo por campo al leer**— aplicada por primera vez a una fila
de `settings`.

## Migraciones y backup

`src/main/db/migrate.ts` saca una copia de `worship.db` a `userData/backups/` antes de correr
`drizzle-orm`'s `migrate()`, conservando las últimas 3. Si una migración falla, el usuario ve un
diálogo con la ubicación del backup en vez de una pantalla en blanco.

**`VACUUM INTO`, no `copyFileSync`**, y verificada con `PRAGMA integrity_check` sobre la copia. La
base corre en `journal_mode = WAL`: las transacciones recientes viven en `worship.db-wal`, no en el
archivo principal, así que copiarlo solo descarta en silencio todo lo posterior al último
checkpoint. Normalmente salía completa —esta función corre antes de que la app abra la base, con el
WAL ya checkpointeado— y fallaba justo cuando hacía falta: después de un cierre sucio, un corte de
luz o un SIGKILL. Medido en `npm run test` (`tests/main/data-layer.test.ts`) con un `-wal` caliente de 4,1 MB:
`VACUUM INTO` captura las 5000 filas, `copyFileSync` 4977. `backupBeforeMigrate` devuelve un
`BackupResult` y el diálogo de error dice la verdad: promete una copia solo si de verdad la hay y
pasó el `integrity_check`.

La otra mitad es la salida: `closeDatabase()` corre en `will-quit` con
`wal_checkpoint(TRUNCATE)` + `close()`. Sin eso el `-wal` crecía entre sesiones, que es lo que hacía
más probable el escenario de arriba. Un cierre limpio **borra** `-wal` y `-shm`; que sobrevivan a
una salida es la forma más rápida de detectar que esto se rompió.

**Solo cuando hay algo pendiente**, y eso es correctitud, no rendimiento. `hasPendingMigrations()`
compara el `when` más nuevo de `drizzle/meta/_journal.json` contra `MAX(created_at)` de
`__drizzle_migrations`, abriendo la base en modo lectura. Antes copiaba en **todos** los arranques:
como las migraciones corren una sola vez, tres arranques normales después de migrar llenaban los
tres cupos con copias post-migración y **rotaban afuera la única copia que esta función existe para
guardar**. Se veía en la carpeta real del usuario: las 3 copias eran del mismo día y del mismo
tamaño, todas posteriores a la última migración.

## Parseo defensivo de la Biblia (el camino JSON)

`src/main/db/seed/bible-formats/json.ts` tolera las mismas variantes que la versión legacy: contenedor
array-de-libros / `{books:[...]}` / objeto-por-nombre; libro con `name` o `nombre`; capítulos
array u objeto `{"1":...}`; versículos string[]/`{text}`[]/`{verse}`[]/objeto. Verificado contra
`rv1960.json` real: **sí tiene `name`** en los 66 libros — el bug "se muestra 'Libro' 66 veces"
que documentaba la versión legacy de este archivo (`.claude/knowledge/`) no se reprodujo con los
datos actuales; no se portó ningún fix para él.
