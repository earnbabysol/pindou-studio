import { MARD_BY_CODE, nearestMardCode } from "./mard-palette";
import type { PixelResult } from "./pixelize";

export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type InventoryMap = Record<string, number>;

export type InventoryLine = {
  code: string;
  required: number;
  owned: number;
  missing: number;
  substitute: string | null;
};

export function codesFromResult(result: PixelResult): string[] {
  return result.labels.map((label) => (label < 0 ? "" : result.palette[label]?.code ?? ""));
}

export function resultFromCodes(width: number, height: number, codes: readonly string[]): PixelResult {
  const counts = new Map<string, number>();
  codes.slice(0, width * height).forEach((code) => {
    if (MARD_BY_CODE.has(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
  });
  const active = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => ({ color: MARD_BY_CODE.get(code)!, count }));
  const indexByCode = new Map(active.map((entry, index) => [entry.color.code, index]));
  const labels = Array.from({ length: width * height }, (_, index) => {
    const code = codes[index] ?? "";
    return indexByCode.get(code) ?? -1;
  });
  const palette = active.map(({ color, count }) => ({ ...color, count }));
  return {
    width,
    height,
    labels,
    palette,
    beadCount: palette.reduce((total, color) => total + color.count, 0),
  };
}

export function floodFillCodes(
  codes: readonly string[],
  width: number,
  height: number,
  start: number,
  replacement: string,
) {
  if (start < 0 || start >= width * height) return [...codes];
  const target = codes[start] ?? "";
  if (target === replacement) return [...codes];
  const next = [...codes];
  const queue = [start];
  const visited = new Uint8Array(width * height);
  while (queue.length) {
    const index = queue.pop()!;
    if (visited[index] || (next[index] ?? "") !== target) continue;
    visited[index] = 1;
    next[index] = replacement;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) queue.push(index - 1);
    if (x + 1 < width) queue.push(index + 1);
    if (y > 0) queue.push(index - width);
    if (y + 1 < height) queue.push(index + width);
  }
  return next;
}

export function replaceCode(codes: readonly string[], from: string, to: string) {
  if (from === to) return [...codes];
  return codes.map((code) => (code === from ? to : code));
}

export function normalizeSelection(startX: number, startY: number, endX: number, endY: number): SelectionRect {
  return {
    x: Math.min(startX, endX),
    y: Math.min(startY, endY),
    width: Math.abs(endX - startX) + 1,
    height: Math.abs(endY - startY) + 1,
  };
}

export function moveSelectionCodes(
  codes: readonly string[],
  width: number,
  height: number,
  selection: SelectionRect,
  dx: number,
  dy: number,
) {
  const boundedDx = Math.max(-selection.x, Math.min(width - selection.x - selection.width, dx));
  const boundedDy = Math.max(-selection.y, Math.min(height - selection.y - selection.height, dy));
  if (!boundedDx && !boundedDy) return { codes: [...codes], selection };
  const next = [...codes];
  const copied: Array<{ x: number; y: number; code: string }> = [];
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      const index = y * width + x;
      copied.push({ x, y, code: codes[index] ?? "" });
      next[index] = "";
    }
  }
  copied.forEach(({ x, y, code }) => {
    next[(y + boundedDy) * width + x + boundedDx] = code;
  });
  return {
    codes: next,
    selection: {
      ...selection,
      x: selection.x + boundedDx,
      y: selection.y + boundedDy,
    },
  };
}

export function inventoryLines(result: PixelResult, inventory: InventoryMap): InventoryLine[] {
  const ownedCodes = Object.entries(inventory)
    .filter(([, amount]) => amount > 0)
    .map(([code]) => code);
  return result.palette.map((color) => {
    const owned = Math.max(0, Math.floor(inventory[color.code] ?? 0));
    return {
      code: color.code,
      required: color.count,
      owned,
      missing: Math.max(0, color.count - owned),
      substitute: nearestMardCode(color.code, ownedCodes)?.code ?? null,
    };
  });
}
