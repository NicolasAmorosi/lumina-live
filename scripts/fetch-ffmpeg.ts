/**
 * Puts a pinned, checksum-verified FFmpeg + ffprobe into
 * `resources/ffmpeg/<platform>-<arch>/`, which `electron-builder` ships as
 * `resources/ffmpeg/` next to the app (`build.extraResources`) and `paths.ts`
 * reads in dev.
 *
 *   tsx scripts/fetch-ffmpeg.ts                  # this machine (postinstall)
 *   tsx scripts/fetch-ffmpeg.ts win32-x64        # a cross-build target
 *
 * Downloaded rather than versioned: the Windows pair alone is 210 MB. Pinned
 * by URL AND sha256, so an installer built twice ships the same bytes — the
 * same reason `package-lock.json` is committed. A target whose stamp already
 * matches is skipped, so re-running it costs nothing.
 *
 * Both builds are GPLv3 (they include libx264, which the conversion uses).
 * They run as a separate process, never linked into the app; `NOTICE.txt`
 * names the sources, which is what the license asks of a binary redistributor.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unzipSync } from "fflate";

type Archive = {
  url: string;
  sha256: string;
  /** Output file name → path inside the zip. */
  entries: Record<string, string>;
};

const RIEDL = "https://ffmpeg.martin-riedl.de/download";
const GYAN = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip";
const GYAN_ROOT = "ffmpeg-9.0.2-essentials_build";

/** FFmpeg 9.0.2 everywhere. Windows: Gyan's static "essentials" build. macOS
 *  and Linux: Martin Riedl's static builds — the macOS ones are signed with a
 *  Developer ID and the hardened runtime, which an Apple Silicon Mac requires
 *  before it will run a binary at all. */
const BUILDS: Record<string, Archive[]> = {
  "win32-x64": [
    {
      url: GYAN,
      sha256: "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba",
      entries: {
        "ffmpeg.exe": `${GYAN_ROOT}/bin/ffmpeg.exe`,
        "ffprobe.exe": `${GYAN_ROOT}/bin/ffprobe.exe`,
        "LICENSE.txt": `${GYAN_ROOT}/LICENSE`,
      },
    },
  ],
  "darwin-arm64": riedl("macos/arm64/1789931890_9.0.2", {
    ffmpeg: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
    ffprobe: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
  }),
  "darwin-x64": riedl("macos/amd64/1789931006_9.0.2", {
    ffmpeg: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
    ffprobe: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
  }),
  "linux-x64": riedl("linux/amd64/1789931100_9.0.2", {
    ffmpeg: "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f",
    ffprobe: "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32",
  }),
};

function riedl(dir: string, sums: { ffmpeg: string; ffprobe: string }): Archive[] {
  return (["ffmpeg", "ffprobe"] as const).map((name) => ({
    url: `${RIEDL}/${dir}/${name}.zip`,
    sha256: sums[name],
    entries: { [name]: name },
  }));
}

const OUT_ROOT = path.resolve("resources/ffmpeg");
const NOTICE = path.resolve("resources/ffmpeg-NOTICE.txt");

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchTarget(target: string): Promise<void> {
  const archives = BUILDS[target];
  if (!archives) throw new Error(`No FFmpeg build pinned for ${target}. Known: ${Object.keys(BUILDS).join(", ")}`);

  const outDir = path.join(OUT_ROOT, target);
  const stampPath = path.join(outDir, ".stamp");
  const stamp = archives.map((a) => a.sha256).join("\n");
  const expected = archives.flatMap((a) => Object.keys(a.entries));
  if (
    fs.existsSync(stampPath) &&
    fs.readFileSync(stampPath, "utf8") === stamp &&
    expected.every((name) => fs.existsSync(path.join(outDir, name)))
  ) {
    console.log(`[ffmpeg] ${target}: up to date`);
    return;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const archive of archives) {
    console.log(`[ffmpeg] ${target}: ${archive.url}`);
    const zip = await download(archive.url);
    const digest = createHash("sha256").update(zip).digest("hex");
    if (digest !== archive.sha256) {
      throw new Error(`Checksum mismatch for ${archive.url}: expected ${archive.sha256}, got ${digest}`);
    }
    const wanted = new Set(Object.values(archive.entries));
    const files = unzipSync(zip, { filter: (file) => wanted.has(file.name) });
    for (const [name, entry] of Object.entries(archive.entries)) {
      const data = files[entry];
      if (!data) throw new Error(`${entry} is missing from ${archive.url}`);
      const dest = path.join(outDir, name);
      fs.writeFileSync(dest, data);
      if (!name.endsWith(".txt")) fs.chmodSync(dest, 0o755);
    }
  }
  fs.copyFileSync(NOTICE, path.join(outDir, "NOTICE.txt"));
  // Last, so an interrupted download is never mistaken for a finished one.
  fs.writeFileSync(stampPath, stamp);
  console.log(`[ffmpeg] ${target}: ready in ${path.relative(process.cwd(), outDir)}`);
}

const targets = process.argv.slice(2);
for (const target of targets.length > 0 ? targets : [`${process.platform}-${process.arch}`]) {
  await fetchTarget(target);
}
