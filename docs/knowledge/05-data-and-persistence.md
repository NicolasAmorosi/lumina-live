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
(playlists guardadas, polimórfico con `CHECK`; renombradas desde `services`/`service_items` en la
migración `0004_rename_programs.sql` con `ALTER TABLE ... RENAME` — un recreate de tabla habría
perdido el `CHECK`, que Drizzle no materializa en el snapshot), `bible_versions`+`bible_books`+`bible_verses`+
`bible_verses_fts` (FTS5 external-content), `bible_favorites`, `projection_history`,
`slide_decks`+`deck_slides`+`deck_audio` (cache persistente de presentaciones convertidas,
direccionado por hash de contenido — ver `03-slides-libreoffice.md`).

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
(`npm run db:smoke`).

## Archivos faltantes — nunca se borran filas

`media_assets.missing_since` se marca en un barrido (`MediaRepo.sweep()`, corre en cada
`library:list`) que revisa `fs.existsSync` sobre las filas `in_library=1`. Un archivo ausente
**nunca borra la fila** — puede ser un pendrive desconectado. La UI muestra un badge y ofrece
`library:relocate`, que reescribe `path`/`pathKey` sin tocar el id — cualquier `program_item`
que lo referencie por `mediaAssetId` sigue funcionando solo.

`pathKey` normaliza (`NFC` + lowercase en Windows) para que `C:\a.mp4` y `c:\A.MP4` no entren dos
veces — Windows es case-insensitive y el legacy no lo contemplaba.

## Migración de datos legacy

`src/main/services/migrate-legacy-data.ts` corre una sola vez al primer arranque: si existen
`settings.json`/`media_library.json` en `userData` (de una instalación de la versión vanilla),
importa `logoPath`/`lastFolder` y cada entrada de biblioteca a SQLite, y renombra los archivos
originales a `*.migrated` para que no se reprocesen. Best-effort: un JSON corrupto no bloquea el
arranque.

## Seed de la Biblia — nunca se escribe dentro del bundle

`resources/bibles/rv1960.json` se empaqueta con `extraResources` (`build/electron-builder`) y se
importa a las tablas en el **primer arranque**, no en build time — así una actualización de la
app nunca pisa la DB del usuario. `bible:import` (el equivalente al viejo "Importar Biblia") hace
exactamente lo mismo: parsea el JSON en memoria e inserta filas. **Nunca escribe un archivo
dentro del directorio de la app** — el bug legacy de `import-bible` escribiendo en
`data/bible/` (roto en una instalación empaquetada por permisos) no existe en este diseño.

Idempotencia por `sourceHash` (sha256 del JSON) en `bible_versions` — reimportar el mismo archivo
no vuelve a sembrar nada.

## Migraciones y backup

`src/main/db/migrate.ts` copia `worship.db` (+ `-wal`/`-shm`) a `userData/backups/` antes de
correr `drizzle-orm`'s `migrate()`, conservando las últimas 3. Si una migración falla, el usuario
ve un diálogo con la ubicación del backup en vez de una pantalla en blanco.

## Parseo defensivo de la Biblia

`src/main/db/seed/bible-source.ts` tolera las mismas variantes que la versión legacy: contenedor
array-de-libros / `{books:[...]}` / objeto-por-nombre; libro con `name` o `nombre`; capítulos
array u objeto `{"1":...}`; versículos string[]/`{text}`[]/`{verse}`[]/objeto. Verificado contra
`rv1960.json` real: **sí tiene `name`** en los 66 libros — el bug "se muestra 'Libro' 66 veces"
que documentaba la versión legacy de este archivo (`.claude/knowledge/`) no se reprodujo con los
datos actuales; no se portó ningún fix para él.
