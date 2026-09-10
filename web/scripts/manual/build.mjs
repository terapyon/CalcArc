// マニュアルの Markdown を PDF にする（設計書 `2026-09-10-manuals-design.md` §4、
// 計画 `2026-09-10-manuals.md` T2）。
//
//   node scripts/manual/build.mjs [--src <dir>] [--shots <dir>] [--out <dir>]
//
// - `--src`   マニュアルの置き場。既定は `docs/manual`（設計書 §2）
// - `--shots` 撮った写真の置き場。`<名前>.png` を `shot:<名前>` として使う（設計書 §3）
// - `--out`   PDF の置き場。既定は `web/manual-dist`（追跡しない）
//
// **ブラウザは Playwright の Chromium を使う**（`page.pdf()` は Chromium だけが
// 持つ。設計書 §4）。**ウェブサーバは立てない**——頁・書体・写真は
// `.invalid`（決して名前解決されない）の架空の送り元から `route` で渡し、
// **それ以外の通信はすべて塞ぐ。** PDF がネットワークに依らないことを
// 仕組みで保つ。
//
// **判定は `markdown.ts` の純関数が持つ。** ここは読み書きと印刷だけをする。

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import {
  fontFaceCss,
  manualLang,
  manualTitle,
  pdfName,
  renderManual,
} from "./markdown.ts";

const WEB = resolve(import.meta.dirname, "..", "..");
const ROOT = resolve(WEB, "..");
const ORIGIN = "https://calcarc-manual.invalid";

/** 書体の太さ。本文は 400、`**強調**` と見出しは 700。 */
const WEIGHTS = ["400", "700"];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
};

function fail(message) {
  console.error(`manual NG — ${message}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    src: { type: "string" },
    shots: { type: "string" },
    out: { type: "string" },
  },
});

const srcDir = values.src ? resolve(values.src) : join(ROOT, "docs", "manual");
const outDir = values.out ? resolve(values.out) : join(WEB, "manual-dist");
const shotsDir = values.shots ? resolve(values.shots) : null;

// **1 冊も無ければ落ちる**（計画 T2）。何も作らずに緑になる段を作らない
// ——CI に載せた日に「PDF が付いた」と誰もが思うが、実際には 0 冊である。
const manuals = existsSync(srcDir)
  ? readdirSync(srcDir)
      .filter((name) => name.endsWith(".md"))
      .sort()
  : [];
if (manuals.length === 0) {
  fail(`${srcDir} に *.md が 1 冊も無い（何も作らずに成功しない）`);
}

if (
  shotsDir !== null &&
  !statSync(shotsDir, { throwIfNoEntry: false })?.isDirectory()
) {
  fail(`--shots ${shotsDir} はディレクトリではない`);
}
/** `<名前>.png` → 送り元の URL。 */
const shots = new Map(
  shotsDir === null
    ? []
    : readdirSync(shotsDir)
        .filter((name) => name.endsWith(".png"))
        .map((name) => [
          basename(name, ".png"),
          `${ORIGIN}/shots/${encodeURIComponent(name)}`,
        ]),
);

const fontDir = fileURLToPath(
  new URL(".", import.meta.resolve("@fontsource/noto-sans-jp/400.css")),
);
const fontCss = WEIGHTS.map((weight) =>
  fontFaceCss(
    readFileSync(join(fontDir, `${weight}.css`), "utf8"),
    `${ORIGIN}/fonts`,
  ),
).join("\n");

const version = JSON.parse(
  readFileSync(join(WEB, "package.json"), "utf8"),
).version;

/**
 * 送り元のパスを手元のファイルに対応させる。**`/` を含む名前は受けない**
 * ——`..` で置き場の外を読ませない。
 */
function localFile(pathname, html) {
  const [, kind, raw] = /^\/([a-z]+)\/(.+)$/.exec(pathname) ?? [];
  const name = raw === undefined ? "" : decodeURIComponent(raw);
  if (name.includes("/") || name.includes("\\")) return null;
  if (kind === "page" && name === "index.html")
    return { body: html, ext: ".html" };
  if (kind === "fonts")
    return { path: join(fontDir, "files", name), ext: extname(name) };
  if (kind === "shots" && shotsDir !== null)
    return { path: join(shotsDir, name), ext: extname(name) };
  return null;
}

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
let exitCode = 0;
try {
  for (const name of manuals) {
    const started = performance.now();
    const markdown = readFileSync(join(srcDir, name), "utf8");
    let html;
    try {
      html = renderManual(markdown, {
        shots,
        fontCss,
        title: manualTitle(markdown, name),
        lang: manualLang(name),
      });
    } catch (error) {
      console.error(
        `manual NG — ${name}: ${error instanceof Error ? error.message : error}`,
      );
      exitCode = 1;
      continue;
    }

    const page = await browser.newPage();
    const blocked = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const file = url.origin === ORIGIN ? localFile(url.pathname, html) : null;
      if (
        file === null ||
        (file.path !== undefined && !existsSync(file.path))
      ) {
        blocked.push(route.request().url());
        await route.abort();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: CONTENT_TYPES[file.ext] ?? "application/octet-stream",
        body: file.body ?? readFileSync(file.path),
      });
    });
    await page.goto(`${ORIGIN}/page/index.html`, { waitUntil: "load" });

    // **書体が当たったことを確かめてから刷る**（計画 T1 の撮影と同じ規律）。
    // `check()` は**どの `@font-face` にも当たらない文字列に true を返す**ので、
    // それだけでは「当たった」の証拠にならない。`load()` が本文の文字について
    // **実際に読み込んだ face の数**を返すので、そちらが 0 でないことを主張する。
    const fonts = await page.evaluate(async () => {
      const text = document.body.textContent ?? "";
      const regular = await document.fonts.load('16px "Noto Sans JP"', text);
      const bold = await document.fonts.load('bold 16px "Noto Sans JP"', text);
      await document.fonts.ready;
      return {
        regular: regular.length,
        bold: bold.length,
        check: document.fonts.check('16px "Noto Sans JP"', text),
      };
    });
    if (fonts.regular === 0 || !fonts.check) {
      console.error(
        `manual NG — ${name}: 書体 Noto Sans JP が当たっていない（load ${fonts.regular} face、check ${fonts.check}）`,
      );
      exitCode = 1;
      await page.close();
      continue;
    }
    if (blocked.length > 0) {
      console.error(
        `manual NG — ${name}: 読めなかったもの ${blocked.join(", ")}`,
      );
      exitCode = 1;
      await page.close();
      continue;
    }

    const out = join(outDir, pdfName(name, version));
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
    await page.close();

    // **刷り上がりにも書体が入っていることを見る。** 頁で当たっていても、
    // 刷る段で別の書体に落ちたら日本語が豆腐になる（設計書 §3・§10）。
    if (!pdf.includes("NotoSansJP")) {
      console.error(
        `manual NG — ${name}: PDF に NotoSansJP の書体が埋め込まれていない`,
      );
      exitCode = 1;
      continue;
    }
    writeFileSync(out, pdf);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(
      `manual: ${name} → ${out}（${pdf.length} バイト、${seconds} 秒、書体 ${fonts.regular}+${fonts.bold} face）`,
    );
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
