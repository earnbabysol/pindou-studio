"use client";
/* eslint-disable @next/next/no-img-element -- local data URLs are intentionally never sent to an image service */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { removeCornerBackground, sharpenImageData } from "@/lib/image-processing";
import { MARD_BY_CODE, MARD_COLORS } from "@/lib/mard-palette";
import {
  codesFromResult,
  floodFillCodes,
  inventoryLines,
  moveSelectionCodes,
  normalizeSelection,
  replaceCode,
  resultFromCodes,
  type InventoryMap,
  type SelectionRect,
} from "@/lib/pattern";
import { pixelize, type PixelResult } from "@/lib/pixelize";
import {
  deleteLocalProject,
  listLocalProjects,
  loadLocalProject,
  parseProjectFile,
  projectFileBlob,
  saveLocalProject,
  type StudioProject,
} from "@/lib/project-storage";

type BoardSize = 52 | 104;
type FitMode = "cover" | "contain";
type EditorTool = "brush" | "eraser" | "fill" | "picker" | "replace" | "select";
type WorkMode = "edit" | "build";
type PdfMode = "clear" | "actual";

type SourceImage = {
  element: HTMLImageElement;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};

const TOOL_LABELS: Array<{ id: EditorTool; label: string; shortcut: string; icon: string }> = [
  { id: "brush", label: "画笔", shortcut: "B", icon: "●" },
  { id: "eraser", label: "橡皮", shortcut: "E", icon: "◇" },
  { id: "fill", label: "填充", shortcut: "F", icon: "▣" },
  { id: "picker", label: "吸色", shortcut: "I", icon: "⌾" },
  { id: "replace", label: "换色", shortcut: "R", icon: "⇄" },
  { id: "select", label: "框选", shortcut: "S", icon: "▱" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function safeFilename(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "拼豆稿";
}

function beadLabelColor(r: number, g: number, b: number) {
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 158 ? "rgba(20,20,18,.9)" : "rgba(255,255,255,.96)";
}

function drawBeadCode(
  context: CanvasRenderingContext2D,
  code: string,
  color: { r: number; g: number; b: number },
  x: number,
  y: number,
  cell: number,
) {
  context.save();
  context.fillStyle = beadLabelColor(color.r, color.g, color.b);
  context.font = `800 ${Math.max(4, Math.floor(cell * 0.42))}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(code, x + cell / 2, y + cell / 2 + 0.4, cell - 2);
  context.restore();
}

function drawPattern(
  canvas: HTMLCanvasElement,
  boardSize: BoardSize,
  result: PixelResult | null,
  targetWidth: number,
  targetHeight: number,
  showGrid: boolean,
  showBeadCodes: boolean,
  workMode: WorkMode,
  activeBuildCode: string,
  completed: readonly boolean[],
  selection: SelectionRect | null,
) {
  const cell = boardSize === 104 ? 9 : 13;
  const size = boardSize * cell;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#F2EEE5";
  context.fillRect(0, 0, size, size);
  const offsetX = Math.floor((boardSize - targetWidth) / 2);
  const offsetY = Math.floor((boardSize - targetHeight) / 2);

  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const localX = x - offsetX;
      const localY = y - offsetY;
      const inside = localX >= 0 && localX < targetWidth && localY >= 0 && localY < targetHeight;
      const pixelX = x * cell;
      const pixelY = y * cell;
      let filled = false;
      if (inside && result) {
        const localIndex = localY * result.width + localX;
        const label = result.labels[localIndex];
        if (label >= 0) {
          const color = result.palette[label];
          context.fillStyle = color.hex;
          context.fillRect(pixelX, pixelY, cell, cell);
          if (showBeadCodes) drawBeadCode(context, color.code, color, pixelX, pixelY, cell);
          if (workMode === "build" && activeBuildCode && color.code !== activeBuildCode) {
            context.fillStyle = "rgba(255,253,248,.76)";
            context.fillRect(pixelX, pixelY, cell, cell);
          }
          if (workMode === "build" && completed[localIndex]) {
            context.fillStyle = "rgba(33,126,78,.28)";
            context.fillRect(pixelX, pixelY, cell, cell);
            context.fillStyle = "rgba(20,87,53,.95)";
            context.beginPath();
            context.arc(pixelX + cell * 0.78, pixelY + cell * 0.22, Math.max(1.2, cell * 0.11), 0, Math.PI * 2);
            context.fill();
          }
          filled = true;
        }
      }
      if (!filled) {
        context.fillStyle = inside ? "#FAF7F0" : "#F2EEE5";
        context.fillRect(pixelX, pixelY, cell, cell);
        context.fillStyle = inside ? "rgba(29,29,27,.11)" : "rgba(29,29,27,.07)";
        context.beginPath();
        context.arc(pixelX + cell / 2, pixelY + cell / 2, Math.max(0.8, cell * 0.13), 0, Math.PI * 2);
        context.fill();
      }
    }
  }

  if (showGrid) {
    context.lineWidth = 1;
    for (let index = 0; index <= boardSize; index += 1) {
      const major = index % 10 === 0;
      context.strokeStyle = major ? "rgba(29,29,27,.30)" : "rgba(29,29,27,.10)";
      context.beginPath();
      context.moveTo(index * cell + 0.5, 0);
      context.lineTo(index * cell + 0.5, size);
      context.stroke();
      context.beginPath();
      context.moveTo(0, index * cell + 0.5);
      context.lineTo(size, index * cell + 0.5);
      context.stroke();
    }
  }

  context.save();
  context.strokeStyle = "#F05C3E";
  context.lineWidth = Math.max(2, cell * 0.22);
  context.setLineDash([cell * 0.75, cell * 0.5]);
  context.strokeRect(offsetX * cell + 1, offsetY * cell + 1, targetWidth * cell - 2, targetHeight * cell - 2);
  context.restore();

  if (selection && workMode === "edit") {
    context.save();
    context.fillStyle = "rgba(32,96,151,.12)";
    context.strokeStyle = "#206097";
    context.lineWidth = Math.max(2, cell * 0.22);
    context.setLineDash([cell * 0.55, cell * 0.35]);
    const x = (offsetX + selection.x) * cell;
    const y = (offsetY + selection.y) * cell;
    context.fillRect(x, y, selection.width * cell, selection.height * cell);
    context.strokeRect(x + 1, y + 1, selection.width * cell - 2, selection.height * cell - 2);
    context.restore();
  }
}

function drawPatternSheet(
  canvas: HTMLCanvasElement,
  boardSize: BoardSize,
  result: PixelResult,
  targetWidth: number,
  targetHeight: number,
  showBeadCodes: boolean,
) {
  const cell = boardSize === 104 ? 24 : 30;
  const boardPixels = boardSize * cell;
  const outerMargin = 54;
  const coordinateBand = 38;
  const headerHeight = 96;
  const boardX = outerMargin + coordinateBand;
  const boardY = headerHeight + coordinateBand;
  const legendColumns = Math.min(6, Math.max(1, result.palette.length));
  const legendRows = Math.ceil(result.palette.length / legendColumns);
  const legendTop = boardY + boardPixels + coordinateBand + 72;
  const legendHeaderHeight = 66;
  const legendRowHeight = 56;
  canvas.width = boardX + boardPixels + coordinateBand + outerMargin;
  canvas.height = legendTop + legendHeaderHeight + legendRows * legendRowHeight + 58;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#FFFDF8";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#1D1D1B";
  context.font = "800 32px Arial, sans-serif";
  context.fillText("MARD 拼豆图纸", outerMargin, 43);
  context.fillStyle = "#66635C";
  context.font = "600 16px Arial, sans-serif";
  context.fillText(
    `${boardSize} × ${boardSize} 底板 · ${targetWidth} × ${targetHeight} 画面 · ${result.palette.length} 色 · ${result.beadCount.toLocaleString("zh-CN")} 颗`,
    outerMargin,
    72,
  );
  const offsetX = Math.floor((boardSize - targetWidth) / 2);
  const offsetY = Math.floor((boardSize - targetHeight) / 2);
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const localX = x - offsetX;
      const localY = y - offsetY;
      const inside = localX >= 0 && localX < targetWidth && localY >= 0 && localY < targetHeight;
      const pixelX = boardX + x * cell;
      const pixelY = boardY + y * cell;
      context.fillStyle = inside ? "#FAF7F0" : "#F0ECE3";
      context.fillRect(pixelX, pixelY, cell, cell);
      if (!inside) continue;
      const label = result.labels[localY * result.width + localX];
      if (label < 0) continue;
      const color = result.palette[label];
      context.fillStyle = color.hex;
      context.fillRect(pixelX, pixelY, cell, cell);
      if (showBeadCodes) drawBeadCode(context, color.code, color, pixelX, pixelY, cell);
    }
  }
  for (let index = 0; index <= boardSize; index += 1) {
    const position = index * cell;
    const major = index % 10 === 0;
    context.strokeStyle = major ? "rgba(29,29,27,.52)" : "rgba(29,29,27,.18)";
    context.lineWidth = major ? 1.8 : 0.8;
    context.beginPath();
    context.moveTo(boardX + position, boardY);
    context.lineTo(boardX + position, boardY + boardPixels);
    context.stroke();
    context.beginPath();
    context.moveTo(boardX, boardY + position);
    context.lineTo(boardX + boardPixels, boardY + position);
    context.stroke();
  }
  context.fillStyle = "#4E4C47";
  context.font = `700 ${boardSize === 104 ? 10 : 12}px Arial, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < boardSize; index += 1) {
    const label = String(index + 1);
    const centerX = boardX + index * cell + cell / 2;
    const centerY = boardY + index * cell + cell / 2;
    context.fillText(label, centerX, boardY - coordinateBand / 2);
    context.fillText(label, centerX, boardY + boardPixels + coordinateBand / 2);
    context.fillText(label, boardX - coordinateBand / 2, centerY);
    context.fillText(label, boardX + boardPixels + coordinateBand / 2, centerY);
  }
  context.textAlign = "left";
  context.fillStyle = "#1D1D1B";
  context.font = "800 23px Arial, sans-serif";
  context.fillText("MARD 色号与用量", outerMargin, legendTop + 26);
  const legendWidth = canvas.width - outerMargin * 2;
  const itemWidth = legendWidth / legendColumns;
  result.palette.forEach((color, index) => {
    const column = index % legendColumns;
    const row = Math.floor(index / legendColumns);
    const itemX = outerMargin + column * itemWidth;
    const itemY = legendTop + legendHeaderHeight + row * legendRowHeight;
    context.fillStyle = color.hex;
    context.fillRect(itemX, itemY + 11, 32, 32);
    context.fillStyle = "#1D1D1B";
    context.font = "800 17px Arial, sans-serif";
    context.fillText(color.code, itemX + 43, itemY + 22);
    context.fillStyle = "#74716A";
    context.font = "600 13px Arial, sans-serif";
    context.fillText(`${color.count.toLocaleString("zh-CN")} 颗`, itemX + 43, itemY + 41);
  });
  context.fillStyle = "#8B8880";
  context.font = "500 12px Arial, sans-serif";
  context.fillText("色块为 MARD 221 色卡屏幕近似值；购买与制作请以 MARD 色号为准。", outerMargin, canvas.height - 24);
}

export default function Home() {
  const [projectName, setProjectName] = useState("未命名拼豆稿");
  const [currentProjectId, setCurrentProjectId] = useState("autosave");
  const [boardSize, setBoardSize] = useState<BoardSize>(104);
  const [targetWidth, setTargetWidth] = useState(90);
  const [ratioWidth, setRatioWidth] = useState(9);
  const [ratioHeight, setRatioHeight] = useState(4);
  const [maxColors, setMaxColors] = useState(16);
  const [cleanupStrength, setCleanupStrength] = useState(2);
  const [fitMode, setFitMode] = useState<FitMode>("cover");
  const [zoom, setZoom] = useState(100);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [sharpness, setSharpness] = useState(0);
  const [removeBackground, setRemoveBackground] = useState(false);
  const [backgroundTolerance, setBackgroundTolerance] = useState(35);
  const [dither, setDither] = useState(false);
  const [restrictToInventory, setRestrictToInventory] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showBeadCodes, setShowBeadCodes] = useState(true);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [completed, setCompleted] = useState<boolean[]>([]);
  const [inventory, setInventory] = useState<InventoryMap>({});
  const [inventoryReady, setInventoryReady] = useState(false);
  const [history, setHistory] = useState<string[][]>([]);
  const [future, setFuture] = useState<string[][]>([]);
  const [workMode, setWorkMode] = useState<WorkMode>("edit");
  const [editorTool, setEditorTool] = useState<EditorTool>("brush");
  const [selectedCode, setSelectedCode] = useState("H7");
  const [activeBuildCode, setActiveBuildCode] = useState("");
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfMode>("clear");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<StudioProject[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const boardCanvasRef = useRef<HTMLCanvasElement>(null);
  const strokeActiveRef = useRef(false);
  const strokeVisitedRef = useRef(new Set<number>());
  const selectionAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const skipGenerationRef = useRef<string | null>(null);

  const targetHeight = useMemo(
    () => Math.max(1, Math.round((targetWidth * ratioHeight) / ratioWidth)),
    [ratioHeight, ratioWidth, targetWidth],
  );
  const targetFits = targetWidth <= boardSize && targetHeight <= boardSize;
  const centeredOffset = useMemo(
    () => ({ x: Math.floor((boardSize - targetWidth) / 2), y: Math.floor((boardSize - targetHeight) / 2) }),
    [boardSize, targetHeight, targetWidth],
  );
  const result = useMemo(
    () => (codes ? resultFromCodes(targetWidth, targetHeight, codes) : null),
    [codes, targetHeight, targetWidth],
  );
  const ownedKey = useMemo(
    () => Object.entries(inventory).filter(([, amount]) => amount > 0).map(([code]) => code).sort().join(","),
    [inventory],
  );
  const ownedCodes = useMemo(() => (ownedKey ? ownedKey.split(",") : []), [ownedKey]);
  const stockLines = useMemo(() => (result ? inventoryLines(result, inventory) : []), [inventory, result]);
  const totalMissing = stockLines.reduce((total, line) => total + line.missing, 0);
  const placedCount = useMemo(
    () => (codes ? codes.reduce((total, code, index) => total + (code && completed[index] ? 1 : 0), 0) : 0),
    [codes, completed],
  );
  const progress = result?.beadCount ? Math.round((placedCount / result.beadCount) * 100) : 0;
  const activeColorTotal = codes?.filter((code) => code === activeBuildCode).length ?? 0;
  const activeColorDone = codes?.reduce(
    (total, code, index) => total + (code === activeBuildCode && completed[index] ? 1 : 0),
    0,
  ) ?? 0;

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2500);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      setRecentProjects(await listLocalProjects());
    } catch {
      // IndexedDB can be disabled in private browsing; file export still works.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem("pindou-mard-inventory-v1");
        if (stored) setInventory(JSON.parse(stored) as InventoryMap);
      } catch {
        // Keep the empty inventory when storage is unavailable.
      } finally {
        setInventoryReady(true);
      }
      void refreshProjects();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshProjects]);

  useEffect(() => {
    if (!inventoryReady) return;
    try {
      window.localStorage.setItem("pindou-mard-inventory-v1", JSON.stringify(inventory));
    } catch {
      // The project file remains the fallback for storage-limited browsers.
    }
  }, [inventory, inventoryReady]);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("图片超过 20 MB，请先压缩后再上传。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const image = new Image();
      image.onload = () => {
        setSource({ element: image, name: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
        setProjectName(file.name.replace(/\.[^.]+$/, "") || "未命名拼豆稿");
        setCurrentProjectId("autosave");
        setError(null);
      };
      image.onerror = () => setError("这张图片无法读取，请换一张再试。");
      image.src = dataUrl;
    };
    reader.onerror = () => setError("这张图片读取失败，请重试。");
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const maxByHeight = Math.floor((boardSize * ratioWidth) / ratioHeight);
    const maximum = Math.max(1, Math.min(boardSize, maxByHeight));
    if (targetWidth <= maximum) return;
    const frame = window.requestAnimationFrame(() => setTargetWidth(maximum));
    return () => window.cancelAnimationFrame(frame);
  }, [boardSize, ratioHeight, ratioWidth, targetWidth]);

  useEffect(() => {
    if (!source || !targetFits) return;
    if (skipGenerationRef.current === source.dataUrl) {
      skipGenerationRef.current = null;
      return;
    }
    if (restrictToInventory && !ownedCodes.length) {
      return;
    }
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      setIsProcessing(true);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.clearRect(0, 0, targetWidth, targetHeight);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%) saturate(${saturation}%)`;
        const sourceRatio = source.width / source.height;
        const targetRatio = targetWidth / targetHeight;
        let drawWidth = targetWidth;
        let drawHeight = targetHeight;
        if (fitMode === "cover") {
          if (sourceRatio > targetRatio) drawWidth = targetHeight * sourceRatio;
          else drawHeight = targetWidth / sourceRatio;
        } else if (sourceRatio > targetRatio) drawHeight = targetWidth / sourceRatio;
        else drawWidth = targetHeight * sourceRatio;
        drawWidth *= zoom / 100;
        drawHeight *= zoom / 100;
        const drawX = (targetWidth - drawWidth) / 2 + (panX / 100) * targetWidth;
        const drawY = (targetHeight - drawHeight) / 2 + (panY / 100) * targetHeight;
        context.drawImage(source.element, drawX, drawY, drawWidth, drawHeight);
        context.filter = "none";
        let imageData = context.getImageData(0, 0, targetWidth, targetHeight);
        imageData = sharpenImageData(imageData, targetWidth, targetHeight, sharpness);
        if (removeBackground) {
          imageData = removeCornerBackground(imageData, targetWidth, targetHeight, backgroundTolerance);
        }
        const next = pixelize(imageData.data, targetWidth, targetHeight, maxColors, cleanupStrength, {
          allowedCodes: restrictToInventory ? ownedCodes : undefined,
          dither,
        });
        if (!cancelled) {
          setCodes(codesFromResult(next));
          setCompleted(Array(targetWidth * targetHeight).fill(false));
          setHistory([]);
          setFuture([]);
          setSelection(null);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("生成像素稿时遇到问题，请换一张图片再试。");
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [
    backgroundTolerance,
    brightness,
    cleanupStrength,
    contrast,
    dither,
    fitMode,
    maxColors,
    ownedCodes,
    panX,
    panY,
    removeBackground,
    restrictToInventory,
    saturation,
    sharpness,
    source,
    targetFits,
    targetHeight,
    targetWidth,
    zoom,
  ]);

  useEffect(() => {
    if (!boardCanvasRef.current) return;
    drawPattern(
      boardCanvasRef.current,
      boardSize,
      result,
      targetWidth,
      targetHeight,
      showGrid,
      showBeadCodes,
      workMode,
      activeBuildCode,
      completed,
      selection,
    );
  }, [activeBuildCode, boardSize, completed, result, selection, showBeadCodes, showGrid, targetHeight, targetWidth, workMode]);

  useEffect(() => {
    if (!result?.palette.length) return;
    const frame = window.requestAnimationFrame(() => {
      if (!result.palette.some((color) => color.code === selectedCode)) setSelectedCode(result.palette[0].code);
      if (!activeBuildCode || !result.palette.some((color) => color.code === activeBuildCode)) {
        setActiveBuildCode(result.palette[0].code);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeBuildCode, result, selectedCode]);

  const makeProject = useCallback(
    (id: string, name = projectName): StudioProject => ({
      version: 1,
      id,
      name: name.trim() || "未命名拼豆稿",
      savedAt: new Date().toISOString(),
      source: source
        ? { name: source.name, dataUrl: source.dataUrl, width: source.width, height: source.height }
        : null,
      settings: {
        boardSize,
        targetWidth,
        ratioWidth,
        ratioHeight,
        maxColors,
        cleanupStrength,
        fitMode,
        zoom,
        panX,
        panY,
        brightness,
        contrast,
        saturation,
        sharpness,
        removeBackground,
        backgroundTolerance,
        dither,
        restrictToInventory,
        showGrid,
        showBeadCodes,
      },
      pattern: codes ? { width: targetWidth, height: targetHeight, codes, completed } : null,
      inventory,
    }),
    [
      backgroundTolerance, boardSize, brightness, cleanupStrength, codes, completed, contrast, dither, fitMode,
      inventory, maxColors, panX, panY, projectName, ratioHeight, ratioWidth, removeBackground,
      restrictToInventory, saturation, sharpness, showBeadCodes, showGrid, source, targetWidth, zoom,
      targetHeight,
    ],
  );

  useEffect(() => {
    if (!codes) return;
    const timer = window.setTimeout(() => {
      void saveLocalProject(makeProject("autosave", `${projectName}（自动保存）`)).then(refreshProjects).catch(() => undefined);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [codes, completed, makeProject, projectName, refreshProjects]);

  const commitCodes = useCallback(
    (next: string[]) => {
      if (!codes || next.length !== codes.length || next.every((code, index) => code === codes[index])) return;
      setHistory((current) => [...current, codes].slice(-50));
      setFuture([]);
      setCodes(next);
    },
    [codes],
  );

  const undo = useCallback(() => {
    if (!codes || !history.length) return;
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setFuture((current) => [codes, ...current].slice(0, 50));
    setCodes(previous);
  }, [codes, history]);

  const redo = useCallback(() => {
    if (!codes || !future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setHistory((current) => [...current, codes].slice(-50));
    setCodes(next);
  }, [codes, future]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select") || target?.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      const tool = TOOL_LABELS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase());
      if (tool && workMode === "edit") setEditorTool(tool.id);
      if (selection && workMode === "edit" && event.key.startsWith("Arrow")) {
        event.preventDefault();
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        };
        const [dx, dy] = moves[event.key];
        const moved = moveSelectionCodes(codes ?? [], targetWidth, targetHeight, selection, dx, dy);
        commitCodes(moved.codes);
        setSelection(moved.selection);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [codes, commitCodes, redo, selection, targetHeight, targetWidth, undo, workMode]);

  const localPointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = boardCanvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    const boardX = Math.floor(((event.clientX - bounds.left) / bounds.width) * boardSize);
    const boardY = Math.floor(((event.clientY - bounds.top) / bounds.height) * boardSize);
    const x = boardX - centeredOffset.x;
    const y = boardY - centeredOffset.y;
    if (x < 0 || y < 0 || x >= targetWidth || y >= targetHeight) return null;
    return { x, y, index: y * targetWidth + x };
  };

  const paintStrokePoint = (index: number) => {
    if (!codes || strokeVisitedRef.current.has(index)) return;
    strokeVisitedRef.current.add(index);
    const replacement = editorTool === "eraser" ? "" : selectedCode;
    setCodes((current) => {
      if (!current || current[index] === replacement) return current;
      const next = [...current];
      next[index] = replacement;
      return next;
    });
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPointFromEvent(event);
    if (!point || !codes) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (workMode === "build") {
      setCompleted((current) => {
        const next = [...current];
        next[point.index] = !next[point.index];
        return next;
      });
      return;
    }
    if (editorTool === "picker") {
      if (codes[point.index]) setSelectedCode(codes[point.index]);
      return;
    }
    if (editorTool === "fill") {
      commitCodes(floodFillCodes(codes, targetWidth, targetHeight, point.index, selectedCode));
      return;
    }
    if (editorTool === "replace") {
      const from = codes[point.index];
      if (from) commitCodes(replaceCode(codes, from, selectedCode));
      return;
    }
    if (editorTool === "select") {
      selectionAnchorRef.current = { x: point.x, y: point.y };
      setSelection({ x: point.x, y: point.y, width: 1, height: 1 });
      return;
    }
    setHistory((current) => [...current, codes].slice(-50));
    setFuture([]);
    strokeActiveRef.current = true;
    strokeVisitedRef.current = new Set();
    paintStrokePoint(point.index);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPointFromEvent(event);
    if (!point || workMode !== "edit") return;
    if (editorTool === "select" && selectionAnchorRef.current) {
      const anchor = selectionAnchorRef.current;
      setSelection(normalizeSelection(anchor.x, anchor.y, point.x, point.y));
    } else if (strokeActiveRef.current && (editorTool === "brush" || editorTool === "eraser")) {
      paintStrokePoint(point.index);
    }
  };

  const endCanvasGesture = () => {
    strokeActiveRef.current = false;
    strokeVisitedRef.current.clear();
    selectionAnchorRef.current = null;
  };

  const moveSelection = (dx: number, dy: number) => {
    if (!selection || !codes) return;
    const moved = moveSelectionCodes(codes, targetWidth, targetHeight, selection, dx, dy);
    commitCodes(moved.codes);
    setSelection(moved.selection);
  };

  const applyOriginalRatio = () => {
    if (!source) return;
    const divisor = (left: number, right: number): number => right === 0 ? left : divisor(right, left % right);
    const common = divisor(Math.round(source.width), Math.round(source.height));
    const rawWidth = Math.round(source.width) / common;
    const rawHeight = Math.round(source.height) / common;
    if (rawWidth <= 99 && rawHeight <= 99) {
      setRatioWidth(rawWidth);
      setRatioHeight(rawHeight);
    } else {
      setRatioWidth(Math.max(1, Math.round((source.width / source.height) * 10)));
      setRatioHeight(10);
    }
  };

  const saveProject = async () => {
    const id = currentProjectId === "autosave" ? `project-${Date.now()}` : currentProjectId;
    const project = makeProject(id);
    try {
      await saveLocalProject(project);
      setCurrentProjectId(id);
      await refreshProjects();
      flash("项目已保存到这台设备");
    } catch {
      setError("浏览器无法保存项目，请使用“导出项目文件”。");
    }
  };

  const exportProjectFile = () => {
    const project = makeProject(currentProjectId === "autosave" ? `project-${Date.now()}` : currentProjectId);
    downloadBlob(projectFileBlob(project), `${safeFilename(project.name)}.pindou`);
    flash("已导出 .pindou 项目文件");
  };

  const applyProject = (project: StudioProject) => {
    const settings = project.settings;
    setSource(null);
    setProjectName(project.name);
    setCurrentProjectId(project.id);
    setBoardSize(settings.boardSize);
    setTargetWidth(settings.targetWidth);
    setRatioWidth(settings.ratioWidth);
    setRatioHeight(settings.ratioHeight);
    setMaxColors(settings.maxColors);
    setCleanupStrength(settings.cleanupStrength);
    setFitMode(settings.fitMode);
    setZoom(settings.zoom ?? 100);
    setPanX(settings.panX ?? 0);
    setPanY(settings.panY ?? 0);
    setBrightness(settings.brightness ?? 0);
    setContrast(settings.contrast ?? 0);
    setSaturation(settings.saturation ?? 100);
    setSharpness(settings.sharpness ?? 0);
    setRemoveBackground(settings.removeBackground ?? false);
    setBackgroundTolerance(settings.backgroundTolerance ?? 35);
    setDither(settings.dither ?? false);
    setRestrictToInventory(settings.restrictToInventory ?? false);
    setShowGrid(settings.showGrid ?? true);
    setShowBeadCodes(settings.showBeadCodes ?? true);
    setInventory(project.inventory ?? {});
    setCodes(project.pattern?.codes ?? null);
    setCompleted(project.pattern?.completed ?? []);
    setHistory([]);
    setFuture([]);
    setSelection(null);
    if (project.source) {
      const image = new Image();
      image.onload = () => {
        skipGenerationRef.current = project.source!.dataUrl;
        setSource({
          element: image,
          name: project.source!.name,
          dataUrl: project.source!.dataUrl,
          width: project.source!.width,
          height: project.source!.height,
        });
      };
      image.src = project.source.dataUrl;
    }
    setProjectsOpen(false);
    flash("项目已打开，可继续编辑");
  };

  const importProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyProject(parseProjectFile(String(reader.result ?? "")));
      } catch {
        setError("这个文件不是有效的 .pindou 项目。");
      }
    };
    reader.readAsText(file);
  };

  const downloadPixelArt = () => {
    if (!result) return;
    const canvas = document.createElement("canvas");
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    const imageData = context.createImageData(result.width, result.height);
    result.labels.forEach((label, index) => {
      if (label < 0) return;
      const color = result.palette[label];
      imageData.data[index * 4] = color.r;
      imageData.data[index * 4 + 1] = color.g;
      imageData.data[index * 4 + 2] = color.b;
      imageData.data[index * 4 + 3] = 255;
    });
    context.putImageData(imageData, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeFilename(projectName)}-${result.width}x${result.height}.png`);
      flash("已下载 MARD 纯像素图");
    }, "image/png");
  };

  const downloadBoard = () => {
    if (!result) return;
    const canvas = document.createElement("canvas");
    drawPatternSheet(canvas, boardSize, result, targetWidth, targetHeight, showBeadCodes);
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeFilename(projectName)}-MARD图纸.png`);
      flash("已下载带行列号的 PNG 图纸");
    }, "image/png");
  };

  const downloadPdf = async () => {
    if (!result || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { createPatternPdfBlob } = await import("@/lib/pdf-export");
      const blob = await createPatternPdfBlob({
        projectName,
        boardSize,
        targetWidth,
        targetHeight,
        result,
        inventory,
        showBeadCodes,
        mode: pdfMode,
      });
      downloadBlob(blob, `${safeFilename(projectName)}-MARD-${pdfMode === "actual" ? "1比1" : "清晰分页"}.pdf`);
      flash("PDF 图纸已生成");
    } catch {
      setError("PDF 生成失败，请先下载 PNG 图纸。");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const downloadInventory = () => {
    if (!result) return;
    const lines = [
      "MARD色号,需要（颗）,库存（颗）,缺少（颗）,建议替代色号",
      ...stockLines.map((line) => `${line.code},${line.required},${line.owned},${line.missing},${line.substitute ?? ""}`),
      `合计,${result.beadCount},,${totalMissing},`,
    ];
    downloadBlob(new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" }), `${safeFilename(projectName)}-备料清单.csv`);
    flash("已下载库存与购买清单");
  };

  const applySubstitute = (from: string, to: string | null) => {
    if (!codes || !to) return;
    commitCodes(replaceCode(codes, from, to));
    setSelectedCode(to);
    flash(`已将 ${from} 全部替换为 ${to}`);
  };

  const markActiveColorDone = () => {
    if (!codes || !activeBuildCode) return;
    setCompleted((current) => current.map((done, index) => done || codes[index] === activeBuildCode));
  };

  const selectBoard = (size: BoardSize) => {
    setBoardSize(size);
    setTargetWidth((current) => Math.min(current, size));
  };

  const filteredInventory = MARD_COLORS.filter((color) =>
    color.code.toLowerCase().includes(inventorySearch.trim().toLowerCase()),
  );

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div><p className="eyebrow">PIXEL BEAD STUDIO</p><h1>拼豆稿</h1></div>
        </div>
        <div className="topbar-note"><span className="privacy-dot" />图片与项目仅在当前设备处理</div>
        <div className="topbar-actions">
          <button className="button button-ghost" onClick={() => { setProjectsOpen(true); void refreshProjects(); }}>打开项目</button>
          <button className="button button-secondary" onClick={() => void saveProject()} disabled={!codes}>保存项目</button>
          <button className="button button-primary" onClick={() => void downloadPdf()} disabled={!result || isExportingPdf}>
            {isExportingPdf ? "正在生成…" : "下载 PDF"}
          </button>
        </div>
      </header>

      <div className="studio-grid">
        <aside className="control-panel" aria-label="拼豆图设置">
          <section className="control-section upload-section">
            <div className="section-heading"><span className="step-number">01</span><div><h2>图片与项目</h2><p>上传图片，或继续上次的拼豆稿</p></div></div>
            <input
              className="visually-hidden"
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) loadFile(file);
                event.target.value = "";
              }}
            />
            <div
              className={`upload-box ${isDragging ? "is-dragging" : ""} ${source ? "has-source" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event: DragEvent<HTMLDivElement>) => {
                event.preventDefault();
                setIsDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) loadFile(file);
              }}
            >
              {source ? (
                <><img src={source.dataUrl} alt="上传图片预览" /><div className="upload-file-meta"><strong>{source.name}</strong><span>{source.width} × {source.height} px</span></div><button className="replace-button" onClick={() => fileInputRef.current?.click()}>更换</button></>
              ) : (
                <button className="upload-trigger" onClick={() => fileInputRef.current?.click()}><span className="upload-plus">＋</span><strong>选择图片</strong><span>PNG / JPG / WebP，最大 20 MB</span></button>
              )}
            </div>
            <div className="field-group">
              <label htmlFor="project-name">项目名称</label>
              <input id="project-name" className="plain-input" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </div>
          </section>

          <section className="control-section">
            <div className="section-heading"><span className="step-number">02</span><div><h2>画布尺寸</h2><p>尺寸和比例会自动保持在底板内</p></div></div>
            <div className="field-group"><span className="field-label">底板</span><div className="segmented-control"><button className={boardSize === 52 ? "active" : ""} onClick={() => selectBoard(52)}>52 × 52</button><button className={boardSize === 104 ? "active" : ""} onClick={() => selectBoard(104)}>104 × 104</button></div></div>
            <div className="dimension-row">
              <div className="field-group compact-field"><label htmlFor="target-width">画面宽度</label><div className="number-input"><input id="target-width" type="number" min="1" max={boardSize} value={targetWidth} onChange={(event) => setTargetWidth(Math.max(1, Math.min(boardSize, Number(event.target.value) || 1)))} /><span>格</span></div></div>
              <span className="dimension-link">×</span>
              <div className="field-group compact-field"><span className="field-label">自动高度</span><div className="readonly-value"><strong>{targetHeight}</strong><span>格</span></div></div>
            </div>
            <div className="field-group"><div className="label-row"><span className="field-label">整体比例</span><button className="text-button" onClick={applyOriginalRatio} disabled={!source}>使用原图比例</button></div><div className="ratio-control"><input aria-label="比例宽" type="number" min="1" max="99" value={ratioWidth} onChange={(event) => setRatioWidth(Math.max(1, Number(event.target.value) || 1))} /><span>:</span><input aria-label="比例高" type="number" min="1" max="99" value={ratioHeight} onChange={(event) => setRatioHeight(Math.max(1, Number(event.target.value) || 1))} /><span className="ratio-result">{targetWidth} × {targetHeight}</span></div></div>
          </section>

          <section className="control-section">
            <div className="section-heading"><span className="step-number">03</span><div><h2>构图与画面</h2><p>先调整构图，再交给 MARD 配色</p></div></div>
            <div className="field-group"><span className="field-label">图片适配</span><div className="segmented-control"><button className={fitMode === "cover" ? "active" : ""} onClick={() => setFitMode("cover")}>裁切铺满</button><button className={fitMode === "contain" ? "active" : ""} onClick={() => setFitMode("contain")}>完整保留</button></div></div>
            <RangeField label="缩放" value={zoom} min={60} max={220} suffix="%" onChange={setZoom} />
            <div className="split-range"><RangeField label="左右位置" value={panX} min={-50} max={50} onChange={setPanX} /><RangeField label="上下位置" value={panY} min={-50} max={50} onChange={setPanY} /></div>
            <div className="split-range"><RangeField label="亮度" value={brightness} min={-40} max={40} onChange={setBrightness} /><RangeField label="对比度" value={contrast} min={-40} max={40} onChange={setContrast} /></div>
            <RangeField label="饱和度" value={saturation} min={0} max={180} suffix="%" onChange={setSaturation} />
            <RangeField label="锐化" value={sharpness} min={0} max={3} onChange={setSharpness} />
            <label className="check-row"><input type="checkbox" checked={removeBackground} onChange={(event) => setRemoveBackground(event.target.checked)} /><span>自动去除四角背景</span></label>
            {removeBackground && <RangeField label="去背景强度" value={backgroundTolerance} min={0} max={100} suffix="%" onChange={setBackgroundTolerance} />}
            <button className="reset-adjustments" onClick={() => { setZoom(100); setPanX(0); setPanY(0); setBrightness(0); setContrast(0); setSaturation(100); setSharpness(0); setRemoveBackground(false); }}>恢复画面默认值</button>
          </section>

          <section className="control-section">
            <div className="section-heading"><span className="step-number">04</span><div><h2>MARD 221 配色</h2><p>控制色数、色块干净程度与库存</p></div></div>
            <RangeField label="最多颜色" value={maxColors} min={2} max={32} suffix=" 色" onChange={setMaxColors} />
            <RangeField label="杂色清理" value={cleanupStrength} min={0} max={3} onChange={setCleanupStrength} />
            <label className="check-row"><input type="checkbox" checked={dither} onChange={(event) => setDither(event.target.checked)} /><span>抖动混色（适合照片渐变）</span></label>
            <label className="check-row"><input type="checkbox" checked={restrictToInventory} onChange={(event) => setRestrictToInventory(event.target.checked)} /><span>仅使用我的库存色号</span></label>
            <button className="button button-secondary full-button inventory-manage" onClick={() => setInventoryOpen(true)}>管理 MARD 库存 · {ownedCodes.length} 色</button>
          </section>
        </aside>

        <section className="preview-panel" aria-label="拼豆图预览">
          <div className="preview-toolbar">
            <div><p className="eyebrow">WORKSPACE</p><h2>{workMode === "edit" ? "手动精修" : "手机制作模式"}</h2></div>
            <div className="toolbar-right">
              <div className="mode-switch"><button className={workMode === "edit" ? "active" : ""} onClick={() => setWorkMode("edit")}>编辑</button><button className={workMode === "build" ? "active" : ""} onClick={() => setWorkMode("build")}>制作</button></div>
              <label className="toggle-control"><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} /><span />网格</label>
              <label className="toggle-control"><input type="checkbox" checked={showBeadCodes} onChange={(event) => setShowBeadCodes(event.target.checked)} /><span />色号</label>
            </div>
          </div>

          {workMode === "edit" ? (
            <div className="editor-toolbar" aria-label="手动编辑工具">
              <div className="tool-list">{TOOL_LABELS.map((tool) => <button key={tool.id} className={editorTool === tool.id ? "active" : ""} onClick={() => setEditorTool(tool.id)} title={`${tool.label}（${tool.shortcut}）`}><span>{tool.icon}</span>{tool.label}<kbd>{tool.shortcut}</kbd></button>)}</div>
              <div className="history-actions"><button onClick={undo} disabled={!history.length}>↶ 撤销</button><button onClick={redo} disabled={!future.length}>↷ 重做</button></div>
              <button className="active-color-button" onClick={() => setInventoryOpen(true)} title="选择 MARD 色号"><i style={{ background: MARD_BY_CODE.get(selectedCode)?.hex }} /><strong>{selectedCode}</strong><span>换色</span></button>
            </div>
          ) : (
            <div className="build-toolbar">
              <div className="build-progress"><span>整体进度</span><strong>{progress}%</strong><div><i style={{ width: `${progress}%` }} /></div></div>
              <label>当前色号<select value={activeBuildCode} onChange={(event) => setActiveBuildCode(event.target.value)}>{result?.palette.map((color) => <option key={color.code} value={color.code}>{color.code} · {color.count} 颗</option>)}</select></label>
              <span className="active-progress">本色 {activeColorDone}/{activeColorTotal}</span>
              <button onClick={markActiveColorDone} disabled={!activeBuildCode}>本色全部完成</button>
            </div>
          )}

          {selection && workMode === "edit" && <div className="selection-bar"><span>已框选 {selection.width} × {selection.height} 格</span><div><button onClick={() => moveSelection(-1, 0)}>←</button><button onClick={() => moveSelection(0, -1)}>↑</button><button onClick={() => moveSelection(0, 1)}>↓</button><button onClick={() => moveSelection(1, 0)}>→</button><button onClick={() => setSelection(null)}>取消框选</button></div></div>}

          <div className="canvas-stage">
            <div className="canvas-ruler ruler-top"><span>01</span><span>{String(Math.ceil(boardSize / 2)).padStart(2, "0")}</span><span>{boardSize}</span></div>
            <div className="canvas-ruler ruler-side"><span>01</span><span>{String(Math.ceil(boardSize / 2)).padStart(2, "0")}</span><span>{boardSize}</span></div>
            <div className={`canvas-wrap tool-${editorTool} mode-${workMode}`}>
              <canvas
                ref={boardCanvasRef}
                aria-label="拼豆像素画编辑画布"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={endCanvasGesture}
                onPointerCancel={endCanvasGesture}
                onPointerLeave={() => { if (!strokeActiveRef.current) selectionAnchorRef.current = null; }}
              />
              {!source && !result && <button className="empty-canvas-callout" onClick={() => fileInputRef.current?.click()}><span className="callout-beads"><i /><i /><i /></span><strong>上传图片开始</strong><span>也可以打开 .pindou 项目</span></button>}
              {isProcessing && <div className="processing-badge"><span />正在重新配色</div>}
            </div>
          </div>

          <div className="preview-summary">
            <div><span>底板</span><strong>{boardSize} × {boardSize}</strong></div>
            <div><span>画面</span><strong>{targetWidth} × {targetHeight}</strong></div>
            <div><span>实际色数</span><strong>{result?.palette.length ?? "—"} / {maxColors}</strong></div>
            <div className="summary-accent"><span>{workMode === "build" ? "制作进度" : "预计豆数"}</span><strong>{workMode === "build" ? `${placedCount} / ${result?.beadCount ?? 0}` : (result?.beadCount.toLocaleString("zh-CN") ?? "—")}</strong></div>
          </div>
          {(error || (restrictToInventory && !ownedCodes.length ? "“仅使用库存”已开启，请先在库存中填写至少一个 MARD 色号。" : null)) && <p className="inline-error" role="alert">{error || "“仅使用库存”已开启，请先在库存中填写至少一个 MARD 色号。"}</p>}
          {workMode === "edit" && result && <p className="workspace-hint">提示：画笔可拖动；填充会处理相邻同色区；换色会替换整张图中的同一色号；框选后可用方向键移动。</p>}
        </section>

        <aside className="palette-panel" aria-label="颜色、库存与导出">
          <div className="palette-heading"><div><p className="eyebrow">MARD PALETTE</p><h2>配色与备料</h2></div><span className="palette-count">{result?.palette.length ?? 0} 色</span></div>
          {result?.palette.length ? (
            <div className="palette-list">
              {result.palette.map((color) => {
                const line = stockLines.find((item) => item.code === color.code);
                return <div className={`palette-row ${selectedCode === color.code ? "is-selected" : ""}`} key={color.code}>
                  <button className="color-swatch" style={{ background: color.hex, color: beadLabelColor(color.r, color.g, color.b), textShadow: "none" }} onClick={() => { setSelectedCode(color.code); setActiveBuildCode(color.code); }}>{color.code}</button>
                  <div className="color-meta"><strong>MARD {color.code}</strong><span>库存 {line?.owned ?? 0} 颗</span>{line?.missing ? <span className="shortage">缺 {line.missing} 颗</span> : <span className="stock-ok">库存充足</span>}</div>
                  <div className="bead-count"><strong>{color.count.toLocaleString("zh-CN")}</strong><span>颗</span>{line?.missing && line.substitute ? <button className="substitute-button" onClick={() => applySubstitute(color.code, line.substitute)}>换 {line.substitute}</button> : null}</div>
                </div>;
              })}
            </div>
          ) : (
            <div className="palette-empty"><div className="empty-swatches" aria-hidden="true"><span /><span /><span /><span /><span /></div><strong>MARD 色号会出现在这里</strong><p>上传图片后，可逐色检查库存、缺少数量和推荐替代色。</p></div>
          )}

          <div className={`inventory-card ${totalMissing ? "has-shortage" : ""}`}>
            <div><span>{totalMissing ? "预计还需购买" : "预计总用豆"}</span><strong>{result ? (totalMissing || result.beadCount).toLocaleString("zh-CN") : "—"}</strong></div><span className="inventory-unit">颗</span>
          </div>
          <button className="inventory-link" onClick={() => setInventoryOpen(true)}>管理库存与选择编辑颜色 <span>→</span></button>

          <div className="export-section">
            <div className="export-heading"><strong>PDF 图纸</strong><span>A4 自动分页</span></div>
            <div className="segmented-control pdf-mode"><button className={pdfMode === "clear" ? "active" : ""} onClick={() => setPdfMode("clear")}>清晰分页</button><button className={pdfMode === "actual" ? "active" : ""} onClick={() => setPdfMode("actual")}>1:1 实物</button></div>
            <p className="export-note">{pdfMode === "actual" ? "每格 5 mm，打印时选择 100% 实际大小。" : "每页 26 × 26 格，色号更容易看清。"}</p>
            <div className="export-stack">
              <button className="button button-primary full-button" onClick={() => void downloadPdf()} disabled={!result || isExportingPdf}>{isExportingPdf ? "正在排版…" : "下载 A4 PDF 图纸"}</button>
              <button className="button button-secondary full-button" onClick={downloadBoard} disabled={!result}>下载完整 PNG 图纸</button>
              <button className="button button-secondary full-button" onClick={downloadPixelArt} disabled={!result}>下载纯像素图</button>
              <button className="text-export" onClick={downloadInventory} disabled={!result}>库存 / 购买清单 CSV <span>↗</span></button>
              <button className="text-export" onClick={exportProjectFile} disabled={!codes}>导出 .pindou 项目 <span>↗</span></button>
            </div>
          </div>
          <p className="panel-footnote">PDF 含封面、四边行列号、分页坐标、每页色号与总用量。104 底板会按 52 × 52 标出四个拼接区。</p>
        </aside>
      </div>

      {inventoryOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setInventoryOpen(false); }}>
          <section className="modal inventory-modal" role="dialog" aria-modal="true" aria-label="MARD 库存管理">
            <header className="modal-header"><div><p className="eyebrow">MARD 221</p><h2>我的拼豆库存</h2><p>填写拥有的颗数；库存色也可直接选作编辑颜色。</p></div><button className="modal-close" onClick={() => setInventoryOpen(false)} aria-label="关闭">×</button></header>
            <div className="inventory-toolbar"><input className="plain-input" placeholder="搜索色号，例如 A12" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} /><label className="check-row inline"><input type="checkbox" checked={restrictToInventory} onChange={(event) => setRestrictToInventory(event.target.checked)} /><span>生成时只用库存色</span></label><span>{ownedCodes.length} 个色号有库存</span></div>
            <div className="inventory-grid">
              {filteredInventory.map((color) => <div className={`inventory-row ${selectedCode === color.code ? "selected" : ""}`} key={color.code}>
                <button className="inventory-color" onClick={() => { setSelectedCode(color.code); setActiveBuildCode(color.code); }}><i style={{ background: color.hex }} /><strong>{color.code}</strong></button>
                <input aria-label={`${color.code} 库存数量`} type="number" min="0" max="999999" value={inventory[color.code] ?? 0} onChange={(event) => setInventory((current) => ({ ...current, [color.code]: Math.max(0, Number(event.target.value) || 0) }))} />
                <button className="quick-stock" onClick={() => setInventory((current) => ({ ...current, [color.code]: (current[color.code] ?? 0) + 1000 }))}>+1000</button>
              </div>)}
            </div>
            <footer className="modal-footer"><button className="button button-secondary" onClick={() => setInventory({})}>清空库存</button><button className="button button-primary" onClick={() => setInventoryOpen(false)}>完成</button></footer>
          </section>
        </div>
      )}

      {projectsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectsOpen(false); }}>
          <section className="modal projects-modal" role="dialog" aria-modal="true" aria-label="打开拼豆项目">
            <header className="modal-header"><div><p className="eyebrow">LOCAL PROJECTS</p><h2>打开或备份项目</h2><p>自动保存和最近项目仅保存在这台设备。</p></div><button className="modal-close" onClick={() => setProjectsOpen(false)} aria-label="关闭">×</button></header>
            <input ref={projectInputRef} className="visually-hidden" type="file" accept=".pindou,application/json" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) importProject(file); event.target.value = ""; }} />
            <div className="project-actions"><button className="button button-primary" onClick={() => projectInputRef.current?.click()}>导入 .pindou 文件</button><button className="button button-secondary" onClick={exportProjectFile} disabled={!codes}>备份当前项目</button></div>
            <div className="project-list">
              {recentProjects.length ? recentProjects.map((project) => <div className="project-row" key={project.id}><button className="project-open" onClick={async () => { const loaded = await loadLocalProject(project.id); if (loaded) applyProject(loaded); }}><strong>{project.name}</strong><span>{new Date(project.savedAt).toLocaleString("zh-CN")} · {project.pattern ? `${project.pattern.width} × ${project.pattern.height}` : "仅设置"}</span></button><button className="project-delete" onClick={async () => { await deleteLocalProject(project.id); await refreshProjects(); }} aria-label={`删除 ${project.name}`}>删除</button></div>) : <div className="project-empty"><strong>还没有本地项目</strong><span>编辑后会自动保存，也可以导入朋友发来的 .pindou 文件。</span></div>}
            </div>
            <footer className="modal-footer"><span>项目文件可通过微信、网盘或邮件分享。</span><button className="button button-secondary" onClick={() => setProjectsOpen(false)}>关闭</button></footer>
          </section>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return <div className="slider-field"><div className="label-row"><span className="field-label">{label}</span><output>{value}{suffix}</output></div><input aria-label={label} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} /><div className="range-labels"><span>{min}{suffix}</span><span>{max}{suffix}</span></div></div>;
}
