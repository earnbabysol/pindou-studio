import { MARD_BY_CODE } from "./mard-palette";
import { inventoryLines, type InventoryMap } from "./pattern";
import type { PixelResult } from "./pixelize";

export type PdfScaleMode = "clear" | "actual";

export type PatternPdfOptions = {
  projectName: string;
  boardSize: 52 | 104;
  targetWidth: number;
  targetHeight: number;
  result: PixelResult;
  inventory: InventoryMap;
  showBeadCodes: boolean;
  mode: PdfScaleMode;
};

type CanvasLike = {
  width: number;
  height: number;
  getContext: (contextId: "2d") => CanvasRenderingContext2D | null;
  toDataURL: (type?: string, quality?: number) => string;
};

export type PdfCanvasFactory = (width: number, height: number) => CanvasLike;

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
const FONT = '"Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif';

function setupPage(factory: PdfCanvasFactory) {
  const canvas = factory(PAGE_WIDTH, PAGE_HEIGHT);
  canvas.width = PAGE_WIDTH;
  canvas.height = PAGE_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建 PDF 页面");
  context.fillStyle = "#FFFDF8";
  context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
  return { canvas, context };
}

function text(
  context: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  size: number,
  weight = 600,
  color = "#1D1D1B",
  align: CanvasTextAlign = "left",
) {
  context.fillStyle = color;
  context.font = `${weight} ${size}px ${FONT}`;
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  context.fillText(content, x, y);
}

function getBoardCode(options: PatternPdfOptions, boardX: number, boardY: number) {
  const offsetX = Math.floor((options.boardSize - options.targetWidth) / 2);
  const offsetY = Math.floor((options.boardSize - options.targetHeight) / 2);
  const x = boardX - offsetX;
  const y = boardY - offsetY;
  if (x < 0 || y < 0 || x >= options.targetWidth || y >= options.targetHeight) return "";
  const label = options.result.labels[y * options.targetWidth + x];
  return label < 0 ? "" : options.result.palette[label]?.code ?? "";
}

function labelColor(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 158 ? "#161614" : "#FFFFFF";
}

function drawOverview(context: CanvasRenderingContext2D, options: PatternPdfOptions) {
  const size = 720;
  const x = 70;
  const y = 244;
  const cell = size / options.boardSize;
  context.fillStyle = "#F1EDE5";
  context.fillRect(x, y, size, size);
  for (let row = 0; row < options.boardSize; row += 1) {
    for (let column = 0; column < options.boardSize; column += 1) {
      const code = getBoardCode(options, column, row);
      const color = MARD_BY_CODE.get(code);
      if (!color) continue;
      context.fillStyle = color.hex;
      context.fillRect(x + column * cell, y + row * cell, Math.ceil(cell), Math.ceil(cell));
    }
  }
  context.strokeStyle = "#A9A399";
  context.lineWidth = 2;
  context.strokeRect(x, y, size, size);
  if (options.boardSize === 104) {
    context.strokeStyle = "#F05C3E";
    context.lineWidth = 4;
    context.setLineDash([12, 8]);
    context.beginPath();
    context.moveTo(x + size / 2, y);
    context.lineTo(x + size / 2, y + size);
    context.moveTo(x, y + size / 2);
    context.lineTo(x + size, y + size / 2);
    context.stroke();
    context.setLineDash([]);
  }
}

function drawCover(factory: PdfCanvasFactory, options: PatternPdfOptions) {
  const { canvas, context } = setupPage(factory);
  context.fillStyle = "#F05C3E";
  context.fillRect(0, 0, 22, PAGE_HEIGHT);
  text(context, "MARD 拼豆图纸", 70, 90, 42, 800);
  text(context, options.projectName, 70, 140, 24, 700, "#56534D");
  text(
    context,
    `${options.boardSize} × ${options.boardSize} 底板  ·  ${options.targetWidth} × ${options.targetHeight} 画面  ·  ${options.result.palette.length} 色  ·  ${options.result.beadCount.toLocaleString("zh-CN")} 颗`,
    70,
    188,
    18,
    600,
    "#716D65",
  );
  drawOverview(context, options);
  text(context, "图纸说明", 844, 278, 24, 800);
  const modeText = options.mode === "actual" ? "1:1 实物尺寸（5 mm/格）" : "清晰分页（26 × 26/页）";
  const notes = [
    modeText,
    options.showBeadCodes ? "每格标注 MARD 色号" : "每格仅显示颜色",
    options.boardSize === 104 ? "104 底板按 52 × 52 分为四区" : "52 底板为一个完整制作区",
    "红色虚线表示底板分区边界",
  ];
  notes.forEach((note, index) => {
    context.fillStyle = "#F05C3E";
    context.beginPath();
    context.arc(854, 328 + index * 48, 5, 0, Math.PI * 2);
    context.fill();
    text(context, note, 876, 335 + index * 48, 17, 600, "#55514A");
  });

  const lines = inventoryLines(options.result, options.inventory);
  const missing = lines.reduce((total, line) => total + line.missing, 0);
  text(context, "MARD 色号与用量", 70, 1040, 27, 800);
  text(
    context,
    missing ? `库存还缺 ${missing.toLocaleString("zh-CN")} 颗` : "当前库存数量充足",
    1168,
    1040,
    17,
    700,
    missing ? "#B33D28" : "#2D7A4D",
    "right",
  );
  context.strokeStyle = "#D8D2C8";
  context.beginPath();
  context.moveTo(70, 1064);
  context.lineTo(1170, 1064);
  context.stroke();
  const columns = 4;
  const itemWidth = 275;
  const itemHeight = 70;
  lines.forEach((line, index) => {
    const color = MARD_BY_CODE.get(line.code)!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 70 + column * itemWidth;
    const y = 1090 + row * itemHeight;
    context.fillStyle = color.hex;
    context.fillRect(x, y, 42, 42);
    context.strokeStyle = "rgba(29,29,27,.25)";
    context.strokeRect(x, y, 42, 42);
    text(context, line.code, x + 55, y + 19, 17, 800);
    text(
      context,
      `${line.required} 颗${line.missing ? ` · 缺 ${line.missing}` : ""}`,
      x + 55,
      y + 41,
      13,
      600,
      line.missing ? "#B33D28" : "#747069",
    );
  });
  text(context, "图片和项目均在本机处理。购买与制作请以 MARD 色号为准。", 70, 1690, 14, 500, "#8A867E");
  return canvas;
}

function drawPatternPage(
  factory: PdfCanvasFactory,
  options: PatternPdfOptions,
  startX: number,
  startY: number,
  pageIndex: number,
  pageCount: number,
) {
  const { canvas, context } = setupPage(factory);
  const cells = 26;
  const coordinateBand = 50;
  const cell = options.mode === "actual" ? 29.53 : 39;
  const gridSize = cell * cells;
  const boardX = (PAGE_WIDTH - gridSize) / 2;
  const boardY = 220 + coordinateBand;
  const endX = Math.min(options.boardSize, startX + cells);
  const endY = Math.min(options.boardSize, startY + cells);
  const sectionColumn = Math.floor(startX / 52) + 1;
  const sectionRow = Math.floor(startY / 52) + 1;

  text(context, "MARD 拼豆图纸", 70, 72, 30, 800);
  text(context, options.projectName, 70, 112, 18, 700, "#56534D");
  text(
    context,
    `底板区 ${sectionRow}-${sectionColumn}  ·  列 ${startX + 1}-${endX}  ·  行 ${startY + 1}-${endY}`,
    70,
    160,
    18,
    700,
    "#F05C3E",
  );
  text(context, `${pageIndex + 1} / ${pageCount}`, 1170, 72, 17, 700, "#6F6B64", "right");

  for (let localY = 0; localY < cells; localY += 1) {
    for (let localX = 0; localX < cells; localX += 1) {
      const boardColumn = startX + localX;
      const boardRow = startY + localY;
      const x = boardX + localX * cell;
      const y = boardY + localY * cell;
      context.fillStyle = "#F4F0E8";
      context.fillRect(x, y, cell, cell);
      if (boardColumn >= options.boardSize || boardRow >= options.boardSize) continue;
      const code = getBoardCode(options, boardColumn, boardRow);
      const color = MARD_BY_CODE.get(code);
      if (!color) {
        context.fillStyle = "rgba(29,29,27,.14)";
        context.beginPath();
        context.arc(x + cell / 2, y + cell / 2, 2.4, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.fillStyle = color.hex;
      context.fillRect(x, y, cell, cell);
      if (options.showBeadCodes) {
        context.fillStyle = labelColor(color.r, color.g, color.b);
        context.font = `800 ${Math.max(10, Math.floor(cell * 0.34))}px Arial, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(code, x + cell / 2, y + cell / 2 + 0.5, cell - 4);
      }
    }
  }

  for (let index = 0; index <= cells; index += 1) {
    const majorX = (startX + index) % 10 === 0;
    const majorY = (startY + index) % 10 === 0;
    context.lineWidth = majorX ? 2 : 0.7;
    context.strokeStyle = majorX ? "rgba(29,29,27,.55)" : "rgba(29,29,27,.18)";
    context.beginPath();
    context.moveTo(boardX + index * cell, boardY);
    context.lineTo(boardX + index * cell, boardY + gridSize);
    context.stroke();
    context.lineWidth = majorY ? 2 : 0.7;
    context.strokeStyle = majorY ? "rgba(29,29,27,.55)" : "rgba(29,29,27,.18)";
    context.beginPath();
    context.moveTo(boardX, boardY + index * cell);
    context.lineTo(boardX + gridSize, boardY + index * cell);
    context.stroke();
  }

  context.fillStyle = "#4E4B46";
  context.font = `700 ${options.mode === "actual" ? 12 : 14}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < cells; index += 1) {
    const column = startX + index + 1;
    const row = startY + index + 1;
    const centerX = boardX + index * cell + cell / 2;
    const centerY = boardY + index * cell + cell / 2;
    if (column <= options.boardSize) {
      context.fillText(String(column), centerX, boardY - coordinateBand / 2);
      context.fillText(String(column), centerX, boardY + gridSize + coordinateBand / 2);
    }
    if (row <= options.boardSize) {
      context.fillText(String(row), boardX - coordinateBand / 2, centerY);
      context.fillText(String(row), boardX + gridSize + coordinateBand / 2, centerY);
    }
  }

  if ((startX + cells) % 52 === 0 && startX + cells < options.boardSize) {
    context.strokeStyle = "#F05C3E";
    context.lineWidth = 5;
    context.setLineDash([13, 9]);
    context.beginPath();
    context.moveTo(boardX + gridSize, boardY);
    context.lineTo(boardX + gridSize, boardY + gridSize);
    context.stroke();
  }
  if ((startY + cells) % 52 === 0 && startY + cells < options.boardSize) {
    context.strokeStyle = "#F05C3E";
    context.lineWidth = 5;
    context.setLineDash([13, 9]);
    context.beginPath();
    context.moveTo(boardX, boardY + gridSize);
    context.lineTo(boardX + gridSize, boardY + gridSize);
    context.stroke();
  }
  context.setLineDash([]);

  const legendY = Math.min(PAGE_HEIGHT - 300, boardY + gridSize + coordinateBand + 65);
  text(context, "本页所用色号", 70, legendY, 20, 800);
  const pageCounts = new Map<string, number>();
  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      const code = getBoardCode(options, column, row);
      if (code) pageCounts.set(code, (pageCounts.get(code) ?? 0) + 1);
    }
  }
  Array.from(pageCounts.entries()).forEach(([code, count], index) => {
    const color = MARD_BY_CODE.get(code)!;
    const x = 70 + (index % 8) * 137;
    const y = legendY + 32 + Math.floor(index / 8) * 46;
    context.fillStyle = color.hex;
    context.fillRect(x, y, 26, 26);
    context.strokeStyle = "rgba(29,29,27,.22)";
    context.strokeRect(x, y, 26, 26);
    text(context, `${code} · ${count}`, x + 35, y + 20, 12, 700, "#4E4B46");
  });
  text(
    context,
    options.mode === "actual" ? "打印时请选择 100% / 实际大小，勿勾选适合页面。" : "清晰分页：每页 26 × 26 格。",
    70,
    1690,
    14,
    600,
    "#7B7770",
  );
  return canvas;
}

export function renderPatternPdfPages(factory: PdfCanvasFactory, options: PatternPdfOptions) {
  const pages: CanvasLike[] = [drawCover(factory, options)];
  const starts: Array<[number, number]> = [];
  for (let y = 0; y < options.boardSize; y += 26) {
    for (let x = 0; x < options.boardSize; x += 26) starts.push([x, y]);
  }
  starts.forEach(([x, y], index) => {
    pages.push(drawPatternPage(factory, options, x, y, index, starts.length));
  });
  return pages;
}

export async function createPatternPdfBlob(options: PatternPdfOptions) {
  const [{ jsPDF }] = await Promise.all([import("jspdf")]);
  const pages = renderPatternPdfPages((width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }, options);
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage("a4", "portrait");
    pdf.addImage(page.toDataURL("image/png"), "PNG", 0, 0, 210, 297, undefined, "FAST");
  });
  return pdf.output("blob");
}
