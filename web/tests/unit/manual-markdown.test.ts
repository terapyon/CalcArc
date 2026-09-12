import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractChapters,
  extractKeyNames,
  extractShotRefs,
  fontFaceCss,
  joinCjkLines,
  manualLang,
  manualTitle,
  pdfName,
  renderManual,
} from "../../scripts/manual/markdown.ts";

/**
 * マニュアルを PDF にする道具の純関数（設計書 `2026-09-10-manuals-design.md`
 * §2・§4、計画 T2）。**CLI（`scripts/manual/build.mjs`）も同じ関数を通る。**
 */

const FIXTURE = readFileSync(
  join(import.meta.dirname, "fixtures", "manual", "sample.ja.md"),
  "utf8",
);

const RENDER = {
  fontCss: "",
  title: "試験",
  lang: "ja" as const,
};

describe("マニュアルの印の抜き出し", () => {
  it("finds every key name with its line", () => {
    expect(
      extractKeyNames("前\n【返済月額】と【賞与】\n\n表 | 【AC】 |"),
    ).toEqual([
      { name: "返済月額", line: 2 },
      { name: "賞与", line: 2 },
      { name: "AC", line: 4 },
    ]);
  });

  it("does not read a bracket that runs across lines as one name", () => {
    // 改行をまたぐ `【` は書き損じ。拾うと次の行までを 1 つの名前と読む。
    expect(extractKeyNames("【返済\n月額】")).toEqual([]);
  });

  it("finds every shot with its line and description", () => {
    expect(
      extractShotRefs(
        "文\n![画面: 金融・複利残高](shot:finance-compound)\n![x](other.png)",
      ),
    ).toEqual([
      { name: "finance-compound", alt: "画面: 金融・複利残高", line: 2 },
    ]);
  });

  it("finds numbered chapters only", () => {
    // 番号の無い `##`（英語版の用語表）と `###` は章に数えない。
    expect(
      extractChapters(
        "# 題\n## Glossary\n## 1. はじめに\n### 1.1 小節\n## 2. Tabs  \n##3. 詰めた",
      ),
    ).toEqual([
      { number: 1, title: "はじめに", line: 3 },
      { number: 2, title: "Tabs", line: 5 },
    ]);
  });

  it("reads the fixture manual", () => {
    // **件数を主張する。** 抜き出しの正規表現が壊れて 0 件になっても、
    // 「知らない名前 0 件」は緑になる。
    expect(extractKeyNames(FIXTURE).length).toBeGreaterThanOrEqual(10);
    expect(extractShotRefs(FIXTURE).map((ref) => ref.name)).toEqual([
      "finance",
    ]);
  });
});

describe("マニュアルの HTML", () => {
  it("replaces a shot marker with the given image", () => {
    const html = renderManual("![画面: 金融](shot:finance)", {
      ...RENDER,
      shots: new Map([["finance", "https://example.invalid/finance.png"]]),
    });
    expect(html).toContain(
      '<img src="https://example.invalid/finance.png" alt="画面: 金融">',
    );
    expect(html).not.toContain("shot:");
  });

  it("refuses a shot that is not in the map, naming its line", () => {
    // **壊れた画像の枠を載せた PDF を作らない。**
    expect(() =>
      renderManual("文\n\n![画面](shot:nowhere)", {
        ...RENDER,
        shots: new Map(),
      }),
    ).toThrow("3 行目 shot:nowhere");
  });

  it("refuses a shot marker written with a name the extractor cannot read", () => {
    // 抜き出しが拾えない綴り（大文字）でも、描画で落ちる——黙って通さない。
    expect(() =>
      renderManual("![画面](shot:Finance)", {
        ...RENDER,
        shots: new Map([["finance", "x.png"]]),
      }),
    ).toThrow("写真が無い: shot:Finance");
  });

  it("refuses a shot marker that is not an image", () => {
    // `!` を落とすとリンクになる。PDF の中で押しても行き先は無い。
    expect(() =>
      renderManual("[画面](shot:finance)", {
        ...RENDER,
        shots: new Map([["finance", "x.png"]]),
      }),
    ).toThrow("画像にならずに残った");
  });

  it("refuses an image that is not a shot", () => {
    // マニュアルの写真はリポジトリに置かない（設計書 §2・裁定 #1）。
    expect(() =>
      renderManual("![画面](docs/images/finance.png)", {
        ...RENDER,
        shots: new Map(),
      }),
    ).toThrow("shot: でない画像");
  });

  it("names Noto Sans JP and embeds the given font faces", () => {
    const html = renderManual("# 題\n\n本文", {
      ...RENDER,
      fontCss: "@font-face { font-family: 'Noto Sans JP'; }",
      shots: new Map(),
    });
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("@font-face { font-family: 'Noto Sans JP'; }");
    expect(html).toMatch(/font-family: "Noto Sans JP"/);
  });

  it("does not turn a wrapped Japanese line into a space", () => {
    // Chromium は日本語の間の改行を空白として描く——折り返して書いた文の
    // 途中に空白が出る。
    const html = renderManual("日本語の\n文が続く。\nEnglish\nwords", {
      ...RENDER,
      shots: new Map(),
    });
    expect(html).toContain("日本語の文が続く。");
    expect(html).toContain("English\nwords");
  });

  it("leaves code untouched", () => {
    const html = renderManual("```\n日本\n語\n```", {
      ...RENDER,
      shots: new Map(),
    });
    expect(html).toContain("日本\n語");
  });
});

describe("書体と名前", () => {
  it("points the font files at the page's origin", () => {
    const css =
      "src: url(./files/a.woff2) format('woff2'), url(./files/a.woff)";
    expect(fontFaceCss(css, "https://m.invalid/fonts")).toBe(
      "src: url(https://m.invalid/fonts/a.woff2) format('woff2'), url(https://m.invalid/fonts/a.woff)",
    );
  });

  it("refuses font CSS it cannot rewrite", () => {
    // 包みの綴りが変わった日に、書体の無い @font-face を黙って埋め込まない。
    expect(() => fontFaceCss("src: url(a.woff2)", "x")).toThrow();
  });

  it("rewrites the real package's CSS", () => {
    // **本物の包みで確かめる。** 上の 1 行は綴りを自分で書いており、
    // 包みが綴りを変えても緑のままになる。
    const css = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "node_modules",
        "@fontsource",
        "noto-sans-jp",
        "400.css",
      ),
      "utf8",
    );
    const out = fontFaceCss(css, "https://m.invalid/fonts");
    expect(out).not.toContain("url(./files/");
    expect(out).toContain("font-family: 'Noto Sans JP'");
  });

  it("names the PDF from the file and the version", () => {
    expect(pdfName("quick.ja.md", "0.9.0")).toBe("calcarc-0.9.0-quick-ja.pdf");
    expect(pdfName("detail.ja.md", "1.0.0")).toBe(
      "calcarc-1.0.0-detail-ja.pdf",
    );
  });

  it("reads the language from the file name", () => {
    expect(manualLang("quick.en.md")).toBe("en");
    expect(manualLang("quick.ja.md")).toBe("ja");
  });

  it("takes the title from the first heading", () => {
    expect(manualTitle("前書き\n# CalcArc の手引き\n## 節", "x")).toBe(
      "CalcArc の手引き",
    );
    expect(manualTitle("見出し無し", "quick.ja.md")).toBe("quick.ja.md");
  });

  it("joins lines only between Japanese characters", () => {
    expect(joinCjkLines("あ\nい\nう")).toBe("あいう");
    expect(joinCjkLines("あ\nB")).toBe("あ\nB");
  });
});
