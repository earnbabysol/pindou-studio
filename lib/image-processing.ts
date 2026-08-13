export function sharpenImageData(
  imageData: ImageData,
  width: number,
  height: number,
  strength: number,
) {
  if (strength <= 0) return imageData;
  const source = new Uint8ClampedArray(imageData.data);
  const amount = Math.min(3, Math.max(0, strength)) * 0.22;
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = source[index + channel];
        let neighbors = 0;
        offsets.forEach(([dx, dy]) => {
          neighbors += source[((y + dy) * width + x + dx) * 4 + channel];
        });
        imageData.data[index + channel] = Math.max(
          0,
          Math.min(255, center + amount * (center * 4 - neighbors)),
        );
      }
    }
  }
  return imageData;
}

export function removeCornerBackground(
  imageData: ImageData,
  width: number,
  height: number,
  tolerance: number,
) {
  const radius = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 8)));
  const samples: number[][] = [];
  const corners = [
    [0, 0],
    [width - radius, 0],
    [0, height - radius],
    [width - radius, height - radius],
  ];
  corners.forEach(([startX, startY]) => {
    for (let y = startY; y < startY + radius; y += 1) {
      for (let x = startX; x < startX + radius; x += 1) {
        const index = (y * width + x) * 4;
        if (imageData.data[index + 3] > 180) {
          samples.push([
            imageData.data[index],
            imageData.data[index + 1],
            imageData.data[index + 2],
          ]);
        }
      }
    }
  });
  if (!samples.length) return imageData;
  const background = [0, 1, 2].map(
    (channel) => samples.reduce((sum, sample) => sum + sample[channel], 0) / samples.length,
  );
  const threshold = 18 + Math.max(0, Math.min(100, tolerance)) * 1.65;
  const feather = 28;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    if (imageData.data[offset + 3] === 0) continue;
    const distance = Math.sqrt(
      (imageData.data[offset] - background[0]) ** 2 +
        (imageData.data[offset + 1] - background[1]) ** 2 +
        (imageData.data[offset + 2] - background[2]) ** 2,
    );
    if (distance <= threshold) imageData.data[offset + 3] = 0;
    else if (distance < threshold + feather) {
      imageData.data[offset + 3] = Math.round(
        imageData.data[offset + 3] * ((distance - threshold) / feather),
      );
    }
  }
  return imageData;
}
