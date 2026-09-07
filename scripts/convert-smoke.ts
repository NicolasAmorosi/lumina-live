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
import { containerKind, extractAudioParts, readPresentationMeta } from "../src/main/slides/pptx-metadata";

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

      const started = Date.now();
      const pdf = await convert(soffice, profileDir, file, path.join(work, "pdf"), "pdf");
      const pdfMs = Date.now() - started;
      const pdfSize = (fs.statSync(pdf).size / 1024 / 1024).toFixed(1);
      console.log(`   PDF: ${pdfMs}ms, ${pdfSize} MB`);

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
        console.log("   sin metadata (contenedor no soportado)\n");
        continue;
      }

      const meta = readPresentationMeta(parseSource);
      const timed = meta.slides.filter((s) => s.autoAdvanceMs !== null);
      const hidden = meta.slides.filter((s) => s.hidden);

      console.log(`   diapositivas: ${meta.slideCount} (fuente de timings: ${timingsSource})`);
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
      if (meta.skippedVideoParts.length > 0) {
        console.log(`   video embebido (fuera de alcance): ${meta.skippedVideoParts.length}`);
      }
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
