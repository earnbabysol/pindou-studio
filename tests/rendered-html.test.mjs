import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the finished 拼豆稿 tool", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /拼豆稿/);
  assert.match(html, /PIXEL BEAD STUDIO/);
  assert.match(html, /选择图片/);
  assert.match(html, /104(?:<!-- -->)? × (?:<!-- -->)?104/);
  assert.match(html, /90(?:<!-- -->)? × (?:<!-- -->)?40/);
  assert.match(html, /MARD 221/);
  assert.match(html, /手动精修/);
  assert.match(html, />制作<\/button>/);
  assert.match(html, /管理 MARD 库存/);
  assert.match(html, /下载 A4 PDF 图纸/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the pixel conversion engine and social preview", async () => {
  const [page, engine, mardPalette, packageJson, socialCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/pixelize.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/mard-palette.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    stat(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /useState<BoardSize>\(104\)/);
  assert.match(page, /useState\(90\)/);
  assert.match(page, /useState\(16\)/);
  assert.match(page, /downloadPixelArt/);
  assert.match(page, /downloadInventory/);
  assert.match(page, /downloadPdf/);
  assert.match(page, /saveLocalProject/);
  assert.match(page, /floodFillCodes/);
  assert.match(page, /restrictToInventory/);
  assert.match(page, /function drawPatternSheet/);
  assert.match(page, /showBeadCodes/);
  assert.match(page, /MARD色号,需要（颗）,库存（颗）,缺少（颗）,建议替代色号/);
  assert.doesNotMatch(page, /colorCode|色号,HEX|<strong>\{color\.hex\}<\/strong>/);
  assert.match(engine, /function smoothPixels/);
  assert.match(engine, /function removeSmallIslands/);
  assert.match(engine, /function snapCentroidsToMard/);
  assert.match(engine, /export function pixelize/);
  const mardEntries = [...mardPalette.matchAll(/\b([A-HM]\d+):([0-9A-F]{6})\b/g)];
  assert.equal(mardEntries.length, 221);
  assert.equal(new Set(mardEntries.map((entry) => entry[1])).size, 221);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.ok(socialCard.size > 100_000);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(projectRoot);
});

test("builds a self-contained GitHub Pages entry", async () => {
  const staticHtml = await readFile(
    new URL("../dist-pages/index.html", import.meta.url),
    "utf8",
  );

  assert.match(staticHtml, /<title>拼豆稿｜MARD 拼豆设计与制作工具<\/title>/);
  assert.match(staticHtml, /\/pindou-studio\/assets\/[^"']+\.js/);
  assert.match(staticHtml, /\/pindou-studio\/assets\/[^"']+\.css/);
  assert.doesNotMatch(staticHtml, /chatgpt\.site/);
  await access(new URL("../dist-pages/og.png", import.meta.url));
});
