"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { pixelize, type PixelResult } from "@/lib/pixelize";

type BoardSize = 52 | 104;
type FitMode = "cover" | "contain";

type SourceImage = {
  element: HTMLImageElement;
  name: string;
  url: string;
  width: number;
  height: number;
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function beadLabelColor(r: number, g: number, b: number) {
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 158 ? "rgba(20, 20, 18, 0.88)" : "rgba(255, 255, 255, 0.94)";
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
      const inside =
        localX >= 0 &&
        localX < targetWidth &&
        localY >= 0 &&
        localY < targetHeight;
      let filled = false;

      if (inside && result) {
        const label = result.labels[localY * result.width + localX];
        if (label >= 0) {
          context.fillStyle = result.palette[label].hex;
          context.fillRect(x * cell, y * cell, cell, cell);
          if (showBeadCodes) {
            drawBeadCode(
              context,
              result.palette[label].code,
              result.palette[label],
              x * cell,
              y * cell,
              cell,
            );
          }
          filled = true;
        }
      }

      if (!filled) {
        context.fillStyle = inside ? "#FAF7F0" : "#F2EEE5";
        context.fillRect(x * cell, y * cell, cell, cell);
        context.beginPath();
        context.fillStyle = inside ? "rgba(29, 29, 27, 0.11)" : "rgba(29, 29, 27, 0.07)";
        context.arc(
          x * cell + cell / 2,
          y * cell + cell / 2,
          Math.max(0.8, cell * 0.13),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
  }

  if (showGrid) {
    context.lineWidth = 1;
    for (let index = 0; index <= boardSize; index += 1) {
      const major = index % 10 === 0;
      context.strokeStyle = major ? "rgba(29, 29, 27, 0.28)" : "rgba(29, 29, 27, 0.10)";
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
  context.strokeRect(
    offsetX * cell + 1,
    offsetY * cell + 1,
    targetWidth * cell - 2,
    targetHeight * cell - 2,
  );
  context.restore();
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
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillText("MARD 拼豆图纸", outerMargin, 43);
  context.fillStyle = "#66635C";
  context.font = "600 16px Arial, sans-serif";
  context.fillText(
    `${boardSize} × ${boardSize} 底板  ·  ${targetWidth} × ${targetHeight} 画面  ·  ${result.palette.length} 色  ·  ${result.beadCount.toLocaleString("zh-CN")} 颗`,
    outerMargin,
    72,
  );
  context.textAlign = "right";
  context.fillText(showBeadCodes ? "逐格色号：已标注" : "逐格色号：未标注", canvas.width - outerMargin, 72);

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
    context.strokeStyle = major ? "rgba(29, 29, 27, 0.52)" : "rgba(29, 29, 27, 0.18)";
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

  context.save();
  context.strokeStyle = "#F05C3E";
  context.lineWidth = 3;
  context.setLineDash([12, 8]);
  context.strokeRect(
    boardX + offsetX * cell + 1.5,
    boardY + offsetY * cell + 1.5,
    targetWidth * cell - 3,
    targetHeight * cell - 3,
  );
  context.restore();

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

  context.fillStyle = "#1D1D1B";
  context.font = "800 23px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText("MARD 色号与用量", outerMargin, legendTop + 26);
  context.fillStyle = "#74716A";
  context.font = "600 14px Arial, sans-serif";
  context.fillText(
    `共 ${result.palette.length} 个色号 · 合计 ${result.beadCount.toLocaleString("zh-CN")} 颗`,
    outerMargin,
    legendTop + 52,
  );
  context.strokeStyle = "#D8D3C8";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(outerMargin, legendTop + legendHeaderHeight - 4);
  context.lineTo(canvas.width - outerMargin, legendTop + legendHeaderHeight - 4);
  context.stroke();

  const legendWidth = canvas.width - outerMargin * 2;
  const itemWidth = legendWidth / legendColumns;
  result.palette.forEach((color, index) => {
    const column = index % legendColumns;
    const row = Math.floor(index / legendColumns);
    const itemX = outerMargin + column * itemWidth;
    const itemY = legendTop + legendHeaderHeight + row * legendRowHeight;
    context.fillStyle = color.hex;
    context.fillRect(itemX, itemY + 11, 32, 32);
    context.strokeStyle = "rgba(29, 29, 27, 0.24)";
    context.strokeRect(itemX + 0.5, itemY + 11.5, 31, 31);
    context.fillStyle = "#1D1D1B";
    context.font = "800 17px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(color.code, itemX + 43, itemY + 22);
    context.fillStyle = "#74716A";
    context.font = "600 13px Arial, sans-serif";
    context.fillText(`${color.count.toLocaleString("zh-CN")} 颗`, itemX + 43, itemY + 41);
  });

  context.fillStyle = "#8B8880";
  context.font = "500 12px Arial, sans-serif";
  context.textAlign = "left";
  context.fillText(
    "色块为 MARD 221 色卡屏幕近似值；购买与制作请以 MARD 色号为准。",
    outerMargin,
    canvas.height - 24,
  );
}

export default function Home() {
  const [boardSize, setBoardSize] = useState<BoardSize>(104);
  const [targetWidth, setTargetWidth] = useState(90);
  const [ratioWidth, setRatioWidth] = useState(9);
  const [ratioHeight, setRatioHeight] = useState(4);
  const [maxColors, setMaxColors] = useState(16);
  const [cleanupStrength, setCleanupStrength] = useState(2);
  const [fitMode, setFitMode] = useState<FitMode>("cover");
  const [showGrid, setShowGrid] = useState(true);
  const [showBeadCodes, setShowBeadCodes] = useState(true);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [result, setResult] = useState<PixelResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceUrlRef = useRef<string | null>(null);

  const targetHeight = useMemo(
    () => Math.max(1, Math.round((targetWidth * ratioHeight) / ratioWidth)),
    [ratioHeight, ratioWidth, targetWidth],
  );
  const targetFits = targetWidth <= boardSize && targetHeight <= boardSize;
  const centeredOffset = useMemo(
    () => ({
      x: Math.floor((boardSize - targetWidth) / 2),
      y: Math.floor((boardSize - targetHeight) / 2),
    }),
    [boardSize, targetHeight, targetWidth],
  );

  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2300);
  }, []);

  const loadFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("图片超过 20 MB，请先压缩后再上传。");
      return;
    }

    setError(null);
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = url;
      setSource({
        element: image,
        name: file.name,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setError("这张图片无法读取，请换一张再试。");
    };
    image.src = url;
  }, []);

  useEffect(
    () => () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    },
    [],
  );

  useEffect(() => {
    const maxByHeight = Math.floor((boardSize * ratioWidth) / ratioHeight);
    const maximum = Math.max(1, Math.min(boardSize, maxByHeight));
    if (targetWidth > maximum) setTargetWidth(maximum);
  }, [boardSize, ratioHeight, ratioWidth, targetWidth]);

  useEffect(() => {
    if (!source || !targetFits) {
      setResult(null);
      return;
    }

    let cancelled = false;
    setIsProcessing(true);
    const frame = window.requestAnimationFrame(() => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        context.clearRect(0, 0, targetWidth, targetHeight);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        const sourceRatio = source.width / source.height;
        const targetRatio = targetWidth / targetHeight;
        let drawWidth = targetWidth;
        let drawHeight = targetHeight;
        if (fitMode === "cover") {
          if (sourceRatio > targetRatio) drawWidth = targetHeight * sourceRatio;
          else drawHeight = targetWidth / sourceRatio;
        } else if (sourceRatio > targetRatio) {
          drawHeight = targetWidth / sourceRatio;
        } else {
          drawWidth = targetHeight * sourceRatio;
        }
        const drawX = (targetWidth - drawWidth) / 2;
        const drawY = (targetHeight - drawHeight) / 2;
        context.drawImage(source.element, drawX, drawY, drawWidth, drawHeight);
        const imageData = context.getImageData(0, 0, targetWidth, targetHeight);
        const next = pixelize(
          imageData.data,
          targetWidth,
          targetHeight,
          maxColors,
          cleanupStrength,
        );
        if (!cancelled) {
          setResult(next);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setResult(null);
          setError("生成像素稿时遇到问题，请换一张图片再试。");
        }
      } finally {
        if (!cancelled) setIsProcessing(false);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [cleanupStrength, fitMode, maxColors, source, targetFits, targetHeight, targetWidth]);

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
    );
  }, [boardSize, result, showBeadCodes, showGrid, targetHeight, targetWidth]);

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const applyOriginalRatio = () => {
    if (!source) return;
    const divisor = (left: number, right: number): number =>
      right === 0 ? left : divisor(right, left % right);
    const roundedWidth = Math.max(1, Math.round(source.width));
    const roundedHeight = Math.max(1, Math.round(source.height));
    const common = divisor(roundedWidth, roundedHeight);
    const rawWidth = roundedWidth / common;
    const rawHeight = roundedHeight / common;
    if (rawWidth <= 99 && rawHeight <= 99) {
      setRatioWidth(rawWidth);
      setRatioHeight(rawHeight);
    } else {
      const ratio = source.width / source.height;
      setRatioWidth(Math.max(1, Math.round(ratio * 10)));
      setRatioHeight(10);
    }
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
      downloadBlob(blob, `pindou-MARD-${result.width}x${result.height}-${result.palette.length}colors.png`);
      flash("已下载 MARD 纯像素图");
    }, "image/png");
  };

  const downloadBoard = () => {
    if (!result) return;
    const canvas = document.createElement("canvas");
    drawPatternSheet(canvas, boardSize, result, targetWidth, targetHeight, showBeadCodes);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const codeMode = showBeadCodes ? "with-codes" : "colors-only";
      downloadBlob(blob, `pindou-MARD-sheet-${boardSize}-${targetWidth}x${targetHeight}-${codeMode}.png`);
      flash("已下载 MARD 拼豆图纸");
    }, "image/png");
  };

  const downloadInventory = () => {
    if (!result) return;
    const lines = [
      "MARD色号,数量（颗）",
      ...result.palette.map((color) => `${color.code},${color.count}`),
      `合计,${result.beadCount}`,
    ];
    downloadBlob(
      new Blob(["\uFEFF", lines.join("\n")], { type: "text/csv;charset=utf-8" }),
      `pindou-MARD-colors-${targetWidth}x${targetHeight}.csv`,
    );
    flash("已下载配色用量表");
  };

  const selectBoard = (size: BoardSize) => {
    setBoardSize(size);
    setTargetWidth((current) => Math.min(current, size));
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">PIXEL BEAD STUDIO</p>
            <h1>拼豆稿</h1>
          </div>
        </div>
        <div className="topbar-note">
          <span className="privacy-dot" />
          图片仅在当前浏览器中处理
        </div>
        <div className="topbar-actions">
          <button className="button button-secondary" onClick={downloadPixelArt} disabled={!result}>
            纯像素 PNG
          </button>
          <button className="button button-primary" onClick={downloadBoard} disabled={!result}>
            下载 MARD 图纸
          </button>
        </div>
      </header>

      <div className="studio-grid">
        <aside className="control-panel" aria-label="拼豆图设置">
          <section className="control-section upload-section">
            <div className="section-heading">
              <span className="step-number">01</span>
              <div>
                <h2>选择图片</h2>
                <p>PNG / JPG / WebP · 最大 20 MB</p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleFileInput}
            />
            <div
              className={`upload-box ${isDragging ? "is-dragging" : ""} ${source ? "has-source" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {source ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={source.url} alt="已上传图片缩略图" />
                  <div className="upload-file-meta">
                    <strong title={source.name}>{source.name}</strong>
                    <span>{source.width} × {source.height} px</span>
                  </div>
                  <button className="replace-button" onClick={() => fileInputRef.current?.click()}>
                    更换
                  </button>
                </>
              ) : (
                <button className="upload-trigger" onClick={() => fileInputRef.current?.click()}>
                  <span className="upload-plus" aria-hidden="true">＋</span>
                  <strong>点击或拖入图片</strong>
                  <span>上传后自动生成像素稿</span>
                </button>
              )}
            </div>
          </section>

          <section className="control-section">
            <div className="section-heading">
              <span className="step-number">02</span>
              <div>
                <h2>设置尺寸</h2>
                <p>画面会自动居中放入底板</p>
              </div>
            </div>

            <div className="field-group">
              <label>底板规格</label>
              <div className="segmented-control">
                {[104, 52].map((size) => (
                  <button
                    key={size}
                    className={boardSize === size ? "active" : ""}
                    onClick={() => selectBoard(size as BoardSize)}
                    aria-pressed={boardSize === size}
                  >
                    {size} × {size}
                  </button>
                ))}
              </div>
            </div>

            <div className="dimension-row">
              <div className="field-group compact-field">
                <label htmlFor="target-width">横向豆数</label>
                <div className="number-input suffix-input">
                  <input
                    id="target-width"
                    type="number"
                    min={1}
                    max={boardSize}
                    value={targetWidth}
                    onChange={(event) => setTargetWidth(Math.max(1, Number(event.target.value) || 1))}
                  />
                  <span>px</span>
                </div>
              </div>
              <div className="dimension-link" aria-hidden="true">×</div>
              <div className="field-group compact-field">
                <label>纵向自适应</label>
                <div className="readonly-value">
                  <strong>{targetHeight}</strong>
                  <span>px</span>
                </div>
              </div>
            </div>

            <div className="field-group">
              <div className="label-row">
                <label>画面比例</label>
                <button className="text-button" onClick={applyOriginalRatio} disabled={!source}>
                  使用原图比例
                </button>
              </div>
              <div className="ratio-control">
                <input
                  aria-label="比例宽度"
                  type="number"
                  min={1}
                  max={99}
                  value={ratioWidth}
                  onChange={(event) => setRatioWidth(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
                />
                <span>:</span>
                <input
                  aria-label="比例高度"
                  type="number"
                  min={1}
                  max={99}
                  value={ratioHeight}
                  onChange={(event) => setRatioHeight(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
                />
                <span className="ratio-result">＝ {targetWidth} × {targetHeight}</span>
              </div>
            </div>

            <div className="field-group">
              <label>图片适配</label>
              <div className="segmented-control">
                <button className={fitMode === "cover" ? "active" : ""} onClick={() => setFitMode("cover")}>
                  裁切填满
                </button>
                <button className={fitMode === "contain" ? "active" : ""} onClick={() => setFitMode("contain")}>
                  完整显示
                </button>
              </div>
            </div>
          </section>

          <section className="control-section">
            <div className="section-heading">
              <span className="step-number">03</span>
              <div>
                <h2>清理颜色</h2>
                <p>匹配 MARD 221 色卡并消除杂色</p>
              </div>
            </div>

            <div className="slider-field">
              <div className="label-row">
                <label htmlFor="color-count">最多颜色</label>
                <output>{maxColors} 色</output>
              </div>
              <input
                id="color-count"
                type="range"
                min={2}
                max={32}
                value={maxColors}
                onChange={(event) => setMaxColors(Number(event.target.value))}
              />
              <div className="range-labels"><span>2</span><span>16</span><span>32</span></div>
            </div>

            <div className="slider-field">
              <div className="label-row">
                <label htmlFor="cleanup-strength">色块洁净度</label>
                <output>{["关闭", "轻柔", "标准", "强力"][cleanupStrength]}</output>
              </div>
              <input
                id="cleanup-strength"
                type="range"
                min={0}
                max={3}
                value={cleanupStrength}
                onChange={(event) => setCleanupStrength(Number(event.target.value))}
              />
              <div className="range-labels"><span>保留细节</span><span>去除杂色</span></div>
            </div>

            <div className="field-group annotation-field">
              <label>逐格 MARD 色号</label>
              <div className="segmented-control">
                <button
                  className={showBeadCodes ? "active" : ""}
                  onClick={() => setShowBeadCodes(true)}
                  aria-pressed={showBeadCodes}
                >
                  标注色号
                </button>
                <button
                  className={!showBeadCodes ? "active" : ""}
                  onClick={() => setShowBeadCodes(false)}
                  aria-pressed={!showBeadCodes}
                >
                  仅显示颜色
                </button>
              </div>
              <p className="field-hint">控制预览与图纸中每一颗豆是否印出对应色号。</p>
            </div>
          </section>
        </aside>

        <section className="preview-panel" aria-label="拼豆图预览">
          <div className="preview-toolbar">
            <div>
              <p className="eyebrow">LIVE PREVIEW</p>
              <h2>{source ? "像素稿预览" : "等待图片"}</h2>
            </div>
            <label className="toggle-control">
              <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
              <span aria-hidden="true" />
              显示格线
            </label>
          </div>

          <div className="canvas-stage">
            <div className="canvas-ruler ruler-top" aria-hidden="true">
              <span>0</span><span>{Math.floor(boardSize / 2)}</span><span>{boardSize}</span>
            </div>
            <div className="canvas-ruler ruler-side" aria-hidden="true">
              <span>0</span><span>{Math.floor(boardSize / 2)}</span><span>{boardSize}</span>
            </div>
            <div className="canvas-wrap">
              <canvas ref={boardCanvasRef} aria-label={`${boardSize}乘${boardSize}拼豆底板预览`} />
              {!source && (
                <button className="empty-canvas-callout" onClick={() => fileInputRef.current?.click()}>
                  <span className="callout-beads" aria-hidden="true"><i /><i /><i /></span>
                  <strong>放入一张图片</strong>
                  <span>自动生成 {targetWidth} × {targetHeight} 像素稿</span>
                </button>
              )}
              {isProcessing && <div className="processing-badge"><span /> 正在整理色块…</div>}
            </div>
          </div>

          <div className="preview-summary">
            <div>
              <span>底板</span>
              <strong>{boardSize} × {boardSize}</strong>
            </div>
            <div>
              <span>成品画面</span>
              <strong>{targetWidth} × {targetHeight}</strong>
            </div>
            <div>
              <span>起始坐标</span>
              <strong>X {centeredOffset.x} · Y {centeredOffset.y}</strong>
            </div>
            <div className="summary-accent">
              <span>MARD 色号</span>
              <strong>{result ? result.palette.length : "—"} / {maxColors}</strong>
            </div>
          </div>

          {!targetFits && <p className="inline-error">当前画面超出底板，请缩小横向豆数或调整比例。</p>}
          {error && <p className="inline-error">{error}</p>}
        </section>

        <aside className="palette-panel" aria-label="颜色与用量">
          <div className="palette-heading">
            <div>
              <p className="eyebrow">COLOR MAP</p>
              <h2>MARD 色号用量</h2>
            </div>
            <span className="palette-count">MARD 221 · {result?.palette.length ?? 0} 色</span>
          </div>

          {result && result.palette.length ? (
            <div className="palette-list">
              {result.palette.map((color) => (
                <div className="palette-row" key={color.code}>
                  <span className="color-swatch" style={{ backgroundColor: color.hex }}>
                    {color.code}
                  </span>
                  <div className="color-meta">
                    <strong>MARD {color.code}</strong>
                    <span>{((color.count / result.beadCount) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="bead-count"><strong>{color.count.toLocaleString("zh-CN")}</strong><span>颗</span></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="palette-empty">
              <div className="empty-swatches" aria-hidden="true">
                <span /><span /><span /><span /><span />
              </div>
              <strong>MARD 色号会出现在这里</strong>
              <p>上传图片后，将列出实际采用的 MARD 色号和所需豆数。</p>
            </div>
          )}

          <div className="inventory-card">
            <div>
              <span>预计总用豆</span>
              <strong>{result ? result.beadCount.toLocaleString("zh-CN") : "—"}</strong>
            </div>
            <span className="inventory-unit">颗</span>
          </div>

          <div className="export-stack">
            <button className="button button-primary full-button" onClick={downloadBoard} disabled={!result}>
              下载 MARD 拼豆图纸
            </button>
            <button className="button button-secondary full-button" onClick={downloadPixelArt} disabled={!result}>
              下载 {targetWidth} × {targetHeight} 纯像素图
            </button>
            <button className="text-export" onClick={downloadInventory} disabled={!result}>
              导出配色用量表 CSV <span>↗</span>
            </button>
          </div>

          <p className="panel-footnote">图纸包含四边行列号和底部 MARD 色号用量；屏幕颜色仅作近似预览，制作请以色号为准。</p>
        </aside>
      </div>

      {notice && <div className="toast" role="status">{notice}</div>}
    </main>
  );
}
