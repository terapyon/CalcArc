// public/icon.svg から PNG アイコンを 3 種類生成する。
//
// 新しい依存を足さないため、ラスタライズには @playwright/test を使う
// (既に devDependency として e2e に入っている)。sharp や resvg のような
// 画像専用ライブラリは追加しない。
//
// 生成した PNG はコミットする。ビルドのたびに再生成しない
// (ビルドの決定性を CI の再現検査に合わせるため)。
//
// 実行: pnpm icons
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const svgPath = `${webDir}public/icon.svg`;
const svgMarkup = readFileSync(svgPath, "utf-8");

// { ファイル名, 出力サイズ, 安全域(maskable 用に glyph を縮小する比率) }
const targets = [
  { file: "icon-192.png", size: 192, safeZone: 1 },
  { file: "icon-512.png", size: 512, safeZone: 1 },
  // maskable は OS がアイコンを丸や角丸でクロップするため、意味のある絵柄を
  // 中央 80% の安全域に収める(https://web.dev/maskable-icon/)。
  { file: "icon-512-maskable.png", size: 512, safeZone: 0.8 },
];

function htmlFor(size, safeZone) {
  const glyphSize = size * safeZone;
  const offset = (size - glyphSize) / 2;
  const background = safeZone < 1 ? "background: #d8e6ff;" : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; }
      body { width: ${size}px; height: ${size}px; ${background} }
      svg { position: absolute; left: ${offset}px; top: ${offset}px; width: ${glyphSize}px; height: ${glyphSize}px; }
    </style>
  </head>
  <body>${svgMarkup}</body>
</html>`;
}

const browser = await chromium.launch();
try {
  for (const { file, size, safeZone } of targets) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(htmlFor(size, safeZone));
    await page.screenshot({
      path: `${webDir}public/${file}`,
      omitBackground: safeZone >= 1,
    });
    await page.close();
    console.log(`generated public/${file}`);
  }
} finally {
  await browser.close();
}
