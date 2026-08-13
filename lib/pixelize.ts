import { MARD_221 } from "./mard-palette";

export type PaletteColor = {
  code: string;
  r: number;
  g: number;
  b: number;
  hex: string;
  count: number;
};

export type PixelResult = {
  width: number;
  height: number;
  labels: number[];
  palette: PaletteColor[];
  beadCount: number;
};

type Lab = { l: number; a: number; b: number };
type Sample = Lab & { weight: number };
type MardLabColor = {
  code: string;
  hex: string;
  r: number;
  g: number;
  b: number;
  lab: Lab;
};

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

function rgbToLab(r: number, g: number, b: number): Lab {
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  const red = linear(r);
  const green = linear(g);
  const blue = linear(b);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const pivot = (value: number) =>
    value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function labDistance(left: Lab, right: Lab) {
  const dl = left.l - right.l;
  const da = left.a - right.a;
  const db = left.b - right.b;
  return dl * dl + da * da + db * db;
}

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

const MARD_COLORS: MardLabColor[] = MARD_221.map((color) => {
  const rgb = hexToRgb(color.hex);
  return {
    ...color,
    ...rgb,
    lab: rgbToLab(rgb.r, rgb.g, rgb.b),
  };
});

function smoothPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
) {
  const total = width * height;
  let current = new Float32Array(total * 3);
  const mask = new Uint8Array(total);

  for (let index = 0; index < total; index += 1) {
    const alpha = rgba[index * 4 + 3];
    mask[index] = alpha >= 96 ? 1 : 0;
    current[index * 3] = rgba[index * 4];
    current[index * 3 + 1] = rgba[index * 4 + 1];
    current[index * 3 + 2] = rgba[index * 4 + 2];
  }

  const passes = Math.max(0, Math.min(3, strength));
  const sigma = 24 + passes * 8;
  const sigmaSquared = 2 * sigma * sigma;

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float32Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!mask[index]) continue;

        const red = current[index * 3];
        const green = current[index * 3 + 1];
        const blue = current[index * 3 + 2];
        let sumRed = 0;
        let sumGreen = 0;
        let sumBlue = 0;
        let totalWeight = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighborY = y + offsetY;
          if (neighborY < 0 || neighborY >= height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const neighborX = x + offsetX;
            if (neighborX < 0 || neighborX >= width) continue;
            const neighbor = neighborY * width + neighborX;
            if (!mask[neighbor]) continue;
            const nr = current[neighbor * 3];
            const ng = current[neighbor * 3 + 1];
            const nb = current[neighbor * 3 + 2];
            const difference =
              (red - nr) * (red - nr) +
              (green - ng) * (green - ng) +
              (blue - nb) * (blue - nb);
            const spatialWeight = offsetX === 0 && offsetY === 0 ? 1 : offsetX === 0 || offsetY === 0 ? 0.82 : 0.62;
            const weight = spatialWeight * Math.exp(-difference / sigmaSquared);
            sumRed += nr * weight;
            sumGreen += ng * weight;
            sumBlue += nb * weight;
            totalWeight += weight;
          }
        }

        next[index * 3] = sumRed / totalWeight;
        next[index * 3 + 1] = sumGreen / totalWeight;
        next[index * 3 + 2] = sumBlue / totalWeight;
      }
    }
    current = next;
  }

  return { pixels: current, mask };
}

function makeHistogram(pixels: Float32Array, mask: Uint8Array) {
  const histogram = new Map<number, { r: number; g: number; b: number; weight: number }>();
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const r = clampByte(pixels[index * 3]);
    const g = clampByte(pixels[index * 3 + 1]);
    const b = clampByte(pixels[index * 3 + 2]);
    const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
    const entry = histogram.get(key);
    if (entry) {
      entry.r += r;
      entry.g += g;
      entry.b += b;
      entry.weight += 1;
    } else {
      histogram.set(key, { r, g, b, weight: 1 });
    }
  }

  return Array.from(histogram.values()).map((entry) => {
    const lab = rgbToLab(entry.r / entry.weight, entry.g / entry.weight, entry.b / entry.weight);
    return { ...lab, weight: entry.weight } satisfies Sample;
  });
}

function buildCentroids(samples: Sample[], requestedColors: number) {
  const colorCount = Math.max(1, Math.min(requestedColors, samples.length));
  const mostCommon = samples.reduce((best, sample) =>
    sample.weight > best.weight ? sample : best,
  );
  let centroids: Lab[] = [{ l: mostCommon.l, a: mostCommon.a, b: mostCommon.b }];

  while (centroids.length < colorCount) {
    let candidate = samples[0];
    let bestScore = -1;
    for (const sample of samples) {
      const nearest = Math.min(...centroids.map((centroid) => labDistance(sample, centroid)));
      const score = nearest * Math.sqrt(sample.weight);
      if (score > bestScore) {
        candidate = sample;
        bestScore = score;
      }
    }
    centroids.push({ l: candidate.l, a: candidate.a, b: candidate.b });
  }

  for (let iteration = 0; iteration < 14; iteration += 1) {
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }));
    for (const sample of samples) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      centroids.forEach((centroid, index) => {
        const distance = labDistance(sample, centroid);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      const sum = sums[bestIndex];
      sum.l += sample.l * sample.weight;
      sum.a += sample.a * sample.weight;
      sum.b += sample.b * sample.weight;
      sum.weight += sample.weight;
    }

    let movement = 0;
    centroids = centroids.map((centroid, index) => {
      const sum = sums[index];
      if (!sum.weight) return centroid;
      const next = {
        l: sum.l / sum.weight,
        a: sum.a / sum.weight,
        b: sum.b / sum.weight,
      };
      movement += labDistance(centroid, next);
      return next;
    });
    if (movement < 0.02) break;
  }

  return centroids;
}

function nearestUnusedMard(target: Lab, usedCodes: Set<string>) {
  let best = MARD_COLORS[0];
  let bestDistance = Infinity;
  for (const color of MARD_COLORS) {
    if (usedCodes.has(color.code)) continue;
    const distance = labDistance(target, color.lab);
    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }
  return best;
}

function snapCentroidsToMard(centroids: Lab[], samples: Sample[]) {
  let usedCodes = new Set<string>();
  let selected = centroids.map((centroid) => {
    const color = nearestUnusedMard(centroid, usedCodes);
    usedCodes.add(color.code);
    return color;
  });

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const sums = selected.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }));
    for (const sample of samples) {
      let bestIndex = 0;
      let bestDistance = Infinity;
      selected.forEach((color, index) => {
        const distance = labDistance(sample, color.lab);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      const sum = sums[bestIndex];
      sum.l += sample.l * sample.weight;
      sum.a += sample.a * sample.weight;
      sum.b += sample.b * sample.weight;
      sum.weight += sample.weight;
    }

    usedCodes = new Set<string>();
    const next = sums.map((sum, index) => {
      const target = sum.weight
        ? { l: sum.l / sum.weight, a: sum.a / sum.weight, b: sum.b / sum.weight }
        : selected[index].lab;
      const color = nearestUnusedMard(target, usedCodes);
      usedCodes.add(color.code);
      return color;
    });
    if (next.every((color, index) => color.code === selected[index].code)) break;
    selected = next;
  }

  return selected;
}

function removeSmallIslands(
  labels: number[],
  mask: Uint8Array,
  width: number,
  height: number,
  strength: number,
) {
  if (strength <= 0) return labels;
  const output = [...labels];
  const maxIslandSize = [0, 1, 2, 4][Math.min(3, strength)];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (let pass = 0; pass < Math.min(2, strength); pass += 1) {
    const visited = new Uint8Array(output.length);
    for (let start = 0; start < output.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      const label = output[start];
      const queue = [start];
      const component: number[] = [];
      visited[start] = 1;

      while (queue.length) {
        const index = queue.pop()!;
        component.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          if (!visited[neighbor] && mask[neighbor] && output[neighbor] === label) {
            visited[neighbor] = 1;
            queue.push(neighbor);
          }
        }
      }

      if (component.length > maxIslandSize) continue;
      const neighbors = new Map<number, number>();
      for (const index of component) {
        const x = index % width;
        const y = Math.floor(index / width);
        for (const [dx, dy] of directions) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbor = ny * width + nx;
          const neighborLabel = output[neighbor];
          if (mask[neighbor] && neighborLabel !== label) {
            neighbors.set(neighborLabel, (neighbors.get(neighborLabel) ?? 0) + 1);
          }
        }
      }
      let replacement = label;
      let bestBoundary = 0;
      for (const [neighborLabel, boundary] of neighbors) {
        if (boundary > bestBoundary) {
          bestBoundary = boundary;
          replacement = neighborLabel;
        }
      }
      if (replacement !== label) {
        component.forEach((index) => {
          output[index] = replacement;
        });
      }
    }
  }

  return output;
}

export function pixelize(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  maxColors: number,
  cleanupStrength: number,
): PixelResult {
  const { pixels, mask } = smoothPixels(rgba, width, height, cleanupStrength);
  const samples = makeHistogram(pixels, mask);
  if (!samples.length) {
    return { width, height, labels: Array(width * height).fill(-1), palette: [], beadCount: 0 };
  }

  const centroids = buildCentroids(samples, maxColors);
  const selectedColors = snapCentroidsToMard(centroids, samples);
  let labels = Array(width * height).fill(-1);
  for (let index = 0; index < labels.length; index += 1) {
    if (!mask[index]) continue;
    const lab = rgbToLab(
      pixels[index * 3],
      pixels[index * 3 + 1],
      pixels[index * 3 + 2],
    );
    let bestIndex = 0;
    let bestDistance = Infinity;
    selectedColors.forEach((color, colorIndex) => {
      const distance = labDistance(lab, color.lab);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = colorIndex;
      }
    });
    labels[index] = bestIndex;
  }

  labels = removeSmallIslands(labels, mask, width, height, cleanupStrength);

  const sums = selectedColors.map(() => ({ count: 0 }));
  labels.forEach((label, index) => {
    if (label < 0) return;
    sums[label].count += 1;
  });

  const active = sums
    .map((sum, oldIndex) => ({ ...sum, oldIndex }))
    .filter((sum) => sum.count > 0)
    .sort((left, right) => right.count - left.count);
  const remap = new Map(active.map((entry, index) => [entry.oldIndex, index]));
  labels = labels.map((label) => (label < 0 ? -1 : (remap.get(label) ?? -1)));
  const palette = active.map((sum) => {
    const color = selectedColors[sum.oldIndex];
    return {
      code: color.code,
      hex: color.hex,
      r: color.r,
      g: color.g,
      b: color.b,
      count: sum.count,
    };
  });

  return {
    width,
    height,
    labels,
    palette,
    beadCount: palette.reduce((total, color) => total + color.count, 0),
  };
}
