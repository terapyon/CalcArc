// マニュアルの Markdown を読む・HTML にする純関数（設計書
// `2026-09-10-manuals-design.md` §2・§4・§6）。
//
// **ファイルもブラウザも触らない。** 読むのは CLI（`build.mjs`）、確かめるのは
// vitest（`tests/unit/manual-*.test.ts`）で、**両方が同じ関数を通る**
// ——「手元の PDF では通ったが番人では違う」を作らない。
//
// **`.ts` にしてある理由。** `tsconfig.json` の `include` は `src` と `tests` だけで、
// `scripts/` は入っていない。**ただし `tsc` は import を辿る**ので、`tests/unit` の
// テストが import したこのファイルは型検査に載る（`.mjs` は `allowJs` でも
// `checkJs` が無いので検査されない）。Node 24 は型を剥がして `.ts` をそのまま
// 読むので、CLI（`.mjs`）からも import できる——**そのため、剥がせる構文だけで
// 書く**（`enum` や引数プロパティを使わない）。
//
// **`biome` はこのディレクトリを見ない**（`biome.json` の `includes` は `src/**`・
// `tests/**`・直下の `*.ts`）。既存の `scripts/*.mjs` と同じ扱いである。

import { Marked, type Tokens } from "marked";

/** 本文の中の位置。行は 1 始まり（エラーの文言で `file:line` と出すため）。 */
export interface Marker {
  name: string;
  line: number;
}

export interface ShotRef extends Marker {
  /** 画像の説明（`![…]` の中身）。GitHub 上では写真の代わりにこれが出る。 */
  alt: string;
}

export interface ManualFile {
  path: string;
  text: string;
}

export interface UnknownKeyName {
  path: string;
  line: number;
  name: string;
}

/**
 * キー名の印（設計書 §6）。`【返済月額】` のように書く。
 *
 * **1 行の中で閉じるものだけを拾う。** 改行をまたぐ `【` は書き損じであり、
 * 拾うと次の段落までを 1 つの「キー名」と読んでしまう。
 */
const KEY_NAME = /【([^【】\n]+)】/g;

/**
 * 写真の印（設計書 §2）。`![画面: 金融・複利残高](shot:finance-compound)`。
 *
 * **名前に使える文字は台本の名前と同じ形に限る**（英小文字・数字・`-`）。
 * それ以外の綴りは印として拾わない代わりに、`renderManual` が「`shot:` が
 * 残った」で落とす——**黙って壊れた画像にしない。**
 */
const SHOT_REF = /!\[([^\]\n]*)\]\(\s*shot:([a-z0-9-]+)\s*\)/g;

/**
 * 章の見出し。`## 3. 基本の使い方` のように **`##` と番号とピリオド**で書く
 * （設計書 §8 の章立て）。番号の無い `##`（英語版の用語表など）は章に数えない。
 */
const CHAPTER = /^##[ \t]+(\d+)\.[ \t]+(.+?)[ \t]*$/;

export interface Chapter {
  number: number;
  title: string;
  line: number;
}

/** 番号つきの章を、書かれた順に抜き出す。 */
export function extractChapters(markdown: string): Chapter[] {
  const found: Chapter[] = [];
  markdown.split("\n").forEach((text, index) => {
    const match = CHAPTER.exec(text);
    if (match !== null) {
      found.push({
        number: Number(match[1]),
        title: match[2] ?? "",
        line: index + 1,
      });
    }
  });
  return found;
}

/** `【…】` を行番号つきで抜き出す。 */
export function extractKeyNames(markdown: string): Marker[] {
  const found: Marker[] = [];
  markdown.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(KEY_NAME)) {
      found.push({ name: match[1] ?? "", line: index + 1 });
    }
  });
  return found;
}

/** `![…](shot:名前)` を行番号つきで抜き出す。 */
export function extractShotRefs(markdown: string): ShotRef[] {
  const found: ShotRef[] = [];
  markdown.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(SHOT_REF)) {
      found.push({
        name: match[2] ?? "",
        alt: match[1] ?? "",
        line: index + 1,
      });
    }
  });
  return found;
}

/**
 * 画面のラベルに無い `【…】` を返す（設計書 §6 の番人の判定）。
 *
 * **向きは「画面が正」である。** `known` は画面の定義元から集めた集合で、
 * マニュアルの綴りから組み立てない——**画面（承認済み）を正としてマニュアルを
 * 直す**（設計書 §6「期待値をマニュアル側から組み立てない」）。
 */
export function findUnknownKeyNames(
  files: readonly ManualFile[],
  known: ReadonlySet<string>,
): UnknownKeyName[] {
  const unknown: UnknownKeyName[] = [];
  for (const file of files) {
    for (const marker of extractKeyNames(file.text)) {
      if (!known.has(marker.name)) {
        unknown.push({ path: file.path, line: marker.line, name: marker.name });
      }
    }
  }
  return unknown;
}

/**
 * 出力の PDF の名前。`quick.ja.md` と `0.9.0` から `calcarc-0.9.0-quick-ja.pdf`。
 *
 * **版数をファイル名に入れる。** Release に付いた PDF を手元に落としたとき、
 * どの版の画面を書いたものかが名前だけで分かる。
 */
export function pdfName(fileName: string, version: string): string {
  const stem = fileName.replace(/\.md$/, "").replaceAll(".", "-");
  return `calcarc-${version}-${stem}.pdf`;
}

/** 文書の言語。`*.en.md` だけが英語で、ほかは日本語（設計書 §2 の 3 冊）。 */
export function manualLang(fileName: string): "ja" | "en" {
  return fileName.endsWith(".en.md") ? "en" : "ja";
}

/**
 * `@fontsource/noto-sans-jp` の CSS の `url(./files/…)` を、PDF を刷るページから
 * 読める場所に書き換える（設計書 §4「PDF の HTML に `@font-face` で埋め込む」）。
 *
 * **1 つも書き換えなかったら落とす。** 包みの中身の綴りが変わった日に、
 * 書体の無い `@font-face` を黙って埋め込むことになる。
 */
export function fontFaceCss(css: string, baseUrl: string): string {
  let replaced = 0;
  const out = css.replaceAll("url(./files/", () => {
    replaced += 1;
    return `url(${baseUrl}/`;
  });
  if (replaced === 0) {
    throw new Error(
      "書体の CSS に url(./files/…) が 1 つも無い（@fontsource の中身の綴りが変わった？）",
    );
  }
  return out;
}

/**
 * 日本語の文字。**行を折り返して書いた本文の改行を、HTML で空白にしない**ために使う。
 *
 * Markdown では段落の中の改行は空白 1 つになる。英語ならそれが語の区切りだが、
 * 日本語では**文の途中に余計な空白が出る**——このリポジトリの文書は日本語の
 * 行を 80 字前後で折り返して書いている（この設計書自体がそうである）。
 */
const CJK =
  "[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー、。，．「」『』（）【】・：！？]";
const CJK_BREAK = new RegExp(`(${CJK})\\n(${CJK})`, "gu");

/** 日本語の文字どうしに挟まれた改行を取り除く。**コードの中身には使わない。** */
export function joinCjkLines(text: string): string {
  // 1 回の置換では `あ\nい\nう` の真ん中の `い` が 2 つの一致で共有されて
  // 片方しか取れない——取れなくなるまで繰り返す。
  let current = text;
  for (;;) {
    const next = current.replace(CJK_BREAK, "$1$2");
    if (next === current) return current;
    current = next;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

export interface RenderOptions {
  /** 写真の名前 → ページから読める URL。**無い名前は落とす。** */
  shots: ReadonlyMap<string, string>;
  /** `fontFaceCss` が返した `@font-face` の並び。 */
  fontCss: string;
  title: string;
  lang: "ja" | "en";
}

/** 固定した書体 1 つ。`package` は `web` の `devDependencies` に厳密な版で在る。 */
export interface PinnedFont {
  package: string;
  /** その包みの CSS が名乗る `font-family`。 */
  family: string;
}

/**
 * **PDF と写真の文字を描いてよい書体の全部**（設計書 §4）。並びが優先順で、
 * **和文の書体を先頭に置き、それが持たない字だけを後ろが描く。**
 *
 * **Noto Sans JP だけでは足りなかった**（2026-09-11、3 冊の全 19,514 字を 1 字ずつ
 * CDP の `CSS.getPlatformFontsForNode` で測った）。端末の書体が描いていたのは 4 字
 * ——`ʸ`（U+02B8）・`ˣ`（U+02E3）・`π`（U+03C0）を `Arimo`、`▸`（U+25B8）を
 * `DejaVu Sans`。どれも画面のキー名（`【xʸ】`・`【eˣ】`・`【π】`・`【▸∠】`）で、
 * **綴りを変えられない。** 手元の端末の書体に落ちていただけで、runner に何が
 * 在るかは分からない。
 *
 * - `Arimo` が `ʸ` `ˣ` `π` を描く（`Noto Sans` も描くが包みが 3 倍大きい。
 *   `Noto Sans Symbols 2` は範囲を名乗るが字を持たず、端末の書体へ落ちた）
 * - `Noto Sans Symbols 2` が `▸` を描く（`Arimo` は持たない）
 *
 * **ここに無い書体が 1 字でも描いたら、PDF を作らずに落ちる**（`build.mjs`）。
 * 書体を足すなら、測ってから足す。
 */
export const PINNED_FONTS: readonly PinnedFont[] = [
  { package: "@fontsource/noto-sans-jp", family: "Noto Sans JP" },
  { package: "@fontsource/arimo", family: "Arimo" },
  { package: "@fontsource/noto-sans-symbols-2", family: "Noto Sans Symbols 2" },
];

/** `font-family` に書く並び。 */
const FAMILIES = PINNED_FONTS.map((font) => `"${font.family}"`).join(", ");

/**
 * CDP（`CSS.getPlatformFontsForNode`）が返す、要素の字を描いた書体 1 つ。
 * 綴りは Chrome DevTools Protocol の `CSS.PlatformFontUsage` から写している。
 */
export interface PlatformFont {
  familyName: string;
  postScriptName?: string;
  /** `@font-face` で読み込んだ書体なら true、端末の書体なら false。 */
  isCustomFont: boolean;
  glyphCount: number;
}

/**
 * **端末の書体が描いた字数**。0 でなければ、その要素は固定した書体の外で描かれた。
 *
 * **`isCustomFont` だけで分けてよいのは、PDF を刷る頁が固定した書体しか
 * 読めないからである**——`build.mjs` は `PINNED_FONTS` の包みのファイルだけを
 * 配り、それ以外の通信はすべて塞ぐ。`@font-face` で読み込めた書体は、ここに
 * 在るものだけである。
 */
export function unpinnedGlyphs(fonts: readonly PlatformFont[]): number {
  return fonts
    .filter((font) => !font.isCustomFont)
    .reduce((sum, font) => sum + font.glyphCount, 0);
}

/** `Arimo(system)×1, Noto Sans JP(web)×3` の形。エラーの文言に使う。 */
export function describeFonts(fonts: readonly PlatformFont[]): string {
  return fonts
    .map(
      (font) =>
        `${font.familyName}(${font.isCustomFont ? "web" : "system"})×${font.glyphCount}`,
    )
    .join(", ");
}

/** PDF のための頁の見た目。**書体は固定した書体だけを名指しする**（設計書 §4）。 */
const PAGE_CSS = `
html { font-family: ${FAMILIES}, sans-serif; font-size: 10.5pt; line-height: 1.7; color: #1c1c1e; }
body { margin: 0; }
h1 { font-size: 20pt; margin: 0 0 12pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; border-bottom: 1px solid #c7c7cc; padding-bottom: 2pt; break-after: avoid; }
h3 { font-size: 12pt; margin: 12pt 0 4pt; break-after: avoid; }
table { border-collapse: collapse; margin: 6pt 0; }
th, td { border: 1px solid #c7c7cc; padding: 3pt 6pt; text-align: left; vertical-align: top; }
code { font-family: ${FAMILIES}, monospace; background: #f2f2f7; padding: 0 2pt; }
figure.shot { margin: 8pt 0; text-align: center; break-inside: avoid; }
figure.shot img { max-width: 100%; max-height: 120mm; border: 1px solid #c7c7cc; }
figure.shot figcaption { font-size: 9pt; color: #636366; }
`;

/**
 * Markdown を、PDF に刷る 1 枚の HTML にする（設計書 §4 の 1・2）。
 *
 * - `![…](shot:名前)` を `shots` の写真に差し替える。**`shots` に無い名前は
 *   落とす**——壊れた画像の枠を載せた PDF を作らない
 * - **`shot:` 以外の画像は書かせない。** マニュアルの写真はリポジトリに置かない
 *   （設計書 §2・§3、裁定 #1）ので、`shot:` でない画像はどこからも来ない
 */
export function renderManual(markdown: string, options: RenderOptions): string {
  // **先に全部を行番号つきで数える。** 描画の途中で落とすと最初の 1 つしか
  // 言えず、しかも行が分からない。
  const missing = extractShotRefs(markdown).filter(
    (ref) => !options.shots.has(ref.name),
  );
  if (missing.length > 0) {
    throw new Error(
      `写真が無い: ${missing.map((ref) => `${ref.line} 行目 shot:${ref.name}`).join(", ")}`,
    );
  }

  const marked = new Marked({
    walkTokens(token) {
      // **地の文だけ**を繋ぐ。`code` と `codespan` は別の型なので触れない。
      if (token.type === "text") {
        const text = token as Tokens.Text;
        text.text = joinCjkLines(text.text);
      }
    },
    renderer: {
      image({ href, text }: Tokens.Image) {
        const name = href.startsWith("shot:")
          ? href.slice("shot:".length)
          : null;
        if (name === null) {
          throw new Error(`shot: でない画像がある: ${href}`);
        }
        const url = options.shots.get(name);
        // **上の数え上げと描画が食い違ったとき**の最後の網（`SHOT_REF` が拾わない
        // 綴り——大文字や空白を含む名前——はここに来る）。
        if (url === undefined) {
          throw new Error(`写真が無い: shot:${name}`);
        }
        const alt = escapeHtml(text);
        return `<figure class="shot"><img src="${escapeHtml(url)}" alt="${alt}"><figcaption>${alt}</figcaption></figure>`;
      },
    },
  });
  const body = marked.parse(markdown, { async: false });

  // **`shot:` が画像にならずに残った**なら、印の書き損じである（`[…](shot:…)` の
  // `!` 抜けなど）。リンクのまま PDF に載っても押せる先は無い。
  if (/(?:href|src)="shot:/.test(body)) {
    throw new Error(
      "shot: の印が画像にならずに残った（`![…](shot:名前)` の形で書く）",
    );
  }

  return [
    "<!doctype html>",
    `<html lang="${options.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeHtml(options.title)}</title>`,
    `<style>${options.fontCss}\n${PAGE_CSS}</style>`,
    "</head>",
    `<body>${body}</body>`,
    "</html>",
  ].join("\n");
}

/** 最初の `# 見出し`。無ければ `fallback`。PDF の題名（`<title>`）になる。 */
export function manualTitle(markdown: string, fallback: string): string {
  const match = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/m.exec(markdown);
  return match?.[1] ?? fallback;
}
