import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeFonts,
  fontFaceCss,
  PINNED_FONTS,
  renderManual,
  unpinnedGlyphs,
} from "../../scripts/manual/markdown.ts";

/**
 * **PDF と写真の文字を描く書体の番人**（設計書 `2026-09-10-manuals-design.md`
 * §4、計画 T3）。書体が当たったかどうかは Chromium に尋ねるしかなく、それは
 * `pnpm manual`（`build.mjs`）と `pnpm shots`（`pinned-font.ts`）が走るときに
 * 見る。ここが見るのは、その判定の純関数と、**固定した書体が本当に固定されて
 * いること**（版・名乗る名前・並び）である。
 */

const WEB = join(import.meta.dirname, "..", "..");

const devDependencies = (
  JSON.parse(readFileSync(join(WEB, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
  }
).devDependencies;

describe("固定した書体", () => {
  it("和文の書体を先頭に、足りない字を描く 2 つを後ろに並べる", () => {
    // **並びが優先順である。** 和文の書体より前に別の書体を置くと、
    // 英数字と記号の形が PDF ごと変わる。
    expect(PINNED_FONTS.map((font) => font.family)).toEqual([
      "Noto Sans JP",
      "Arimo",
      "Noto Sans Symbols 2",
    ]);
  });

  it.each(PINNED_FONTS.map((font) => [font.package]))(
    "%s は web の devDependencies に厳密な版で在る",
    (name) => {
      // **範囲で書かない**（CLAUDE.md「道具の版は固定する」）。`^` を付けると
      // lockfile を作り直した日に、測っていない版の書体が描く。
      expect(devDependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );

  it.each(PINNED_FONTS.map((font) => [font.package, font.family]))(
    "%s の CSS は '%s' を名乗り、書き換えられる",
    (name, family) => {
      // **本物の包みで確かめる。** 名乗る名前が変わった日に、頁が名指す
      // 書体はどこにも無くなり、端末の書体が黙って描く。
      const css = readFileSync(
        join(WEB, "node_modules", name, "400.css"),
        "utf8",
      );
      const out = fontFaceCss(css, "https://m.invalid/fonts");
      expect(out).toContain(`font-family: '${family}'`);
      expect(out).not.toContain("url(./files/");
    },
  );

  it("頁は固定した書体だけを、並びのとおりに名指す", () => {
    const html = renderManual("# 題\n\n本文", {
      fontCss: "",
      title: "試験",
      lang: "ja",
      shots: new Map(),
    });
    expect(html).toContain(
      'font-family: "Noto Sans JP", "Arimo", "Noto Sans Symbols 2", sans-serif;',
    );
  });
});

describe("unpinnedGlyphs", () => {
  const web = (familyName: string, glyphCount: number) => ({
    familyName,
    postScriptName: familyName.replaceAll(" ", ""),
    isCustomFont: true,
    glyphCount,
  });
  const system = (familyName: string, glyphCount: number) => ({
    familyName,
    isCustomFont: false,
    glyphCount,
  });

  it("固定した書体だけが描いたなら 0", () => {
    expect(unpinnedGlyphs([web("Noto Sans JP", 12), web("Arimo", 1)])).toBe(0);
  });

  it("端末の書体が描いた字を数える", () => {
    // 2026-09-11 に測った形そのもの——`【▸∠】` の `▸` を DejaVu Sans が描いた。
    expect(
      unpinnedGlyphs([web("Noto Sans JP", 3), system("DejaVu Sans", 1)]),
    ).toBe(1);
    expect(unpinnedGlyphs([system("Arimo", 2), system("DejaVu Sans", 1)])).toBe(
      3,
    );
  });

  it("書体の名前ではなく、読み込んだ書体かどうかで分ける", () => {
    // **`Arimo` は端末にも在る**（2026-09-11 の作業機。`ʸ` `ˣ` `π` を描いていた）。
    // 名前で分けると、端末の Arimo を固定した書体と取り違える。
    expect(unpinnedGlyphs([system("Arimo", 1)])).toBe(1);
    expect(unpinnedGlyphs([web("Arimo", 1)])).toBe(0);
  });

  it("描いた書体を読める形で並べる", () => {
    expect(
      describeFonts([web("Noto Sans JP", 3), system("DejaVu Sans", 1)]),
    ).toBe("Noto Sans JP(web)×3, DejaVu Sans(system)×1");
  });
});
