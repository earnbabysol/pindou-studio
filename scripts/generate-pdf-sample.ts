import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { jsPDF } from "jspdf";
import { renderPatternPdfPages, type PdfCanvasFactory } from "../lib/pdf-export";
import { resultFromCodes } from "../lib/pattern";

const windowsFont = "C:\\Windows\\Fonts\\msyh.ttc";
if (existsSync(windowsFont)) GlobalFonts.registerFromPath(windowsFont, "Microsoft YaHei");

const width = 40;
const height = 20;
const palette = ["A4", "B5", "C8", "E6", "F5", "H2", "H7"];
const codes = Array.from({ length: width * height }, (_, index) => {
  const x = index % width;
  const y = Math.floor(index / width);
  if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return "";
  return palette[(Math.floor(x / 5) + Math.floor(y / 4)) % palette.length];
});
const result = resultFromCodes(width, height, codes);
const factory: PdfCanvasFactory = (pageWidth, pageHeight) =>
  createCanvas(pageWidth, pageHeight) as unknown as ReturnType<PdfCanvasFactory>;
const pages = renderPatternPdfPages(factory, {
  projectName: "PDF 图纸版式检查",
  boardSize: 52,
  targetWidth: width,
  targetHeight: height,
  result,
  inventory: { A4: 100, B5: 1000, C8: 1000, E6: 20, F5: 1000, H2: 1000, H7: 1000 },
  showBeadCodes: true,
  mode: "clear",
});

const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
pages.forEach((page, index) => {
  if (index > 0) pdf.addPage("a4", "portrait");
  pdf.addImage(page.toDataURL("image/png"), "PNG", 0, 0, 210, 297, undefined, "FAST");
});
const outputDirectory = resolve("tmp/pdfs");
await mkdir(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, "pindou-sample.pdf");
await writeFile(outputPath, Buffer.from(pdf.output("arraybuffer")));
console.log(outputPath);
