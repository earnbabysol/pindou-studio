import assert from "node:assert/strict";
import test from "node:test";
import {
  floodFillCodes,
  inventoryLines,
  moveSelectionCodes,
  replaceCode,
  resultFromCodes,
} from "../lib/pattern";

test("manual editor operations preserve MARD codes and counts", () => {
  const start = ["A1", "A1", "H7", "A1", "H7", "H7", "B5", "B5", "B5"];
  const filled = floodFillCodes(start, 3, 3, 0, "C4");
  assert.deepEqual(filled.slice(0, 2), ["C4", "C4"]);
  assert.equal(filled[3], "C4");
  const replaced = replaceCode(filled, "H7", "H6");
  assert.ok(!replaced.includes("H7"));
  const result = resultFromCodes(3, 3, replaced);
  assert.equal(result.beadCount, 9);
  assert.equal(result.palette.reduce((total, color) => total + color.count, 0), 9);
});

test("selection movement clears the source area and moves as one block", () => {
  const start = ["A1", "B1", "", "", "", "", "", "", ""];
  const moved = moveSelectionCodes(start, 3, 3, { x: 0, y: 0, width: 2, height: 1 }, 1, 1);
  assert.deepEqual(moved.codes, ["", "", "", "", "A1", "B1", "", "", ""]);
  assert.deepEqual(moved.selection, { x: 1, y: 1, width: 2, height: 1 });
});

test("inventory report includes shortages and an owned substitute", () => {
  const result = resultFromCodes(2, 2, ["A1", "A1", "A1", "A2"]);
  const lines = inventoryLines(result, { A1: 1, A2: 50, A3: 50 });
  const a1 = lines.find((line) => line.code === "A1");
  assert.equal(a1?.missing, 2);
  assert.ok(a1?.substitute === "A2" || a1?.substitute === "A3");
});
