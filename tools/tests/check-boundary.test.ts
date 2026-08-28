import { describe, expect, it } from "vitest";
import {
  findBoundaryViolations,
  findUiLeakIntoCalc,
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
