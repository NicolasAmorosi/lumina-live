/**
 * Exercises the LibreOffice half of the slide pipeline WITHOUT Electron:
 * soffice discovery, PPTX -> PDF conversion, and OOXML metadata extraction
 * (slide order, auto-advance timings, embedded audio).
 *
 * Rasterization is deliberately NOT covered here — it needs a Chromium canvas,
 * so it only runs inside the app.
 *
 *   npx tsx scripts/convert-smoke.ts <archivo.pptx> [...]
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  containerKind,
  extractAudioParts,
  extractVideoParts,
  readPresentationMeta,
} from "../src/main/slides/pptx-metadata";
import { resolveLinkedAudio } from "../src/main/slides/linked-audio";
import { readBinarySlideTimings } from "../src/main/slides/ppt-binary-timings";

const run = promisify(execFile);

const CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/opt/homebrew/bin/soffice",
];

function findSoffice(): string {
  const fromEnv = process.env["WORSHIP_SOFFICE_PATH"];
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const found = CANDIDATES.find((c) => fs.existsSync(c));
  if (!found) {
    console.error("LibreOffice no encontrado. Instalá con: brew install --cask libreoffice");
    process.exit(1);
  }
  return found;
}

async function convert(
  soffice: string,
  profileDir: string,
  source: string,
  outDir: string,
  target: "pdf" | "pptx",
): Promise<string> {
  // No quotes around the filter name — argv entries, not a shell string.
  const filter =
    target === "pdf" ? "pdf:impress_pdf_Export" : "pptx:Impress MS PowerPoint 2007 XML";
  await run(
    soffice,
    [
      "--headless",
      "--invisible",
      "--nologo",
      "--nodefault",
      "--norestore",
      "--nolockcheck",
      `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
      "--convert-to",
      filter,
      "--outdir",
      outDir,
      path.resolve(source),
    ],
    { timeout: 180_000, env: { ...process.env, SAL_DISABLE_OPENCL: "1" } },
  );
  const produced = fs.readdirSync(outDir).find((f) => f.toLowerCase().endsWith(`.${target}`));
  if (!produced) throw new Error(`LibreOffice no generó un ${target}`);
  return path.join(outDir, produced);
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Uso: npx tsx scripts/convert-smoke.ts <archivo.pptx> [...]");
    process.exit(1);
  }

  const soffice = findSoffice();
  const { stdout: version } = await run(soffice, ["--version"], { timeout: 20_000 });
  console.log(`soffice: ${soffice}\n         ${version.trim()}\n`);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "worship-convert-smoke-"));
  const profileDir = path.join(workRoot, "profile");
  fs.mkdirSync(profileDir, { recursive: true });

  let failures = 0;

  for (const file of files) {
    console.log(`── ${path.basename(file)}`);
    if (!fs.existsSync(file)) {
      console.log("   ✗ no existe\n");
      failures += 1;
      continue;
    }

    const work = fs.mkdtempSync(path.join(workRoot, "deck-"));
    try {
      const kind = containerKind(file);
      console.log(`   contenedor: ${kind}`);

      // A PDF is already the intermediate format: `deck-service` hands it to
      // the rasterizer untouched, so this must not convert it either — running
      // it through `soffice` would re-render it via Draw's PDF importer and
      // measure something the app never does.
      if (kind === "pdf") {
        const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(1);
        console.log(`   PDF: origen, sin conversión (${mb} MB) — no requiere LibreOffice`);
      } else {
        const started = Date.now();
        const pdf = await convert(soffice, profileDir, file, path.join(work, "pdf"), "pdf");
        const mb = (fs.statSync(pdf).size / 1024 / 1024).toFixed(1);
        console.log(`   PDF: ${Date.now() - started}ms, ${mb} MB`);
      }

      // Legacy binary .ppt has no OOXML: round-trip through .pptx to recover
      // timings and audio, exactly like deck-service does.
      let parseSource = file;
      let timingsSource = "ooxml";
      if (kind === "binary") {
        parseSource = await convert(soffice, profileDir, file, path.join(work, "pptx"), "pptx");
        timingsSource = "ooxml-converted";
        console.log(`   .ppt legacy -> .pptx para leer timings`);
      } else if (kind !== "ooxml") {
        timingsSource = "none";
      }

      if (timingsSource === "none") {
        console.log(
          kind === "pdf"
            ? "   sin metadata (un PDF no tiene transiciones ni media embebida)\n"
            : "   sin metadata (contenedor no soportado)\n",
        );
        continue;
      }

      const meta = readPresentationMeta(parseSource);
      const hidden = meta.slides.filter((s) => s.hidden);

      // The same recovery `deck-service.ts` does: LibreOffice's PPTX export
      // only writes `<p:transition>` (and with it `advTm`) when the slide has
      // a visual effect, so a legacy deck's timings have to be re-read from
      // the source binary. Reported separately here so the smoke run SHOWS
      // how many the conversion lost.
      let recovered = 0;
      if (kind === "binary") {
        const binary = readBinarySlideTimings(file);
        if (binary && binary.length === meta.slides.length) {
          meta.slides.forEach((slide, i) => {
            const fromBinary = binary[i]?.autoAdvanceMs ?? null;
            if (slide.autoAdvanceMs === null && fromBinary !== null) {
              slide.autoAdvanceMs = fromBinary;
              recovered += 1;
            }
          });
        } else {
          console.log(`   ⚠ no se pudieron leer timings del binario de origen`);
        }
      }
      const timed = meta.slides.filter((s) => s.autoAdvanceMs !== null);

      console.log(`   diapositivas: ${meta.slideCount} (fuente de timings: ${timingsSource})`);
      if (recovered > 0) {
        console.log(`   recuperados del binario (el .pptx los perdió): ${recovered}`);
      }
      console.log(`   con auto-avance: ${timed.length}${
        timed.length > 0
          ? ` [${timed.slice(0, 6).map((s) => `${s.slideIndex}:${s.autoAdvanceMs}ms`).join(", ")}${timed.length > 6 ? ", …" : ""}]`
          : ""
      }`);
      if (hidden.length > 0) console.log(`   ocultas: ${hidden.map((s) => s.slideIndex).join(", ")}`);
      if (meta.slideSizeEmu) {
        const ratio = (meta.slideSizeEmu.cx / meta.slideSizeEmu.cy).toFixed(2);
        console.log(`   relación de aspecto: ${ratio}`);
      }

      if (meta.audio.length > 0) {
        const extracted = extractAudioParts(parseSource, meta.audio, path.join(work, "audio"));
        console.log(
          `   audio: ${extracted.length} pista(s) -> ${extracted
            .map((a) => `${a.ext} ${(a.bytes / 1024).toFixed(0)}KB scope=${a.scope}${a.playable ? "" : " (NO reproducible)"}`)
            .join(", ")}`,
        );
      } else {
        console.log("   audio: ninguno");
      }
      if (meta.video.length > 0) {
        const extracted = extractVideoParts(parseSource, meta.video, path.join(work, "video"));
        console.log(
          `   video: ${extracted.length} clip(s) -> ${extracted
            .map((v) => {
              const r = v.rect;
              const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
              return `slide ${v.slideIndex} ${v.ext} ${(v.bytes / 1024).toFixed(0)}KB rect ${pct(r.x)},${pct(r.y)} ${pct(r.width)}x${pct(r.height)}${v.playable ? "" : " (NO reproducible)"}`;
            })
            .join(", ")}`,
        );
      } else {
        console.log("   video: ninguno");
      }
      if (meta.skippedVideoParts.length > 0) {
        console.log(`   video no utilizable: ${meta.skippedVideoParts.join(", ")}`);
      }

      // Only relevant when the deck has no usable embedded/transition audio —
      // that's what toDTO() falls back to as the soundtrack.
      const linked = resolveLinkedAudio(file);
      console.log(
        meta.audio.length > 0
          ? `   audio vinculado: (ignorado, el deck ya tiene audio embebido)`
          : `   audio vinculado: ${linked ? path.basename(linked) : "no encontrado"}`,
      );
      console.log();
    } catch (error) {
      failures += 1;
      console.log(`   ✗ ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  fs.rmSync(workRoot, { recursive: true, force: true });

  if (failures > 0) {
    console.error(`${failures} archivo(s) fallaron.`);
    process.exit(1);
  }
  console.log("Todo OK.");
}

void main();
