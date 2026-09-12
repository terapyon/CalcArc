import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PINNED_FONTS,
  type PinnedFont,
} from "../../scripts/manual/markdown.ts";
import type { Page } from "../e2e/fixtures";

/**
 * **写真の書体を固定する**(マニュアルの設計書 §3、裁定 #6)。
 *
 * 画面の書体は `web/src/ui/tokens.css` の `font-family: system-ui, sans-serif`
 * で、**端末の書体を使う。** 日本語の書体が無い runner で撮ると、写真の
 * 日本語が豆腐(□)になる。そこで撮る前に固定した書体(`PINNED_FONTS`、
 * `web` の `devDependencies` に版を固定してある)を画面に当てる。
 * **代わりに、写真は利用者が見る画面と書体が違う**——それを承知で採った
 * のが裁定 #6 である。
 *
 * **書体の並びは PDF と同じ 1 か所から読む**(`scripts/manual/markdown.ts` の
 * `PINNED_FONTS`)。和文は `Noto Sans JP`、それが持たないキー名の字
 * (`ʸ` `ˣ` `▸`)は後ろの書体が描く——**2026-09-11 に測るまで、写真のこの 3 字は
 * 端末の書体(`Arimo` と `DejaVu Sans`)が描いていた。**
 *
 * **当てただけでは信じない。当たったことを確かめてから撮る**(`provePinnedFont`)。
 */

const NODE_MODULES = join(import.meta.dirname, "..", "..", "node_modules");

const [FIRST_FONT, ...FALLBACK_FONTS] = PINNED_FONTS;

/**
 * 和文の書体。**先頭が `@fontsource/noto-sans-jp` でなければ投げる**——下の
 * 和文の断片の切り出しは、この包みの綴り(`noto-sans-jp-[n]`)を読む。
 */
const JAPANESE_FONT: PinnedFont = (() => {
  if (FIRST_FONT?.package !== "@fontsource/noto-sans-jp") {
    throw new Error("PINNED_FONTS の先頭が @fontsource/noto-sans-jp ではない");
  }
  return FIRST_FONT;
})();

const packageDir = (name: string) => join(NODE_MODULES, name);

/**
 * **表示部の和文だけに当てる別名。** 表示部は `--display-font`(等幅)で、
 * 数字の桁を揃えるためにそこは変えない。等幅の書体は和文を持たないことが
 * 多く、和文は端末の書体へ落ちる——2026-09-10 の作業機では
 * `Noto Sans Mono CJK JP`(端末の書体)が描いていた(CDP で実測)。
 * **和文だけを受け持つ別名を先頭に置く**と、和文は固定の書体、英数字は
 * 等幅のまま、になる。
 */
const DISPLAY_FAMILY = "CalcArc Shots JP";

/**
 * **当てる太さ。** 画面が使う太さは 2 つ——既定の 400 と、
 * `tokens.css` の `--key-font-weight-emphasis: 600`(CSS Modules の
 * `font-weight` はすべてこの変数を指す。2026-09-10 に grep で確かめた)。
 * 読み上げ用の `<h1>` は既定で太字(700)だが画面に出ない。
 * **足し忘れても豆腐にはならない**——近い太さの同じ書体が描く。豆腐を
 * 見張るのは `provePinnedFont` である。包みに無い太さは読まない
 * (`Noto Sans Symbols 2` は 400 だけを持つ)。
 */
const WEIGHTS = [400, 600] as const;

/** 書体のファイルを配る道。**このページの外には出ない**(`page.route` が答える)。 */
const FONT_PATH = "/__shots/fonts/";

/**
 * CDP が返す書体の `postScriptName` の頭。`Noto Sans JP` の包みは
 * `NotoSansJPThin-Regular` を名乗る(2026-09-11 実測)——**名前の空白を
 * 落とした綴りで始まる**ことで見分ける。
 */
const PINNED_POSTSCRIPT = PINNED_FONTS.map((font) =>
  font.family.replaceAll(" ", ""),
);

/** 1 文字でも Latin-1 に掛かる範囲は、表示部の別名から外す。 */
function withoutLatin1(range: string): string[] {
  return range
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const start = /^U\+([0-9a-f?]+)/i.exec(part)?.[1];
      if (start === undefined) return false;
      return Number.parseInt(start.replaceAll("?", "0"), 16) > 0xff;
    });
}

/** 固定した書体のファイル名 → 手元のパス。**名前が重なったら投げる。** */
function fontFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const font of PINNED_FONTS) {
    const dir = join(packageDir(font.package), "files");
    for (const name of readdirSync(dir)) {
      if (files.has(name)) {
        throw new Error(`書体のファイル名が 2 つの包みで重なった: ${name}`);
      }
      files.set(name, join(dir, name));
    }
  }
  return files;
}

/** 1 つの包みの、1 つの太さの CSS。**名乗る名前を確かめてから使う。** */
function packageCss(
  font: (typeof PINNED_FONTS)[number],
  weight: number,
): string | null {
  const path = join(packageDir(font.package), `${weight}.css`);
  if (!existsSync(path)) return null;
  const css = readFileSync(path, "utf-8");
  if (!css.includes(`font-family: '${font.family}'`)) {
    throw new Error(
      `${font.package}/${weight}.css が '${font.family}' を名乗っていない`,
    );
  }
  return css.replaceAll("url(./files/", `url(${FONT_PATH}`);
}

/** 当てる CSS(`@font-face` 一式)。**ファイルは `node_modules` から読む。** */
function fontFaces(): string {
  const out: string[] = [];
  for (const weight of WEIGHTS) {
    const local = packageCss(JAPANESE_FONT, weight);
    if (local === null) {
      throw new Error(`${JAPANESE_FONT.package}/${weight}.css が無い`);
    }
    out.push(local);
    // 番号付きの断片(`noto-sans-jp-[0]` …)が和文を持つ。Latin-1 に掛かる
    // 範囲は外す(英数字は等幅の書体に残す)。
    let slices = 0;
    for (const face of local.matchAll(
      /\/\* noto-sans-jp-\[\d+\]-\d+-normal \*\/\s*@font-face\s*\{([^}]*)\}/g,
    )) {
      const body = face[1] ?? "";
      const range = /unicode-range:([^;]*);/.exec(body)?.[1] ?? "";
      const kept = withoutLatin1(range);
      slices += 1;
      if (kept.length === 0) continue;
      out.push(
        `@font-face {${body
          .replace(/font-family:[^;]*;/, `font-family: '${DISPLAY_FAMILY}';`)
          .replace(
            /unicode-range:[^;]*;/,
            `unicode-range: ${kept.join(",")};`,
          )}}`,
      );
    }
    // **件数を先に主張する。** 綴りが変わって 0 件になると、表示部の和文だけが
    // 黙って端末の書体へ落ちる(`provePinnedFont` が見つけはするが、ここで止める)。
    if (slices < 100) {
      throw new Error(`${weight}.css の和文の断片が ${slices} 件しか無い`);
    }
  }
  for (const font of FALLBACK_FONTS) {
    const faces = WEIGHTS.map((weight) => packageCss(font, weight)).filter(
      (css): css is string => css !== null,
    );
    if (faces.length === 0) {
      throw new Error(
        `${font.package} に ${WEIGHTS.join(" / ")} の CSS が無い`,
      );
    }
    out.push(...faces);
  }
  return out.join("\n");
}

/** 書体を画面に当て、読み込みが終わるまで待つ。 */
export async function applyPinnedFont(page: Page): Promise<void> {
  const files = fontFiles();
  await page.route(`**${FONT_PATH}*`, async (route) => {
    const name = new URL(route.request().url()).pathname.slice(
      FONT_PATH.length,
    );
    const path = files.get(name);
    if (path === undefined) {
      await route.fulfill({ status: 404 });
      return;
    }
    await route.fulfill({
      body: readFileSync(path),
      contentType: name.endsWith(".woff2") ? "font/woff2" : "font/woff",
    });
  });
  // 等幅の並びは `tokens.css` から読む(ここに写さない)。
  const display = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--display-font")
      .trim(),
  );
  if (display === "") throw new Error("--display-font が読めない");
  const body = PINNED_FONTS.map((font) => `"${font.family}"`).join(", ");
  await page.addStyleTag({
    content: `${fontFaces()}
body { font-family: ${body}, sans-serif !important; }
:root { --display-font: "${DISPLAY_FAMILY}", ${display} !important; }`,
  });
  await page.evaluate(
    async (families) => {
      const text = document.body.textContent ?? "";
      await Promise.all(
        families.flatMap((family) =>
          [400, 600].map((weight) =>
            document.fonts.load(`${weight} 16px "${family}"`, text),
          ),
        ),
      );
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    },
    [...PINNED_FONTS.map((font) => font.family), DISPLAY_FAMILY],
  );
}

/** CDP の `DOM.Node` のうち、ここで使う部分。 */
interface DomNode {
  nodeId: number;
  nodeType: number;
  nodeValue: string;
  localName: string;
  attributes?: string[];
  children?: DomNode[];
}

/** 和文(かな・漢字・全角)。**豆腐になるのはここである。** */
const JAPANESE = /[　-ヿ㐀-鿿＀-￯]/gu;

/**
 * **書体が当たったことを、描いた書体で確かめる。** 当たっていなければ投げる
 * ——**豆腐の写真を書き出す前に止まる。**
 *
 * **`document.fonts.check` は使わない。** 2026-09-10 に実測すると、
 * 実在しない書体名(`"Bogus Font"`)にも `true` を返した——読み込むべき
 * 書体が無ければ「読み込み済み」と答える。**何も証明しない。**
 * 算出値の `font-family` も同じで、**名前を書いたこと**しか言わない。
 *
 * **Chromium の CDP(`CSS.getPlatformFontsForNode`)は、要素の文字を
 * 実際に描いた書体と字数を返す。** 文字を持つ要素ごとに、**端末の書体が
 * 描いてよい字**を決め、端末の書体が描いた字数がそれを超えたら落とす:
 *
 * - **本文の書体の要素では 1 字も**端末の書体に描かせない——和文も ASCII も
 *   記号も、固定した書体が描く。**PDF と同じ規則である**(`build.mjs`)。
 *   2026-09-11 までは記号だけ端末の書体に任せていて、`【eˣ】` `【xʸ】`
 *   `【▸∠】` の 3 字は手元の `Arimo` と `DejaVu Sans` が描いていた。
 *   **和文だけを見ると Scientific は何も確かめられない**——盤面が英数字だけで、
 *   和文は読み上げ用の `<h1>`・押せないキーの説明・フッタにしか無い
 *   (2026-09-10 に 4 件しか数えられず、下限で落ちた)
 * - **表示部(`--display-font`)では和文だけ**を固定した書体に描かせる。
 *   英数字と記号(`×` など)は等幅の書体のままでよい——**等幅の書体は端末の
 *   書体である**(`tokens.css`)。ここまで固定を求めると、表示部の数字を
 *   固定の書体へ差し替えることになり、桁の揃った表示が写真から消える。
 *   **そちらは端末に依るまま撮る**(写真の表示部の英数字の形は runner の
 *   等幅の書体で決まる)
 *
 * **この書体の字数からは数えない。** 合字があるので字数は文字数より
 * 少なくなりうる——`Scientific` は 10 文字で 9 字だった(`fi` が 1 字。
 * 2026-09-10 実測)。**端末の書体の側から上限で挟めば、合字は字数を
 * 減らすだけなので誤って落とさない。**
 *
 * 描かれていない要素(閉じた `<select>` の `<option>`)は書体を返さないので
 * 数えない。**写真の外のフッタも数える**(同じ書体が当たっているはずである)。
 * 撮影は Chromium だけで回す(`playwright.shots.config.ts`)。
 */
export async function provePinnedFont(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });

  const problems: string[] = [];
  let checked = 0;
  const visit = async (node: DomNode, inApp: boolean): Promise<void> => {
    const attrs = node.attributes ?? [];
    const here = inApp || (attrs[0] === "id" && attrs[1] === "root");
    if (here && node.nodeType === 1) {
      const text = (node.children ?? [])
        .filter((child) => child.nodeType === 3)
        .map((child) => child.nodeValue)
        .join("");
      const { fonts } =
        text.trim() === ""
          ? { fonts: [] }
          : await cdp.send("CSS.getPlatformFontsForNode", {
              nodeId: node.nodeId,
            });
      if (fonts.length > 0) {
        checked += 1;
        const { computedStyle } = await cdp.send(
          "CSS.getComputedStyleForNode",
          {
            nodeId: node.nodeId,
          },
        );
        const family =
          computedStyle.find((p) => p.name === "font-family")?.value ?? "";
        const display = family.includes(DISPLAY_FAMILY);
        const japanese = text.match(JAPANESE)?.length ?? 0;
        // 端末の書体が描いてよい字数。本文の書体の要素では 0 字。
        const allowed = display ? [...text].length - japanese : 0;
        const system = fonts
          .filter(
            (f) =>
              !(
                f.isCustomFont &&
                PINNED_POSTSCRIPT.some((name) =>
                  f.postScriptName.startsWith(name),
                )
              ),
          )
          .reduce((n, f) => n + f.glyphCount, 0);
        if (system > allowed) {
          problems.push(
            `<${node.localName}> ${JSON.stringify(text.trim())} (the system font may draw ${allowed}): ${fonts
              .map(
                (f) =>
                  `${f.familyName}(${f.isCustomFont ? "web" : "system"})×${f.glyphCount}`,
              )
              .join(", ")}`,
          );
        }
      }
    }
    for (const child of node.children ?? []) await visit(child, here);
  };
  await visit(root, false);
  await cdp.detach();

  if (problems.length > 0) {
    throw new Error(
      `the pinned fonts (${PINNED_FONTS.map((font) => font.family).join(", ")}) did not draw the text:\n${problems.join("\n")}`,
    );
  }
  // **件数を先に主張する。** 何も数えずに「違反 0 件」で通さない。
  if (checked < 10) {
    throw new Error(`only ${checked} elements with text were checked`);
  }
}
