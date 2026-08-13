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
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the pixel conversion engine and social preview", async () => {
  const [page, engine, packageJson, socialCard] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/pixelize.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    stat(new URL("../public/og.png", import.meta.url)),
  ]);

  assert.match(page, /useState<BoardSize>\(104\)/);
  assert.match(page, /useState\(90\)/);
  assert.match(page, /useState\(16\)/);
  assert.match(page, /downloadPixelArt/);
  assert.match(page, /downloadInventory/);
  assert.match(engine, /function smoothPixels/);
  assert.match(engine, /function removeSmallIslands/);
  assert.match(engine, /export function pixelize/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.ok(socialCard.size > 100_000);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(projectRoot);
});
