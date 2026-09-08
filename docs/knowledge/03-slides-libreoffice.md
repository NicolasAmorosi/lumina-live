# 03 — Pipeline de diapositivas (LibreOffice headless)

Reemplaza por completo la integración COM/PowerShell con PowerPoint. Ya **no** hay nada
Windows-only: la app corre y se valida igual en macOS, Windows y Linux.

## El cambio de modelo

Antes: *control remoto de un slideshow vivo de PowerPoint* — main sostenía un cursor de
diapositiva, PowerShell lo movía, y los PNG eran un subproducto efímero en `os.tmpdir()`.

Ahora: **un deck es contenido**. Se convierte una sola vez y se cachea; main ya no tiene un cursor
de diapositiva, tiene un **cache**. Ese solo replanteo es lo que borra `ppt:next/prev/goto/
currentSlide/close` — el cursor vive en el store del renderer y es la única copia.

## El pipeline

```
.pptx ──soffice --convert-to pdf──► PDF ──pdfjs en ventana oculta──► WebP por slide
   │                                                                      │
   └──parseo OOXML (fflate + fast-xml-parser)──► timings + audio ─────────┴──► SQLite + disco
```

`soffice --convert-to png` **solo exporta la primera diapositiva** — de ahí el paso por PDF.

## Por qué el rasterizado va en una `BrowserWindow` oculta

Rasterizar necesita un Canvas2D real. La alternativa (`@napi-rs/canvas` en un `utilityProcess`)
publica su binario nativo como `optionalDependency` **por plataforma**: a diferencia de
`better-sqlite3` (8 binarios en un tarball), `npm install` en macOS nunca baja el de Windows, así
que cross-compilar el instalador de Windows desde una Mac — cosa que este proyecto hace — shippearía
una app rota. Una ventana oculta ya es su propio proceso del SO, así que el aislamiento ante un
crash es el mismo, sin ese riesgo.

Se usa el build **legacy** de pdf.js (`pdfjs-dist/legacy/build/pdf.mjs`): el bundle moderno usa
built-ins que el Chromium de Electron 36 todavía no tiene y falla con
`n.toHex is not a function`.

## Identidad por hash de contenido

`slide_decks` se identifica por `(content_hash, render_width, image_format)`, **no** por
`media_asset_id`. Dos entradas de biblioteca que apuntan a copias del mismo archivo comparten una
conversión, y mover el archivo es un hit de cache en vez de reconvertir. Hay un fast-path previo
por `(size, mtime)` que ni siquiera hashea.

## Alineación de timings — el detalle que importa

**LibreOffice NO exporta las diapositivas ocultas al PDF** (verificado contra un deck real). Por
eso los timings se alinean contra las diapositivas **visibles** (`!hidden`), no contra la lista
completa del OOXML: hacerlo mal corre cada timing una posición por cada slide oculta. Si los
conteos igual no coinciden (una animación que LibreOffice parte en varias páginas), se descartan
**todos** los timings (`timings_source = 'none'`) — un auto-avance desalineado en silencio es peor
que no tener auto-avance.

## Parseo OOXML

- `ppt/presentation.xml` → `<p:sldIdLst>` da el **orden real**. `slide1.xml, slide2.xml…` es el
  orden de creación y diverge apenas alguien reordena.
- El `<p:transition>` casi nunca está en la raíz del slide en decks modernos: vive en
  `mc:AlternateContent/mc:Choice[@Requires="p14"]`, con copia en `mc:Fallback`. Se revisan las tres
  formas. Mirar solo la suelta es la forma más común de leer cero timings sin darse cuenta.
- `@advTm` (ms de auto-avance), `@advClick`, `p:sld/@show="0"` (oculta).
- Audio: `p:pic` con `a:audioFile` + los `_rels` del slide; `p:cMediaNode` da loop/volumen.
  OOXML no tiene un booleano de "suena en todo el deck" — es una heurística documentada
  (`loop` o `repeatCount="indefinite"` ⇒ `scope: "deck"`).
- `.ppt`/`.pps` binarios (OLE2, no zip): se convierten **también** a `.pptx` con una segunda pasada
  de LibreOffice solo para recuperar timings y audio (`timings_source = 'ooxml-converted'`).
  Verificado: un `.ppt` real de 52 diapositivas se recupera entero.

## Aislamiento de LibreOffice

`-env:UserInstallation=file://<userData>/soffice-profile` es **obligatorio**: un perfil propio
significa un lock y un named pipe propios, así que una copia de LibreOffice abierta por el usuario
como app normal ni roba nuestro comando ni nos bloquea. El perfil se calienta una vez por versión
al arrancar (`slides.profileWarmedVersion`).

En Windows se prefiere **`soffice.com` antes que `soffice.exe`**: el `.exe` se desacopla y devuelve
antes de que el PDF exista; el `.com` bloquea hasta terminar.

Los argumentos van siempre como array de `argv`, nunca como string de shell — y el nombre del
filtro va **sin comillas** (`pptx:Impress MS PowerPoint 2007 XML`), porque unas comillas literales
pasan a ser parte del nombre del filtro y LibreOffice lo rechaza.

## Se acabó la danza del overlay

Como una diapositiva ahora es un `<img>`, la ventana de proyección **nunca se esconde**. NEGRO y
LOGO son resultados normales de `selectOutput`, y el canal `projection:setOverlayVisible`
desapareció. El audio del deck sigue sonando durante NEGRO — verificado.

## Servido

`worship://deck/<deckId>/<n>[/thumb]` resuelve contra `deck_slides` y se sirve con
`Cache-Control: public, max-age=31536000, immutable` — el par `(deckId, slideIndex)` es inmutable
por construcción (otro contenido ⇒ otro hash ⇒ otro deckId). Sin ese header Chromium releería cada
imagen en cada cambio de diapositiva, en vivo. El audio (`worship://deck-audio/<id>`) va sin ese
header porque se recorre con seek, no se reemplaza.

Todo lo que sirve `worship://` pasa por `serveFile()`, que implementa **semántica real de
`Range`** (206 + `Content-Range`, `Accept-Ranges: bytes`, 416, streaming con
`fs.createReadStream({start,end})`). Antes delegaba en `net.fetch(file://…)` sin reenviar los
headers, lo que dejaba a todo video/audio **sin seek** y rompía la reproducción con
`PIPELINE_ERROR_DECODE (-12909)` por datos desalineados — ver
[`.claude/knowledge/worship-protocol-range-and-video-lifecycle.md`](../../.claude/knowledge/worship-protocol-range-and-video-lifecycle.md).

## Verificación sin levantar la app

```bash
npm run slides:smoke -- "ruta/al/archivo.pptx"
```

Cubre discovery de soffice, conversión a PDF, el round-trip de `.ppt` legacy, orden de
diapositivas, timings, slides ocultas y extracción de audio. El rasterizado no entra ahí porque
necesita el canvas de Chromium — eso solo corre dentro de la app.
