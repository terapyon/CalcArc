// public/icon.svg を土台に、SNS/チャットのリンクプレビュー用 OGP 画像
// (1200x630) を生成する。
//
// generate-icons.mjs と同じ流儀: 新しい依存を足さないため、ラスタライズには
// @playwright/test を使う(既に devDependency として e2e に入っている)。
//
// フォントは Noto Sans CJK JP を前提にする。日本語の文言を含むため、CJK
// フォントが無い環境で実行すると文字化け(トーフ)した画像になる——その場合は
// 生成し直さず、フォントを入れるかコミット済みの画像をそのまま使うこと。
//
// 生成した PNG はコミットする。ビルドのたびに再生成しない。
//
// 実行: pnpm ogp (または node scripts/generate-ogp.mjs)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const svgPath = `${webDir}public/icon.svg`;
const svgMarkup = readFileSync(svgPath, "utf-8");

const WIDTH = 1200;
const HEIGHT = 630;
const ICON_SIZE = 220;

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        background: #f2f2f7;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: "Noto Sans CJK JP", "Noto Sans JP", sans-serif;
      }
      .card {
        display: flex;
        align-items: center;
        gap: 56px;
        padding: 0 80px;
      }
      .icon { width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; flex: none; }
      .text { display: flex; flex-direction: column; gap: 20px; }
      h1 {
        margin: 0;
        font-size: 88px;
        font-weight: 700;
        color: #0b3d91;
        line-height: 1;
      }
      p {
        margin: 0;
        font-size: 34px;
        font-weight: 400;
        color: #1c1c1e;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">${svgMarkup}</div>
      <div class="text">
        <h1>CalcArc</h1>
        <p>ブラウザで動く計算ツール群<br />Rust + WebAssembly / オフライン対応</p>
      </div>
    </div>
  </body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(html);
  await page.screenshot({
    path: `${webDir}public/ogp.png`,
    omitBackground: false,
  });
  await page.close();
  console.log("generated public/ogp.png");
} finally {
  await browser.close();
}
