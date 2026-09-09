import { describe, expect, it } from "vitest";
import {
  findBoundaryViolations,
  findTouchTargetOutsideTokens,
  findUiLeakIntoCalc,
  findVisuallyHiddenOutsideTokens,
  readWebFiles,
} from "../check-boundary.mjs";

// **向きは片方向である**(CLAUDE.md)。`web` から重量級への参照は 0 件で、
// この向きを保つ。逆(`heavy` が `web` を読む)は正常なので見ない。

describe("findBoundaryViolations", () => {
  it("web が heavy を名指ししていたら見つける", () => {
    const found = findBoundaryViolations([
      {
        path: "web/scripts/x.mjs",
        text: 'const HEAVY_MARKER = "Heavy corpus";\n',
      },
    ]);
    expect(found).toEqual([
      {
        path: "web/scripts/x.mjs",
        line: 1,
        text: 'const HEAVY_MARKER = "Heavy corpus";',
      },
    ]);
  });

  it("大文字小文字を問わない", () => {
    expect(
      findBoundaryViolations([{ path: "web/a.ts", text: "heavy-report.md" }]),
    ).toHaveLength(1);
    expect(
      findBoundaryViolations([{ path: "web/a.ts", text: "HEAVY" }]),
    ).toHaveLength(1);
  });

  it("web の外は見ない", () => {
    // `heavy/` 自身と `tools/` は heavy を名乗ってよい。
    expect(
      findBoundaryViolations([
        { path: "heavy/tests/corpus/report.ts", text: "heavy" },
        {
          path: "tools/release-evidence.mjs",
          text: 'const HEAVY_MARKER = "Heavy corpus";',
        },
      ]),
    ).toHaveLength(0);
  });

  it("行番号と中身を返す（どこを直せばよいか分かる形で）", () => {
    const found = findBoundaryViolations([
      { path: "web/b.ts", text: "ok\nok\nimport heavy from 'x'\n" },
    ]);
    expect(found).toEqual([
      { path: "web/b.ts", line: 3, text: "import heavy from 'x'" },
    ]);
  });

  it("いまの web は 1 件も無い（実物で確かめる）", () => {
    // **これが本題である。** D-2（`web` が heavy を知っていた 6 行）は
    // 2026-08-26 の移動で消えた。**消えたままであることを、この検査が見張る。**
    const found = findBoundaryViolations(readWebFiles());
    expect(found).toEqual([]);
  });
});

// **2 本目の向き**: `web/src/calc/` は UI Framework を知らない
// (CLAUDE.md「`web/src/calc/` に React を import しない」)。

describe("findUiLeakIntoCalc", () => {
  it("calc が react を直に import していたら見つける", () => {
    const found = findUiLeakIntoCalc([
      {
        path: "web/src/calc/index.ts",
        text: 'import { useState } from "react";\n',
      },
    ]);
    expect(found).toEqual([
      {
        path: "web/src/calc/index.ts",
        line: 1,
        text: 'import { useState } from "react";',
      },
    ]);
  });

  it("ui 経由でも見つける（react とは書かれていない）", () => {
    // **`web/src/ui/Keypad/Keypad.tsx:1` が react を import している**ので、
    // `calc` から `ui` を読めば React は推移的に入る。**規則の文言ではなく
    // 規則の理由のほうを見張る**、というのがこの 1 件である。
    const found = findUiLeakIntoCalc([
      {
        path: "web/src/calc/x.ts",
        text: 'import { Key } from "../../ui/Key/Key";\n',
      },
    ]);
    expect(found).toHaveLength(1);
  });

  it("react に触れた註釈は違反にしない（語ではなく import を見る）", () => {
    // `src/calc/index.ts:4` に実在する形。**規律を書いた行が規律違反になる**
    // のは検査の側の誤りである。
    const found = findUiLeakIntoCalc([
      { path: "web/src/calc/index.ts", text: " * ここに react を書かない。\n" },
    ]);
    expect(found).toEqual([]);
  });

  it("calc の外は見ない", () => {
    const found = findUiLeakIntoCalc([
      {
        path: "web/src/ui/App.tsx",
        text: 'import { useState } from "react";\n',
      },
      { path: "web/src/finance/index.ts", text: 'import "react";\n' },
    ]);
    expect(found).toEqual([]);
  });

  it("いまの calc は 1 件も無い（実物で確かめる）", () => {
    const found = findUiLeakIntoCalc(readWebFiles());
    expect(found).toEqual([]);
  });
});

describe("findTouchTargetOutsideTokens", () => {
  // **44px を定めているのは base-spec §43 ではない。** §43 が求めるのは
  // "Touch target size" までで、44 を選んだのはこのプロジェクトである
  // (同節の 2026-09-04 の追記)。**選んだ値は 1 か所にだけ置く。**

  it("tokens.css の外で値として書いていたら見つける", () => {
    expect(
      findTouchTargetOutsideTokens([
        { path: "web/src/ui/Key/Key.module.css", text: "  min-width: 44px;\n" },
      ]),
    ).toEqual([
      {
        path: "web/src/ui/Key/Key.module.css",
        line: 1,
        text: "min-width: 44px;",
      },
    ]);
  });

  it("tokens.css 自身は通す（そこが置き場である）", () => {
    expect(
      findTouchTargetOutsideTokens([
        { path: "web/src/ui/tokens.css", text: "  --touch-target-min: 44px;" },
      ]),
    ).toHaveLength(0);
  });

  it("註の中の 44px は違反にしない（理由を書いた行を赤くしない）", () => {
    // 実物にある形。`Keypad.module.css` は「キーには min-width: 44px が
    // 効いており」と、規則そのものを註で説明している。
    expect(
      findTouchTargetOutsideTokens([
        {
          path: "web/src/ui/Keypad/Keypad.module.css",
          text: [
            "  /* キーには min-width: 44px が効いており(Key.module.css)、",
            "     列は 44px より細くならない。7 列 x 44px = 308px。 */",
            "/* 正方のキー。44px はここで守る。 */",
          ].join("\n"),
        },
      ]),
    ).toHaveLength(0);
  });

  it("css 以外は見ない（E2E が 44 を直に書くのは正しい）", () => {
    // テストが期待値を自分で持たず、トークンを読んで突き合わせたら、
    // **両方が同時に間違っても緑になる**。
    expect(
      findTouchTargetOutsideTokens([
        {
          path: "web/tests/e2e/keypad-shell.spec.ts",
          text: "  const min: string = '44px';",
        },
      ]),
    ).toHaveLength(0);
  });

  it("いまの web は 1 件も無い（実物で確かめる）", () => {
    const files = readWebFiles();
    // **何件見たかを主張する。** `git ls-files` が空を返した日に、
    // 「0 件」は何も意味しなくなる。
    expect(
      files.filter((file) => file.path.endsWith(".css")).length,
      "read no css files at all",
    ).toBeGreaterThan(5);
    expect(findTouchTargetOutsideTokens(files)).toEqual([]);
  });
});

describe("findVisuallyHiddenOutsideTokens", () => {
  // **読み上げにだけ届かせる隠し方は 1 つしかない。** `display: none` も
  // `visibility: hidden` もアクセシビリティツリーから要素を消すので、
  // 使えるのは「在るまま画面の外へ出す」一式だけである。**その一式は
  // 1 か所にだけ置く**——散ると、直す日に片方だけが直る。

  it("tokens.css の外で値として書いていたら見つける", () => {
    expect(
      findVisuallyHiddenOutsideTokens([
        {
          path: "web/src/ui/Keypad/Keypad.module.css",
          text: "  clip-path: inset(50%);\n",
        },
      ]),
    ).toEqual([
      {
        path: "web/src/ui/Keypad/Keypad.module.css",
        line: 1,
        text: "clip-path: inset(50%);",
      },
    ]);
  });

  it("tokens.css 自身は通す（そこが置き場である）", () => {
    expect(
      findVisuallyHiddenOutsideTokens([
        { path: "web/src/ui/tokens.css", text: "  clip-path: inset(50%);" },
      ]),
    ).toHaveLength(0);
  });

  it("註の中の綴りは違反にしない（理由を書いた行を赤くしない）", () => {
    // 実物にある形。`Keypad.module.css` の `.offDescription` は、なぜ
    // `display: none` ではないのかを註で説明している。
    expect(
      findVisuallyHiddenOutsideTokens([
        {
          path: "web/src/ui/Keypad/Keypad.module.css",
          text: [
            "/* **読み上げにだけ届く説明**。clip-path: inset(50%) の一式は",
            "   tokens.css の .visually-hidden が持つ。ここでは書かない。 */",
            "/* display: none にすると clip-path: inset(50%) の意味が消える。 */",
          ].join("\n"),
        },
      ]),
    ).toHaveLength(0);
  });

  it("いまの web は 1 件も無い（実物で確かめる）", () => {
    const files = readWebFiles();
    // **何件見たかを主張する。** `git ls-files` が空を返した日に、
    // 「0 件」は何も意味しなくなる（4 本目と同じ形）。
    expect(
      files.filter((file) => file.path.endsWith(".css")).length,
      "read no css files at all",
    ).toBeGreaterThan(5);
    expect(findVisuallyHiddenOutsideTokens(files)).toEqual([]);
  });
});
