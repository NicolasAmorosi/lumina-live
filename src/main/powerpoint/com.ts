import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { runPowerShell, assertWindows } from "./powershell";
import { PPT_EXPORT_TIMEOUT_MS, PPT_OPEN_TIMEOUT_MS } from "@shared/constants";

/** Grabs a running PowerPoint via COM, or launches a hidden one. Reused by every command. */
const GET_APP = `
$ppt = $null
try { $ppt = [System.Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch {}
if (-not $ppt) { $ppt = New-Object -ComObject PowerPoint.Application }
`;

export async function preOpenPowerPoint(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await runPowerShell(GET_APP, {}, 10_000);
  } catch {
    // Best-effort warmup only; ppt:open will retry properly.
  }
}

export async function openPresentation(
  filePath: string,
): Promise<{ success: boolean; totalSlides: number }> {
  assertWindows();
  const script = `
${GET_APP}
$pres = $ppt.Presentations.Open($env:WORSHIP_PPT_PATH, 0, 0, -1)
$pres.SlideShowSettings.ShowPresenterView = 0
$ss = $pres.SlideShowSettings.Run()
Write-Output ("OK|" + $pres.Slides.Count)
`;
  try {
    const out = await runPowerShell(script, { WORSHIP_PPT_PATH: filePath }, PPT_OPEN_TIMEOUT_MS);
    const match = /OK\|(\d+)/.exec(out);
    return { success: true, totalSlides: match ? Number(match[1]) : 0 };
  } catch {
    // Optimistic fallback matching legacy behavior: PowerShell not responding
    // in time doesn't necessarily mean the show didn't start.
    return { success: true, totalSlides: 0 };
  }
}

async function runViewCommand(method: string): Promise<string> {
  assertWindows();
  const script = `
${GET_APP}
$view = $ppt.SlideShowWindows(1).View
$view.${method}
Write-Output $view.Slide.SlideIndex
`;
  return runPowerShell(script, {}, 5_000);
}

export const nextSlide = () => runViewCommand("Next()");
export const prevSlide = () => runViewCommand("Previous()");

export async function gotoSlide(slide: number): Promise<void> {
  assertWindows();
  const script = `
${GET_APP}
$ppt.SlideShowWindows(1).View.GotoSlide([int]$env:WORSHIP_PPT_SLIDE)
`;
  await runPowerShell(script, { WORSHIP_PPT_SLIDE: String(slide) }, 5_000);
}

export async function getCurrentSlide(): Promise<number> {
  assertWindows();
  const script = `
${GET_APP}
Write-Output $ppt.SlideShowWindows(1).View.Slide.SlideIndex
`;
  const out = await runPowerShell(script, {}, 3_000);
  return Number(out) || 0;
}

export async function closePresentation(): Promise<void> {
  if (process.platform !== "win32") return;
  const script = `
${GET_APP}
foreach ($p in $ppt.Presentations) {
  try { $p.SlideShowWindow.View.Exit() } catch {}
  $p.Close()
}
`;
  try {
    await runPowerShell(script, {}, 10_000);
  } catch {
    // No open presentations is not an error.
  }
}

export async function quitPowerPoint(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    await runPowerShell(`${GET_APP}\n$ppt.Quit()`, {}, 5_000);
  } catch {
    // Best-effort at app shutdown.
  }
}

export async function exportSlides(
  filePath: string,
): Promise<{ sessionId: string; imagePaths: string[] }> {
  assertWindows();
  const sessionId = randomUUID();
  const outDir = path.join(os.tmpdir(), `worship_slides_${sessionId}`);
  fs.mkdirSync(outDir, { recursive: true });

  const script = `
${GET_APP}
$pres = $ppt.Presentations.Open($env:WORSHIP_PPT_PATH, -1, 0, 0)
for ($i = 1; $i -le $pres.Slides.Count; $i++) {
  $file = Join-Path $env:WORSHIP_PPT_OUTDIR ("slide-{0:D3}.png" -f $i)
  $pres.Slides.Item($i).Export($file, "PNG", 480, 270)
}
$total = $pres.Slides.Count
$pres.Close()
Write-Output ("OK|" + $total)
`;
  await runPowerShell(
    script,
    { WORSHIP_PPT_PATH: filePath, WORSHIP_PPT_OUTDIR: outDir },
    PPT_EXPORT_TIMEOUT_MS,
  );

  const files = fs
    .readdirSync(outDir)
    .filter((f) => f.endsWith(".png"))
    .sort();
  return { sessionId, imagePaths: files.map((f) => path.join(outDir, f)) };
}
