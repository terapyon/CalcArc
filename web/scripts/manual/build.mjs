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
  describeFonts,
  fontFaceCss,
  manualLang,
  manualTitle,
  PINNED_FONTS,
  pdfName,
  renderManual,
  unpinnedGlyphs,
} from "./markdown.ts";

const WEB = resolve(import.meta.dirname, "..", "..");
const ROOT = resolve(WEB, "..");
const ORIGIN = "https://calcarc-manual.invalid";

/**
 * 書体の太さ。本文は 400、`**強調**` と見出しは 700。**包みに無い太さは読まない**
 * ——`Noto Sans Symbols 2` は 400 しか持たず、太字はブラウザが合成する
 * （合成しても描くのはその書体である）。
 */
const WEIGHTS = ["400", "700"];

/**
 * 1 冊で書体を確かめた要素の数の下限。**何も数えずに「端末の書体 0 字」で
 * 通さない。** 2026-09-11 の 3 冊で数えた実数は `detail.ja.md` 468・
 * `quick.en.md` 124・`quick.ja.md` 90——最少の 90 より下に置く。
 */
const MIN_CHECKED = 50;

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

/**
 * 書体のファイル名 → 手元のパス。**固定した書体（`PINNED_FONTS`）の包みの
 * ファイルだけを配る**——`markdown.ts` の `unpinnedGlyphs` が「読み込んだ
 * 書体 = 固定した書体」と数えてよいのは、ここで配る物がそれだけだからである。
 */
const fontFiles = new Map();
const fontCss = [];
for (const font of PINNED_FONTS) {
  const dir = fileURLToPath(
    new URL(".", import.meta.resolve(`${font.package}/400.css`)),
  );
  for (const name of readdirSync(join(dir, "files"))) {
    // **名前が重なったら落ちる。** 後から読んだ包みが前の書体を黙って差し替える。
    if (fontFiles.has(name)) {
      fail(`書体のファイル名が 2 つの包みで重なった: ${name}`);
    }
    fontFiles.set(name, join(dir, "files", name));
  }
  let read = 0;
  for (const weight of WEIGHTS) {
    const path = join(dir, `${weight}.css`);
    if (!existsSync(path)) continue;
    const css = readFileSync(path, "utf8");
    if (!css.includes(`font-family: '${font.family}'`)) {
      fail(
        `${font.package}/${weight}.css が '${font.family}' を名乗っていない`,
      );
    }
    fontCss.push(fontFaceCss(css, `${ORIGIN}/fonts`));
    read += 1;
  }
  if (read === 0) {
    fail(`${font.package} に ${WEIGHTS.join(" / ")} の CSS が 1 つも無い`);
  }
}

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
  if (kind === "fonts") {
    const path = fontFiles.get(name);
    return path === undefined ? null : { path, ext: extname(name) };
  }
  if (kind === "shots" && shotsDir !== null)
    return { path: join(shotsDir, name), ext: extname(name) };
  return null;
}

/** 和文と ASCII のほかの字。**どの字が端末の書体へ落ちたかの候補**として示す。 */
const SUSPECT =
  /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\s!-~]/gu;

/**
 * **字を実際に描いた書体を、要素ごとに Chromium に尋ねる**（写真の
 * `tests/shots/pinned-font.ts` の `provePinnedFont` と同じ道具）。
 *
 * **`document.fonts.check` と算出値の `font-family` は証拠にならない**——前者は
 * 実在しない書体名にも `true` を返し、後者は名前を書いたことしか言わない
 * （2026-09-10 の実測、`pinned-font.ts` の註）。**CDP の
 * `CSS.getPlatformFontsForNode` は、要素の字を描いた書体と字数を返す。**
 */
async function fontProvenance(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const problems = [];
  let checked = 0;
  const visit = async (node) => {
    if (node.nodeType === 1) {
      const text = (node.children ?? [])
        .filter((child) => child.nodeType === 3)
        .map((child) => child.nodeValue)
        .join("");
      // 描かれない要素（`<title>`・`<style>`）は書体を返さないので数えない。
      const { fonts } =
        text.trim() === ""
          ? { fonts: [] }
          : await cdp.send("CSS.getPlatformFontsForNode", {
              nodeId: node.nodeId,
            });
      if (fonts.length > 0) {
        checked += 1;
        if (unpinnedGlyphs(fonts) > 0) {
          const suspects = [...new Set(text.match(SUSPECT) ?? [])].join(" ");
          problems.push(
            `<${node.localName}> ${JSON.stringify(text.trim())}` +
              `（候補の字: ${suspects || "無し"}）: ${describeFonts(fonts)}`,
          );
        }
      }
    }
    for (const child of node.children ?? []) await visit(child);
  };
  await visit(root);
  await cdp.detach();
  return { checked, problems };
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
        fontCss: fontCss.join("\n"),
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
    // **和文の書体のあとに並べた書体も読み込ませる**——読み込みの前に尋ねると、
    // 仮に描いている端末の書体が答えに出る。
    const fonts = await page.evaluate(
      async (families) => {
        const text = document.body.textContent ?? "";
        const regular = await document.fonts.load('16px "Noto Sans JP"', text);
        const bold = await document.fonts.load(
          'bold 16px "Noto Sans JP"',
          text,
        );
        for (const family of families) {
          await document.fonts.load(`16px "${family}"`, text);
          await document.fonts.load(`bold 16px "${family}"`, text);
        }
        await document.fonts.ready;
        await new Promise((done) => requestAnimationFrame(done));
        return {
          regular: regular.length,
          bold: bold.length,
          check: document.fonts.check('16px "Noto Sans JP"', text),
        };
      },
      PINNED_FONTS.map((font) => font.family).slice(1),
    );
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

    // **固定した書体の外で描かれた字が 1 つでもあれば刷らない**（設計書 §4）。
    // 手元では端末の書体が黙って代わりに描き、PDF は正しく見える——**runner に
    // その書体が在るかは分からない**ので、在ってもなくても同じ結果にする。
    const provenance = await fontProvenance(page);
    if (provenance.problems.length > 0) {
      console.error(
        `manual NG — ${name}: 固定した書体（${PINNED_FONTS.map((font) => font.family).join(" / ")}）の外で描かれた字がある。` +
          "書体を足すなら測ってから足す（markdown.ts の PINNED_FONTS）:\n" +
          provenance.problems.join("\n"),
      );
      exitCode = 1;
      await page.close();
      continue;
    }
    if (provenance.checked < MIN_CHECKED) {
      console.error(
        `manual NG — ${name}: 書体を確かめた要素が ${provenance.checked} 個しか無い（下限 ${MIN_CHECKED}）`,
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
      `manual: ${name} → ${out}（${pdf.length} バイト、${seconds} 秒、書体 ${fonts.regular}+${fonts.bold} face、書体を確かめた要素 ${provenance.checked}）`,
    );
  }
} finally {
  await browser.close();
}
process.exit(exitCode);
