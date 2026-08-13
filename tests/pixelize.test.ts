import assert from "node:assert/strict";
import test from "node:test";
import { MARD_221 } from "../lib/mard-palette";
import { pixelize } from "../lib/pixelize";

test("MARD standard palette contains 221 unique brand codes", () => {
  assert.equal(MARD_221.length, 221);
  assert.equal(new Set(MARD_221.map((color) => color.code)).size, 221);
  assert.ok(MARD_221.every((color) => /^[A-HM]\d+$/.test(color.code)));
});

test("pixel conversion returns only exact MARD colors", () => {
  const width = 8;
  const height = 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const sourceColors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ];
  for (let index = 0; index < width * height; index += 1) {
    const color = sourceColors[index % sourceColors.length];
    rgba[index * 4] = color[0];
    rgba[index * 4 + 1] = color[1];
    rgba[index * 4 + 2] = color[2];
    rgba[index * 4 + 3] = 255;
  }

  const result = pixelize(rgba, width, height, 4, 0);
  const officialColors = new Map(MARD_221.map((color) => [color.code, color.hex]));
  assert.ok(result.palette.length <= 4);
  assert.equal(result.beadCount, width * height);
  assert.ok(result.labels.every((label) => label >= 0 && label < result.palette.length));
  assert.ok(
    result.palette.every((color) => officialColors.get(color.code) === color.hex),
  );
});

test("requested color limit remains strict after MARD matching", () => {
  const rgba = new Uint8ClampedArray(6 * 6 * 4);
  for (let index = 0; index < 36; index += 1) {
    rgba[index * 4] = (index * 47) % 256;
    rgba[index * 4 + 1] = (index * 83) % 256;
    rgba[index * 4 + 2] = (index * 131) % 256;
    rgba[index * 4 + 3] = 255;
  }

  assert.ok(pixelize(rgba, 6, 6, 2, 0).palette.length <= 2);
});

test("inventory-restricted conversion uses only owned MARD codes", () => {
  const rgba = new Uint8ClampedArray(8 * 8 * 4);
  for (let index = 0; index < 64; index += 1) {
    rgba[index * 4] = (index * 71) % 256;
    rgba[index * 4 + 1] = (index * 37) % 256;
    rgba[index * 4 + 2] = (index * 19) % 256;
    rgba[index * 4 + 3] = 255;
  }
  const owned = ["A4", "B5", "C8", "H7"];
  const result = pixelize(rgba, 8, 8, 16, 1, { allowedCodes: owned, dither: true });
  assert.ok(result.palette.length <= owned.length);
  assert.ok(result.palette.every((color) => owned.includes(color.code)));
  assert.equal(result.beadCount, 64);
});
