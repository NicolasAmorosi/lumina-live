/**
 * A PDF with one 16:9 page per colour, each with a white square that moves one
 * step to the right per page, so two slides never rasterize alike.
 *
 * Shapes, not text: the rasterizer runs pdf.js with `useSystemFonts: false`,
 * which drops every non-embedded standard font (`.claude/knowledge/a-pdf-source-breaks-two-assumptions-the-pipeline-made-about-its-own-output.md`).
 */
export function buildPdf(colors: readonly string[]): Buffer {
  const width = 960;
  const height = 540;
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1;

  const catalog = add("");
  const pagesIndex = add("");
  const pageIds: number[] = [];
  colors.forEach((hex, i) => {
    const [r, g, b] = [1, 3, 5].map((at) => (parseInt(hex.slice(at, at + 2), 16) / 255).toFixed(3));
    const stream = `${r} ${g} ${b} rg 0 0 ${width} ${height} re f 1 1 1 rg ${120 + i * 240} 180 180 180 re f`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesIndex + 1} 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${content + 1} 0 R /Resources << >> >>`,
      ),
    );
  });
  objects[catalog] = `<< /Type /Catalog /Pages ${pagesIndex + 1} 0 R >>`;
  objects[pagesIndex] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id + 1} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog + 1} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
